/**
 * 本番 DB 適用ワークフロー（.github/workflows/db-apply.yml）が、承認の前にマイグレーションを検査するための純粋関数。
 * パスの検証・SQL の文への分割・トランザクションに包めない文の検出・触るテーブルの抽出・台帳（APPLIED.md）の更新。
 * 手順は docs/operation/db-apply.md。
 */

// docs/db-migration/ の実ファイルは「3桁の番号（013b のような英小文字1字の枝番あり）_英小文字」。
// 大文字を含む古いファイル（008_ADD_EXHIBITION_TO_RPC.sql 等）は適用済みのため対象にしない。
// 英小文字・数字・_・- 以外（/ や . を含む）を許さないので、../ によるディレクトリの外への移動はできない
export const MIGRATION_PATH_RE =
  /^docs\/db-migration\/[0-9]{3}[a-z]?_[a-z0-9_-]+\.sql$/;

/** @param {unknown} value */
export function validateMigrationPath(value) {
  if (typeof value !== "string" || !MIGRATION_PATH_RE.test(value)) {
    return {
      ok: false,
      reason: `パスが ${MIGRATION_PATH_RE} に合わない: ${JSON.stringify(value)}`,
    };
  }
  return { ok: true, reason: "" };
}

const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;

/**
 * SQL を最上位の `;` で文に分ける。文字列（'…'・E'…'）・$タグ$…$タグ$・"識別子"・コメント（-- と入れ子の \/* *\/）の中の
 * `;` やキーワードは文の区切り・判定に使わない。
 *
 * 各文の code は、コメントを空白に、文字列と $ 引用の中身を空にしたもの（"識別子" は残す）。
 * 最上位（引用・コメントの外）のバックスラッシュは psql のメタコマンド（\! でシェルを実行できる）なので metaCommands に入れる。
 *
 * @param {string} sql
 * @returns {{ statements: { code: string, line: number, text: string }[], metaCommands: { line: number, text: string }[], errors: string[] }}
 */
export function splitStatements(sql) {
  const statements = [];
  const metaCommands = [];
  const errors = [];
  let code = "";
  let stmtLine = 0; // 文の最初の非空白文字の行（0=まだ無い）
  let stmtStart = 0; // 文の最初の非空白文字の位置
  let line = 1;
  let i = 0;
  const n = sql.length;

  const markStart = () => {
    if (stmtLine === 0) {
      stmtLine = line;
      stmtStart = i;
    }
  };
  const advance = (count) => {
    for (let k = 0; k < count; k += 1) {
      if (sql[i + k] === "\n") line += 1;
    }
    i += count;
  };

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      code += " ";
      advance(stop - i);
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      const startLine = line;
      advance(2);
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          advance(2);
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          advance(2);
        } else {
          advance(1);
        }
      }
      if (depth > 0) errors.push(`${startLine}行目: 閉じていないコメント /*`);
      code += " ";
      continue;
    }
    if (c === "'") {
      markStart();
      const prev = sql[i - 1] ?? "";
      const prev2 = sql[i - 2] ?? "";
      const escapeString = /[Ee]/.test(prev) && !IDENT_CHAR.test(prev2);
      const startLine = line;
      advance(1);
      let closed = false;
      while (i < n) {
        if (escapeString && sql[i] === "\\") {
          advance(2);
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            advance(2);
            continue;
          }
          advance(1);
          closed = true;
          break;
        }
        advance(1);
      }
      if (!closed) errors.push(`${startLine}行目: 閉じていない文字列 '`);
      code += "''";
      continue;
    }
    if (c === '"') {
      markStart();
      const startLine = line;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) {
        errors.push(`${startLine}行目: 閉じていない識別子 "`);
        code += sql.slice(i);
        advance(n - i);
        continue;
      }
      code += sql.slice(i, j + 1);
      advance(j + 1 - i);
      continue;
    }
    if (c === "$" && !IDENT_CHAR.test(sql[i - 1] ?? "")) {
      const m = /^\$([A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(
        sql.slice(i, i + 64),
      );
      if (m) {
        markStart();
        const tag = m[0];
        const startLine = line;
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) {
          errors.push(`${startLine}行目: 閉じていない ${tag} 引用`);
          code += `${tag}${tag}`;
          advance(n - i);
          continue;
        }
        code += `${tag}${tag}`;
        advance(end + tag.length - i);
        continue;
      }
    }
    if (c === "\\") {
      const end = sql.indexOf("\n", i);
      metaCommands.push({
        line,
        text: sql.slice(i, end === -1 ? n : end).slice(0, 80),
      });
      code += " ";
      advance(1);
      continue;
    }
    if (c === ";") {
      if (code.trim() !== "") {
        statements.push({
          code: code.trim(),
          line: stmtLine,
          text: sql.slice(stmtStart, i),
        });
      }
      code = "";
      stmtLine = 0;
      advance(1);
      continue;
    }
    if (!/\s/.test(c)) markStart();
    code += c;
    advance(1);
  }
  if (code.trim() !== "") {
    statements.push({ code: code.trim(), line: stmtLine, text: sql.slice(stmtStart) });
  }
  return { statements, metaCommands, errors };
}

