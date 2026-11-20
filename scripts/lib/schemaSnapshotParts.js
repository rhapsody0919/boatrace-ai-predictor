/**
 * scripts/lib/schemaSnapshot.js から移した、スキーマの写しの組み立ての部品（記号の表・並べ替えの道具・表／列／制約／索引／ポリシー／
 * トリガー／関数／権限の取り込み・写しの本体の組み立て）。字は元のまま。DB に触れない純粋関数。
 */

export const SNAPSHOT_FORMAT = 2;

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
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
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

// 組み立ての部品（buildSnapshot の中の塊を、取り出す表・ビュー・関数・権限ごとに分けた）。
// relations・columns・functions の Map は、元の buildSnapshot の中と同じく、各 add 関数が中の配列へ足して組み立てる
export function buildRelations(relationRows) {
  const relations = new Map();
  for (const r of relationRows) {
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
  return relations;
}

export const relationLookup = (relations) => (name, what) => {
  const rel = relations.get(name);
  if (!rel) {
    throw new Error(
      `schema-snapshot: ${what} の表 ${name} が表・ビューの一覧に無い`,
    );
  }
  return rel;
};

export function addColumns(columnRows, relationOf) {
  const columns = new Map();
  for (const c of columnRows) {
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
  return columns;
}

export function addConstraints(constraintRows, relationOf) {
  for (const c of constraintRows) {
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
}

export function addIndexes(indexRows, relationOf) {
  for (const i of indexRows) {
    relationOf(i.table_name, "索引").indexes.push({
      name: i.name,
      unique: i.is_unique,
      primary: i.is_primary,
      definition: i.definition,
    });
  }
}

export function addPolicies(policyRows, relationOf) {
  for (const p of policyRows) {
    relationOf(p.table_name, "ポリシー").policies.push({
      name: p.name,
      command: decode(POLCMDS, p.cmd, "polcmd"),
      permissive: p.permissive,
      roles: [...(p.roles ?? [])].sort(cmp),
      using: p.using_expr ?? null,
      withCheck: p.check_expr ?? null,
    });
  }
}

export function addTriggers(triggerRows, relationOf) {
  for (const t of triggerRows) {
    relationOf(t.table_name, "トリガー").triggers.push({
      name: t.name,
      enabled: decode(TRIGGER_ENABLED, t.enabled, "tgenabled"),
      function: `${t.function_schema}.${functionKey(t.function_name, t.function_args)}`,
      definition: t.definition,
    });
  }
}

export function buildFunctions(functionRows) {
  const functions = new Map();
  for (const f of functionRows) {
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
  return functions;
}

// 既定の権限（"default:<scope>:<objType>"）の1件
function defaultPrivilegeOf(g, type) {
  const [, scope, objType] = type.split(":");
  if (!DEFAULT_ACL_SCOPES.includes(scope)) {
    throw new Error(
      `schema-snapshot: 知らない既定の権限の範囲 ${JSON.stringify(scope)}`,
    );
  }
  // grantee が null の行は ACL が空（誰にも付けない）の記録。作りつけの既定（関数の PUBLIC の EXECUTE 等）とは逆の意味
  return {
    scope,
    objectType: decode(DEFAULT_ACL_OBJECTS, objType, "defaclobjtype"),
    role: g.name,
    ...grantEntry({
      ...g,
      grantee: g.grantee ?? null,
      privileges: g.privileges ?? [],
    }),
  };
}

function applyGrant(g, { relationOf, columns, functions, sequences, defaultPrivileges }) {
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
    defaultPrivileges.push(defaultPrivilegeOf(g, type));
  } else {
    throw new Error(
      `schema-snapshot: 知らない権限の対象 ${JSON.stringify(g.object_type)}`,
    );
  }
}

export function applyGrants(grantRows, { relationOf, columns, functions }) {
  const sequences = new Map();
  const defaultPrivileges = [];
  for (const g of grantRows) {
    applyGrant(g, { relationOf, columns, functions, sequences, defaultPrivileges });
  }
  return { sequences, defaultPrivileges };
}

/** 名前順に並べ直した一覧（relations・functions・sequences）。defaultPrivileges はその場で並べる */
export function sortLists(relations, functions, sequences, defaultPrivileges) {
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
  return { relationList, functionList, sequenceList };
}

const COMMENT_LINES = [
  "本番 DB（public）のスキーマの写し。記録であり生成物ではない（ADR-0102。ADR-0078 の生成物の一覧に入れない）。リポジトリは公開なので、写しも公開に載る。",
  "作り直し: git fetch して master の台帳に合わせてから node --env-file=.env.local scripts/db/schema-snapshot.js（claude_ro で読むだけ。scripts/db/ro-query.js を問い合わせごとに呼ぶ）。",
  "鮮度: appliedFilesAtCapture は取得の時に docs/db-migration/APPLIED.md で適用済みだったファイル。今の台帳で適用済みなのにそこに無いファイルがあれば古い（session-start-check の schemaSnapshot）。",
  '手で書き換えない。definition・viewDefinition は行の配列（join("\\n") で戻す）。行数の目安（reltuples）は入れない。',
];

/** 写しの本体（$comment・format・件数・各一覧）。鍵の検査（assertNoSecrets）は呼び元 */
export function assembleSnapshot({ capturedAt, appliedThrough, appliedFiles, rows, relationList, functionList, sequenceList, defaultPrivileges }) {
  const count = (k) => relationList.reduce((a, r) => a + r[k].length, 0);
  const isView = (r) => r.kind === "view" || r.kind === "materialized_view";
  return {
    $comment: COMMENT_LINES,
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
}
