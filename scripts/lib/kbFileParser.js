/**
 * 公式ダウンロードデータ（Kファイル=競走成績、Bファイル=番組表）の全項目パーサー
 *
 * 目的: K/Bファイルの生ファイルを1回だけ取得して保存し、パーサーが拾う項目が増えても
 * 再取得せずに何度でも再解析できるようにする（docs/design/kb-longterm-backfill/plan.md）。
 * そのため出力は「今DBに入れる項目」に絞らず、ファイルに含まれる項目を全て保持する
 * 中間形式（kb-day/v1）にする。認識できなかった行は捨てずに unparsed に残す。
 * DBへ入れる列の選択は scripts/lib/kbArchiveRows.js が中間形式から行う。
 *
 * データ仕様:
 *   URL: https://www1.mbrace.or.jp/od2/{K|B}/{YYYYMM}/{k|b}{YYMMDD}.lzh
 *   中身: Shift_JIS(cp932) の固定幅テキスト（1日1ファイルに全会場分）、LZH(LH5)圧縮
 *   取得可能範囲: 2005-01〜（2026-09-20の月一覧で確認。Kは2005-01-01も存在）
 *   当日分: 全レース終了前は「データは、この場の全レース終了後に登録されます。」の
 *           プレースホルダが返る（HTTP 200、約320バイト）。確定データとして扱ってはならない。
 *
 * ⚠️ scripts/lib/kfileParser.js（進入コース・着順のみ。日次同期用）とは別モジュール。
 *    着順・進入コースの解釈は同じ（tests: verify-kb-file-parser.js で一致を検証）。
 *    scripts/ml/backfill.py（Python版）の正規表現の移植元でもある。
 */

import {
  LhaReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@kirinsaninc/lhats";
import { PENDING_MARKER, splitVenueBlocks } from "./kbFileParserText.js";
import {
  K_VENUE_HDR_RE,
  K_SUMMARY_CANCELLED_RE,
  K_RACE_HDR_RE,
  parseStartField,
  parseKResultRow,
  parseKText,
} from "./kbFileParserK.js";
import { B_RACE_HDR_RE, B_ENTRY_RE, parseBText } from "./kbFileParserB.js";

export const KB_BASE_URL = "https://www1.mbrace.or.jp/od2";
export const KB_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
export const KB_SCHEMA = "kb-day/v1";

/** @param {string} dateStr YYYY-MM-DD */
function ymdParts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`日付の形式が不正です（YYYY-MM-DD）: ${dateStr}`);
  return { yyyy: m[1], yy: m[1].slice(2), mm: m[2], dd: m[3] };
}

/**
 * @param {"K"|"B"} kind
 * @param {string} dateStr YYYY-MM-DD
 */
export function buildKbUrl(kind, dateStr) {
  const { yyyy, yy, mm, dd } = ymdParts(dateStr);
  return `${KB_BASE_URL}/${kind}/${yyyy}${mm}/${kind.toLowerCase()}${yy}${mm}${dd}.lzh`;
}

/** アーカイブ内の相対パス（例: K/202203/k220324.lzh）。URLと同じ構造にする */
export function kbArchiveRelPath(kind, dateStr) {
  const { yyyy, yy, mm, dd } = ymdParts(dateStr);
  return `${kind}/${yyyy}${mm}/${kind.toLowerCase()}${yy}${mm}${dd}.lzh`;
}