// 判定用: "識別子" の中身を消し、空白を1つにまとめて大文字にする
const bare = (code) =>
  code
    .replace(/"(?:[^"]|"")*"/g, '"_"')
    .replace(/\s+/g, " ")
    .toUpperCase();

const TX_BEGIN_RE = /^(BEGIN|START TRANSACTION)\b/;
const TX_END_RE = /^(COMMIT|END)( WORK| TRANSACTION)?$/;
const TX_CONTROL_RE =
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

// apply の上限。ロック待ちは早めに諦め（再実行すればよい）、1文の実行は job の timeout（15分）より前に打ち切る
export const LOCK_TIMEOUT = "10s";
export const STATEMENT_TIMEOUT = "10min";
// 自動の経路（承認なし、ADR-0097）は短くする。判定は表の大きさを見られないので、大きい表のロック待ちや長い索引の作成は
// ここで失敗として止める（待ち続けない）。ファイルの SET LOCAL は判定がこの上限以内のものだけを軽いにしている
export const AUTO_TIMEOUTS = { lock: "5s", statement: "120s" };
// これを超える行には注意を出す（本文の枠の外に隠れる）
const LONG_LINE_CHARS = 200;

// 双方向制御（Trojan Source）・ゼロ幅文字・BOM。承認者が読む本文と実際の SQL をずらせるため拒否する
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

const ID = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*))?`;
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
  if (txIndexes.length > 0 && !wrapped) {
    for (const idx of txIndexes) {
      rejections.push(
        `${statements[idx].line}行目: トランザクション制御（${bare(statements[idx].code).slice(0, 40)}）。` +
          "許すのは「先頭の文が BEGIN、最後の文が COMMIT」の1組だけ",
      );
    }
  }

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

/**
 * ファイル冒頭のコメント（最初の文より前の -- 行）から、見出しに「確認」を含む節を取り出す。
 * 見出し: `-- 適用後の確認（読み取りのみ）:` のように `-- ` の直後から書かれ、`:`（全角可）を含む行。
 * 中身: 続く `--` + 空白2つ以上で字下げされた行。
 *
 * @param {string} sql
 * @returns {{ heading: string, lines: string[] }[]}
 */
export function extractConfirmationSections(sql) {
  const header = [];
  for (const raw of sql.split("\n")) {
    const lineText = raw.replace(/\r$/, "");
    if (lineText.trim() === "") {
      header.push("--");
      continue;
    }
    if (!/^\s*--/.test(lineText)) break;
    header.push(lineText.trim());
  }
  const sections = [];
  let current = null;
  for (const lineText of header) {
    // 見出しの「確認」より前に : が無いこと（「過去分: …確認できておらず」を見出しにしない）
    const heading = /^-- ?((?=\S)[^:：]*確認[^:：]*[:：])\s*(.*)$/.exec(lineText);
    if (heading) {
      current = { heading: heading[1], inline: heading[2], indented: [] };
      sections.push(current);
      continue;
    }
    if (current && /^--\s{2,}\S/.test(lineText)) {
      current.indented.push(lineText.slice(2));
      continue;
    }
    current = null;
  }
  return sections.map(({ heading, inline, indented }) => {
    const indent = Math.min(...indented.map((l) => l.search(/\S/)));
    return {
      heading,
      lines: [...(inline ? [inline] : []), ...indented.map((l) => l.slice(indent))],
    };
  });
}

/**
 * job summary の表のセルに入れるコード片（`…` で囲む前）。コードスパンの中では HTML も Markdown も解釈されないので、
 * 抜け出す手段（` と改行）と、表の列を割る | だけを潰す
 */
