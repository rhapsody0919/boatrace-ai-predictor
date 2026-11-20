import { WRITE_OPS } from "./dataReadersSelect.js";
import { isFixtureLike } from "./dataReadersVisit.js";

/** SQL の本文からコメントと文字列の中身を外す（$$ の本体は残す） */
export function stripSqlNoise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * 関数の定義（CREATE OR REPLACE FUNCTION … 全文）が読む表・書く表・呼ぶ関数を、写しにある名前だけで返す。
 * @param {string} definition
 * @param {Set<string>} relationNames
 * @param {Set<string>} functionNames
 * @param {string} selfName 自分の名前（呼ぶ関数から外す）
 */
export function sqlTableRefs(
  definition,
  relationNames,
  functionNames,
  selfName,
) {
  const sql = stripSqlNoise(definition)
    // 定義の頭（CREATE … FUNCTION name(args) RETURNS …）は本文ではない
    .replace(/^[\s\S]*?\bAS\s+(\$[A-Za-z_]*\$)/i, "$1");
  const reads = new Set();
  const writes = new Set();
  const calls = new Set();
  const name = String.raw`(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;
  for (const m of sql.matchAll(
    new RegExp(
      String.raw`\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?)\s+(?:only\s+)?${name}`,
      "gi",
    ),
  )) {
    const t = m[1].toLowerCase();
    if (relationNames.has(t)) writes.add(t);
  }
  for (const m of sql.matchAll(
    new RegExp(
      String.raw`\b(?:from|join|using)\s+(?:only\s+|lateral\s+)?${name}`,
      "gi",
    ),
  )) {
    const t = m[1].toLowerCase();
    // DELETE FROM は書き込みとして上で拾った
    const before = sql.slice(Math.max(0, m.index - 8), m.index).toLowerCase();
    if (/delete\s*$/.test(before)) continue;
    if (relationNames.has(t)) reads.add(t);
  }
  for (const m of sql.matchAll(new RegExp(String.raw`${name}\s*\(`, "g"))) {
    const f = m[1].toLowerCase();
    if (functionNames.has(f) && f !== selfName) calls.add(f);
  }
  return {
    reads: [...reads].sort(),
    writes: [...writes].sort(),
    calls: [...calls].sort(),
  };
}

const ANON_ROLES = new Set(["anon", "PUBLIC", "public"]);
const AUTH_ROLES = new Set(["authenticated", "PUBLIC", "public"]);

function hasPrivilege(grants, roles, privilege) {
  return grants.some(
    (g) => roles.has(g.grantee) && g.privileges.includes(privilege),
  );
}

function policyAllows(relation, roles, command) {
  if (!relation.rlsEnabled) return true;
  return relation.policies.some(
    (p) =>
      p.permissive !== false &&
      (p.command === command || p.command === "ALL") &&
      p.roles.some((r) => roles.has(r)),
  );
}

/** 表の権限の要約。service_role は RLS を通らないので、anon・authenticated だけを見る */
export function relationAccess(relation) {
  const out = {};
  for (const [label, roles] of [
    ["anon", ANON_ROLES],
    ["authenticated", AUTH_ROLES],
  ]) {
    out[label] = ["SELECT", "INSERT", "UPDATE", "DELETE"].filter(
      (priv) =>
        hasPrivilege(relation.grants, roles, priv) &&
        policyAllows(relation, roles, priv),
    );
  }
  out.summary = out.anon.includes("SELECT")
    ? "anon 可"
    : out.authenticated.includes("SELECT")
      ? "authenticated 可"
      : "service だけ";
  return out;
}

export function functionAccess(fn) {
  const anon = hasPrivilege(fn.grants, ANON_ROLES, "EXECUTE");
  const authenticated = hasPrivilege(fn.grants, AUTH_ROLES, "EXECUTE");
  return {
    anon,
    authenticated,
    summary: anon
      ? "anon 可"
      : authenticated
        ? "authenticated 可"
        : "service だけ",
  };
}

const ref = (a) => `${a.file}:${a.line}`;
const byRef = (a, b) =>
  a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1;
const sortStr = (list) =>
  [...new Set(list)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * 相対 import を解決する（拡張子・index の補い）。リポジトリ外・パッケージは null
 * @param {string} from
 * @param {string} spec
 * @param {Set<string>} files
 */
export function resolveImport(from, spec, files) {
  if (!spec.startsWith(".")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const base = parts.join("/");
  for (const cand of [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}/index.js`,
  ]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

