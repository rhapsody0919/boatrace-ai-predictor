import { WRITE_OPS } from "./dataReadersSelect.js";
import { isFixtureLike } from "./dataReadersVisit.js";
import {
  stripSqlNoise,
  sqlTableRefs,
  relationAccess,
  functionAccess,
  ref,
  byRef,
  sortStr,
  scrapeJobWriters,
  resolveHelperAccesses,
} from "./dataReadersAccess.js";

export const FORMAT = 1;

/** 名前の文字列の箇所（読み込んだファイルの分と他の言語の分）。部品の呼び出しで拾った行の近くは、読み書きとして数えたので外す */
function collectMentions(perFile, otherMentions, helperAccesses) {
  return [
    ...[...perFile.values()].flatMap((p) => p.mentions ?? []),
    ...(otherMentions ?? []),
  ]
    .filter(
      (m) =>
        !helperAccesses.some(
          (a) =>
            a.file === m.file &&
            a.kind === m.kind &&
            a.name === m.name &&
            Math.abs(a.line - m.line) <= 3,
        ),
    )
    .sort(byRef);
}

const mentionRefs = (mentions, kind, name) =>
  mentions.filter((m) => m.kind === kind && m.name === name).map(ref);

/** トリガーの関数（public.f() の f）→ その表 */
function buildTriggerTables(snapshot) {
  const triggerTables = new Map();
  for (const rel of snapshot.relations) {
    for (const t of rel.triggers ?? []) {
      const fn = String(t.function)
        .replace(/^public\./, "")
        .replace(/\(.*$/, "");
      if (!triggerTables.has(fn)) triggerTables.set(fn, new Set());
      triggerTables.get(fn).add(rel.name);
    }
  }
  return triggerTables;
}

/** 関数の本体が読む・書く表と呼ぶ関数（名前 → 本体）。同じ名前の多重定義は合わせる */
function buildFnBody(snapshot, relationNames, functionNames) {
  const fnBody = new Map();
  for (const fn of snapshot.functions) {
    const refs = sqlTableRefs(
      fn.definition.join("\n"),
      relationNames,
      functionNames,
      fn.name,
    );
    const prev = fnBody.get(fn.name);
    // 同じ名前の多重定義は合わせる
    fnBody.set(
      fn.name,
      prev
        ? {
            reads: sortStr([...prev.reads, ...refs.reads]),
            writes: sortStr([...prev.writes, ...refs.writes]),
            calls: sortStr([...prev.calls, ...refs.calls]),
          }
        : refs,
    );
  }
  return fnBody;
}

/** ビューの定義が読む表（DROP は依存で止まるか、CASCADE でビューごと消える） */
function buildViewBody(snapshot, relationNames, functionNames) {
  const viewBody = new Map();
  for (const rel of snapshot.relations) {
    if (!Array.isArray(rel.viewDefinition)) continue;
    viewBody.set(
      rel.name,
      sqlTableRefs(
        rel.viewDefinition.join("\n"),
        relationNames,
        functionNames,
        rel.name,
      ),
    );
  }
  return viewBody;
}

/** 列の名前が RPC・ビューの本文に出るかを見る本文（コメントと文字列を外した本文で語として） */
function buildSqlText(snapshot) {
  const sqlText = new Map();
  for (const fn of snapshot.functions)
    sqlText.set(
      `rpc:${fn.name}`,
      `${sqlText.get(`rpc:${fn.name}`) ?? ""}\n${stripSqlNoise(fn.definition.join("\n"))}`,
    );
  for (const rel of snapshot.relations)
    if (Array.isArray(rel.viewDefinition))
      sqlText.set(
        `view:${rel.name}`,
        stripSqlNoise(rel.viewDefinition.join("\n")),
      );
  return sqlText;
}

/** 検査の固定入力のファイル（verify-*.js 等）の箇所には test を付ける。写しにある名前だけを拾っている */
const ledgerEntry = (a, columns) => ({
  ref: ref(a),
  op: a.op,
  via: a.via,
  columns,
  ...(isFixtureLike(a.file) ? { test: true } : {}),
});

/** 本体（bodies の key 側）が name を含む名前の一覧 */
const namesWhere = (bodies, key, name) =>
  [...bodies.entries()]
    .filter(([, b]) => b[key].includes(name))
    .map(([n]) => n)
    .sort();

/** 表の列ごとの読み手・書き手の箇所と、写しに無い列の名前 */
function collectColumnRefs(rel, mine) {
  const columns = {};
  const colNames = new Set(rel.columns.map((c) => c.name));
  for (const c of rel.columns) columns[c.name] = { readers: [], writers: [] };
  const unknownColumns = new Set();
  for (const a of mine) {
    for (const c of a.columns) {
      if (c === "*" || c === "?") continue;
      if (colNames.has(c)) columns[c].readers.push(ref(a));
      else unknownColumns.add(c);
    }
    for (const c of a.writeColumns) {
      if (c === "?") continue;
      if (colNames.has(c)) columns[c].writers.push(ref(a));
      else unknownColumns.add(c);
    }
  }
  for (const c of Object.keys(columns)) {
    columns[c].readers = sortStr(columns[c].readers);
    columns[c].writers = sortStr(columns[c].writers);
  }
  return { columns, unknownColumns };
}

function buildTableEntry(rel, src) {
  const { all, fnBody, viewBody, sqlText, mentions, extraReaders } = src;
  const mine = all.filter((a) => a.kind === "table" && a.name === rel.name);
  const readers = mine.filter((a) => !WRITE_OPS.has(a.op));
  const writers = mine.filter((a) => WRITE_OPS.has(a.op));
  const { columns, unknownColumns } = collectColumnRefs(rel, mine);
  const viaRpc = namesWhere(fnBody, "reads", rel.name);
  const writtenByRpc = namesWhere(fnBody, "writes", rel.name);
  const readByView = namesWhere(viewBody, "reads", rel.name);
  const sqlReaders = [
    ...viaRpc.map((n) => `rpc:${n}`),
    ...writtenByRpc.map((n) => `rpc:${n}`),
    ...readByView.map((n) => `view:${n}`),
  ];
  for (const c of Object.keys(columns)) {
    const re = new RegExp(`\\b${c}\\b`, "i");
    columns[c].sql = sortStr(
      sqlReaders.filter((k) => re.test(sqlText.get(k) ?? "")),
    );
  }
  return {
    kind: rel.kind,
    rlsEnabled: rel.rlsEnabled,
    access: relationAccess(rel),
    readers: readers.map((a) => ledgerEntry(a, a.columns)),
    writers: writers.map((a) => ledgerEntry(a, a.writeColumns)),
    readByRpc: viaRpc,
    writtenByRpc,
    readByView,
    columns,
    columnsNotInSnapshot: [...unknownColumns].sort(),
    mentions: mentionRefs(mentions, "table", rel.name),
    external: extraReaders.filter(
      (e) => e.kind === "table" && e.name === rel.name,
    ),
  };
}

function buildTables(snapshot, src) {
  const tables = {};
  for (const rel of [...snapshot.relations].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  ))
    tables[rel.name] = buildTableEntry(rel, src);
  return tables;
}