export const codeCell = (text) =>
  String(text).replace(/\s+/g, " ").replace(/`/g, "'").replace(/\|/g, "\\|");

/** job summary の地の文（見出し等）に SQL 由来の文字列を入れるとき、Markdown・HTML として解釈させない */
export const escapeInline = (text) =>
  String(text)
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]|~]/g, (c) => `\\${c}`)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fenceFor = (text) => {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map((m) => m[0].length),
  );
  return "`".repeat(longest + 1);
};

/**
 * 承認の前に見る job summary（Markdown）。
 * @param {{ path: string, sha256: string, sql: string, inspection: ReturnType<typeof inspectMigration>,
 *           fileUrl: string, alreadyApplied: boolean, maxBodyLines?: number }} args
 */
export function renderSummary({
  path,
  sha256,
  sql,
  inspection,
  fileUrl,
  alreadyApplied,
  maxBodyLines = 2000,
}) {
  const lines = sql.split("\n");
  const lineCount = sql.endsWith("\n") ? lines.length - 1 : lines.length;
  const out = [];
  out.push(`## 本番 DB への適用: \`${path}\``);
  out.push("");
  if (inspection.rejections.length > 0) {
    out.push("### このファイルは適用できない（承認の前に止めた）");
    out.push("");
    for (const r of inspection.rejections) out.push(`- ${r}`);
    out.push("");
  }
  const longLines = lines
    .map((l, idx) => ({ line: idx + 1, length: l.length }))
    .filter((l) => l.length > LONG_LINE_CHARS);
  if (longLines.length > 0) {
    out.push(
      `> **注意: ${LONG_LINE_CHARS} 字を超える行がある（${longLines
        .slice(0, 10)
        .map((l) => `${l.line}行目 ${l.length}字`)
        .join("、")}）。本文の枠は横にスクロールしないと見えないので、行末まで読んでから承認する**`,
    );
    out.push("");
  }
  if (alreadyApplied) {
    out.push(
      "> **注意: 台帳（APPLIED.md）ではこのファイルは既に「適用済み」。再適用で問題ないか確認してから承認する**",
    );
    out.push("");
  }
  out.push("| 項目 | 値 |");
  out.push("|---|---|");
  out.push(`| ファイル | [${path}](${fileUrl}) |`);
  out.push(`| sha256 | \`${sha256}\` |`);
  out.push(`| 行数 | ${lineCount} |`);
  out.push(`| 文の数 | ${inspection.statements.length} |`);
  out.push(
    `| 実行のしかた | ${
      inspection.mode === "file-transaction"
        ? "ファイル自身の BEGIN〜COMMIT（1つのトランザクション。途中で失敗したら全体が戻る）"
        : "psql --single-transaction（1つのトランザクション。途中で失敗したら全体が戻る）"
    } |`,
  );
  out.push("");
  out.push(
    "### 触るテーブル（CREATE/ALTER/INSERT/UPDATE/DELETE/DROP/TRUNCATE の対象）",
  );
  out.push("");
  if (inspection.tables.length === 0) {
    out.push(
      "なし（関数・ポリシー・権限・コメントだけの変更か、DO ブロックの中で触っている。本文で確認する）",
    );
  } else {
    out.push("| テーブル | 操作 |");
    out.push("|---|---|");
    for (const t of inspection.tables)
      out.push(`| \`${codeCell(t.table)}\` | ${t.ops.join(", ")} |`);
  }
  out.push("");
  out.push("DO ブロック・関数本体（$$ の中）は抽出しない。");
  out.push("");
  out.push("### 冒頭コメントの確認 SQL");
  out.push("");
  const sections = extractConfirmationSections(sql);
  if (sections.length === 0) {
    out.push(
      "冒頭コメントに「確認」の節が無い。本文の確認方法を読んでから承認する。",
    );
  } else {
    for (const s of sections) {
      const text = s.lines.join("\n");
      const fence = fenceFor(text);
      out.push(`**${escapeInline(s.heading)}**`);
      out.push("");
      out.push(`${fence}sql`);
      out.push(text);
      out.push(fence);
      out.push("");
    }
  }
  out.push("### 文の一覧（先頭120字）");
  out.push("");
  out.push("| 行 | 文 |");
  out.push("|---|---|");
  for (const s of inspection.statements) {
    out.push(`| ${s.line} | \`${codeCell(s.head)}\` |`);
  }
  out.push("");
  const shown = lines.slice(0, maxBodyLines).join("\n");
  const fence = fenceFor(shown);
  out.push(
    lineCount > maxBodyLines
      ? `### 本文（先頭 ${maxBodyLines} 行 / 全 ${lineCount} 行。全文は上のリンク）`
      : "### 本文",
  );
  out.push("");
  out.push(`${fence}sql`);
  out.push(shown.replace(/\n$/, ""));
  out.push(fence);
  out.push("");
  return out.join("\n");
}

