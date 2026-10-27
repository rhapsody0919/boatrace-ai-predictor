/**
 * 本番スキーマの写し（docs/reference/schema-snapshot.json、ADR-0102）を組み立てる純粋関数。DB に触れない。
 * 取得は scripts/db/schema-snapshot.js が scripts/db/ro-query.js（claude_ro、ADR-0096）を問い合わせごとに呼んで行い、
 * ここは ro-query.js の --json の出力（{ fields, rows, truncated, limit }）を問い合わせの名前ごとに受け取って組み立てるだけ。
 *
 * 守ること:
 *   * 1つでも truncated（--limit で打ち切り）なら失敗にする。写しが黙って欠けない
 *   * 列・制約・索引・ポリシー・権限が、取った表・ビュー・関数のどれにも当たらなければ失敗にする（問い合わせの食い違い）
 *   * 知らない種類の記号（relkind・contype 等）が来たら失敗にする（Postgres の版の変化に気づく）
 *   * 鍵らしい文字列（JWT・sb_secret_）が入っていたら失敗にする（関数の本文に鍵を書いた等）
 *   * 並びは名前（関数は名前と引数の型）の順。同じスキーマなら capturedAt 以外は同じ出力になる
 *   * 行数の目安（reltuples）は入れない（毎回変わり、記録の差分が読めなくなる）
 *
 * 鮮度は appliedThrough（docs/db-migration/APPLIED.md で「適用済み」の最大の番号）と
 * pendingAtCapture（それ以下で適用済みでなかった番号。欠番・台帳に行が無い番号を含む）で持つ。比べるのは snapshotFreshness。
 */
import { ledgerState } from "./dbReconcile.js";

export const SNAPSHOT_FORMAT = 1;

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
  n: "not_null",
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
const DEFAULT_ACL_OBJECTS = {
  r: "table",
  S: "sequence",
  f: "function",
  T: "type",
  n: "schema",
};

const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT（Supabase の anon・service_role の鍵の形）
  /sb_secret_[A-Za-z0-9_-]{8,}/, // Supabase の新しい秘密鍵の形
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

const relationKey = (name) => `relation:${name}`;
const functionKey = (name, args) => `function:${name}(${args})`;

function grantEntry(row) {
  return {
    grantee: row.grantee,
    privileges: row.privileges,
    grantable: row.grantable ?? [],
  };
}

/**
 * @param {Record<string, { fields?: string[], rows: Record<string, unknown>[], truncated: boolean }>} raw
 *   問い合わせの名前ごとの ro-query.js --json の出力
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
 * 台帳（APPLIED.md）の番号つきの行の番号と適用状況（「（番号なし）」の行は数えない）
 * @param {string} ledger
 * @returns {{ number: number, state: string | null }[]}
 */
function ledgerRows(ledger) {
  const text = String(ledger ?? "");
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (!/^\d+$/.test(cells[1] ?? "")) continue;
    rows.push({ number: Number(cells[1]), state: ledgerState(text, cells[2]) });
  }
  return rows;
}

const appliedNumbers = (rows) =>
  new Set(rows.filter((r) => r.state === "適用済み").map((r) => r.number));

/**
 * 台帳から、適用済みの最大の番号と、それ以下で適用済みでない番号（未適用・不明・廃止・欠番・台帳に行が無い）を返す。
 * 行の無い番号も入れるのは、後から台帳に「適用済み」で足された番号（db-apply が行を足す等）を見落とさないため。
 * @param {string} ledger
 * @returns {{ appliedThrough: number | null, pendingAtCapture: number[] }}
 */
export function appliedLedgerState(ledger) {
  const applied = appliedNumbers(ledgerRows(ledger));
  if (applied.size === 0) return { appliedThrough: null, pendingAtCapture: [] };
  const appliedThrough = Math.max(...applied);
  const pendingAtCapture = [];
  for (let n = 1; n <= appliedThrough; n++) {
    if (!applied.has(n)) pendingAtCapture.push(n);
  }
  return { appliedThrough, pendingAtCapture };
}

/**
 * 写しが台帳より古いか。写しの後に「適用済み」になった番号（appliedThrough より大きいもの、
 * または取得の時に未適用・不明だったもの）があれば古い。
 * @param {{ appliedThrough: number | null, pendingAtCapture?: number[] }} snapshot
 * @param {string} ledger
 */
