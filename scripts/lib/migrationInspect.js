/**
 * マイグレーションの検査（dbApplySql.js から分けた純粋関数）: トランザクションに包めない文・見えない字の拒否、触るテーブルの抽出。
 * 呼び出し元はこれまでどおり dbApplySql.js から import できる
 */
import { splitStatements } from "./sqlStatements.js";

// 判定用: "識別子" の中身を消し、空白を1つにまとめて大文字にする
export const bare = (code) =>
  code
    .replace(/"(?:[^"]|"")*"/g, '"_"')
    .replace(/\s+/g, " ")
    .toUpperCase();

const TX_BEGIN_RE = /^(BEGIN|START TRANSACTION)\b/;
const TX_END_RE = /^(COMMIT|END)( WORK| TRANSACTION)?$/;
export const TX_CONTROL_RE =
  /^(BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE TRANSACTION)\b/;

// トランザクションに包めない（または今回の適用で扱わない）文。[文の先頭か任意の位置か, 正規表現, 理由]
const REJECT_RULES = [
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

export const ID = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*))?`;
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

/** 字句の誤り・見えない制御文字・メタコマンド・空の拒否（この順） */
function lexicalRejections(sql, statements, metaCommands, errors) {
  const rejections = [...errors];
  for (const [idx, lineText] of sql.split("\n").entries()) {
    if (INVISIBLE_RE.test(lineText)) {
      rejections.push(
        `${idx + 1}行目: 見えない制御文字（双方向制御・ゼロ幅・BOM）がある。承認画面の表示と実行される SQL がずれるため許可しない`,
      );
    }
  }
  for (const m of metaCommands) {
    rejections.push(
      `${m.line}行目: psql のメタコマンド（\\…）は許可しない: ${m.text}`,
    );
  }
  if (statements.length === 0) rejections.push("SQL の文が1つも無い");
  return rejections;
}

/** トランザクション制御の位置を見て、ファイル自身の BEGIN〜COMMIT で包んでいるか（wrapped）と拒否を返す */
function transactionShape(statements) {
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
  const rejections = [];
  if (txIndexes.length > 0 && !wrapped) {
    for (const idx of txIndexes) {
      rejections.push(
        `${statements[idx].line}行目: トランザクション制御（${bare(statements[idx].code).slice(0, 40)}）。` +
          "許すのは「先頭の文が BEGIN、最後の文が COMMIT」の1組だけ",
      );
    }
  }
  return { wrapped, rejections };
}

/**
 * マイグレーションを検査する。rejections が1件でもあれば適用しない。
 * mode: "single-transaction"（ファイルにトランザクション制御が無い。psql --single-transaction で包む）
 *       "file-transaction"（先頭の文が BEGIN、最後の文が COMMIT で、他にトランザクション制御が無い。
 *        ファイル自身の BEGIN〜COMMIT が1つのトランザクションになるので、--single-transaction は付けない）
 *
 * @param {string} sql
 */
export function inspectMigration(sql) {
  const { statements, metaCommands, errors } = splitStatements(sql);
  const rejections = lexicalRejections(sql, statements, metaCommands, errors);
  const tx = transactionShape(statements);
  rejections.push(...tx.rejections);
  const wrapped = tx.wrapped;

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

  return {
    mode: wrapped ? "file-transaction" : "single-transaction",
    statements: statements.map((s) => ({
      line: s.line,
      head: s.text.replace(/\s+/g, " ").trim().slice(0, 120),
    })),
    tables: [...tables.entries()]
      .map(([table, ops]) => ({ table, ops: [...ops] }))
      .sort((a, b) => a.table.localeCompare(b.table)),
    rejections,
  };
}