/**
 * apply で psql に渡す引数。ロック待ちで本番の読み取りを長く止めないよう、ファイルの前にセッションの
 * lock_timeout・statement_timeout を設定する（-c と -f は書いた順に同じ接続で実行される）。
 * single-transaction では -c も含めて1つのトランザクションになる。file-transaction では SET が BEGIN の前に
 * 確定し、ファイル自身のトランザクションにも効く。
 *
 * @param {"single-transaction" | "file-transaction"} mode
 * @param {string} migrationPath
 */
export function psqlArgs(
  mode,
  migrationPath,
  timeouts = { lock: LOCK_TIMEOUT, statement: STATEMENT_TIMEOUT },
) {
  const args = ["-X", "-v", "ON_ERROR_STOP=1", "--echo-errors"];
  if (mode === "single-transaction") args.push("--single-transaction");
  args.push("-c", `SET lock_timeout = '${timeouts.lock}'`);
  args.push("-c", `SET statement_timeout = '${timeouts.statement}'`);
  args.push("-f", migrationPath);
  return args;
}

/** ファイル名の番号部分（"122"・"013b"） */
export const migrationNumber = (fileName) => fileName.split("_")[0];

/**
 * 台帳の行で、そのファイルが「適用済み」か（3列目）
 * @param {string} ledger
 * @param {string} fileName
 */
export function isAppliedInLedger(ledger, fileName) {
  const row = ledger
    .split("\n")
    .find(
      (l) => l.startsWith("|") && (l.split("|")[2] ?? "").trim() === fileName,
    );
  return row ? (row.split("|")[3] ?? "").includes("適用済み") : false;
}

/**
 * 台帳（APPLIED.md）で、ファイルの行の「適用状況」を適用済みにする。行が無ければ表に足す
 * （「（番号なし）」の行の前。無ければ表の最後の行の後）。
 *
 * @param {string} ledger
 * @param {{ fileName: string, date: string, runUrl: string, sha256: string }} args
 * @returns {{ text: string, action: "updated" | "inserted" }}
 */