export function snapshotFreshness(snapshot, ledger) {
  const applied = appliedNumbers(ledgerRows(ledger));
  const pending = new Set(snapshot.pendingAtCapture ?? []);
  const through = snapshot.appliedThrough ?? -1;
  const appliedSince = [...applied]
    .filter((n) => n > through || pending.has(n))
    .sort((a, b) => a - b);
  return {
    stale: appliedSince.length > 0,
    snapshotAppliedThrough: snapshot.appliedThrough,
    ledgerAppliedThrough: applied.size > 0 ? Math.max(...applied) : null,
    appliedSince,
  };
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
  const { appliedThrough, pendingAtCapture } = appliedLedgerState(ledger);
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
    relationOf(c.table_name, "制約").constraints.push({
      name: c.name,
      type: decode(CONTYPES, c.contype, "contype"),
      definition: c.definition,
      references:
        c.references_table === null || c.references_table === undefined
          ? null
          : `${c.references_schema}.${c.references_table}`,
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
      roles: p.roles,
      using: p.using_expr ?? null,
      withCheck: p.check_expr ?? null,
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
    if (g.object_type === "relation") {
      relationOf(g.name, "権限").grants.push(grantEntry(g));
    } else if (g.object_type === "column") {
      const col = columns.get(g.name);
      if (!col)
        throw new Error(
          `schema-snapshot: 列の権限の ${g.name} が列の一覧に無い`,
        );
      col.grants.push(grantEntry(g));
    } else if (g.object_type === "function") {
      const fn = functions.get(functionKey(g.name, g.identity_args));
      if (!fn) {
        throw new Error(
          `schema-snapshot: 関数の権限の ${g.name}(${g.identity_args}) が関数の一覧に無い`,
        );
      }
      fn.grants.push(grantEntry(g));
    } else if (g.object_type === "sequence") {
      if (!sequences.has(g.name))
        sequences.set(g.name, { name: g.name, grants: [] });
      sequences.get(g.name).grants.push(grantEntry(g));
    } else if (String(g.object_type).startsWith("default:")) {
      defaultPrivileges.push({
        objectType: decode(
          DEFAULT_ACL_OBJECTS,
          g.object_type.slice("default:".length),
          "defaclobjtype",
        ),
        role: g.name,
        ...grantEntry(g),
      });
    } else {
      throw new Error(
        `schema-snapshot: 知らない権限の対象 ${JSON.stringify(g.object_type)}`,
      );
    }
  }

  const relationList = [...relations.values()];
  const functionList = [...functions.values()];
  const snapshot = {
    $comment: [
      "本番 DB（public）のスキーマの写し。記録であり生成物ではない（ADR-0102。ADR-0078 の生成物の一覧に入れない）。",
      "作り直し: node --env-file=.env.local scripts/db/schema-snapshot.js（claude_ro で読むだけ。scripts/db/ro-query.js を問い合わせごとに呼ぶ）。",
      "鮮度: appliedThrough は取得の時の docs/db-migration/APPLIED.md の適用済みの最大の番号、pendingAtCapture はそれ以下で適用済みでなかった番号（未適用・不明・欠番・台帳に行が無い）。",
      "後で適用済みになった番号があれば古い（session-start-check の schemaSnapshot）。手で書き換えない。",
      'definition・viewDefinition は行の配列（join("\\n") で戻す）。行数の目安（reltuples）は入れない。',
    ],
    format: SNAPSHOT_FORMAT,
    capturedAt,
    appliedThrough,
    pendingAtCapture,
    serverVersionNum: rows.meta[0]?.server_version_num ?? null,
    counts: {
      relations: relationList.length,
      tables: relationList.filter(
        (r) => r.kind !== "view" && r.kind !== "materialized_view",
      ).length,
      views: relationList.filter(
        (r) => r.kind === "view" || r.kind === "materialized_view",
      ).length,
      columns: rows.columns.length,
      functions: functionList.length,
      policies: rows.policies.length,
      constraints: rows.constraints.length,
      indexes: rows.indexes.length,
    },
    relations: relationList,
    functions: functionList,
    sequences: [...sequences.values()],
    defaultPrivileges,
  };

  const text = JSON.stringify(snapshot);
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) {
      throw new Error(
        `schema-snapshot: 鍵らしい文字列（${re.source.slice(0, 12)}…）が写しに入っている。書かない。どの関数・コメントかを確かめる`,
      );
    }
  }
  return snapshot;
}

/** ファイルに書く形（2字下げ＋末尾の改行） */
export function serializeSnapshot(snapshot) {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
