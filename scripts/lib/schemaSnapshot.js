/**
 * 本番スキーマの写し（docs/reference/schema-snapshot.json、ADR-0102）を組み立てる純粋関数。DB に触れない。
 * 取得は scripts/db/schema-snapshot.js が scripts/db/ro-query.js（claude_ro、ADR-0096）を問い合わせごとに呼んで行い、
 * ここは ro-query.js の --json の出力（{ fields, rows, truncated, limit }）を問い合わせの名前ごとに受け取って組み立てるだけ。
 *
 * 守ること:
 *   * 1つでも truncated（--limit で打ち切り）なら失敗にする。写しが黙って欠けない
 *   * 列・制約・索引・ポリシー・トリガー・権限が、取った表・ビュー・関数のどれにも当たらなければ失敗にする（問い合わせの食い違い）
 *   * 知らない種類の記号（relkind・contype 等）が来たら失敗にする（Postgres の版の変化に気づく）
 *   * 鍵らしい文字列（JWT・Slack の Webhook・URL に埋めた資格情報 等）と、search_path 等以外の関数の設定（proconfig）が
 *     入っていたら失敗にする。リポジトリは公開なので、写しは公開に載る
 *   * 並びはここで名前（C の照合と同じ code unit の順）に並べ直す。同じスキーマなら capturedAt 以外は同じ出力になる
 *   * 行数の目安（reltuples）は入れない（毎回変わり、記録の差分が読めなくなる）
 *
 * 鮮度は台帳（docs/db-migration/APPLIED.md）のファイルの名前で持つ。appliedFilesAtCapture は取得の時に「適用済み」だった
 * ファイル。今の台帳で適用済みなのにそこに無いファイルがあれば古い（snapshotFreshness）。appliedThrough は表示用の最大の番号。
 */
import { ledgerState } from "./dbReconcile.js";
import {
  addColumns,
  addConstraints,
  addIndexes,
  addPolicies,
  addTriggers,
  applyGrants,
  assembleSnapshot,
  buildFunctions,
  buildRelations,
  cmp,
  relationLookup,
  sortLists,
} from "./schemaSnapshotParts.js";

// 元から export している名は、移した先から同じ名で出し直す
export { SNAPSHOT_FORMAT } from "./schemaSnapshotParts.js";

/** 写しの置き場所（リポジトリの根からの相対） */
export const SNAPSHOT_FILE = "docs/reference/schema-snapshot.json";
export const LEDGER_FILE = "docs/db-migration/APPLIED.md";

/** 取得する問い合わせ（scripts/db/schema-snapshot/{name}.sql）。この順に呼ぶ */
export const SNAPSHOT_QUERIES = [
  "meta",
  "relations",
  "columns",
  "functions",
  "policies",
  "constraints",
  "indexes",
  "triggers",
  "grants",
];

/** 関数の設定（proconfig）で写しに入れてよい名前。ほかの名前（app.* 等）は値が秘密になりうるので失敗にする */
const ALLOWED_FUNCTION_SETTINGS = [
  "search_path",
  "statement_timeout",
  "lock_timeout",
];

