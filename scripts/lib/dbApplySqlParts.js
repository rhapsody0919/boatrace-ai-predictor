/**
 * scripts/lib/dbApplySql.js から移した、SQL の字句の読み（splitStatements の1字句ずつ）・トランザクション制御と拒否の規則・
 * 触るテーブルの抽出・inspectMigration の部品。正規表現と文字列は元のまま。
 */
import { ID } from "./dbApplyNameParts.js";

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/;

// splitStatements の字句の読み。scanToken は位置 i から始まる1つの字句を {end: 次の位置, append: code に足す字,
// mark: 文の最初の非空白か, error・meta・semi: 付くときだけ} で返す（元の while の中の if の列をそのまま関数に分けた）
const scanComment = (sql, i, line) => {
  const c = sql[i];
  const next = sql[i + 1];
  if (c === "-" && next === "-") {
    const end = sql.indexOf("\n", i);
    return { end: end === -1 ? sql.length : end, append: " " };
  }
  if (c === "/" && next === "*") {
    let depth = 1;
    let j = i + 2;
    while (j < sql.length && depth > 0) {
      if (sql[j] === "/" && sql[j + 1] === "*") {
        depth += 1;
        j += 2;
      } else if (sql[j] === "*" && sql[j + 1] === "/") {
        depth -= 1;
        j += 2;
      } else {
        j += 1;
      }
    }
    return { end: j, append: " ", error: depth > 0 ? `${line}行目: 閉じていないコメント /*` : undefined };
  }
  return null;
};

const scanSingleQuote = (sql, i, line) => {
  const prev = sql[i - 1] ?? "";
  const prev2 = sql[i - 2] ?? "";
  const escapeString = /[Ee]/.test(prev) && !IDENT_CHAR.test(prev2);
  let j = i + 1;
  while (j < sql.length) {
    if (escapeString && sql[j] === "\\") {
      j += 2;
      continue;
    }
    if (sql[j] === "'") {
      if (sql[j + 1] === "'") {
        j += 2;
        continue;
      }
      return { mark: true, end: j + 1, append: "''" };
    }
    j += 1;
  }
  return { mark: true, end: j, append: "''", error: `${line}行目: 閉じていない文字列 '` };
};

const scanDoubleQuote = (sql, i, line) => {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === '"') {
      if (sql[j + 1] === '"') {
        j += 2;
        continue;
      }
      return { mark: true, end: j + 1, append: sql.slice(i, j + 1) };
    }
    j += 1;
  }
  return { mark: true, end: sql.length, append: sql.slice(i), error: `${line}行目: 閉じていない識別子 "` };
};

const scanDollar = (sql, i, line) => {
  if (sql[i] !== "$" || IDENT_CHAR.test(sql[i - 1] ?? "")) return null;
  const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i, i + 64));
  if (!m) return null;
  const tag = m[0];
  const end = sql.indexOf(tag, i + tag.length);
  if (end === -1) {
    return { mark: true, end: sql.length, append: `${tag}${tag}`, error: `${line}行目: 閉じていない ${tag} 引用` };
  }
  return { mark: true, end: end + tag.length, append: `${tag}${tag}` };
};

const scanQuoted = (sql, i, line) => {
  const c = sql[i];
  if (c === "'") return scanSingleQuote(sql, i, line);
  if (c === '"') return scanDoubleQuote(sql, i, line);
  return scanDollar(sql, i, line);
};

const scanControl = (sql, i) => {
  const c = sql[i];
  if (c === "\\") {
    const end = sql.indexOf("\n", i);
    return { end: i + 1, append: " ", meta: sql.slice(i, end === -1 ? sql.length : end).slice(0, 80) };
  }
  if (c === ";") return { end: i + 1, semi: true };
  return null;
};

export const scanToken = (sql, i, line) =>
  scanComment(sql, i, line) ??
  scanQuoted(sql, i, line) ??
  scanControl(sql, i) ?? { end: i + 1, append: sql[i], mark: !/\s/.test(sql[i]) };

/** from（含む）から to（含まない）の間の改行の数（元の advance が行番号を進めていた数え方） */
export const countNewlines = (sql, from, to) => {
  let count = 0;
  for (let k = from; k < to; k += 1) if (sql[k] === "\n") count += 1;
  return count;
};

// 判定用: "識別子" の中身を消し、空白を1つにまとめて大文字にする
export const bare = (code) =>
  code
    .replace(/"(?:[^"]|"")*"/g, '"_"')
    .replace(/\s+/g, " ")
    .toUpperCase();

export const TX_BEGIN_RE = /^(BEGIN|START TRANSACTION)\b/;
export const TX_END_RE = /^(COMMIT|END)( WORK| TRANSACTION)?$/;
export const TX_CONTROL_RE =
  /^(BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE TRANSACTION)\b/;

// トランザクションに包めない（または今回の適用で扱わない）文。[文の先頭か任意の位置か, 正規表現, 理由]
export const REJECT_RULES = [
  [/\bCONCURRENTLY\b/, "CONCURRENTLY はトランザクションの中で実行できない"],
  [/^VACUUM\b/, "VACUUM はトランザクションの中で実行できない"],
  [/^ALTER SYSTEM\b/, "ALTER SYSTEM はトランザクションの中で実行できない"],
  [
    /^(CREATE|DROP) DATABASE\b/,
    "CREATE/DROP DATABASE はトランザクションの中で実行できない",
  ],
  [
    /^(CREATE|DROP) TABLESPACE\b/,
    "CREATE/DROP TABLESPACE はトランザクションの中で実行できない",
  ],
  [
    /^(CREATE|ALTER|DROP) SUBSCRIPTION\b/,
    "SUBSCRIPTION の操作はトランザクションに包めない場合がある",
  ],
  [
    /^REINDEX (SYSTEM|DATABASE)\b/,
    "REINDEX SYSTEM/DATABASE はトランザクションの中で実行できない",
  ],
  [/^DISCARD ALL\b/, "DISCARD ALL はトランザクションの中で実行できない"],
  [
    /^COPY\b/,
    "COPY はこのワークフローでは扱わない（データの投入は別ワークフローにする方針）",
  ],
  [
    /\bBEGIN ATOMIC\b/,
    "BEGIN ATOMIC の関数本体は文の区切りを判定できないため扱わない（$$ で書く）",
  ],
];


