/**
 * splitDataLayer/analyze.js - 表の確かめ・名前の索引・参照・上の単位の領域・移す並び（split-data-layer.mjs、BOA-1432）
 */
import { thisMembers } from "./ast.js";
import { scanNames } from "./freeNames.js";
import { importParts } from "./service.js";
import { SERVICE_OBJECT, SERVICE_FILE } from "./table.js";

function methodAreas(table) {
  const areaOfMethod = new Map();
  for (const [a, names] of Object.entries(table))
    for (const n of names) {
      if (areaOfMethod.has(n)) throw new Error(`表に2回: ${n}`);
      if (!/^get[A-Z]/.test(n)) throw new Error(`表の名前は get で始める: ${n}（大域の名前と重ねない）`);
      areaOfMethod.set(n, a);
    }
  return areaOfMethod;
}

function checkTable(svc, areaOfMethod) {
  const memberNames = new Set(svc.members.map((m) => m.name));
  const notInTable = [...memberNames].filter((n) => !areaOfMethod.has(n));
  if (notInTable.length)
    throw new Error(`表に無いメソッド: ${notInTable.join("・")}（METHOD_TABLE に足す）`);
  const notInSource = [...areaOfMethod.keys()].filter((n) => !memberNames.has(n));
  if (notInSource.length)
    throw new Error(`表にあって元に無いメソッド: ${notInSource.join("・")}`);
  return memberNames;
}

// 上の名前（import の local・上の宣言）→ 節
function indexTop(svc) {
  const topOf = new Map();
  const importOf = new Map();
  for (const u of svc.units) {
    if (u.isImport)
      for (const p of importParts(u.node)) {
        importOf.set(p.local, { source: u.node.source.value, part: p });
        topOf.set(p.local, u);
      }
    for (const n of u.isDecl ? u.names : []) {
      if (topOf.has(n)) throw new Error(`上の名前が2回: ${n}`);
      topOf.set(n, u);
    }
  }
  return { topOf, importOf };
}

const sameParams = (call, m) =>
  call.arguments.length === m.params.length &&
  call.arguments.every(
    (a, i) => a.type === "Identifier" && m.params[i].type === "Identifier" && a.name === m.params[i].name,
  );

// メソッドと同じ名前の上の関数: メソッドが同じ引数でそれを呼ぶだけ（委ね）なら、メソッドを消して上の関数を使う
function findDelegated(methods, topOf) {
  const delegated = new Set();
  for (const m of methods) {
    if (!topOf.has(m.name)) continue; // 先の回で上の関数を core へ移した後は import の名前
    const b = m.node.body.body;
    const ret = b.length === 1 && b[0].type === "ReturnStatement" ? b[0].argument : null;
    const ok = ret?.type === "CallExpression" && ret.callee.type === "Identifier" &&
      ret.callee.name === m.name && sameParams(ret, m.node);
    if (!ok) throw new Error(`メソッド ${m.name} と同じ名前の上の単位があり、委ねるだけの形でない`);
    delegated.add(m.name);
  }
  return delegated;
}

function analyzeItem(item, isMethod, topNames, memberNames) {
  const own = new Set(isMethod ? [] : item.names);
  const n = item.node;
  const target = !isMethod && n.type === "ExportNamedDeclaration" ? n.declaration : n;
  const scan = scanNames(target);
  const used = new Set([...scan.free].filter((x) => topNames.has(x) && !own.has(x)));
  const assigned = new Set([...scan.assigned].filter((x) => topNames.has(x) && !own.has(x)));
  if (!isMethod) return { used, assigned, thisRefs: [] };
  const t = thisMembers(n);
  if (t.bad.length) throw new Error(`${item.name} で this をメンバーの読み以外に使っている`);
  const hidden = t.found.filter((r) => scan.thisShadowed.has(r.name)).map((r) => r.name);
  if (hidden.length)
    throw new Error(`${item.name} の this.${hidden[0]} を ${hidden[0]} にすると局所の名前に隠れる（止める）`);
  for (const r of t.found)
    if (!memberNames.has(r.name))
      throw new Error(`${item.name} の this.${r.name} が ${SERVICE_OBJECT} に無い`);
  return { used, assigned, thisRefs: t.found };
}

// 上の単位の領域: 使うメソッドの領域の和を単位から単位へ伝え、1つならその領域、ほか（2つ以上・0）は core
function unitAreaOf(ctx) {
  const { decls, methods, info, topOf, delegated } = ctx;
  const sets = new Map(decls.map((u) => [u, new Set()]));
  let changed = true;
  const add = (u, areas) => {
    const s = sets.get(u);
    if (!s) return;
    const before = s.size;
    areas.forEach((a) => s.add(a));
    changed ||= s.size !== before;
  };
  while (changed) {
    changed = false;
    for (const m of methods) {
      const a = [ctx.areaOfMethod.get(m.name)];
      info.get(m).used.forEach((n) => add(topOf.get(n), a));
      if (delegated.has(m.name)) add(topOf.get(m.name), a);
    }
    for (const u of decls)
      info.get(u).used.forEach((n) => topOf.get(n) !== u && add(topOf.get(n), sets.get(u)));
  }
  return (u) => {
    const s = sets.get(u);
    return s.size === 1 ? [...s][0] : "core";
  };
}

