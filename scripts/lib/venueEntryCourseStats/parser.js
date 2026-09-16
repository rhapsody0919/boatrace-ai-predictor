/**
 * parser - 進入コース別選手成績（`/modules/raceinfo/?page=index_racecourse`）の
 * 共有パーサー（BOA-293）。対象10会場（venueConfig.js参照）でURL・テーブル構造が
 * 完全一致しているため、単一のパーサーで対応する。
 *
 * テーブル構造（実データ確認済み、常滑・唐津・徳山等で共通）:
 *   <table>（.shinnyu_tbl内、クラス名自体は会場により par-table01/com-table01/
 *            c_table 等と異なるため、クラス名ではなく見出しテキストで対象テーブルを
 *            特定する）
 *     <thead><tr><th class="col1">枠</th>...<th class="col11">6着率</th></tr></thead>
 *     <tbody>
 *       <tr><td class="col1" rowspan="6">1</td><td class="col2" rowspan="6">選手名</td>
 *           <td class="col3">1</td>（進入コース）<td class="col4">進入率</td>...</tr>
 *       <tr><td class="col3">2</td>...</tr>  ← col1/col2はrowspanで省略、進入コース1-6分繰り返し
 *       ...
 *     </tbody>
 *
 * 1枠につき最大6行（進入コース1〜6）。会場側にデータが無いコースは行自体が
 * 存在しないことがある（実データ未確認のため、6行固定を前提にしない）。
 */
import * as cheerio from "cheerio";
import { toIntOrNull, toFloatOrNull } from "../venueMotorStats/parserUtils.js";

const EXPECTED_HEADERS = [
  "枠",
  "選手名",
  "進入",
  "進入率",
  "平均ST",
  "1着率",
  "2着率",
  "3着率",
  "4着率",
  "5着率",
  "6着率",
];

// 会場により見出しテキストに半角スペースが混在する（例: 徳山「平均 ST」「1 着率」）
// ため、比較前に空白を除去して正規化する
function normalizeHeaderText(text) {
  return text.replace(/\s+/g, "").trim();
}

// ページ内の全テーブルを最後まで走査し、完全一致するテーブルがあればそれを
// 優先して採用する。見出しが一部だけ違うテーブル（headerMismatch）は、完全
// 一致するテーブルが他に見つからなかった場合のフォールバックとしてのみ使う
// （ループ内で最初に見つかった部分一致テーブルを即returnすると、本来の
// テーブルがDOM順で後にある場合に取りこぼす）
function findEntryCourseTable($) {
  const tables = $("table");
  let partialMatch = null;
  for (let i = 0; i < tables.length; i++) {
    const table = tables.eq(i);
    const headerCells = table
      .find("thead th")
      .map((_, th) => normalizeHeaderText($(th).text()))
      .get();
    if (headerCells.length === 0) continue;
    if (
      headerCells.length === EXPECTED_HEADERS.length &&
      headerCells.every((text, idx) => text === EXPECTED_HEADERS[idx])
    ) {
      return { table, headerCells };
    }
    // 見出し数が一致しない・一部だけ違う場合も「進入コース別選手成績のテーブル
    // らしきもの」として検知し、unexpected_table_headerで構造変化を報告する
    // （枠・選手名・進入の3語を含むテーブルを対象とみなす）
    if (
      !partialMatch &&
      headerCells.some((t) => t === "枠") &&
      headerCells.some((t) => t === "選手名") &&
      headerCells.some((t) => t === "進入")
    ) {
      partialMatch = { table, headerCells, headerMismatch: true };
    }
  }
  return partialMatch;
}

// 選手名セルには女子戦アイコン(<img>)が付与されることがある（例: 常滑）ため、
// img要素を除いてから文字列化する
function cellText($, cell) {
  const clone = $(cell).clone();
  clone.find("img").remove();
  return clone.text().trim();
}