// 双方向制御（Trojan Source）・ゼロ幅文字・BOM。承認者が読む本文と実際の SQL をずらせるため拒否する
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

const TABLE_RULES = [
  [
    "CREATE",
    new RegExp(
      String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${ID})`,
      "i",
    ),
  ],
  [
    "ALTER",
    new RegExp(
      String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${ID})`,
      "i",
    ),
  ],
  ["INSERT", new RegExp(String.raw`\bINSERT\s+INTO\s+(${ID})`, "gi")],
  [
    "UPDATE",
    new RegExp(
      String.raw`\bUPDATE\s+(?:ONLY\s+)?(${ID})(?:\s+(?:AS\s+)?[A-Za-z_][A-Za-z0-9_]*)?\s+SET\b`,
      "gi",
    ),
  ],
  [
    "DELETE",
    new RegExp(String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?(${ID})`, "gi"),
  ],
];
const TABLE_LIST_RULES = [
  [
    "DROP",
    new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+)$`, "is"),
  ],
  [
    "TRUNCATE",
    new RegExp(String.raw`^TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(.+)$`, "is"),
  ],
];

const normalizeName = (name) =>
  name.replace(/\s*\.\s*/g, ".").trim().replace(/^public\./i, "");

/**
 * @param {string} code 1文（splitStatements の code）
 * @returns {{ table: string, op: string }[]}
 */
export function extractTables(code) {
  const found = [];
  for (const [op, re] of TABLE_RULES) {
    if (re.global) {
      re.lastIndex = 0;
      for (const m of code.matchAll(re))
        found.push({ table: normalizeName(m[1]), op });
    } else {
      const m = re.exec(code);
      if (m) found.push({ table: normalizeName(m[1]), op });
    }
  }
  for (const [op, re] of TABLE_LIST_RULES) {
    const m = re.exec(code);
    if (!m) continue;
    const list = m[1].replace(
      /\b(CASCADE|RESTRICT|CONTINUE IDENTITY|RESTART IDENTITY)\b.*$/is,
      "",
    );
    for (const part of list.split(",")) {
      const name = new RegExp(`^\\s*(?:ONLY\\s+)?(${ID})`, "i").exec(part);
      if (name) found.push({ table: normalizeName(name[1]), op });
    }
  }
  return found;
}

/** 見えない制御文字（双方向制御・ゼロ幅・BOM）がある行の拒否の文 */
export function invisibleRejections(sql) {
  const out = [];
  for (const [idx, lineText] of sql.split("\n").entries()) {
    if (INVISIBLE_RE.test(lineText)) {
      out.push(
        `${idx + 1}行目: 見えない制御文字（双方向制御・ゼロ幅・BOM）がある。承認画面の表示と実行される SQL がずれるため許可しない`,
      );
    }
  }
  return out;
}

export const metaRejections = (metaCommands) =>
  metaCommands.map((m) => `${m.line}行目: psql のメタコマンド（\\…）は許可しない: ${m.text}`);

/** トランザクション制御の文の位置と、先頭 BEGIN・最後 COMMIT の1組だけか（wrapped） */
export function transactionShape(statements) {
  const txIndexes = statements
    .map((s, idx) => (TX_CONTROL_RE.test(bare(s.code)) ? idx : -1))
    .filter((idx) => idx !== -1);
  const last = statements.length - 1;
  const wrapped =
    statements.length >= 2 &&
    txIndexes.length === 2 &&
    txIndexes[0] === 0 &&
    txIndexes[1] === last &&
    TX_BEGIN_RE.test(bare(statements[0].code)) &&
    TX_END_RE.test(bare(statements[last].code));
  return { txIndexes, wrapped };
}

export function transactionRejections(statements, txIndexes, wrapped) {
  if (txIndexes.length === 0 || wrapped) return [];
  return txIndexes.map(
    (idx) =>
      `${statements[idx].line}行目: トランザクション制御（${bare(statements[idx].code).slice(0, 40)}）。` +
      "許すのは「先頭の文が BEGIN、最後の文が COMMIT」の1組だけ",
  );
}

/** 文ごとの拒否の規則（REJECT_RULES）と、触るテーブル（表ごとの操作の集合） */
export function scanStatements(statements) {
  const rejections = [];
  const tables = new Map();
  for (const s of statements) {
    const upper = bare(s.code);
    for (const [re, reason] of REJECT_RULES) {
      if (re.test(upper)) rejections.push(`${s.line}行目: ${reason}`);
    }
    for (const { table, op } of extractTables(s.code)) {
      if (!tables.has(table)) tables.set(table, new Set());
      tables.get(table).add(op);
    }
  }
  return { rejections, tables };
}

export const statementHeads = (statements) =>
  statements.map((s) => ({
    line: s.line,
    head: s.text.replace(/\s+/g, " ").trim().slice(0, 120),
  }));

export const tableList = (tables) =>
  [...tables.entries()]
    .map(([table, ops]) => ({ table, ops: [...ops] }))
    .sort((a, b) => a.table.localeCompare(b.table));
