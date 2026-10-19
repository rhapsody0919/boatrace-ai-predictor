/**
 * 本番の読み取り専用ロール claude_ro で1文を実行する（scripts/db/ro-query.js の本体、ADR-0096）。
 * 書けないことはロールの権限（マイグレーション 166）で保証する。ここでは誤用を早く止め、出力を抑える。
 *   * 1文だけ。先頭は SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW のどれか
 *   * READ ONLY のトランザクションで開き、最後は必ず ROLLBACK する
 *   * 接続したロールが claude_ro であることを確かめる（別のロールの URL を入れても実行しない）
 *   * 行はカーソルで上限＋1行だけ取る（psql には上限が無いので自前で付ける）
 *
 * client は query(text) が { rows, fields: [{ name }] } を返すもの（pg の Client・PGlite のどちらでもよい）。
 */
import { splitStatements } from "./dbApplySql.js";

export const RO_ROLE = "claude_ro";
export const DEFAULT_ROW_LIMIT = 200;
export const MAX_ROW_LIMIT = 5000;
export const STATEMENT_TIMEOUT = "30s";

const CURSOR_HEADS = ["SELECT", "WITH", "TABLE", "VALUES"];
const DIRECT_HEADS = ["EXPLAIN", "SHOW"];

/**
 * @param {string} sql
 * @returns {{ ok: true, text: string, useCursor: boolean } | { ok: false, reason: string }}
 */
export function checkReadStatement(sql) {
  const { statements, metaCommands, errors } = splitStatements(sql);
  if (errors.length > 0) return { ok: false, reason: errors.join("; ") };
  if (metaCommands.length > 0) {
    return { ok: false, reason: "psql のメタコマンド（\\…）は受け付けない" };
  }
  if (statements.length !== 1) {
    return {
      ok: false,
      reason: `1文だけを受け付ける（${statements.length}文あった）`,
    };
  }
  const [s] = statements;
  const head = (/^[A-Za-z]+/.exec(s.code)?.[0] ?? "").toUpperCase();
  if (CURSOR_HEADS.includes(head)) {
    return { ok: true, text: s.text, useCursor: true };
  }
  if (DIRECT_HEADS.includes(head)) {
    return { ok: true, text: s.text, useCursor: false };
  }
  return {
    ok: false,
    reason: `先頭が ${[...CURSOR_HEADS, ...DIRECT_HEADS].join(" / ")} の文だけを受け付ける（${head || "空"}）`,
  };
}

/** @param {unknown} value */
export function parseRowLimit(value) {
  if (value === undefined) return DEFAULT_ROW_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_ROW_LIMIT) {
    throw new Error(`--limit は 1〜${MAX_ROW_LIMIT} の整数: ${String(value)}`);
  }
  return n;
}

/**
 * 接続文字列のユーザー名が claude_ro（Session pooler では claude_ro.<project-ref>）であることを、接続の前に確かめる。
 * @param {string | undefined} url
 */
export function checkRoUrl(url) {
  if (!url) {
    throw new Error(
      "SUPABASE_RO_DB_URL が無い。初回設定は docs/db-migration/166-runbook.md",
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("SUPABASE_RO_DB_URL が URL として読めない");
  }
  const user = decodeURIComponent(parsed.username);
  if (user !== RO_ROLE && !user.startsWith(`${RO_ROLE}.`)) {
    throw new Error(
      `SUPABASE_RO_DB_URL のユーザーが ${RO_ROLE} でない（${user}）。書き込めるロールの URL では実行しない`,
    );
  }
  // pg は URL の sslmode を ssl の設定より優先するため外し、呼び出し側の ssl を使う
  parsed.searchParams.delete("sslmode");
  // ?user= や options=-c role=… は URL のユーザー名より優先されるので、他のクエリは受け付けない
  if ([...parsed.searchParams.keys()].length > 0) {
    throw new Error(
      `SUPABASE_RO_DB_URL に sslmode 以外のクエリがある（${[...parsed.searchParams.keys()].join(", ")}）。外す`,
    );
  }
  return parsed.toString();
}

/**
 * @param {{ query: (text: string) => Promise<{ rows: Record<string, unknown>[], fields?: { name: string }[] }> }} client
 * @param {string} sql
 * @param {{ limit?: number, expectedRole?: string }} [options]
 * @returns {Promise<{ fields: string[], rows: Record<string, unknown>[], truncated: boolean, limit: number }>}
 */
export async function runReadOnlyQuery(
  client,
  sql,
  { limit = DEFAULT_ROW_LIMIT, expectedRole = RO_ROLE } = {},
) {
  const checked = checkReadStatement(sql);
  if (!checked.ok) throw new Error(checked.reason);

  await client.query("BEGIN TRANSACTION READ ONLY");
  let result;
  try {
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    const who = await client.query(
      "SELECT current_user AS role, current_setting('transaction_read_only') AS ro",
    );
    const { role, ro } = who.rows[0];
    if (role !== expectedRole) {
      throw new Error(
        `接続したロールが ${expectedRole} でない（${role}）。実行しない`,
      );
    }
    if (ro !== "on") {
      throw new Error(
        `トランザクションが READ ONLY になっていない（${ro}）。実行しない`,
      );
    }

    let res;
    if (checked.useCursor) {
      await client.query(
        `DECLARE ro_query_cursor NO SCROLL CURSOR FOR ${checked.text}\n`,
      );
      res = await client.query(
        `FETCH FORWARD ${limit + 1} FROM ro_query_cursor`,
      );
    } else {
      res = await client.query(checked.text);
    }
    const truncated = res.rows.length > limit;
    result = {
      fields: (res.fields ?? []).map((f) => f.name),
      rows: truncated ? res.rows.slice(0, limit) : res.rows,
      truncated,
      limit,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // 接続が切れた等で ROLLBACK も失敗したとき、元のエラーを上書きしない
      console.error(`ro-query: ROLLBACK も失敗した: ${rollbackError.message}`);
    }
    throw e;
  }
  await client.query("ROLLBACK");
  return result;
}

const MAX_CELL_CHARS = 120;

/** @param {unknown} v */
function cellText(v) {
  let s;
  if (v === null || v === undefined) s = "NULL";
  else if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  s = s.replace(/\s+/g, " ");
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS - 1)}…` : s;
}

/**
 * Markdown の表にする（セルは1行・120字まで）。
 * @param {{ fields: string[], rows: Record<string, unknown>[], truncated: boolean, limit: number }} result
 */
export function formatResult({ fields, rows, truncated, limit }) {
  const esc = (s) => s.replace(/\|/g, "\\|");
  const lines = [];
  if (fields.length > 0) {
    lines.push(`| ${fields.map(esc).join(" | ")} |`);
    lines.push(`| ${fields.map(() => "---").join(" | ")} |`);
    for (const row of rows) {
      lines.push(`| ${fields.map((f) => esc(cellText(row[f]))).join(" | ")} |`);
    }
  }
  lines.push(
    truncated
      ? `(${limit} 行で打ち切り。続きは --limit を上げるか条件を絞る)`
      : `(${rows.length} 行)`,
  );
  return lines.join("\n");
}
