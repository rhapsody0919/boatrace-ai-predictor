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
  maxBodyLines = 400,
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
      out.push(`| \`${t.table}\` | ${t.ops.join(", ")} |`);
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
      out.push(`**${s.heading}**`);
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
    const cell = s.head
      .replace(/\|/g, "\\|")
      .replace(/`/g, "'")
      .replace(/</g, "&lt;");
    out.push(`| ${s.line} | \`${cell}\` |`);
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