/** ジョブの入口の api/cron のファイル。名前で決まらなければ、ジョブの名前の文字列を持つファイルが1つだけのとき。決まらなければ null */
function findJobEntry(job, files, cronFiles, perFile) {
  const byName = `api/cron/${job.replace(/_/g, "-")}.js`;
  if (files.has(byName)) return byName;
  const cands = cronFiles.filter((f) => perFile.get(f).strings?.has(job));
  return cands.length === 1 ? cands[0] : null;
}

/** 入口から相対 import でたどれるファイル（入口を含む。固定入力のファイルは辿らない） */
function reachableFiles(entry, perFile, files) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const cur = queue.shift();
    for (const spec of perFile.get(cur)?.imports ?? []) {
      const next = resolveImport(cur, spec, files);
      if (next && !seen.has(next) && !isFixtureLike(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** たどったファイルの表への書き込み（表の名前 → 箇所の一覧） */
function jobWrites(seen, perFile, extraAccesses) {
  const writes = new Map();
  for (const f of seen) {
    for (const a of [
      ...(perFile.get(f)?.accesses ?? []),
      ...extraAccesses.filter((x) => x.file === f),
    ]) {
      if (a.kind === "table" && WRITE_OPS.has(a.op)) {
        if (!writes.has(a.name)) writes.set(a.name, []);
        writes.get(a.name).push(ref(a));
      }
    }
  }
  return writes;
}

/**
 * 取得のジョブ（scrape の registry）ごとに、入口の api/cron のファイルと、そこから import でたどれる書き込みを返す。
 * 入口: api/cron/{job の _ を - にした名前}.js。無ければ、ジョブの名前の文字列を持つ api/cron のファイルが1つだけのとき。
 * @param {string[]} jobNames
 * @param {Map<string, { accesses: unknown[], imports: string[], strings?: Set<string> }>} perFile
 */
export function scrapeJobWriters(jobNames, perFile, extraAccesses = []) {
  const files = new Set(perFile.keys());
  const cronFiles = [...files].filter((f) => /^api\/cron\/[^/]+\.js$/.test(f));
  const jobs = [];
  const unresolved = [];
  for (const job of [...jobNames].sort()) {
    const entry = findJobEntry(job, files, cronFiles, perFile);
    if (!entry) {
      unresolved.push({
        job,
        reason: "入口の api/cron のファイルが決まらない",
      });
      continue;
    }
    const seen = reachableFiles(entry, perFile, files);
    const writes = jobWrites(seen, perFile, extraAccesses);
    jobs.push({
      job,
      entry,
      reachableFiles: seen.size,
      writes: Object.fromEntries(
        [...writes.keys()].sort().map((t) => [t, sortStr(writes.get(t))]),
      ),
    });
  }
  return { jobs, unresolved };
}

/** 部品の表。`${file}#${fn}` → Map<`${paramIndex}:${kind}:${op}`, def>。足せたら true（既にあれば false） */
function createHelperTable(perFile) {
  const helpers = new Map();
  const addHelper = (key, def) => {
    if (!helpers.has(key)) helpers.set(key, new Map());
    const k = `${def.paramIndex}:${def.kind}:${def.op}`;
    if (helpers.get(key).has(k)) return false;
    helpers.get(key).set(k, def);
    return true;
  };
  for (const [file, p] of perFile)
    for (const d of p.helperDefs ?? []) addHelper(`${file}#${d.fn}`, d);
  return { helpers, addHelper };
}

/** 呼ぶ関数の部品の表の鍵。同じファイルの関数か、相対 import の名前つき import で解決する */
function createCalleeKey(perFile, files, helpers) {
  return (file, name) => {
    const local = `${file}#${name}`;
    if (helpers.has(local)) return local;
    const bindings = perFile.get(file)?.importBindings ?? {};
    if (!Object.hasOwn(bindings, name)) return null;
    const b = bindings[name];
    const target = resolveImport(file, b.source, files);
    return target ? `${target}#${b.imported}` : null;
  };
}

/** 1つの呼び出しが部品の引数をそのまま渡すなら、呼んでいる関数も部品として足す。足せたら true */
function propagateCall(file, c, { helpers, addHelper }, calleeKey) {
  if (!c.encl) return false;
  const key = calleeKey(file, c.callee);
  if (!key) return false;
  let changed = false;
  for (const d of helpers.get(key)?.values() ?? []) {
    const param = c.args[d.paramIndex]?.param;
    if (param !== null && param !== undefined)
      changed =
        addHelper(`${file}#${c.encl}`, {
          ...d,
          fn: c.encl,
          paramIndex: param,
        }) || changed;
  }
  return changed;
}

/** 包む部品（引数をそのまま渡す関数）を不動点までたどる */
function propagateWrappers(perFile, table, calleeKey) {
  for (let changed = true, round = 0; changed && round < 10; round += 1) {
    changed = false;
    for (const [file, p] of perFile)
      for (const c of p.callSites ?? [])
        changed = propagateCall(file, c, table, calleeKey) || changed;
  }
}

/** 部品 d の呼び出し c が渡す文字列の名前を、写しにあるものだけ読み書きにする */
function helperCallAccesses(file, c, d, known) {
  const out = [];
  for (const name of c.args[d.paramIndex]?.lits ?? []) {
    const ok =
      d.kind === "table"
        ? known.knownTables.has(name)
        : known.knownFunctions.has(name);
    if (!ok) continue;
    out.push({
      kind: d.kind,
      name,
      op: d.op,
      via: `helper:${c.callee}`,
      file,
      line: c.line,
      columns: [],
      writeColumns: WRITE_OPS.has(d.op) && d.op !== "delete" ? ["?"] : [],
    });
  }
  return out;
}

/** 同じ呼び出しで同じ表・操作は1つに */
function dedupeHelperAccesses(out) {
  const seen = new Set();
  return out.filter((a) => {
    const k = `${a.file}:${a.line}:${a.kind}:${a.name}:${a.op}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 表・RPC の名前を引数で受け取る部品（`upsertChangedRows(client, "表", …)`・`fetchAll(client, "表")` 等）の
 * 呼び出しを、呼び手のファイル:行の読み書きにする。部品を包む部品（引数をそのまま渡す関数）もたどる。
 * 呼ぶ関数は、同じファイルの関数か、相対 import の名前つき import で解決する。
 * @param {Map<string, { helperDefs?: Array<{ fn: string, paramIndex: number, kind: string, op: string }>, callSites?: Array<{ callee: string, line: number, encl: string | null, args: Array<{ lits: string[] | null, param: number | null }> }>, importBindings?: Record<string, { source: string, imported: string }> }>} perFile
 * @param {{ knownTables: Set<string>, knownFunctions: Set<string> }} known
 */
export function resolveHelperAccesses(perFile, known) {
  const files = new Set(perFile.keys());
  const table = createHelperTable(perFile);
  const calleeKey = createCalleeKey(perFile, files, table.helpers);
  propagateWrappers(perFile, table, calleeKey);
  const out = [];
  for (const [file, p] of perFile) {
    for (const c of p.callSites ?? []) {
      const key = calleeKey(file, c.callee);
      if (!key) continue;
      for (const d of table.helpers.get(key)?.values() ?? [])
        out.push(...helperCallAccesses(file, c, d, known));
    }
  }
  return dedupeHelperAccesses(out);
}

/** 手で足す外の読み手（data-readers.extra.json）の形を確かめる。誤りの文の一覧を返す */
export function validateExtra(extra, snapshot) {
  const errors = [];
  if (!extra || !Array.isArray(extra.readers)) return ["readers が配列でない"];
  const rels = new Map(snapshot.relations.map((r) => [r.name, r]));
  const fns = new Set(snapshot.functions.map((f) => f.name));
  extra.readers.forEach((r, i) => {
    const at = `readers[${i}]`;
    for (const key of [
      "kind",
      "name",
      "reader",
      "repo",
      "access",
      "source",
      "addedAt",
    ]) {
      if (typeof r[key] !== "string" || !r[key])
        errors.push(`${at}.${key} が空`);
    }
    if (!["table", "rpc"].includes(r.kind))
      errors.push(`${at}.kind は table か rpc`);
    if (!["read", "write"].includes(r.access))
      errors.push(`${at}.access は read か write`);
    if (r.kind === "table" && !rels.has(r.name))
      errors.push(`${at}.name の表 ${r.name} が写しに無い`);
    if (r.kind === "rpc" && !fns.has(r.name))
      errors.push(`${at}.name の RPC ${r.name} が写しに無い`);
    if (r.columns !== undefined) {
      if (!Array.isArray(r.columns)) errors.push(`${at}.columns が配列でない`);
      else if (r.kind === "table" && rels.has(r.name)) {
        const cols = new Set(rels.get(r.name).columns.map((c) => c.name));
        r.columns
          .filter((c) => !cols.has(c))
          .forEach((c) =>
            errors.push(`${at}.columns の ${c} が ${r.name} に無い`),
          );
      }
    }
    if (typeof r.addedAt === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(r.addedAt))
      errors.push(`${at}.addedAt は YYYY-MM-DD`);
  });
  return errors;
}

export { ref, byRef, sortStr };
