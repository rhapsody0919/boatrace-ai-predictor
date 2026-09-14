/**
 * parserUtils - 会場公式サイトのモーター成績パーサー間で共通の変換・DOM操作
 * ヘルパー（BOA-264）。当初はgenericTable.js/gamagori.js/miyajimaPdf.jsの3ファイルに
 * それぞれ独立して実装されていたが、特にモーター番号の厳格判定ロジックが
 * 微妙に食い違っていた（genericTable.jsは前方一致＋改行区切り許容、gamagori.jsは
 * 正規化なしの前方一致、miyajimaPdf.jsは完全一致）ため、1箇所に統一した
 * （セルフレビューで発見、2026-09-13）。
 */

// 全角数字・記号を半角に正規化（会場により「２連対率」「1着」等の全角/半角が混在）
export function normalizeText(text) {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[（）]/g, (c) => (c === "（" ? "(" : ")"))
    .trim();
}

export function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = parseInt(normalizeText(value), 10);
  return Number.isFinite(n) ? n : null;
}

export function toFloatOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = parseFloat(normalizeText(value));
  return Number.isFinite(n) ? n : null;
}

// モーター番号セルは、数字の直後に別の文字列が続くケースが2パターンある:
// (a) "4着"のような凡例行の断片 → 数字の直後に文字が直接続く（拒否したい）
// (b) 津の「44\n\n\n44番モーターの節間成績...」のように、数字の後に改行を挟んで
//     常時表示のキャプション文が続く（受理したい、有効なモーター番号のため）
// 「数字の直後が空白/改行 or 文字列末尾」の場合のみ有効な番号として扱うことで
// この2つを区別する
export function toStrictIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = normalizeText(value);
  const m = normalized.match(/^(\d+)(?=\s|$)/);
  return m ? parseInt(m[1], 10) : null;
}

// "1'48\"5" 形式（分'秒"コンマ1秒）を合計秒数(DECIMAL)に変換する。
// 例: 1'48"5 → 60 + 48 + 0.5 = 108.5
export function parseBestTime(value) {
  if (!value) return null;
  const normalized = normalizeText(value);
  const m = normalized.match(/(\d+)'(\d+)"(\d)/);
  if (!m) return null;
  const [, minutes, seconds, tenths] = m;
  return Number(minutes) * 60 + Number(seconds) + Number(tenths) / 10;
}

export function toIsoDate(value) {
  const m = value?.trim().match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function parseStatsPeriod(value) {
  if (!value) return { start: null, end: null };
  const normalized = normalizeText(value).replace(/[～〜~]/g, "~");
  const [start, end] = normalized.split("~");
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

// tableの直接の行だけを返す（find("tr")だと、セル内に埋め込まれた節間成績等の
// ネストしたテーブルの行まで巻き込んでしまう会場があるため、直接の子孫のみを辿る）。
// 会場により<thead>/<tbody>の有無・組み合わせが異なる（theadに見出し行のみ、
// tbodyに見出し・データ行を両方、theadなしでtbody直下に全行、等）ため、
// 起点からの子孫コンビネータ(">")で3パターンを一括カバーする
export function directRows($, table) {
  return table.find("> thead > tr, > tbody > tr, > tr");
}

// セルの.text()はネストしたtableの中身も再帰的に連結してしまう
// （津のモーター番号セルには「節間成績」というポップアップ用のネストテーブルが
// 埋め込まれており、.text()だけでは何百文字もの無関係な文字列が混入する）。
// ネストしたtableを除いてから文字列化する
export function cellText($, cell) {
  const clone = $(cell).clone();
  clone.find("table").remove();
  return clone.text().trim();
}

// tr直下のセルだけを返す（同様にネストしたテーブルのセルを巻き込まないため）
export function directCells($, tr) {
  return $(tr)
    .children("td,th")
    .map((_, c) => cellText($, c))
    .get();
}
