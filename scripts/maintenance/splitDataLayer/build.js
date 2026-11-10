/**
 * splitDataLayer/build.js - 移す物の import の解決と、止める確かめ（split-data-layer.mjs、BOA-1432）:
 * まだ移していない名前を読む・別の領域の Queries を読む（domain-direct）・ファイルの間の循環
 */
import { areaOfFile, SHARED_AREAS } from "./table.js";
import { namesOf } from "./analyze.js";
import { specifier } from "./render.js";

export function findCycle(graph) {
  const state = new Map();
  const stack = [];
  const visit = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of [...(graph.get(n) ?? [])].sort()) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
      const c = state.has(m) ? null : visit(m);
      if (c) return c;
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of [...graph.keys()].sort()) {
    const c = state.has(n) ? null : visit(n);
    if (c) return c;
  }
  return null;
}

function notMovedError(ctx, by, name, viaThis) {
  const u = ctx.topOf.get(name);
  const area = u?.isDecl ? ctx.areaOfUnit(u) : ctx.areaOfMethod.get(name);
  const what = viaThis ? `this.${name}` : name;
  return new Error(`${by} が、まだ移していない ${what}（領域 ${area}）を使う。先に移す`);
}

// 名前を、新しいファイル・元の import（殻が読んでいる先）から解決する
function resolver(ctx, layout, acc) {
  const addDep = (file, source, part) => {
    if (!acc.deps.has(file)) acc.deps.set(file, new Map());
    const m = acc.deps.get(file);
    if (!m.has(source)) m.set(source, new Map());
    m.get(source).set(part.local, part);
  };
  return (file, name, by, viaThis) => {
    const f = layout.fileOfName.get(name);
    if (f) {
      if (f === file) return;
      addDep(file, `./${f}`, specifier(name));
      acc.needExport.add(name);
      acc.edges.push([file, f, name, by]);
      return;
    }
    const imp = ctx.importOf.get(name);
    if (!imp) throw notMovedError(ctx, by, name, viaThis);
    addDep(file, imp.source, imp.part);
    if (areaOfFile(imp.source)) acc.edges.push([file, imp.source.replace(/^\.\//, ""), name, by]);
  };
}

function checkCycle(edges) {
  const graph = new Map();
  for (const [a, b] of edges) {
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a).add(b);
  }
  const cyc = findCycle(graph);
  if (!cyc) return;
  const why = cyc.slice(1).map((b, i) => {
    const e = edges.filter(([x, y]) => x === cyc[i] && y === b).map(([, , n, by]) => `${by}→${n}`);
    return `${cyc[i]} → ${b}（${[...new Set(e)].join("・")}）`;
  });
  throw new Error(`ファイルの間に循環: ${why.join(" / ")}`);
}

function checkDomainDirect(edges) {
  for (const [a, b, name, by] of edges) {
    const [fa, fb] = [areaOfFile(a), areaOfFile(b)];
    const plain = fa && fb && fa !== "core" && fb !== "core" && fa !== fb;
    if (plain && !SHARED_AREAS.includes(fb))
      throw new Error(
        `${a} の ${by} が別の領域の ${b} の ${name} を読む（dependency-rules の domain-direct。${SHARED_AREAS.join("・")} だけ許す）`,
      );
  }
}

// 新しいファイルの import と、export を足す名前
export function resolveFiles(ctx, layout) {
  const acc = { deps: new Map(), needExport: new Set(), edges: [] };
  const resolve = resolver(ctx, layout, acc);
  for (const [f, items] of layout.fileItems)
    for (const x of items) {
      const by = namesOf(x).join("・");
      const i = ctx.info.get(x.item);
      i.used.forEach((n) => resolve(f, n, by, false));
      i.thisRefs.forEach((r) => resolve(f, r.name, by, true));
    }
  checkCycle(acc.edges);
  checkDomainDirect(acc.edges);
  return acc;
}