function buildRpcs(snapshot, src, triggerTables) {
  const { all, fnBody, mentions, extraReaders } = src;
  const rpcs = {};
  const fnByName = new Map();
  for (const fn of snapshot.functions)
    if (!fnByName.has(fn.name)) fnByName.set(fn.name, fn);
  for (const name of [...fnByName.keys()].sort()) {
    const fn = fnByName.get(name);
    const callers = all.filter((a) => a.kind === "rpc" && a.name === name);
    const body = fnBody.get(name);
    rpcs[name] = {
      kind: fn.kind,
      securityDefiner: fn.securityDefiner,
      access: functionAccess(fn),
      callers: callers.map((a) => ({ ref: ref(a), via: a.via })),
      mentions: mentionRefs(mentions, "rpc", name),
      triggerOn: [...(triggerTables.get(name) ?? [])].sort(),
      calledByRpc: namesWhere(fnBody, "calls", name),
      reads: body.reads,
      writes: body.writes,
      calls: body.calls,
      external: extraReaders.filter((e) => e.kind === "rpc" && e.name === name),
    };
  }
  return rpcs;
}

/** コードが使うのに写しに無い名前（種類:名前 → 箇所） */
function buildNotInSnapshot(all, relationNames, functionNames) {
  const notInSnapshot = {};
  for (const a of all) {
    const known =
      a.kind === "table"
        ? relationNames.has(a.name)
        : functionNames.has(a.name);
    if (known) continue;
    const key = `${a.kind}:${a.name}`;
    if (!notInSnapshot[key])
      notInSnapshot[key] = { kind: a.kind, name: a.name, refs: [] };
    notInSnapshot[key].refs.push(ref(a));
  }
  return notInSnapshot;
}

/** 取得のジョブが書く表に、そのジョブの名前を付ける（どの表にも scrapeJobs を持たせる） */
function attachScrapeJobs(tables, scrapeJobs) {
  for (const j of scrapeJobs) {
    for (const t of Object.keys(j.writes)) {
      if (tables[t]) {
        tables[t].scrapeJobs ??= [];
        tables[t].scrapeJobs.push(j.job);
      }
    }
  }
  for (const t of Object.values(tables)) t.scrapeJobs ??= [];
}

