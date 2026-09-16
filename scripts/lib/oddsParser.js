/**
 * boatrace.jp オッズページの共通パーサー
 *
 * odds3t（3連単）/ odds3f（3連複）ページは 6 セクション横並びの
 * rowspan テーブル構造。各セクション = 3列: [2着(rowspan>1), 3着, oddsPoint]。
 * セクションインデックス 0〜5 が 1着艇番 1〜6 に対応。
 *
 * 利用元: scrape-prediction-odds.js（予測買い目オッズ）、
 *         scrape-odds.js（全120通りスナップショット）
 */

/**
 * オッズテーブルをパースして買い目→オッズの Map を返す
 *
 * 3連複(odds3f)では重複組み合わせのセクションに is-disabled セルが入る。
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {boolean} sortBoats - true なら艇番を昇順ソート（3連複用）
 * @returns {Map<string, number>} "A-B-C" -> odds
 */
export function parseOddsTable($, sortBoats) {
  const map = new Map();
  const mainTable = $("table")
    .filter((_, t) => $(t).find(".oddsPoint").length > 0)
    .first();

  const NUM_SECTIONS = 6;
  // セクションごとに現在の「2着」艇番を保持（rowspan 跨ぎ用）
  const current2nd = new Array(NUM_SECTIONS).fill(null);
  // セクションごとの残り rowspan 行数（0 になったら次行でヘッダセル再登場）
  const rowspanLeft = new Array(NUM_SECTIONS).fill(0);

  mainTable.find("tbody tr").each((_, row) => {
    const tds = $(row).find("td").toArray();
    let tdIdx = 0;

    for (let section = 0; section < NUM_SECTIONS; section++) {
      if (tdIdx >= tds.length) break;

      const firstCell = $(tds[tdIdx]);
      const firstCls = firstCell.attr("class") || "";
      const firstRs = parseInt(firstCell.attr("rowspan") || "1");

      // rowspan が尽きていれば今行がこのセクションのヘッダ行
      const isHeaderRow = rowspanLeft[section] === 0;

      if (isHeaderRow) {
        // ヘッダセル（2着艇番）を読む
        rowspanLeft[section] = firstRs - 1;

        if (firstCls.includes("is-disabled")) {
          tdIdx += 3; // ヘッダ + 3着 + odds の 3 セルをスキップ
          continue;
        }

        current2nd[section] = parseInt(firstCell.text().trim());
        tdIdx++;
      } else {
        // 継続行（rowspan 延長中）
        rowspanLeft[section]--;

        if (firstCls.includes("is-disabled")) {
          tdIdx += 2; // 3着 + odds の 2 セルをスキップ
          continue;
        }
      }

      const thirdCell = $(tds[tdIdx++]);
      const oddsCell = $(tds[tdIdx++]);
      const third = parseInt(thirdCell.text().trim());
      const odds = parseFloat(oddsCell.text().trim());

      const first = section + 1;
      const second = current2nd[section];

      if (second && third && !isNaN(odds) && odds > 0) {
        const key = sortBoats
          ? [first, second, third].sort((a, b) => a - b).join("-")
          : `${first}-${second}-${third}`;
        map.set(key, odds);
      }
    }
  });

  return map;
}

/**
 * odds3t ページから全120通りの3連単オッズをパース
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Map<string, number>} "1-2-3" -> odds
 */
export function parseTrifectaAll($) {
  return parseOddsTable($, false);
}

/**
 * odds3f ページから全3連複オッズをパース
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Map<string, number>} "1-2-3"（昇順ソート済み）-> odds
 */
export function parseTrioAll($) {
  return parseOddsTable($, true);
}

/**
 * 2連単/2連複/拡連複ページの共通パーサー
 *
 * odds3t/odds3f（3着艇まで、rowspanで2着セルを跨ぐ）とは異なり、組み合わせが
 * 2艇のみのため各セクションは[相手艇番, oddsPoint]の2セルペア（rowspanなし）。
 * 6セクション（1着/上位艇番1〜6）が横並びで、重複組み合わせ（2連複・拡連複）は
 * is-disabledセルでスキップされる（2連単は順序ありのため重複なし＝is-disabled無し）。
 *
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio} table - 対象テーブル（odds2tfは1ページに2テーブルあるため呼び出し元が指定）
 * @param {boolean} sortBoats - true なら艇番を昇順ソート（2連複・拡連複用）
 * @param {(text: string) => *} parseOddsCell - オッズセルのテキストを値に変換する関数
 * @returns {Map<string, *>} "A-B" -> parseOddsCellの返り値
 */
