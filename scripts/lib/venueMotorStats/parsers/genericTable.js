/**
 * genericTable - 会場公式サイトのモーター成績テーブルの汎用パーサー（BOA-264）
 *
 * 同じ「系統」を名乗るページでも、実際には列の並び順・見出し文言が会場ごとに
 * 微妙に異なる（例: 下関/若松は「モーター番号」列が先頭だが、芦屋は「No」列が
 * 先頭で「前節評価」列が追加されている）ことが実データで判明した。列の位置
 * （インデックス）決め打ちではなく、見出し行のテキストから列位置を都度解決する
 * ことで、この種の微妙な差異を吸収する。
 *
 * 対応できないほど構造が異なる会場（丸亀のJS描画、宮島のPDF配布、蒲郡・住之江の
 * 独自legacy構造等）は、このパーサーではなく専用パーサーを使うこと。
 */

// 全角数字・記号を半角に正規化（会場により「２連対率」「1着」等の全角/半角が混在）
function normalizeText(text) {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[（）]/g, (c) => (c === "（" ? "(" : ")"))
    .trim();
}

// 見出しセル専用の正規化。データ値と違い、見出しは会場により
// ・「優勝回数」を「優勝」と略す（児島等）
// ・並び替え矢印(▼)や改行・空白が埋め込まれる（「最高\nタイム\n(1800m)▼」等）
// といった表記揺れが激しいため、空白・記号を全て除去した上でルート語で
// 前方一致させる（HEADER_ALIASESは意図的に短いルート語を使う）
function normalizeHeader(text) {
  return normalizeText(text).replace(/[\s▼▲△▽☆★]/g, "");
}

// フィールド名 → 見出しテキストの候補（会場により「◯◯回数」/「◯◯」等表記が
// 揺れるため、短いルート語を使いstartsWithで前方一致させる）
const HEADER_ALIASES = {
  motorNumber: ["モーター番号", "No", "No.", "機番"],
  meetCount: ["節数"],
  statsPeriod: ["算出期間"],
  top2Rate: ["2連対率", "2連率"],
  top3Rate: ["3連対率", "3連率"],
  winRate: ["勝率"],
  accidentRate: ["事故率"],
  firstPlace: ["1着"],
  secondPlace: ["2着"],
  thirdPlace: ["3着"],
  raceCount: ["出走"],
  finalCount: ["優出"],
  championshipCount: ["優勝"],
  avgExhibitionTime: ["平均展示タイム"],
  bestTime: ["最高タイム"],
};

// 「優勝」+「出走」or「2連対率/2連率」を両方含む見出し行を持つテーブルを
// モーター成績テーブルと判定する（同じページに無関係な表が複数存在するため）
function isMotorStatsHeaderRow(cells) {
  const normalized = cells.map(normalizeHeader);
  const hasChampionship = normalized.some((c) => c.includes("優勝"));
  const hasRaceCountOrRate = normalized.some(
    (c) => c.includes("出走") || c.includes("2連対率") || c.includes("2連率"),
  );
  return hasChampionship && hasRaceCountOrRate;
}

function buildHeaderMap(headerCells) {
  const normalized = headerCells.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex((cell) =>
      aliases.some((alias) => cell === alias || cell.startsWith(alias)),
    );
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = parseInt(normalizeText(value), 10);
  return Number.isFinite(n) ? n : null;
}

// モーター番号セルは「4着」のような凡例行の断片を parseInt が誤って4と
// 読んでしまう（数字プレフィックスだけで判定が緩すぎる）ため、モーター番号は
// セル全体が純粋な整数であることを要求する厳格版を使う
// モーター番号セルは、数字の直後に別の文字列が続くケースが2パターンある:
// (a) "4着"のような凡例行の断片 → 数字の直後に文字が直接続く（拒否したい）
// (b) 津の「44\n\n\n44番モーターの節間成績...」のように、数字の後に改行を挟んで
//     常時表示のキャプション文が続く（受理したい、有効なモーター番号のため）
// 「数字の直後が空白/改行 or 文字列末尾」の場合のみ有効な番号として扱うことで
// この2つを区別する
function toStrictIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = normalizeText(value);
  const m = normalized.match(/^(\d+)(?=\s|$)/);
  return m ? parseInt(m[1], 10) : null;
}

function toFloatOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = parseFloat(normalizeText(value));
  return Number.isFinite(n) ? n : null;
}