export function markAppliedInLedger(
  ledger,
  { fileName, date, runUrl, sha256 },
) {
  const status = `適用済み（${date}、db-apply ワークフローで適用。run: ${runUrl}、sha256: \`${sha256.slice(0, 16)}…\`）`;
  const rows = ledger.split("\n");
  const idx = rows.findIndex(
    (l) => l.startsWith("|") && (l.split("|")[2] ?? "").trim() === fileName,
  );
  if (idx !== -1) {
    const cells = rows[idx].split("|");
    // cells: ["", " 番号 ", " ファイル ", " 適用状況 ", ...残り]
    cells[3] = ` ${status} `;
    rows[idx] = cells.join("|");
    return { text: rows.join("\n"), action: "updated" };
  }
  const newRow = `| ${migrationNumber(fileName)} | ${fileName} | ${status} | 台帳に行が無かったため db-apply が追加した。変更内容はファイル冒頭のコメントを参照 |`;
  const tableHeader = rows.findIndex((l) =>
    /^\|\s*番号\s*\|\s*ファイル\s*\|/.test(l),
  );
  if (tableHeader === -1)
    throw new Error(
      "APPLIED.md に台帳の表（| 番号 | ファイル | …）が見つからない",
    );
  let end = tableHeader;
  while (end + 1 < rows.length && rows[end + 1].startsWith("|")) end += 1;
  const unnumbered = rows.findIndex(
    (l, k) => k > tableHeader && k <= end && /^\|\s*（番号なし）/.test(l),
  );
  const insertAt = unnumbered !== -1 ? unnumbered : end + 1;
  rows.splice(insertAt, 0, newRow);
  return { text: rows.join("\n"), action: "inserted" };
}

// ---------------------------------------------------------------------------
// 軽い／重いの判定（ADR-0097）。許可のリスト方式: ファイルの全部の文が下の形に丸ごと当てはまるときだけ「軽い」
// （Environment production-db-auto で承認なしに当てる）。1文でも外れたら「重い」（production-db、オーナーの1タップ）。
// 個人情報らしい列を足すもの・削除の前の控えが無いもの・inspectMigration が拒否するものは「止める」（当てずに通知）。
// 判定は文の code（コメントを消し、文字列と $$ の中身を空にしたもの）で行う。DO・関数の本体は見えないが、どちらも重い。
// ---------------------------------------------------------------------------

/** 削除の前の控えを置くスキーマ（API に出さない） */
export const BACKUP_SCHEMA = "db_backup";

