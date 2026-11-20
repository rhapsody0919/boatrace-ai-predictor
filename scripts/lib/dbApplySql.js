/**
 * 本番 DB 適用ワークフロー（.github/workflows/db-apply.yml）が、承認の前にマイグレーションを検査するための純粋関数。
 * パスの検証・SQL の文への分割・トランザクションに包めない文の検出・触るテーブルの抽出・台帳（APPLIED.md）の更新。
 * 手順は docs/operation/db-apply.md。
 */
import {
  bare,
  countNewlines,
  invisibleRejections,
  metaRejections,
  scanStatements,
  scanToken,
  statementHeads,
  tableList,
  transactionRejections,
  transactionShape,
  TX_CONTROL_RE,
} from "./dbApplySqlParts.js";
import {
  appliedNoticeLines,
  bodyLines,
  confirmationLines,
  infoTableLines,
  longLineLines,
  rejectionLines,
  statementListLines,
  tableLines,
} from "./dbApplyRenderParts.js";
import {
  backupEntry,
  classifyStatement,
  hasExemptMarker,
  missingBackupStops,
  noBackupTables,
  statementStops,
} from "./dbApplyClassifyParts.js";

// 他のファイル・試験が import する名は、移した先から同じ名で出し直す（export の名の集合は元と同じ）
export { canonName, isPiiColumn } from "./dbApplyNameParts.js";
export { extractTables } from "./dbApplySqlParts.js";
export { codeCell, escapeInline, extractConfirmationSections } from "./dbApplyRenderParts.js";
export { BACKUP_SCHEMA } from "./dbApplyClassifyParts.js";

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

  while (i < sql.length) {
    const tok = scanToken(sql, i, line);
    if (tok.mark && stmtLine === 0) {
      stmtLine = line;
      stmtStart = i;
    }
    if (tok.error) errors.push(tok.error);
    if (tok.meta) metaCommands.push({ line, text: tok.meta });
    if (tok.semi) {
      if (code.trim() !== "") {
        statements.push({
          code: code.trim(),
          line: stmtLine,
          text: sql.slice(stmtStart, i),
        });
      }
      code = "";
      stmtLine = 0;
    } else {
      code += tok.append;
    }
    line += countNewlines(sql, i, tok.end);
    i = tok.end;
  }
  if (code.trim() !== "") {
    statements.push({ code: code.trim(), line: stmtLine, text: sql.slice(stmtStart) });
  }
  return { statements, metaCommands, errors };
}

// apply の上限。ロック待ちは早めに諦め（再実行すればよい）、1文の実行は job の timeout（15分）より前に打ち切る
export const LOCK_TIMEOUT = "10s";
export const STATEMENT_TIMEOUT = "10min";
// 自動の経路（承認なし、ADR-0097）。判定は表の大きさを見られないので、長い索引の作成等は statement の上限で失敗として止める。
// lock は手での適用と同じ10秒（このリポジトリのマイグレーションは SET LOCAL lock_timeout = '10s' と書く決まりで、
// ファイルの SET LOCAL は -c の SET より後に効く。判定は SET LOCAL を SET_LOCAL_MAX_MS 以内のものだけ軽いにしている）
export const AUTO_TIMEOUTS = { lock: "10s", statement: "120s" };

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
  const { txIndexes, wrapped } = transactionShape(statements);
  const scan = scanStatements(statements);
  const rejections = [
    ...errors,
    ...invisibleRejections(sql),
    ...metaRejections(metaCommands),
    ...(statements.length === 0 ? ["SQL の文が1つも無い"] : []),
    ...transactionRejections(statements, txIndexes, wrapped),
    ...scan.rejections,
  ];
  return {
    mode: wrapped ? "file-transaction" : "single-transaction",
    statements: statementHeads(statements),
    tables: tableList(scan.tables),
    rejections,
  };
}

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
  return [
    `## 本番 DB への適用: \`${path}\``,
    "",
    ...rejectionLines(inspection.rejections),
    ...longLineLines(lines),
    ...appliedNoticeLines(alreadyApplied),
    ...infoTableLines({ path, sha256, fileUrl, lineCount, inspection }),
    ...tableLines(inspection.tables),
    ...confirmationLines(sql),
    ...statementListLines(inspection.statements),
    ...bodyLines(lines, lineCount, maxBodyLines),
  ].join("\n");
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
  const noBackup = noBackupTables(sql);

  for (const s of statements) {
    const flat = s.code.replace(/\s+/g, " ").trim();
    if (TX_CONTROL_RE.test(bare(s.code)) && inspection.mode === "file-transaction") {
      results.push({ line: s.line, kind: "tx", reason: "BEGIN / COMMIT" });
      continue;
    }

    const bk = backupEntry(flat, s.line, number);
    if (bk) {
      backups.push(bk.backup);
      results.push(bk.result);
      continue;
    }

    stops.push(...missingBackupStops(s, backups, noBackup, number), ...statementStops(s, flat));
    results.push({ line: s.line, ...classifyStatement(s.code, s.text, ctx) });
  }

  if (hasExemptMarker(sql)) {
    results.push({ line: 0, kind: "heavy", reason: "verify-migration-rls の除外マーカーがある" });
  }

  const label =
    stops.length > 0 ? "stop" : results.some((r) => r.kind !== "light" && r.kind !== "tx") ? "heavy" : "light";
  return { label, statements: results, stops, backups };
}
