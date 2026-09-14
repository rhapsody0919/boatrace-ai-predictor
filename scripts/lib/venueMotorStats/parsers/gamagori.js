/**
 * gamagori - 蒲郡専用パーサー（BOA-264）
 *
 * 蒲郡（gamagori-kyotei.com）は見出し行がrowspan/colspanで構成され、
 * 実データ行のセル数（14）と見出し行のセル数（8+4=12、rowspan/colspan展開後は
 * 実際は一致するはずだがcheerioの素朴なtd列挙では展開されない）が噛み合わない
 * 独自レイアウト。加えてデータ行には値の無い空白の区切りセルが挟まっている
 * （装飾目的とみられる）。見出し名ベースの解決が困難なため、実データで確認した
 * 固定位置での抽出を行う。
 *
 * 実データでの確認済みセル位置（1行=14セル）:
 *   [0]順位 [1]No.(モーター番号) [2]出走回数 [3]通算勝率 [4](空)
 *   [5]通算2連率 [6](空) [7]近況5節勝率 [8](空) [9]近況5節2連率 [10](空)
 *   [11]優出 [12]優勝 [13]使用歴
 *
 * 「通算」列のみを対象とする（近況5節・使用歴はBOA-264のスコープ外、
 * 将来必要になれば拡張する）。節数・事故率・1〜3着数・最高タイムはこのページに
 * 存在しないため取得不可（他会場と同様、無いものはnullのまま）。
 */
import {
  toStrictIntOrNull,
  toFloatOrNull,
  directRows,
  directCells,
} from "../parserUtils.js";

const EXPECTED_CELL_COUNT = 14;

/**
 * @param {import('cheerio').CheerioAPI} $
 * @returns {{ data: Array|null, reason: string|null }}
 */
export function parseGamagoriMotorTable($) {
  const tables = $("table");
  if (tables.length === 0) {
    return { data: null, reason: "table_not_found" };
  }

  const table = tables.eq(0);
  const rows = directRows($, table).toArray();
  // 先頭2行（順位/No./出走回数/... の見出し行 + 勝率/2連率の副見出し行）を飛ばす。
  // ページ構造の前提が崩れていないか最低限の内容確認をしてから読み進める
  // （無関係な表がページ先頭に紛れ込んだ場合に誤読するのを防ぐ）
  // 蒲郡は見出しが縦書き（1文字ずつ改行区切り）のため、空白類を除去してから
  // 判定する（除去しないと「出走」が「出\n走」のまま連続文字列にならず不一致になる）
  const headerText = $(rows[0]).text().replace(/\s/g, "");
  if (!headerText.includes("出走") || !headerText.includes("優勝")) {
    return { data: null, reason: "unexpected_table_header" };
  }
  const dataRows = rows.slice(2);

  const results = [];
  let skippedRows = 0;
  for (const tr of dataRows) {
    const cells = directCells($, tr);
    if (cells.length !== EXPECTED_CELL_COUNT) {
      if (cells.length > 0) skippedRows++;
      continue;
    }

    const motorNumber = toStrictIntOrNull(cells[1]);
    if (motorNumber === null) continue;

    results.push({
      motorNumber,
      meetCount: null,
      raceCount: toStrictIntOrNull(cells[2]),
      finalCount: toStrictIntOrNull(cells[11]),
      championshipCount: toStrictIntOrNull(cells[12]),
      firstPlaceCount: null,
      secondPlaceCount: null,
      thirdPlaceCount: null,
      winRate: toFloatOrNull(cells[3]),
      top2Rate: toFloatOrNull(cells[5]),
      top3Rate: null,
      accidentRate: null,
      avgExhibitionTime: null,
      bestTime: null,
      statsPeriodStart: null,
      statsPeriodEnd: null,
    });
  }

  if (skippedRows > 0) {
    console.warn(
      `⚠️ 蒲郡: セル数が想定(${EXPECTED_CELL_COUNT})と異なる行を${skippedRows}件スキップしました。ページ構造が変わった可能性があります。`,
    );
  }

  if (results.length === 0) {
    return { data: null, reason: "no_data_rows" };
  }
  return { data: results, reason: null };
}