const SECRET_PATTERNS = [
  ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Supabase の秘密鍵", /sb_secret_[A-Za-z0-9_-]{8,}/],
  ["Slack の Webhook", /hooks\.slack\.com\/(services|workflows|triggers)\//],
  ["URL に埋めた資格情報", /[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"]+@/i],
  [
    "GitHub のトークン",
    /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/,
  ],
  ["Slack のトークン", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["API の鍵（sk-）", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["AWS のアクセスキー", /\bAKIA[0-9A-Z]{16}\b/],
];

/**
 * @param {Record<string, { rows: Record<string, unknown>[], truncated: boolean, limit?: number }>} raw
 */
function rowsOf(raw) {
  const out = {};
  for (const name of SNAPSHOT_QUERIES) {
    const r = raw?.[name];
    if (!r || !Array.isArray(r.rows)) {
      throw new Error(`schema-snapshot: 問い合わせ ${name} の結果が無い`);
    }
    if (r.truncated !== false) {
      throw new Error(
        `schema-snapshot: 問い合わせ ${name} が ${r.limit ?? "?"} 行で打ち切られた（truncated=${r.truncated}）。写しが欠けるので書かない`,
      );
    }
    out[name] = r.rows;
  }
  return out;
}

/**
 * 台帳（APPLIED.md）の表の行のファイルと適用状況。ファイルの名前を単位にする
 * （同じ番号で状況の違う行（039・048 等）・013b のような番号がある）。
 * @param {string} ledger
 * @returns {{ file: string, number: number | null, state: string | null }[]}
 */
export function ledgerFiles(ledger) {
  const text = String(ledger ?? "");
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const file = (line.split("|")[2] ?? "").trim();
    if (!file.endsWith(".sql")) continue;
    const num = /^(\d+)/.exec(file)?.[1];
    rows.push({
      file,
      number: num === undefined ? null : Number(num),
      // 状況の読み方は db-apply と同じ（「適用済み」等で始まるか）。「2026-09-24 適用」の形の行は null になる
      state: ledgerState(text, file),
    });
  }
  return rows;
}

/**
 * 台帳で「適用済み」のファイル（名前の順）と、その最大の番号
 * @param {string} ledger
 */
export function appliedLedgerState(ledger) {
  const applied = ledgerFiles(ledger).filter((r) => r.state === "適用済み");
  const numbers = applied.map((r) => r.number).filter((n) => n !== null);
  return {
    appliedThrough: numbers.length > 0 ? Math.max(...numbers) : null,
    appliedFiles: [...new Set(applied.map((r) => r.file))].sort(cmp),
  };
}

/**
 * 写しが台帳より古いか。今の台帳で「適用済み」なのに、取得の時に適用済みでなかったファイルがあれば古い。
 * 状況の後戻り（適用済み→不明）と台帳に載らない変更（SQL Editor で直に当てた等）は判定に出ない（ADR-0102）。
 * @param {{ appliedThrough: number | null, appliedFilesAtCapture?: string[] }} snapshot
 * @param {string} ledger
 */
export function snapshotFreshness(snapshot, ledger) {
  const now = appliedLedgerState(ledger);
  const atCapture = new Set(snapshot.appliedFilesAtCapture ?? []);
  const appliedSince = now.appliedFiles.filter((f) => !atCapture.has(f));
  return {
    stale: appliedSince.length > 0,
    snapshotAppliedThrough: snapshot.appliedThrough,
    ledgerAppliedThrough: now.appliedThrough,
    appliedSince,
  };
}

function assertNoSecrets(snapshot) {
  for (const fn of snapshot.functions) {
    for (const setting of fn.config ?? []) {
      const name = String(setting).split("=")[0];
      if (!ALLOWED_FUNCTION_SETTINGS.includes(name)) {
        throw new Error(
          `schema-snapshot: 関数 ${fn.name}(${fn.identityArgs}) の設定 ${name} は写しに入れない（値が秘密になりうる。入れてよいのは ${ALLOWED_FUNCTION_SETTINGS.join("・")}）`,
        );
      }
    }
  }
  const text = JSON.stringify(snapshot);
  for (const [label, re] of SECRET_PATTERNS) {
    if (re.test(text)) {
      throw new Error(
        `schema-snapshot: 鍵らしい文字列（${label}）が写しに入っている。書かない。どの関数・コメント・既定値かを確かめる`,
      );
    }
  }
}

/**
 * @param {Record<string, { rows: Record<string, unknown>[], truncated: boolean, limit?: number }>} raw
 * @param {{ capturedAt: string, ledger: string }} options
 */
export function buildSnapshot(raw, { capturedAt, ledger }) {
  if (typeof capturedAt !== "string" || capturedAt === "") {
    throw new Error("schema-snapshot: capturedAt が無い");
  }
  const rows = rowsOf(raw);
  const { appliedThrough, appliedFiles } = appliedLedgerState(ledger);
  if (appliedThrough === null) {
    throw new Error(
      "schema-snapshot: 台帳（APPLIED.md）に適用済みの番号が無い",
    );
  }

  const relations = buildRelations(rows.relations);
  const relationOf = relationLookup(relations);
  const columns = addColumns(rows.columns, relationOf);
  addConstraints(rows.constraints, relationOf);
  addIndexes(rows.indexes, relationOf);
  addPolicies(rows.policies, relationOf);
  addTriggers(rows.triggers, relationOf);
  const functions = buildFunctions(rows.functions);
  const { sequences, defaultPrivileges } = applyGrants(rows.grants, { relationOf, columns, functions });
  const { relationList, functionList, sequenceList } = sortLists(relations, functions, sequences, defaultPrivileges);
  const snapshot = assembleSnapshot({
    capturedAt,
    appliedThrough,
    appliedFiles,
    rows,
    relationList,
    functionList,
    sequenceList,
    defaultPrivileges,
  });
  assertNoSecrets(snapshot);
  return snapshot;
}

/** ファイルに書く形（2字下げ＋末尾の改行） */
export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * 写しが base（master）の写しより前の取得に戻っていないか。並行して取り直した古い PR が後で入ると、master の写しが巻き戻る。
 * 比べるのは capturedAt だけ（台帳の行の後戻り・名前の直しで適用済みのファイルが減るのは正しい取り直しでも起きる）。
 * @param {{ capturedAt: string }} head
 * @param {{ capturedAt: string } | null} base
 * @returns {string | null} 戻っていれば（または時刻が読めなければ）理由
 */
export function snapshotRegression(head, base) {
  if (!base) return null;
  const h = Date.parse(head.capturedAt);
  const b = Date.parse(base.capturedAt);
  if (Number.isNaN(h) || Number.isNaN(b)) {
    return `capturedAt が時刻として読めない（head: ${head.capturedAt}、base: ${base.capturedAt}）`;
  }
  if (h < b) {
    return `capturedAt が base（${base.capturedAt}）より前（${head.capturedAt}）`;
  }
  return null;
}