const countTablesWithoutReaders = (tables) =>
  Object.values(tables).filter(
    (t) =>
      t.readers.length === 0 &&
      // data_health_* は件数・鮮度の監視で、使う読み手ではない
      t.readByRpc.filter((n) => !n.startsWith("data_health_")).length === 0 &&
      t.readByView.length === 0 &&
      t.mentions.length === 0 &&
      t.external.length === 0,
  ).length;

const countRpcsWithoutCallers = (rpcs) =>
  Object.values(rpcs).filter(
    (r) =>
      r.callers.length === 0 &&
      r.calledByRpc.length === 0 &&
      r.mentions.length === 0 &&
      r.triggerOn.length === 0 &&
      r.external.length === 0,
  ).length;

function buildCounts(l) {
  const { all, tables, rpcs, mentions } = l;
  return {
    tables: Object.keys(tables).length,
    rpcs: Object.keys(rpcs).length,
    sourceFiles: l.perFile.size,
    filesWithAccess: new Set(all.map((a) => a.file)).size,
    tableReaders: all.filter((a) => a.kind === "table" && !WRITE_OPS.has(a.op))
      .length,
    tableWriters: all.filter((a) => a.kind === "table" && WRITE_OPS.has(a.op))
      .length,
    rpcCallers: all.filter((a) => a.kind === "rpc").length,
    nameMentions: mentions.length,
    tablesWithoutReaders: countTablesWithoutReaders(tables),
    rpcsWithoutCallers: countRpcsWithoutCallers(rpcs),
    external: l.extraReaders.length,
    notInSnapshot: Object.keys(l.notInSnapshot).length,
    unresolved: l.unresolved.length,
    parseErrors: l.parseErrors.length,
    uncoveredFiles: l.uncoveredFiles.length,
  };
}

/**
 * 台帳を組み立てる。
 * @param {{ perFile: Map<string, { accesses: Array<Record<string, unknown>>, unresolved: unknown[], imports: string[], parseError?: string }>, snapshot: any, extra: any, scrapeJobNames: string[], uncoveredFiles: string[], otherMentions?: Array<{ kind: string, name: string, file: string, line: number }> }} input
 */
export function buildLedger({
  perFile,
  snapshot,
  extra,
  scrapeJobNames,
  uncoveredFiles,
  otherMentions,
}) {
  const relationNames = new Set(snapshot.relations.map((r) => r.name));
  const functionNames = new Set(snapshot.functions.map((f) => f.name));
  const helperAccesses = resolveHelperAccesses(perFile, {
    knownTables: relationNames,
    knownFunctions: functionNames,
  });
  const all = [
    ...[...perFile.values()].flatMap((p) => p.accesses),
    ...helperAccesses,
  ].sort(byRef);
  const mentions = collectMentions(perFile, otherMentions, helperAccesses);
  const src = {
    all,
    mentions,
    fnBody: buildFnBody(snapshot, relationNames, functionNames),
    viewBody: buildViewBody(snapshot, relationNames, functionNames),
    sqlText: buildSqlText(snapshot),
    extraReaders: extra?.readers ?? [],
  };
  const tables = buildTables(snapshot, src);
  const rpcs = buildRpcs(snapshot, src, buildTriggerTables(snapshot));
  const notInSnapshot = buildNotInSnapshot(all, relationNames, functionNames);
  const scrape = scrapeJobWriters(scrapeJobNames, perFile, helperAccesses);
  attachScrapeJobs(tables, scrape.jobs);
  const unresolved = [...perFile.values()]
    .flatMap((p) => p.unresolved)
    .sort(byRef);
  const parseErrors = [...perFile.entries()]
    .filter(([, p]) => p.parseError)
    .map(([file, p]) => ({ file, error: p.parseError }));

  return {
    $comment:
      "機械生成（scripts/maintenance/generate-data-readers.js）。手で書き換えない。外の読み手は docs/reference/data-readers.extra.json に足す",
    format: FORMAT,
    snapshotCapturedAt: snapshot.capturedAt,
    counts: buildCounts({
      ...src,
      perFile,
      tables,
      rpcs,
      notInSnapshot,
      unresolved,
      parseErrors,
      uncoveredFiles,
    }),
    tables,
    rpcs,
    scrapeJobs: scrape.jobs,
    notInSnapshot: Object.values(notInSnapshot).sort((a, b) =>
      `${a.kind}:${a.name}` < `${b.kind}:${b.name}` ? -1 : 1,
    ),
    unresolved,
    unresolvedJobs: scrape.unresolved,
    parseErrors,
    uncoveredFiles: sortStr(uncoveredFiles),
  };
}
