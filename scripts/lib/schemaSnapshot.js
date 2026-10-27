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
import { LEDGER_STATES } from "./dbReconcile.js";

export const SNAPSHOT_FORMAT = 2;

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

const RELKINDS = {
  r: "table",
  p: "partitioned_table",
  v: "view",
  m: "materialized_view",
  f: "foreign_table",
};
const CONTYPES = {
  p: "primary_key",
  f: "foreign_key",
  u: "unique",
  c: "check",
  x: "exclusion",
  t: "constraint_trigger",
};
const POLCMDS = {
  r: "SELECT",
  a: "INSERT",
  w: "UPDATE",
  d: "DELETE",
  "*": "ALL",
};
const PROKINDS = { f: "function", p: "procedure", a: "aggregate", w: "window" };
const VOLATILITIES = { i: "immutable", s: "stable", v: "volatile" };
const IDENTITIES = { "": null, a: "always", d: "by_default" };
const GENERATED = { "": null, s: "stored", v: "virtual" };
const TRIGGER_ENABLED = {
  O: "origin",
  D: "disabled",
  R: "replica",
  A: "always",
};
const DEFAULT_ACL_SCOPES = ["global", "public"];
const DEFAULT_ACL_OBJECTS = {
  r: "table",
  S: "sequence",
  f: "function",
  T: "type",
  n: "schema",
};

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

function decode(map, code, what) {
  if (!Object.hasOwn(map, code)) {
    throw new Error(
      `schema-snapshot: 知らない ${what} の記号 ${JSON.stringify(code)}`,
    );
  }
  return map[code];
}

/** 複数行の定義は行の配列にする（JSON の差分が1行ずつ読める）。読む側は join("\n") で戻す */
function toLines(text) {
  return text === null || text === undefined ? null : String(text).split("\n");
}

/** C の照合（バイトの順）と同じ並び。識別子は ASCII なので code unit の比較で一致する */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byKeys =
  (...keys) =>
  (a, b) => {
    for (const k of keys) {
      const d = cmp(String(a[k] ?? ""), String(b[k] ?? ""));
      if (d !== 0) return d;
    }
    return 0;
  };
const byName = byKeys("name");
const byGrantee = byKeys("grantee");

const functionKey = (name, args) => `${name}(${args})`;