function toIsoDate(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

// 「全国集計期間：2025年09月～2026年08月」（常滑）/
// 「集計期間：2025年 9月～2026年 8月」（唐津、全角/半角・スペース混在）等の表記揺れを吸収する
function parseStatsPeriod($) {
  const text = $("body").text();
  const m = text.match(
    /集計期間[：:]\s*(\d{4})年\s*(\d{1,2})月\s*[～〜~]\s*(\d{4})年\s*(\d{1,2})月/,
  );
  if (!m) return { start: null, end: null };
  return {
    start: toIsoDate(m[1], m[2]),
    end: toIsoDate(m[3], m[4]),
  };
}

// 開催期間外の場合、テーブル自体が存在せず「次節開催までしばらくお待ちください」
// 等のメッセージに置き換わる。ただしこの文言はヘッダーのニュース欄（開催告知）にも
// 出現しうる（徳山で実例確認済み、次節開催中でも表示される）ため、ページ全体からの
// 検索ではなく本文コンテンツ領域（.section_inner、無ければmain）に限定して判定する。
// 対象10会場は全て`<main>`タグを持つことを実データで確認済み（2026-09-16）のため、
// ページ全体へのフォールバックは行わない（フォールバックすると、まさにこの関数が
// 回避しようとしているヘッダーニュース欄の誤検知を再現してしまうため）。
// .section_inner/mainのどちらも無い場合は「判定不能」として false を返す
// （＝ entry_course_table_not_found 側に倒す。この場合、次節開催中の一時的な
// 非公開は稀にfalse alertになりうるが、ヘッダー誤検知よりは安全側の選択）
function hasNoActiveMeetMessage($) {
  const scope = $(".section_inner").length ? $(".section_inner") : $("main");
  if (scope.length === 0) return false;
  return /次節開催|しばらくお待ち/.test(scope.text().trim());
}

/**
 * @param {string} html
 * @returns {{ data: Array<{waku:number, racerNameRaw:string, entryCourse:number,
 *   entryRate:number|null, avgSt:number|null, placeRates:number[]}> | null,
 *   statsPeriod: {start:string|null, end:string|null},
 *   reason: string|null }}
 */
export function parseEntryCourseHtml(html) {
  const $ = cheerio.load(html);
  const found = findEntryCourseTable($);

  if (!found) {
    if (hasNoActiveMeetMessage($)) {
      return {
        data: null,
        statsPeriod: { start: null, end: null },
        reason: "no_active_meet",
      };
    }
    return {
      data: null,
      statsPeriod: { start: null, end: null },
      reason: "entry_course_table_not_found",
    };
  }
  if (found.headerMismatch) {
    return {
      data: null,
      statsPeriod: { start: null, end: null },
      reason: "unexpected_table_header",
    };
  }

  const { table } = found;
  const statsPeriod = parseStatsPeriod($);
  const results = [];
  let currentWaku = null;
  let currentRacerNameRaw = null;

  const rows = table.find("> tbody > tr");
  for (let i = 0; i < rows.length; i++) {
    const tr = rows.eq(i);
    const cells = tr.children("td");
    if (cells.length === 0) continue;

    // rowspanで枠・選手名セルを持つ行かどうかは、先頭セルのclassが col1 かで判定する
    // （持たない継続行は先頭セルがcol3=進入コードから始まる）
    const firstCellClasses = (cells.eq(0).attr("class") || "").split(/\s+/);
    let cellOffset = 0;
    if (firstCellClasses.includes("col1")) {
      currentWaku = toIntOrNull(cellText($, cells.eq(0)));
      currentRacerNameRaw = cellText($, cells.eq(1));
      cellOffset = 2;
    }
    if (currentWaku === null || !currentRacerNameRaw) continue;

    const entryCourse = toIntOrNull(cellText($, cells.eq(cellOffset)));
    if (entryCourse === null) continue;

    const entryRate = toFloatOrNull(cellText($, cells.eq(cellOffset + 1)));
    const avgSt = toFloatOrNull(cellText($, cells.eq(cellOffset + 2)));
    const placeRates = [3, 4, 5, 6, 7, 8].map((offset) =>
      toFloatOrNull(cellText($, cells.eq(cellOffset + offset))),
    );

    results.push({
      waku: currentWaku,
      racerNameRaw: currentRacerNameRaw,
      entryCourse,
      entryRate,
      avgSt,
      placeRates,
    });
  }

  if (results.length === 0) {
    return { data: null, statsPeriod, reason: "no_data_rows" };
  }
  return { data: results, statsPeriod, reason: null };
}
