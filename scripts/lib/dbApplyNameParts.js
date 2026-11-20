/**
 * scripts/lib/dbApplySql.js から移した、SQL の名前の部品（識別子の正規表現・名前の正規化・括弧の深さ0での分割・
 * 許されない関数の呼び出し・個人情報らしい列）。字は元のまま。
 */

export const ID = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*))?`;

// 識別子1つ（"…" か英字始まり）と、スキーマつきの名前
export const ONE_ID = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;

/** 名前の比較用: public. を外し、"…" は中身をそのまま、裸の名前は小文字にする */
export function canonName(name) {
  return name
    .replace(/\s*\.\s*/g, ".")
    .trim()
    .split(".")
    .map((part) =>
      part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toLowerCase(),
    )
    .filter((part, idx, all) => !(idx === 0 && all.length === 2 && part === "public"))
    .join(".");
}

/** 括弧の深さ0の `,` で分ける（文字列・$$ の中身は code で空になっている） */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur.trim());
  return parts;
}

// 名前の直後に ( が来てよいもの: 型の修飾子・制約の構文・副作用の無い組み込み関数
export const PAREN_KEYWORDS = new Set([
  // 型
  "numeric", "decimal", "varchar", "char", "character", "varying", "bit", "varbit",
  "timestamp", "timestamptz", "time", "timetz", "interval", "float",
  // 構文
  "check", "key", "unique", "in", "and", "or", "not", "as", "identity", "where", "include",
  "any", "all", "is", "between", "then", "else", "when", "case",
  // 副作用の無い組み込み関数
  "now", "clock_timestamp", "gen_random_uuid", "timezone", "char_length", "length", "lower", "upper",
  "btrim", "trim", "jsonb_typeof", "array_length", "cardinality", "coalesce", "nullif",
  "greatest", "least", "abs",
]);

/**
 * 許されない関数の呼び出し（名前の直後の `(`）を返す。REFERENCES 表(列) と、`(` の前が名前でないもの（括弧のまとまり）は除く
 * @param {string} text
 * @param {Set<string>} [allowed]
 */
export function disallowedCalls(text, allowed = PAREN_KEYWORDS) {
  const calls = [];
  const re = new RegExp(String.raw`(REFERENCES\s+)?(${ONE_ID}(?:\s*\.\s*${ONE_ID})?)\s*\(`, "gi");
  for (const m of text.matchAll(re)) {
    if (m[1]) continue;
    // public. を外さずに比べる（public.lower のような同名の関数は組み込みではない）
    const name = m[2]
      .replace(/\s*\.\s*/g, ".")
      .split(".")
      .map((part) => (part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toLowerCase()))
      .join(".");
    if (!allowed.has(name)) calls.push(name);
  }
  return calls;
}

// 個人情報らしい列の名前（_ で区切った語のどれかが当たれば止める）
const PII_WORDS = new Set([
  "email", "mail", "phone", "tel", "telephone", "mobile", "address", "addr",
  "birth", "birthday", "birthdate", "dob", "fullname", "realname", "kana", "zip", "postal",
]);
export function isPiiColumn(name) {
  const lower = canonName(name).toLowerCase();
  return lower.split(/[^a-z0-9]+/).some((word) => PII_WORDS.has(word)) || /氏名|住所|電話|生年月日/.test(lower);
}

const CONSTRAINT_HEADS = /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|LIKE)\b/i;

/** CREATE TABLE の本文（括弧の中）から列の名前を取り出す */
export function columnsOfCreateTable(body) {
  return splitTopLevel(body)
    .filter((part) => !CONSTRAINT_HEADS.test(part))
    .map((part) => new RegExp(`^(${ONE_ID})`).exec(part)?.[1])
    .filter(Boolean);
}