// 上の let・var を自分の外で代入すると、別のファイルへ移した後は import の束縛への代入になり実行時に落ちる
function checkReassigned(decls, methods, info, topOf) {
  for (const x of [...decls, ...methods])
    for (const n of info.get(x).assigned) {
      const u = topOf.get(n);
      const mutable = u?.isDecl && u.node.type === "VariableDeclaration" && u.node.kind !== "const";
      if (u?.isImport || mutable)
        throw new Error(`${x.name ?? x.names.join("・")} が上の ${n} に代入する（移すと import の束縛への代入になる。止める）`);
    }
}

export function analyzeService(svc, table) {
  const areaOfMethod = methodAreas(table);
  const memberNames = checkTable(svc, areaOfMethod);
  const { topOf, importOf } = indexTop(svc);
  const decls = svc.units.filter((u) => u.isDecl);
  const methods = svc.members.filter((m) => m.kind === "method");
  const delegated = findDelegated(methods, topOf);
  const topNames = new Set(topOf.keys());
  const info = new Map();
  decls.forEach((u) => info.set(u, analyzeItem(u, false, topNames, memberNames)));
  methods.forEach((m) => info.set(m, analyzeItem(m, true, topNames, memberNames)));
  checkReassigned(decls, methods, info, topOf);
  const ctx = { svc, table, areaOfMethod, memberNames, topOf, importOf, decls, methods, delegated, info };
  ctx.areaOfUnit = unitAreaOf(ctx);
  ctx.areaOf = (x) => (x.kind === "unit" ? ctx.areaOfUnit(x.item) : areaOfMethod.get(x.item.name));
  return ctx;
}

export function checkAreas(ctx, areas) {
  const known = Object.keys(ctx.table);
  for (const a of areas)
    if (!known.includes(a)) throw new Error(`知らない領域: ${a}（${known.join("・")}）`);
  for (const a of areas) {
    const left =
      ctx.methods.some((m) => ctx.areaOfMethod.get(m.name) === a) ||
      ctx.decls.some((u) => ctx.areaOfUnit(u) === a);
    if (!left)
      throw new Error(
        a === "core"
          ? `core に移す物が無い（既に移したか、2つ以上の領域が使う上の単位が無い）`
          : `領域 ${a} は既に移した（${SERVICE_FILE} に残りが無い）`,
      );
  }
  if (!areas.includes("core") && ctx.decls.some((u) => ctx.areaOfUnit(u) === "core"))
    throw new Error("core の単位が残っている。最初の回に core を入れる");
}

export const namesOf = (x) => (x.kind === "unit" ? x.item.names : [x.item.name]);

// 移す物（領域ごと）。並びは「同じ領域で使う先を先に、ほかは元の順（上の単位→メソッド）」の安定な位相の順。
// ファイルの間の import が後ろ→前の一方向になり、詰めて分けても循環しない（互いに呼ぶ組は元の順のまま）
function topoOrder(ctx, items, nameToItem) {
  const set = new Set(items);
  const depsOf = (x) => {
    const i = ctx.info.get(x.item);
    const names = [...i.used, ...i.thisRefs.map((r) => r.name)];
    return names.map((n) => nameToItem.get(n)).filter((y) => y && y !== x && set.has(y));
  };
  const placed = new Set();
  const out = [];
  while (out.length < items.length) {
    const next =
      items.find((x) => !placed.has(x) && depsOf(x).every((y) => placed.has(y))) ??
      items.find((x) => !placed.has(x));
    placed.add(next);
    out.push(next);
  }
  return out;
}

export function movingItems(ctx, areas) {
  const moving = new Map();
  const nameToItem = new Map();
  for (const a of areas) {
    const units = ctx.decls.filter((u) => ctx.areaOfUnit(u) === a).map((u) => ({ kind: "unit", item: u }));
    const methods = ctx.methods
      .filter((m) => ctx.areaOfMethod.get(m.name) === a && !ctx.delegated.has(m.name))
      .map((m) => ({ kind: "method", item: m }));
    const items = [...units, ...methods];
    items.forEach((x) => namesOf(x).forEach((n) => nameToItem.set(n, x)));
    moving.set(a, items);
  }
  for (const [a, items] of moving) moving.set(a, topoOrder(ctx, items, nameToItem));
  return moving;
}