// 識別子1つ（"…" か英字始まり）と、スキーマつきの名前
const ONE_ID = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;

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
function splitTopLevel(text) {
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
const PAREN_KEYWORDS = new Set([
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
function disallowedCalls(text, allowed = PAREN_KEYWORDS) {
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
function columnsOfCreateTable(body) {
  return splitTopLevel(body)
    .filter((part) => !CONSTRAINT_HEADS.test(part))
    .map((part) => new RegExp(`^(${ONE_ID})`).exec(part)?.[1])
    .filter(Boolean);
}

const CREATE_TABLE_RE = new RegExp(
  String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${ID})\s*\(([\s\S]*)\)$`,
  "i",
);
const CREATE_INDEX_RE = new RegExp(
  String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:${ONE_ID}\s+)?ON\s+(?:ONLY\s+)?(${ID})(?:\s+USING\s+(?:BTREE|GIN|GIST|HASH|BRIN))?\s*\(([^()]*)\)(?:\s+INCLUDE\s*\(([^()]*)\))?(?:\s+WHERE\s+([\s\S]+))?$`,
  "i",
);
const INDEX_COLUMN_RE = new RegExp(
  String.raw`^${ONE_ID}(?:\s+${ONE_ID})?(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?$`,
  "i",
);
const ALTER_TABLE_RE = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${ID})\s+([\s\S]+)$`,
  "i",
);
const ADD_COLUMN_RE = new RegExp(
  String.raw`^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(${ONE_ID})\s+([\s\S]+)$`,
  "i",
);
// serial 型は暗黙の DEFAULT nextval と NOT NULL を伴い、既存の行を全部書き直す
const ADD_COLUMN_FORBIDDEN =
  /\b(DEFAULT|NOT\s+NULL|GENERATED|PRIMARY|UNIQUE|CHECK|COLLATE|CONSTRAINT|AS|USING|SMALLSERIAL|SERIAL[248]?|BIGSERIAL)\b/i;
const CREATE_POLICY_RE = new RegExp(
  String.raw`^CREATE\s+POLICY\s+${ONE_ID}\s+ON\s+(${ID})(?:\s+AS\s+(?:PERMISSIVE|RESTRICTIVE))?\s+FOR\s+SELECT(?:\s+TO\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)?(?:\s+USING\s*\(([\s\S]*)\))?$`,
  "i",
);
const REVOKE_RE = new RegExp(
  String.raw`^REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER))*)\s+ON\s+(?:TABLE\s+)?(${ID}(?:\s*,\s*${ID})*)\s+FROM\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*(?:\s+CASCADE)?$`,
  "i",
);
const SET_LOCAL_RE =
  /^SET\s+LOCAL\s+(lock_timeout|statement_timeout)\s*(?:=|TO)\s*'?(\d+)\s*(ms|s|min)?'?$/i;
// 自動の経路で SET LOCAL に許す上限（これを超えて待たせる・走らせるのは重い）
const SET_LOCAL_MAX_MS = { lock_timeout: 10_000, statement_timeout: 120_000 };
const EXEMPT_MARKER_RE = /--\s*(rls|grant|view|function)-exempt:/;
const NO_BACKUP_MARKER_RE = /--\s*db-apply:\s*no-backup\s+(\S+)\s+\S/g;

/**
 * 1文の判定。ctx.createdTables は同じファイルでこの文より前に CREATE TABLE した表（canonName）
 * @returns {{ kind: "light" | "heavy", reason: string }}
 */
function classifyStatement(code, text, ctx) {
  const flat = code.replace(/\s+/g, " ").trim();
  const heavy = (reason) => ({ kind: "heavy", reason });
  const light = (reason) => ({ kind: "light", reason });
  if (flat.includes("$")) return heavy("$$ の本体（DO・関数）を含む");

  const ct = CREATE_TABLE_RE.exec(flat);
  if (ct) {
    const table = canonName(ct[1]);
    if (table.includes(".")) return heavy(`public 以外のスキーマの表（${table}）`);
    // 重い CREATE TABLE でも、同じファイルで作った表であることは変わらない（後ろの RLS・policy・REVOKE の判定に使う）
    ctx.createdTables.add(table);
    const body = ct[2];
    if (/\bLIKE\b|\bEXCLUDE\b/i.test(body)) return heavy("CREATE TABLE の LIKE・EXCLUDE");
    const calls = disallowedCalls(body);
    if (calls.length > 0) return heavy(`CREATE TABLE の中で関数を呼ぶ（${calls.join(", ")}）`);
    return light("CREATE TABLE");
  }

  const ci = CREATE_INDEX_RE.exec(flat);
  if (ci) {
    const columns = [...splitTopLevel(ci[2]), ...(ci[3] ? splitTopLevel(ci[3]) : [])];
    if (!columns.every((c) => INDEX_COLUMN_RE.test(c))) return heavy("式の索引");
    if (ci[4] !== undefined) {
      const calls = disallowedCalls(ci[4]);
      if (calls.length > 0 || /\bSELECT\b/i.test(ci[4]))
        return heavy(`索引の WHERE で関数・副問い合わせを使う（${calls.join(", ")}）`);
    }
    return light("CREATE INDEX");
  }

  const at = ALTER_TABLE_RE.exec(flat);
  if (at) {
    const table = canonName(at[1]);
    for (const action of splitTopLevel(at[2])) {
      const add = ADD_COLUMN_RE.exec(action);
      if (add) {
        if (ADD_COLUMN_FORBIDDEN.test(add[2]))
          return heavy("ADD COLUMN に既定値・NOT NULL・制約・生成列がある");
        const calls = disallowedCalls(add[2]);
        if (calls.length > 0) return heavy(`ADD COLUMN の中で関数を呼ぶ（${calls.join(", ")}）`);
        continue;
      }
      if (/^(ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY$/i.test(action)) {
        if (!ctx.createdTables.has(table))
          return heavy(`同じファイルで作っていない表（${table}）の RLS の変更`);
        continue;
      }
      return heavy(`ALTER TABLE の ${action.split(/\s+/).slice(0, 3).join(" ")}`);
    }
    return light("ALTER TABLE（ADD COLUMN・RLS の有効化）");
  }

  if (/^COMMENT\s+ON\s+[\s\S]+\s+IS\s+(?:''|NULL)$/i.test(flat)) return light("COMMENT");

  const cp = CREATE_POLICY_RE.exec(flat);
  if (cp) {
    const table = canonName(cp[1]);
    if (!ctx.createdTables.has(table))
      return heavy(`同じファイルで作っていない表（${table}）の policy`);
    const calls = cp[2] === undefined ? [] : disallowedCalls(cp[2], new Set([...PAREN_KEYWORDS, "auth.uid", "auth.role"]));
    if (calls.length > 0 || /\bSELECT\b/i.test(cp[2] ?? ""))
      return heavy(`policy の USING で関数・副問い合わせを使う（${calls.join(", ")}）`);
    return light("CREATE POLICY（SELECT だけ）");
  }

  const rv = REVOKE_RE.exec(flat);
  if (rv) {
    const tables = splitTopLevel(rv[1]).map(canonName);
    const others = tables.filter((t) => !ctx.createdTables.has(t));
    if (others.length > 0) return heavy(`同じファイルで作っていない表（${others.join(", ")}）の REVOKE`);
    return light("REVOKE（同じファイルの表）");
  }

  if (/^NOTIFY\s+pgrst(?:\s*,\s*'')?$/i.test(flat)) return light("NOTIFY pgrst");

  const sl = SET_LOCAL_RE.exec(text.replace(/\s+/g, " ").trim().replace(/;$/, ""));
  if (sl && /^SET\s+LOCAL\b/i.test(flat)) {
    const unit = (sl[3] ?? "ms").toLowerCase();
    const ms = Number(sl[2]) * (unit === "min" ? 60_000 : unit === "s" ? 1000 : 1);
    // 0 は PostgreSQL では無制限なので軽いにしない
    if (ms > 0 && ms <= SET_LOCAL_MAX_MS[sl[1].toLowerCase()]) return light(`SET LOCAL ${sl[1]}`);
    return heavy(`SET LOCAL ${sl[1]} が自動の上限を超える`);
  }

  return heavy(flat.split(" ").slice(0, 4).join(" "));
}

/**
 * データを消す文と、その表（ALTER TABLE … DROP COLUMN は列も）を返す
 * @returns {{ table: string, column?: string, what: string }[]}
 */
function destructiveTargets(code) {
  const flat = code.replace(/\s+/g, " ").trim();
  const targets = [];
  for (const { table, op } of extractTables(code)) {
    if (op === "DROP" || op === "TRUNCATE" || op === "DELETE")
      targets.push({ table: canonName(table), what: op });
  }
  const at = ALTER_TABLE_RE.exec(flat);
  if (at) {
    for (const action of splitTopLevel(at[2])) {
      const dc = new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(${ONE_ID})`, "i").exec(action);
      if (dc && !/^DROP\s+(CONSTRAINT|DEFAULT|NOT|EXPRESSION|IDENTITY)\b/i.test(action))
        targets.push({ table: canonName(at[1]), column: canonName(dc[1]), what: "DROP COLUMN" });
    }
  }
  return targets;
}