function grantEntry(row) {
  return {
    grantee: row.grantee,
    privileges: row.privileges,
    grantable: row.grantable ?? [],
  };
}

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
  const rows = [];
  for (const line of String(ledger ?? "").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const file = cells[2] ?? "";
    if (!file.endsWith(".sql")) continue;
    const status = cells[3] ?? "";
    const num = /^(\d+)/.exec(file)?.[1];
    rows.push({
      file,
      number: num === undefined ? null : Number(num),
      state: LEDGER_STATES.find((s) => status.startsWith(s)) ?? null,
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

  const relations = new Map();
  for (const r of rows.relations) {
    relations.set(r.name, {
      name: r.name,
      kind: decode(RELKINDS, r.relkind, "relkind"),
      owner: r.owner,
      rlsEnabled: r.rls_enabled,
      rlsForced: r.rls_forced,
      options: r.options ?? null,
      comment: r.comment ?? null,
      viewDefinition: toLines(r.view_definition),
      columns: [],
      constraints: [],
      indexes: [],
      policies: [],
      triggers: [],
      grants: [],
    });
  }
  const relationOf = (name, what) => {
    const rel = relations.get(name);
    if (!rel) {
      throw new Error(
        `schema-snapshot: ${what} の表 ${name} が表・ビューの一覧に無い`,
      );
    }
    return rel;
  };

  const columns = new Map();
  for (const c of rows.columns) {
    const col = {
      name: c.name,
      position: c.position,
      type: c.type,
      notNull: c.not_null,
      default: c.default_expr ?? null,
      identity: decode(IDENTITIES, c.identity ?? "", "attidentity"),
      generated: decode(GENERATED, c.generated ?? "", "attgenerated"),
      comment: c.comment ?? null,
      grants: [],
    };
    relationOf(c.table_name, "列").columns.push(col);
    columns.set(`${c.table_name}.${c.name}`, col);
  }
  for (const c of rows.constraints) {
    const isFk =
      c.references_table !== null && c.references_table !== undefined;
    relationOf(c.table_name, "制約").constraints.push({
      name: c.name,
      type: decode(CONTYPES, c.contype, "contype"),
      columns: c.columns ?? [],
      definition: c.definition,
      references: isFk ? `${c.references_schema}.${c.references_table}` : null,
      referencesColumns: isFk ? (c.references_columns ?? []) : null,
    });
  }
  for (const i of rows.indexes) {
    relationOf(i.table_name, "索引").indexes.push({
      name: i.name,
      unique: i.is_unique,
      primary: i.is_primary,
      definition: i.definition,
    });
  }
  for (const p of rows.policies) {
    relationOf(p.table_name, "ポリシー").policies.push({
      name: p.name,
      command: decode(POLCMDS, p.cmd, "polcmd"),
      permissive: p.permissive,
      roles: [...(p.roles ?? [])].sort(cmp),
      using: p.using_expr ?? null,
      withCheck: p.check_expr ?? null,
    });
  }
  for (const t of rows.triggers) {
    relationOf(t.table_name, "トリガー").triggers.push({
      name: t.name,
      enabled: decode(TRIGGER_ENABLED, t.enabled, "tgenabled"),
      function: `${t.function_schema}.${functionKey(t.function_name, t.function_args)}`,
      definition: t.definition,
    });
  }

  const functions = new Map();
  for (const f of rows.functions) {
    functions.set(functionKey(f.name, f.identity_args), {
      name: f.name,
      identityArgs: f.identity_args,
      result: f.result ?? null,
      kind: decode(PROKINDS, f.prokind, "prokind"),
      language: f.language,
      volatility: decode(VOLATILITIES, f.volatility, "provolatile"),
      securityDefiner: f.security_definer,
      config: f.config ?? null,
      owner: f.owner,
      prosrcMd5: f.prosrc_md5,
      definition: toLines(f.definition),
      grants: [],
    });
  }

  const sequences = new Map();
  const defaultPrivileges = [];
  for (const g of rows.grants) {
    const type = String(g.object_type);
    if (type === "relation") {
      relationOf(g.name, "権限").grants.push(grantEntry(g));
    } else if (type === "column") {
      const col = columns.get(g.name);
      if (!col)
        throw new Error(
          `schema-snapshot: 列の権限の ${g.name} が列の一覧に無い`,
        );
      col.grants.push(grantEntry(g));
    } else if (type === "function") {
      const fn = functions.get(functionKey(g.name, g.identity_args));
      if (!fn) {
        throw new Error(
          `schema-snapshot: 関数の権限の ${g.name}(${g.identity_args}) が関数の一覧に無い`,
        );
      }
      fn.grants.push(grantEntry(g));
    } else if (type === "sequence") {
      if (!sequences.has(g.name))
        sequences.set(g.name, { name: g.name, grants: [] });
      sequences.get(g.name).grants.push(grantEntry(g));
    } else if (type.startsWith("default:")) {
      const [, scope, objType] = type.split(":");
      if (!DEFAULT_ACL_SCOPES.includes(scope)) {
        throw new Error(
          `schema-snapshot: 知らない既定の権限の範囲 ${JSON.stringify(scope)}`,
        );
      }
      defaultPrivileges.push({
        scope,
        objectType: decode(DEFAULT_ACL_OBJECTS, objType, "defaclobjtype"),
        role: g.name,
        ...grantEntry(g),
      });
    } else {
      throw new Error(
        `schema-snapshot: 知らない権限の対象 ${JSON.stringify(g.object_type)}`,
      );
    }
  }

  const relationList = [...relations.values()].sort(byName);
  for (const r of relationList) {
    r.columns.sort((a, b) => a.position - b.position);
    for (const c of r.columns) c.grants.sort(byGrantee);
    r.constraints.sort(byName);
    r.indexes.sort(byName);
    r.policies.sort(byName);
    r.triggers.sort(byName);
    r.grants.sort(byGrantee);
  }
  const functionList = [...functions.values()].sort(
    byKeys("name", "identityArgs"),
  );
  for (const f of functionList) f.grants.sort(byGrantee);
  const sequenceList = [...sequences.values()].sort(byName);
  for (const s of sequenceList) s.grants.sort(byGrantee);
  defaultPrivileges.sort(byKeys("scope", "objectType", "role", "grantee"));

  const count = (k) => relationList.reduce((a, r) => a + r[k].length, 0);
  const isView = (r) => r.kind === "view" || r.kind === "materialized_view";
  const snapshot = {
    $comment: [
      "本番 DB（public）のスキーマの写し。記録であり生成物ではない（ADR-0102。ADR-0078 の生成物の一覧に入れない）。リポジトリは公開なので、写しも公開に載る。",
      "作り直し: git fetch して master の台帳に合わせてから node --env-file=.env.local scripts/db/schema-snapshot.js（claude_ro で読むだけ。scripts/db/ro-query.js を問い合わせごとに呼ぶ）。",
      "鮮度: appliedFilesAtCapture は取得の時に docs/db-migration/APPLIED.md で適用済みだったファイル。今の台帳で適用済みなのにそこに無いファイルがあれば古い（session-start-check の schemaSnapshot）。",
      '手で書き換えない。definition・viewDefinition は行の配列（join("\\n") で戻す）。行数の目安（reltuples）は入れない。',
    ],
    format: SNAPSHOT_FORMAT,
    capturedAt,
    appliedThrough,
    appliedFilesAtCapture: appliedFiles,
    serverVersionNum: rows.meta[0]?.server_version_num ?? null,
    counts: {
      relations: relationList.length,
      tables: relationList.filter((r) => !isView(r)).length,
      views: relationList.filter(isView).length,
      columns: count("columns"),
      functions: functionList.length,
      policies: count("policies"),
      constraints: count("constraints"),
      indexes: count("indexes"),
      triggers: count("triggers"),
    },
    relations: relationList,
    functions: functionList,
    sequences: sequenceList,
    defaultPrivileges,
  };
  assertNoSecrets(snapshot);
  return snapshot;
}

/** ファイルに書く形（2字下げ＋末尾の改行） */
export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * 写しが base（master）の写しより前の取得に戻っていないか。並行して取り直した古い PR が後で入ると、master の写しが巻き戻る。
 * @param {{ capturedAt: string, appliedFilesAtCapture?: string[] }} head
 * @param {{ capturedAt: string, appliedFilesAtCapture?: string[] } | null} base
 * @returns {string | null} 戻っていれば理由
 */
export function snapshotRegression(head, base) {
  if (!base) return null;
  if (Date.parse(head.capturedAt) < Date.parse(base.capturedAt)) {
    return `capturedAt が base（${base.capturedAt}）より前（${head.capturedAt}）`;
  }
  const headFiles = new Set(head.appliedFilesAtCapture ?? []);
  const lost = (base.appliedFilesAtCapture ?? []).filter(
    (f) => !headFiles.has(f),
  );
  if (lost.length > 0) {
    return `base の写しで適用済みだったファイルが無い（${lost.slice(0, 5).join(", ")}${lost.length > 5 ? " …" : ""}）`;
  }
  return null;
}