// "1'48\"5" 形式（分'秒"コンマ1秒）を合計秒数(DECIMAL)に変換する。
// 例: 1'48"5 → 60 + 48 + 0.5 = 108.5
function parseBestTime(value) {
  if (!value) return null;
  const normalized = normalizeText(value);
  const m = normalized.match(/(\d+)'(\d+)"(\d)/);
  if (!m) return null;
  const [, minutes, seconds, tenths] = m;
  return Number(minutes) * 60 + Number(seconds) + Number(tenths) / 10;
}

function parseStatsPeriod(value) {
  if (!value) return { start: null, end: null };
  const normalized = normalizeText(value).replace(/[～〜~]/g, "~");
  const [start, end] = normalized.split("~");
  const toIso = (d) => {
    const m = d?.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  };
  return { start: toIso(start), end: toIso(end) };
}

// tableの直接の行だけを返す（find("tr")だと、セル内に埋め込まれた節間成績等の
// ネストしたテーブルの行まで巻き込んでしまう会場があるため、直接の子孫のみを辿る）。
// 会場により<thead>/<tbody>の有無・組み合わせが異なる（theadに見出し行のみ、
// tbodyに見出し・データ行を両方、theadなしでtbody直下に全行、等）ため、
// 起点からの子孫コンビネータ(">")で3パターンを一括カバーする
function directRows($, table) {
  return table.find("> thead > tr, > tbody > tr, > tr");
}

// tr直下のセルだけを返す（同様にネストしたテーブルのセルを巻き込まないため）
// セルの.text()はネストしたtableの中身も再帰的に連結してしまう
// （津のモーター番号セルには「節間成績」というポップアップ用のネストテーブルが
// 埋め込まれており、.text()だけでは何百文字もの無関係な文字列が混入する）。
// ネストしたtableを除いてから文字列化する
function cellText($, cell) {
  const clone = $(cell).clone();
  clone.find("table").remove();
  return clone.text().trim();
}

function directCells($, tr) {
  return $(tr)
    .children("td,th")
    .map((_, c) => cellText($, c))
    .get();
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @returns {{ data: Array|null, reason: string|null }}
 */
export function parseGenericMotorTable($) {
  const tables = $("table");
  let headerMap = null;
  let dataRows = [];
  let headerCellCount = 0;

  for (let i = 0; i < tables.length; i++) {
    const table = tables.eq(i);
    const rows = directRows($, table);
    if (rows.length < 2) continue;

    const headerCells = directCells($, rows.get(0));
    if (!isMotorStatsHeaderRow(headerCells)) continue;

    headerMap = buildHeaderMap(headerCells);
    dataRows = rows.toArray().slice(1);
    headerCellCount = headerCells.length;
    break;
  }

  if (!headerMap) {
    return { data: null, reason: "motor_stats_table_not_found" };
  }
  if (headerMap.motorNumber === undefined) {
    return { data: null, reason: "motor_number_column_not_found" };
  }

  const results = [];
  for (const tr of dataRows) {
    const cells = directCells($, tr);
    if (cells.length === 0) continue;
    // 一部会場（大村）は1モーターにつき2行構成で、2行目は4〜6着数のみの
    // 3セルの継続行（本パーサーでは使わない項目のため、見出しより明らかに
    // セル数が少ない行は継続行とみなしてスキップする）
    if (cells.length < headerCellCount) continue;

    const motorNumber = toStrictIntOrNull(cells[headerMap.motorNumber]);
    // 決まり手分析の凡例行（"逃げ","まくり",...）等、モーター番号が数値でない
    // 行はデータ行ではないためスキップする
    if (motorNumber === null) continue;

    const period = parseStatsPeriod(cells[headerMap.statsPeriod]);

    results.push({
      motorNumber,
      meetCount: toIntOrNull(cells[headerMap.meetCount]),
      raceCount: toIntOrNull(cells[headerMap.raceCount]),
      finalCount: toIntOrNull(cells[headerMap.finalCount]),
      championshipCount: toIntOrNull(cells[headerMap.championshipCount]),
      firstPlaceCount: toIntOrNull(cells[headerMap.firstPlace]),
      secondPlaceCount: toIntOrNull(cells[headerMap.secondPlace]),
      thirdPlaceCount: toIntOrNull(cells[headerMap.thirdPlace]),
      winRate: toFloatOrNull(cells[headerMap.winRate]),
      top2Rate: toFloatOrNull(cells[headerMap.top2Rate]),
      top3Rate: toFloatOrNull(cells[headerMap.top3Rate]),
      accidentRate: toFloatOrNull(cells[headerMap.accidentRate]),
      avgExhibitionTime: toFloatOrNull(cells[headerMap.avgExhibitionTime]),
      bestTime: parseBestTime(cells[headerMap.bestTime]),
      statsPeriodStart: period.start,
      statsPeriodEnd: period.end,
    });
  }

  if (results.length === 0) {
    return { data: null, reason: "no_data_rows" };
  }
  return { data: results, reason: null };
}

export const _internal = {
  normalizeText,
  buildHeaderMap,
  isMotorStatsHeaderRow,
};