// 依存する表・列ごと消すが、どの表かを文からは決められない削除。控えで守れないので止める
const UNBACKUPABLE_DROP_RE =
  /^(DROP\s+(SCHEMA|TYPE|DOMAIN|EXTENSION)\b[\s\S]*\bCASCADE\b|DROP\s+OWNED\b)/i;

const BACKUP_RE = new RegExp(
  String.raw`^CREATE\s+TABLE\s+(${ID})\s+AS\s+(?:TABLE\s+(${ID})|SELECT\s+([\s\S]+?)\s+FROM\s+(${ID}))$`,
  "i",
);

/**
 * マイグレーションを軽い／重い／止めるに分ける（ADR-0097）。
 *
 * @param {string} sql
 * @param {string} fileName 例 "167_x.sql"（控えの表の名前 db_backup._bak_<番号>_<表> に使う）
 * @returns {{ label: "light" | "heavy" | "stop",
 *            statements: { line: number, kind: "light" | "heavy" | "backup" | "tx", reason: string }[],
 *            stops: string[], backups: { table: string, line: number }[] }}
 */
export function classifyMigration(sql, fileName) {
  const inspection = inspectMigration(sql);
  const stops = inspection.rejections.map((r) => `適用できない: ${r}`);
  const { statements } = splitStatements(sql);
  const number = migrationNumber(fileName);
  const ctx = { createdTables: new Set() };
  const backups = [];
  const results = [];
  const noBackup = new Set(
    [...sql.matchAll(NO_BACKUP_MARKER_RE)].map((m) => canonName(m[1])),
  );

  for (const s of statements) {
    const flat = s.code.replace(/\s+/g, " ").trim();
    if (TX_CONTROL_RE.test(bare(s.code)) && inspection.mode === "file-transaction") {
      results.push({ line: s.line, kind: "tx", reason: "BEGIN / COMMIT" });
      continue;
    }

    const bk = BACKUP_RE.exec(flat);
    if (bk) {
      const target = canonName(bk[1]);
      const source = canonName(bk[2] ?? bk[4]);
      const expected = `${BACKUP_SCHEMA}._bak_${number}_${source.replace(/\./g, "_")}`.toLowerCase();
      if (target === expected) {
        backups.push({
          table: source,
          line: s.line,
          columns: bk[3] === undefined || bk[3].trim() === "*" ? null : splitTopLevel(bk[3]).map(canonName),
        });
        results.push({ line: s.line, kind: "backup", reason: `削除の前の控え（${source}）` });
        continue;
      }
    }

    for (const t of destructiveTargets(s.code)) {
      const copied = backups.some(
        (b) => b.table === t.table && (b.columns === null || (t.column !== undefined && b.columns.includes(t.column))),
      );
      const isBackup = t.table.startsWith(`${BACKUP_SCHEMA}.`);
      if (!copied && !noBackup.has(t.table) && !isBackup) {
        stops.push(
          `${s.line}行目: ${t.what}（${t.table}${t.column ? `.${t.column}` : ""}）の前に控えが無い。` +
            `同じファイルの前の文で CREATE TABLE ${BACKUP_SCHEMA}._bak_${number}_${t.table} AS TABLE ${t.table} を書く`,
        );
      }
    }

    if (UNBACKUPABLE_DROP_RE.test(flat)) {
      stops.push(`${s.line}行目: 依存する表・列ごと消しうる削除（${flat.split(" ").slice(0, 3).join(" ")} … CASCADE / DROP OWNED）は控えで守れない`);
    }

    for (const col of piiColumns(flat)) {
      stops.push(`${s.line}行目: 個人情報らしい列（${col}）を足す`);
    }

    const r = classifyStatement(s.code, s.text, ctx);
    results.push({ line: s.line, ...r });
  }

  if (EXEMPT_MARKER_RE.test(sql)) {
    results.push({ line: 0, kind: "heavy", reason: "verify-migration-rls の除外マーカーがある" });
  }

  const label =
    stops.length > 0 ? "stop" : results.some((r) => r.kind !== "light" && r.kind !== "tx") ? "heavy" : "light";
  return { label, statements: results, stops, backups };
}

/** 文が足す列のうち、個人情報らしい名前のもの */
function piiColumns(flat) {
  const ct = CREATE_TABLE_RE.exec(flat);
  const names = ct ? columnsOfCreateTable(ct[2]) : [];
  const at = ALTER_TABLE_RE.exec(flat);
  if (at) {
    for (const action of splitTopLevel(at[2])) {
      const add = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${ONE_ID})`, "i").exec(action);
      if (add && !/^ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(action)) names.push(add[1]);
    }
  }
  return names.filter(isPiiColumn).map(canonName);
}
