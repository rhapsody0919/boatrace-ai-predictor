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

export const KB_BASE_URL = "https://www1.mbrace.or.jp/od2";
export const KB_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
export const KB_SCHEMA = "kb-day/v1";

export const PENDING_MARKER = "データは、この場の全レース終了後に登録されます";

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

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

/** 全角英数・記号を半角にし、全ての空白（全角含む）を除去する */
const squash = (s) => s.normalize("NFKC").replace(/\s+/g, "");
/** 全角数字を半角にする（空白はそのまま） */
const half = (s) => s.normalize("NFKC");
const toInt = (s) =>
  s === undefined || s === null || s === "" ? null : Number.parseInt(s, 10);
const toNum = (s) =>
  s === undefined || s === null || s === "" ? null : Number.parseFloat(s);

/**
 * 会場ブロックへ分割する。 NNKBGN ... NNKEND / NNBBGN ... NNBEND
 * @param {string} text
 * @param {"K"|"B"} kind
 * @returns {Array<{venue_code: number, lines: string[]}>}
 */
function splitVenueBlocks(text, kind) {
  const begin = new RegExp(`^(\\d{2})${kind}BGN\\s*$`);
  const end = new RegExp(`^(\\d{2})${kind}END\\s*$`);
  const blocks = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const b = begin.exec(line);
    if (b) {
      cur = { venue_code: Number.parseInt(b[1], 10), lines: [] };
      continue;
    }
    if (end.test(line)) {
      if (cur) blocks.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur); // ENDが無いまま終わった場合も捨てない
  return blocks;
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
// Kファイル（競走成績）
// ---------------------------------------------------------------------------

const K_VENUE_HDR_RE =
  /^(.{1,5}?)［成績］\s+(\d{1,2})\/\s*(\d{1,2})\s+(.*?)\s*(第\s*\d+日|最終日)?\s*$/;
const K_DAY_LINE_RE =
  /^\s+(第\s*\d+日|最終日)\s+(\d{4})\/\s*(\d{1,2})\/\s*(\d{1,2})\s+(\S.*?)\s*$/;
const K_SUMMARY_ROW_RE = /^\s+\d{1,2}R\s+\S+/;
// 同着で払戻が複数ある場合の、レース番号なしの継続行（例: "               1-2-5     520    1-2-5     200"）
const K_SUMMARY_CONT_RE = /^\s{10,}\d(?:-\d){1,2}\s+\d+/;
const K_RACE_HDR_RE =
  /^\s{0,4}(\d{1,2})R\s+(.*?)\s+H(\d+)m\s+(\S+)\s+風\s+(\S+?)\s+(\d+)m\s+波\s+(\d+)cm\s*$/;
const K_RESULT_HDR_RE = /^\s+着\s+艇\s+登番/;
const K_RESULT_PREFIX_RE = /^\s{2}(\S{1,2})\s+([1-6])\s+(\d{4})\s+(.+)$/;
const K_NAME_TAIL_RE = /^(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(.*)$/;
const K_PAYOUT_ITEM_RE =
  /(\d(?:-\d){0,2})\s+(\d+)(?:\s+人気\s+(\d+))?|特払い\s+(\d+)/g;

const PAYOUT_KIND = {
  単勝: "win",
  複勝: "place",
  "２連単": "exacta",
  "２連複": "quinella",
  拡連複: "wide",
  "３連単": "trifecta",
  "３連複": "trio",
};

/** スタート欄の解釈。フライング・出遅れ・欠場はrawを残しつつ区別する */
function parseStartField(raw) {
  const s = raw.replace(/\s+/g, "");
  if (s === "" || s === "." || s === "K." || s === "K") {
    return { start_timing: null, is_flying: false, is_late_start: false };
  }
  const m = /^(F)?(L)?(-?\d*\.\d{2})$/.exec(s);
  if (m) {
    const v = Number.parseFloat(m[3]);
    return {
      start_timing: m[1] ? -Math.abs(v) : v, // フライングは負値（race_start_timingsと同義）
      is_flying: Boolean(m[1]),
      is_late_start: Boolean(m[2]),
    };
  }
  if (/^L/.test(s))
    return { start_timing: null, is_flying: false, is_late_start: true };
  if (/^F/.test(s))
    return { start_timing: null, is_flying: true, is_late_start: false };
  return { start_timing: null, is_flying: false, is_late_start: false };
}

/**
 * 1艇分の結果行をパースする。認識できなければ null。
 * 着・艇・登番・氏名・モーター・ボートは固定形式。
 * 展示・進入・スタート・レースタイムの欄は、欠場（K0/K1）・F・L・失格等で形が変わるため、
 * 尾部を生文字列（tail_raw）としても保持し、レースタイム（末尾）と進入（先頭の1〜6）を優先して抽出する。
 */
function parseKResultRow(line) {
  const pre = K_RESULT_PREFIX_RE.exec(line);
  if (!pre) return null;
  const nt = K_NAME_TAIL_RE.exec(pre[4]);
  if (!nt) return null;
  const tail = nt[4];
  const timeM = /(\d\.\d{2}\.\d)\s*$/.exec(tail);
  // レースタイム欄は、完走できなかった艇では ".  ." のプレースホルダになる
  const body = timeM
    ? tail.slice(0, timeM.index)
    : tail.replace(/\s*\.\s+\.\s*$/, "");
  const exM = /^\s*(\d\.\d{2})\s+/.exec(body);
  const afterEx = exM
    ? body.slice(exM[0].length)
    : body.replace(/^\s*K?\s*\.\s*/, "");
  const courseM = /^\s*([1-6])\s+(.*)$/.exec(afterEx);
  const stRaw = (courseM ? courseM[2] : afterEx).trim();
  const rank = /^0[1-6]$/.test(pre[1]) ? Number.parseInt(pre[1], 10) : null;
  return {
    finish_raw: pre[1],
    rank,
    boat_number: toInt(pre[2]),
    racer_id: toInt(pre[3]),
    name: squash(nt[1]),
    name_raw: nt[1].trim(),
    motor_number: toInt(nt[2]),
    boat_id: toInt(nt[3]),
    exhibition_time: exM ? toNum(exM[1]) : null,
    course: courseM ? toInt(courseM[1]) : null,
    start_raw: stRaw,
    ...parseStartField(stRaw),
    race_time: timeM ? timeM[1] : null,
    tail_raw: tail.trim(),
  };
}

/**
 * 払戻ブロックの行を解釈する。特払い・不成立・空欄も項目として残す。
 * 返還等の未知の行は呼び出し側で extra_lines に残す。
 */
function parsePayoutLine(line, state) {
  const m =
    /^\s{6,}(単勝|複勝|２連単|２連複|拡連複|３連単|３連複)?\s*(\S.*)?$/.exec(
      line,
    );
  if (!m) return false;
  const kindJa = m[1] ?? state.lastKind;
  if (!kindJa) return false;
  const rest = (m[2] ?? "").trim();
  const kind = PAYOUT_KIND[kindJa];
  const items = [];
  if (rest === "") {
    if (!m[1]) return false;
    items.push({
      kind,
      combo: null,
      amount: null,
      popularity: null,
      special: "blank",
    });
  } else if (/^不成立\s*$/.test(rest)) {
    items.push({
      kind,
      combo: null,
      amount: null,
      popularity: null,
      special: "不成立",
    });
  } else {
    for (const it of rest.matchAll(K_PAYOUT_ITEM_RE)) {
      if (it[4] !== undefined) {
        items.push({
          kind,
          combo: null,
          amount: toInt(it[4]),
          popularity: null,
          special: "特払い",
        });
      } else {
        items.push({
          kind,
          combo: it[1],
          amount: toInt(it[2]),
          popularity: toInt(it[3]),
          special: null,
        });
      }
    }
    if (items.length === 0) return false;
  }
  state.lastKind = kindJa;
  state.payouts.push(...items);
  return true;
}

/**
 * @param {string[]} lines 会場ブロックの行
 * @param {number} venueCode
 */
function parseKVenue(lines, venueCode) {
  const out = {
    venue_code: venueCode,
    venue_name: null,
    status: "complete",
    header: null,
    title: null,
    title_short: null,
    day_label: null,
    series_day: null,
    is_final_day: false,
    date_in_body: null,
    payout_summary_lines: [],
    races: [],
    unparsed: [],
  };
  const joined = lines.join("\n");
  if (joined.includes(PENDING_MARKER)) {
    out.status = "pending";
    out.unparsed = lines.filter((l) => l.trim() !== "");
    return out;
  }

  let race = null;
  let payoutState = null;
  let seenTitleBanner = false;
  for (const line of lines) {
    if (line.trim() === "") continue;

    const vh = K_VENUE_HDR_RE.exec(line);
    if (vh && !race) {
      out.venue_name = squash(vh[1]);
      out.header = line.trim();
      out.title_short = squash(vh[4]);
      if (vh[5]) out.day_label = squash(vh[5]);
      continue;
    }
    if (/＊＊＊\s*競走成績\s*＊＊＊/.test(line)) {
      seenTitleBanner = true;
      continue;
    }
    if (
      seenTitleBanner &&
      out.title === null &&
      !race &&
      /^\s{4,}\S/.test(line) &&
      !K_DAY_LINE_RE.test(line)
    ) {
      out.title = squash(line.trim());
      continue;
    }
    const dl = K_DAY_LINE_RE.exec(line);
    if (dl && !race) {
      out.day_label = squash(dl[1]);
      out.date_in_body = `${dl[2]}-${String(dl[3]).padStart(2, "0")}-${String(dl[4]).padStart(2, "0")}`;
      continue;
    }
    if (
      /内容については主催者発行のもの/.test(line) ||
      /\[払戻金\]/.test(line)
    ) {
      if (/\[払戻金\]/.test(line))
        out.payout_summary_lines.push(line.trimEnd());
      continue;
    }
    if (
      !race &&
      (K_SUMMARY_ROW_RE.test(line) || K_SUMMARY_CONT_RE.test(line)) &&
      !K_RACE_HDR_RE.test(line)
    ) {
      out.payout_summary_lines.push(line.trimEnd());
      continue;
    }

    const rh = K_RACE_HDR_RE.exec(line);
    if (rh) {
      race = {
        race_number: toInt(rh[1]),
        stage_raw: rh[2].trim(),
        stage: squash(rh[2]),
        distance_m: toInt(rh[3]),
        weather: squash(rh[4]),
        wind_direction: squash(rh[5]),
        wind_speed: toInt(rh[6]),
        wave_height: toInt(rh[7]),
        technique: null,
        rows: [],
        payouts: [],
        extra_lines: [],
      };
      out.races.push(race);
      payoutState = { lastKind: null, payouts: race.payouts };
      continue;
    }
    if (!race) {
      out.unparsed.push(line.trimEnd());
      continue;
    }
    if (K_RESULT_HDR_RE.test(line)) {
      const t = line.split("ﾚｰｽﾀｲﾑ")[1];
      race.technique = t !== undefined && squash(t) !== "" ? squash(t) : null;
      continue;
    }
    if (/^-{10,}\s*$/.test(line)) continue;

    const row = parseKResultRow(line);
    if (row) {
      race.rows.push(row);
      continue;
    }
    if (parsePayoutLine(line, payoutState)) continue;
    race.extra_lines.push(line.trimEnd()); // 返還・レース不成立等の未知の行（捨てない）
  }

  if (out.day_label) {
    const dm = /第(\d+)日/.exec(out.day_label);
    if (dm) out.series_day = Number.parseInt(dm[1], 10);
    if (out.day_label === "最終日") out.is_final_day = true;
  }
  return out;
}

/**
 * Kファイルのテキストを全項目つきの中間形式にパースする。
 * @param {string} text
 * @returns {{venues: object[], top_level_unparsed: string[]}}
 */
export function parseKText(text) {
  const blocks = splitVenueBlocks(text, "K");
  return {
    venues: blocks.map((b) => parseKVenue(b.lines, b.venue_code)),
    top_level_unparsed: [],
  };
}

// ---------------------------------------------------------------------------
// Bファイル（番組表）
// ---------------------------------------------------------------------------

// 例: 「ボートレース唐津 ３月２４日 第９回サッポロビール 第３日」（会場名・日目の途中に全角空白が入る）
//     2005年頃は「唐津 競艇場 １月４日 ...」の表記
const B_VENUE_HDR_RE =
  /^(?:ボートレース(.{1,5}?)|(.{1,6}?)\s*競艇場)\s+([0-9０-９]{1,2})月\s*([0-9０-９]{1,2})日\s+(.*?)\s*(第\s*[0-9０-９]+\s*日|最終日)\s*$/;
const B_DAY_LINE_RE =
  /^\s+(第\s*[0-9０-９]+\s*日|最終日)\s+([0-9０-９]{4})年\s*([0-9０-９]{1,2})月\s*([0-9０-９]{1,2})日\s+\S/;
const B_RACE_HDR_RE =
  /^\s*([0-9０-９]{1,2})[RＲ]\s+(.*?)\s+[HＨ]([0-9０-９]+)[mｍ]\s+電話投票締切予定\s*([0-9０-９]{1,2})[:：]([0-9０-９]{2})/;
const B_ENTRY_RE =
  /^([1-6])\s?(\d{4})(.{4})(\d{2})(\D{2,3}?)(\d{2})(A1|A2|B1|B2)\s*(\d+\.\d{2})\s*(\d+\.\d{2})\s*(\d+\.\d{2})\s*(\d+\.\d{2})\s*(\d{1,3})\s*(\d+\.\d{2})\s*(\d{1,3})\s*(\d+\.\d{2})(.*)$/;

function parseBVenue(lines, venueCode) {
  const out = {
    venue_code: venueCode,
    venue_name: null,
    header: null,
    title: null,
    title_short: null,
    day_label: null,
    series_day: null,
    is_final_day: false,
    date_in_body: null,
    races: [],
    unparsed: [],
  };
  let race = null;
  let seenBanner = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const vh = B_VENUE_HDR_RE.exec(line);
    if (vh && !race) {
      out.venue_name = squash(vh[1] ?? vh[2]);
      out.header = line.trim();
      out.title_short = squash(vh[5]);
      out.day_label = squash(vh[6]);
      continue;
    }
    if (/＊＊＊\s*番組表\s*＊＊＊/.test(line)) {
      seenBanner = true;
      continue;
    }
    if (seenBanner && out.title === null && !race && /^\s{4,}\S/.test(line)) {
      out.title = squash(line.trim());
      continue;
    }
    const dl = B_DAY_LINE_RE.exec(line);
    if (dl && !race) {
      const p2 = (x) => half(x).padStart(2, "0");
      out.date_in_body = `${half(dl[2])}-${p2(dl[3])}-${p2(dl[4])}`;
      continue;
    }
    if (/内容については主催者発行のもの/.test(line)) continue;

    const rh = B_RACE_HDR_RE.exec(line);
    if (rh) {
      race = {
        race_number: toInt(half(rh[1])),
        stage_raw: rh[2].trim(),
        stage: squash(rh[2]),
        distance_m: toInt(half(rh[3])),
        deadline_time: `${half(rh[4]).padStart(2, "0")}:${half(rh[5])}`,
        entries: [],
        extra_lines: [],
      };
      out.races.push(race);
      continue;
    }
    if (!race) {
      out.unparsed.push(line.trimEnd());
      continue;
    }
    if (
      /^-{10,}\s*$/.test(line) ||
      /^艇\s+選手\s+選手/.test(line) ||
      /^番\s+登番\s+名/.test(line)
    )
      continue;

    const e = B_ENTRY_RE.exec(line.trim());
    if (e) {
      const tail = e[16];
      race.entries.push({
        boat_number: toInt(e[1]),
        racer_id: toInt(e[2]),
        name: squash(e[3]),
        name_raw: e[3],
        age: toInt(e[4]),
        branch: squash(e[5]),
        weight: toInt(e[6]),
        class: e[7],
        national_win_rate: toNum(e[8]),
        national_2rate: toNum(e[9]),
        local_win_rate: toNum(e[10]),
        local_2rate: toNum(e[11]),
        motor_number: toInt(e[12]),
        motor_2rate: toNum(e[13]),
        boat_id: toInt(e[14]),
        boat_2rate: toNum(e[15]),
        series_results_raw: tail.slice(0, tail.length).trimEnd(), // 今節成績（日別着順）と早見欄。列位置が意味を持つため原文を保持
      });
      continue;
    }
    race.extra_lines.push(line.trimEnd());
  }
  if (out.day_label) {
    const dm = /第(\d+)日/.exec(out.day_label);
    if (dm) out.series_day = Number.parseInt(dm[1], 10);
    if (out.day_label === "最終日") out.is_final_day = true;
  }
  return out;
}

/**
 * Bファイルのテキストを全項目つきの中間形式にパースする。
 * @param {string} text
 */
export function parseBText(text) {
  const blocks = splitVenueBlocks(text, "B");
  return { venues: blocks.map((b) => parseBVenue(b.lines, b.venue_code)) };
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
  parseKResultRow,
  parseStartField,
  splitVenueBlocks,
};