/**
 * LZHのバイト列を展開し、Shift_JISとしてデコードしたテキストを返す。
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function decodeLzhText(bytes) {
  return new TextDecoder("shift_jis").decode(await decodeLzhBytes(bytes));
}

/**
 * LZHのバイト列を展開し、最初のファイルの内容をバイト列のまま返す（デコードしない）。
 * 固定長（バイト幅）のファイル（期別成績fan等）は、Shift_JISの全角が2バイトのため、
 * 文字列に直してから桁で切ると位置がずれる。バイトのまま項目を切り出すために使う。
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function decodeLzhBytes(bytes) {
  const reader = new LhaReader(new Uint8ArrayReader(bytes), {
    filenameDecoder: (b) => new TextDecoder("shift_jis").decode(b),
  });
  try {
    const entries = await reader.getEntries();
    const entry = entries.find((e) => !e.directory);
    if (!entry) throw new Error("LZHにファイルが含まれていません");
    return await entry.getData(new Uint8ArrayWriter());
  } finally {
    await reader.close();
  }
}

/**
 * Kファイルの、確定状況を会場ごとに数える（純粋関数）。
 *
 * 公式のKファイルは、全レース終了前の会場、または中止・順延の会場のブロックが「データは、この場の全レース終了後に
 * 登録されます。」だけになる。ファイル全体に1か所でもこの文があると日全体を未確定として捨てると、他の会場の確定した
 * 成績まで失う（2026-09-22、9/22朝の取得で73日分が該当。例: 2026-07-30は津が中止で、他の11会場は確定していた）。
 * 会場ブロック単位で数え、日全体が未確定なのは、確定した会場が1つも無い場合だけとする。
 *
 * @param {string} text デコード済みのKファイル
 * @returns {{total: number, pendingVenues: number[], completeVenues: number[], allPending: boolean}}
 */
export function classifyKFileVenues(text) {
  const blocks = splitVenueBlocks(text, "K");
  const pendingVenues = [];
  const completeVenues = [];
  for (const b of blocks) {
    if (b.lines.join("\n").includes(PENDING_MARKER))
      pendingVenues.push(b.venue_code);
    else completeVenues.push(b.venue_code);
  }
  return {
    total: blocks.length,
    pendingVenues,
    completeVenues,
    // ブロックが1つも無い（形式が想定外）ときは、確定とみなさない（従来どおり、ファイル全体のマーカーで判定する側に任せる）
    allPending: blocks.length > 0 && completeVenues.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 日単位の中間形式
// ---------------------------------------------------------------------------

/**
 * K・Bを1日分の中間形式（kb-day/v1）にまとめる。どちらか片方だけでもよい。
 * @param {{date: string, kText?: string|null, bText?: string|null, source?: object}} p
 */
export function buildKbDay({ date, kText = null, bText = null, source = {} }) {
  return {
    schema: KB_SCHEMA,
    date,
    source,
    k: kText ? parseKText(kText) : null,
    b: bText ? parseBText(bText) : null,
  };
}

/**
 * 中間形式の整合サマリー（検証・進捗ログ用）。
 * @param {ReturnType<typeof buildKbDay>} day
 */
export function summarizeKbDay(day) {
  const kVenues = day.k?.venues ?? [];
  const bVenues = day.b?.venues ?? [];
  const kRaces = kVenues.flatMap((v) => v.races);
  const bRaces = bVenues.flatMap((v) => v.races);
  return {
    date: day.date,
    k_venues: kVenues.length,
    k_pending_venues: kVenues.filter((v) => v.status === "pending").length,
    k_races: kRaces.length,
    k_cancelled_races: kVenues.reduce(
      (n, v) => n + (v.cancelled_race_numbers?.length ?? 0),
      0,
    ),
    k_boat_rows: kRaces.reduce((n, r) => n + r.rows.length, 0),
    k_unparsed_lines: kVenues.reduce((n, v) => n + v.unparsed.length, 0),
    k_extra_lines: kRaces.reduce((n, r) => n + r.extra_lines.length, 0),
    b_venues: bVenues.length,
    b_races: bRaces.length,
    b_entries: bRaces.reduce((n, r) => n + r.entries.length, 0),
    b_extra_lines: bRaces.reduce((n, r) => n + r.extra_lines.length, 0),
  };
}

export const _internal = {
  K_RACE_HDR_RE,
  K_VENUE_HDR_RE,
  B_ENTRY_RE,
  B_RACE_HDR_RE,
  K_SUMMARY_CANCELLED_RE,
  parseKResultRow,
  parseStartField,
  splitVenueBlocks,
};

export { PENDING_MARKER } from "./kbFileParserText.js";

export { parseKText } from "./kbFileParserK.js";

export { parseBText } from "./kbFileParserB.js";
