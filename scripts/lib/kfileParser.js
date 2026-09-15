/**
 * 公式成績ファイル（Kファイル）のダウンロード・解凍・パース（BOA-257）
 *
 * 背景: race_results.course_1〜6（進入コース）は scrapeCourseInfo()
 * （scripts/daily/scrape-results.js）が公式サイトのraceresultページHTMLから
 * 取得しているが、全保存レースで艇番と完全一致しており進入変化（前づけ）を
 * 検出できていないことが判明した（BOA-257）。調査の結果、raceresultページの
 * 「スタート情報」テーブルが参照している要素自体が実際の進入コースを
 * 表していない可能性が高いと判明した一方、公式のダウンロードデータ
 * （成績ファイル＝Kファイル）には実際の進入コースが含まれていることを、
 * 実データ2026-09-11分（144レース・863艇）で検証済み: 艇番と進入コースの
 * 不一致率10.2%（公式の枠番別コース取得率とほぼ一致）、1号艇0.0%→6号艇16.0%と
 * 単調増加しており物理的に整合する。
 *
 * データ仕様:
 *   URL: https://www1.mbrace.or.jp/od2/K/{YYYYMM}/k{YYMMDD}.lzh
 *   中身: Shift_JIS(cp932) の固定幅テキスト（1日1ファイルに全会場分）、LZH(LH5)圧縮
 *
 * ⚠️ K_RACE_HDR_RE・K_RESULT_REは scripts/ml/backfill.py（BOA-104、MLバックフィル用）の
 * 同名の正規表現を移植したもの。Python版とJS版で言語が異なり直接のコード共有はできないため、
 * 挙動を変える場合は両方を同期させること（本ファイルは進入コース抽出のみに用途を絞り、
 * 天候・ST・払戻金等のbackfill.py側の他フィールドは移植していない＝YAGNI）。
 */

import {
  LhaReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@kirinsaninc/lhats";

const BASE_URL = "https://www1.mbrace.or.jp/od2/K";
const UA =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

// 会場ヘッダー: "01KBGN" 形式
const VENUE_HDR_RE = /^(\d{2})KBGN/;

// レースヘッダー: 例 "1R 朝1戦予選 H1800m 曇り 風 北 5m 波 5cm"（全角スペース区切り、固定幅）
// backfill.py K_RACE_HDR_RE と同一（天候等のグループは進入コース抽出には未使用だが、
// レース境界の検出ロジックをPython版と一致させるため丸ごと移植する）
const K_RACE_HDR_RE =
  /^\s{0,4}(\d{1,2})R\s+(\S+).*?H\d+m\s+(\S+)\s+風\s+(\S+?)\s+(\d+)m\s+波\s+(\d+)cm/;

// 結果行: 例 "01 4 4861 田中宏樹 54 72 6.80 4 0.05 1.49.6"（固定幅、氏名は全角4文字分）
//          着(01-06 or F/L/失/転...) 艇 登番 名前 モーター ボート 展示 進入 ST タイム
// backfill.py K_RESULT_RE と同一。欠場行（"K0  4 ... K .        K .        .  ."）は
// 進入コース列が"[1-6]"にマッチしないため自然に除外される（欠場艇に進入コースは無いため正しい挙動）。
const K_RESULT_RE =
  /^\s{2}(\S{1,2})\s+([1-6])\s+(\d{4})\s+(.{8,12}?)\s+\d+\s+\d+\s+(\d\.\d{2}|\s*\.?\s*)\s+([1-6])\s+(F?L?\s?\.?-?\d*\.?\d{2}|\S+)/;

function toYYMMDD(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${y.slice(2)}${m}${d}`;
}

function toYYYYMM(dateStr) {
  const [y, m] = dateStr.split("-");
  return `${y}${m}`;
}

function buildKFileUrl(dateStr) {
  const ymd = toYYMMDD(dateStr);
  return `${BASE_URL}/${toYYYYMM(dateStr)}/k${ymd}.lzh`;
}

/**
 * 指定日のKファイルをダウンロード・解凍し、デコード済みテキストを返す。
 * 開催が無い日（404）はnullを返す（呼び出し元でスキップ扱いにする）。
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<string|null>}
 */
export async function fetchKFileText(dateStr) {
  const url = buildKFileUrl(dateStr);
  const response = await fetch(url, { headers: { "User-Agent": UA } });

  if (response.status === 404) {
    return null; // 開催なし日
  }
  if (!response.ok) {
    throw new Error(`Kファイル取得失敗: HTTP ${response.status} (${url})`);
  }

  const buf = new Uint8Array(await response.arrayBuffer());
  const reader = new LhaReader(new Uint8ArrayReader(buf), {
    filenameDecoder: (b) => new TextDecoder("shift_jis").decode(b),
  });
  try {
    const entries = await reader.getEntries();
    const entry = entries.find((e) => !e.directory);
    if (!entry) return null;
    const content = await entry.getData(new Uint8ArrayWriter());
    return new TextDecoder("shift_jis").decode(content);
  } finally {
    await reader.close();
  }
}

/**
 * Kファイルのデコード済みテキストをパースし、レースごとの実進入コースを抽出する。
 * @param {string} text - fetchKFileText()が返すデコード済みテキスト
 * @param {string} raceDate - YYYY-MM-DD（race_id組み立てに使用）
 * @returns {Array<{race_id: string, venue_code: number, race_number: number,
 *   actual_course_1: number|null, ..., actual_course_6: number|null}>}
 */
export function parseKFileText(text, raceDate) {
  const lines = text.split(/\r?\n/);
  /** @type {Map<string, {venue: number, raceNo: number, boats: Map<number, number>}>} */
  const races = new Map();

  let venue = null;
  let currentRaceNo = null;

  for (const line of lines) {
    const venueMatch = line.match(VENUE_HDR_RE);
    if (venueMatch) {
      venue = parseInt(venueMatch[1], 10);
      currentRaceNo = null;
      continue;
    }
    if (venue === null) continue;

    const headerMatch = line.match(K_RACE_HDR_RE);
    if (headerMatch) {
      currentRaceNo = parseInt(headerMatch[1], 10);
      continue;
    }
    if (currentRaceNo === null) continue;

    const resultMatch = line.match(K_RESULT_RE);
    if (!resultMatch) continue;

    const boat = parseInt(resultMatch[2], 10);
    const course = parseInt(resultMatch[6], 10);
    const key = `${venue}-${currentRaceNo}`;
    if (!races.has(key)) {
      races.set(key, { venue, raceNo: currentRaceNo, boats: new Map() });
    }
    races.get(key).boats.set(boat, course);
  }

  const rows = [];
  for (const { venue: v, raceNo, boats } of races.values()) {
    const raceId = `${raceDate}-${String(v).padStart(2, "0")}-${String(raceNo).padStart(2, "0")}`;
    rows.push({
      race_id: raceId,
      venue_code: v,
      race_number: raceNo,
      actual_course_1: boats.has(1) ? boats.get(1) : null,
      actual_course_2: boats.has(2) ? boats.get(2) : null,
      actual_course_3: boats.has(3) ? boats.get(3) : null,
      actual_course_4: boats.has(4) ? boats.get(4) : null,
      actual_course_5: boats.has(5) ? boats.get(5) : null,
      actual_course_6: boats.has(6) ? boats.get(6) : null,
    });
  }
  return rows;
}

// テスト・デバッグ用に内部関数・正規表現も公開する
export const _internal = {
  K_RACE_HDR_RE,
  K_RESULT_RE,
  VENUE_HDR_RE,
  buildKFileUrl,
};