function parseTwoBoatOddsTable($, table, sortBoats, parseOddsCell) {
  const map = new Map();
  const NUM_SECTIONS = 6;

  table.find("tbody tr").each((_, row) => {
    const tds = $(row).find("td").toArray();
    let tdIdx = 0;

    for (let section = 0; section < NUM_SECTIONS; section++) {
      if (tdIdx >= tds.length) break;

      const boatCell = $(tds[tdIdx]);
      if ((boatCell.attr("class") || "").includes("is-disabled")) {
        tdIdx += 2; // 艇番 + odds の2セルをスキップ
        continue;
      }

      const boatNumber = parseInt(boatCell.text().trim());
      tdIdx++;
      const oddsCell = $(tds[tdIdx++]);
      const odds = parseOddsCell(oddsCell.text().trim());

      const first = section + 1;
      if (boatNumber && odds !== null) {
        const key = sortBoats
          ? [first, boatNumber].sort((a, b) => a - b).join("-")
          : `${first}-${boatNumber}`;
        map.set(key, odds);
      }
    }
  });

  return map;
}

function parseSingleOddsValue(text) {
  const odds = parseFloat(text);
  return !isNaN(odds) && odds > 0 ? odds : null;
}

/**
 * 「下限-上限」のレンジ表示オッズをパースする（例: "1.5-1.9"、複勝・拡連複で共通）。
 * scrapePlaceOdds（scrape-odds.js）と同じロジックのため共通化し、両方から呼ぶ
 * @param {string} text
 * @returns {{low: number, high: number}|null}
 */
export function parseRangeOddsValue(text) {
  const normalized = text.replace(/[－ー−]/g, "-");
  const parts = normalized.split("-");
  if (parts.length !== 2) return null;
  const low = parseFloat(parts[0]);
  const high = parseFloat(parts[1]);
  if (isNaN(low) || isNaN(high) || low <= 0 || high < low) return null;
  return { low, high };
}

/**
 * odds2tfページ（2連単・2連複が同一ページ、oddsPointを含むテーブルが2つ）
 * から該当テーブルを取得する。DOM順序（1つ目/2つ目）ではなく、is-disabled
 * セルの有無という構造的な違いで判別する（2連単は順序ありのため全30通りが
 * 有効＝is-disabledなし、2連複は重複組み合わせをis-disabledで除外するため
 * 存在する）。ページの描画順が入れ替わっても誤って2券種を取り違えないための対策
 * @param {import('cheerio').CheerioAPI} $
 * @param {boolean} wantExacta - true: 2連単（is-disabledなし）、false: 2連複（is-disabledあり）
 */
function getOddsTfTable($, wantExacta) {
  return $("table")
    .filter((_, t) => $(t).find(".oddsPoint").length > 0)
    .filter((_, t) => {
      const hasDisabled = $(t).find(".is-disabled").length > 0;
      return wantExacta ? !hasDisabled : hasDisabled;
    })
    .first();
}

/**
 * odds2tfページから全30通りの2連単オッズをパース
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Map<string, number>} "1-2" -> odds
 */
export function parseExactaAll($) {
  return parseTwoBoatOddsTable(
    $,
    getOddsTfTable($, true),
    false,
    parseSingleOddsValue,
  );
}

/**
 * odds2tfページから全15通りの2連複オッズをパース
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Map<string, number>} "1-2"（昇順ソート済み）-> odds
 */
export function parseQuinellaAll($) {
  return parseTwoBoatOddsTable(
    $,
    getOddsTfTable($, false),
    true,
    parseSingleOddsValue,
  );
}

/**
 * oddskページから全15通りの拡連複オッズをパース（下限-上限のレンジ値）
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Map<string, {low: number, high: number}>} "1-2"（昇順ソート済み）-> {low, high}
 */
export function parseWideAll($) {
  const table = $("table")
    .filter((_, t) => $(t).find(".oddsPoint").length > 0)
    .first();
  return parseTwoBoatOddsTable($, table, true, parseRangeOddsValue);
}
