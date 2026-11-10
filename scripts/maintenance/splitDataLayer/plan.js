/**
 * splitDataLayer/plan.js - 振り分けの計画（純関数。ファイルを読み書きしない）と書いた後の確かめ（split-data-layer.mjs、BOA-1432）。
 * 確かめ: 移した単位の AST hash が元と同じ・殻の object のメンバーの並びが元と同じ・殻に残るメソッドの hash が同じ
 */
import { parseModule, astHash, declaredNames } from "./ast.js";
import { freeNames } from "./freeNames.js";
import { parseService, countLines } from "./service.js";
import { analyzeService, checkAreas, movingItems, namesOf } from "./analyze.js";
import { pack, renderFile } from "./render.js";
import { resolveFiles } from "./build.js";
import { buildFacade } from "./facade.js";
import { METHOD_TABLE, MAX_LINES, SERVICE_OBJECT, SERVICE_FILE, areaOfFile } from "./table.js";

function parseOrThrow(text, what) {
  try {
    return parseModule(text);
  } catch (e) {
    throw new Error(`${what} が構文として読めない: ${e.message}`);
  }
}

function render(ctx, moving, areas, maxBody) {
  const layout = pack(ctx, moving, maxBody);
  const acc = resolveFiles(ctx, layout);
  const facade = buildFacade(ctx, layout, areas);
  facade.imported.forEach((n) => acc.needExport.add(n));
  const files = {};
  for (const [f, items] of layout.fileItems)
    files[f] = renderFile(ctx, areaOfFile(f), items, acc.deps.get(f) ?? new Map(), acc.needExport);
  return { layout, files, facade: facade.text };
}

// 本体の行の上限を import の行の分だけ下げ、2つ以上の単位を持つファイルが全部線の内に入るまで詰め直す
function fit(ctx, moving, areas, maxLines) {
  let reserve = 0;
  for (let round = 0; round < 50; round += 1) {
    const r = render(ctx, moving, areas, maxLines - reserve);
    const over = Math.max(
      0,
      ...Object.entries(r.files)
        .filter(([f]) => r.layout.fileItems.get(f).length > 1)
        .map(([, t]) => countLines(t) - maxLines),
    );
    if (over === 0) return r;
    reserve += over;
  }
  throw new Error("詰め方が決まらない（50回）");
}

function outHashes(files) {
  const out = new Map();
  for (const [f, text] of Object.entries(files))
    for (const s of parseOrThrow(text, f).program.body)
      if (s.type !== "ImportDeclaration")
        declaredNames(s).forEach((n) => out.set(n, { file: f, hash: astHash(s) }));
  return out;
}

export function mappingOf(moving, files) {
  const out = outHashes(files);
  const mapping = [];
  for (const items of moving.values())
    for (const x of items)
      for (const n of namesOf(x)) {
        const h = astHash(x.item.node);
        const o = out.get(n);
        if (!o) throw new Error(`移した先に ${n} が無い`);
        if (o.hash !== h) throw new Error(`${n} の AST hash が元と違う（${h} → ${o.hash}）`);
        mapping.push({ name: n, file: `src/services/${o.file}`, hash: h });
      }
  return mapping.sort((p, q) => (p.file < q.file ? -1 : p.file > q.file ? 1 : 0));
}

function checkFacade(ctx, facadeText) {
  const body = parseOrThrow(facadeText, "殻").program.body;
  const obj = body.find(
    (s) => s.type === "ExportNamedDeclaration" && s.declaration?.declarations?.[0]?.id.name === SERVICE_OBJECT,
  ).declaration.declarations[0].init;
  const keys = obj.properties.map((p) => p.key.name);
  if (keys.join(",") !== ctx.svc.members.map((m) => m.name).join(","))
    throw new Error("殻の object のメンバーの並びが元と違う");
  for (const p of obj.properties) {
    const m = ctx.methods.find((x) => x.name === p.key.name);
    if (p.type === "ObjectMethod" && astHash(p) !== astHash(m.node))
      throw new Error(`殻に残る ${m.name} の AST hash が変わった`);
  }
}

// 出した各ファイル（殻も）の import の取りこぼしと余り: 元で上の名前だった物を使うなら import か宣言があり、import は全部使う
export function checkImports(files, topNames) {
  for (const [f, text] of Object.entries(files)) {
    const body = parseOrThrow(text, f).program.body;
    const missing = [...freeNames({ type: "Program", body })].filter((n) => topNames.has(n));
    if (missing.length) throw new Error(`${f} が ${missing.join("・")} を import も宣言もせずに使う`);
    const refs = freeNames({ type: "Program", body: body.filter((x) => x.type !== "ImportDeclaration") });
    const unused = body
      .filter((x) => x.type === "ImportDeclaration")
      .flatMap((x) => x.specifiers.map((y) => y.local.name))
      .filter((n) => !refs.has(n));
    if (unused.length) throw new Error(`${f} に使わない import: ${unused.join("・")}`);
  }
}

function reportOf(ctx) {
  const rows = Object.fromEntries(Object.keys(ctx.table).map((a) => [a, { methods: 0, units: 0, lines: 0 }]));
  for (const u of ctx.decls) {
    const r = rows[ctx.areaOfUnit(u)];
    r.units += 1;
    r.lines += countLines(u.text);
  }
  for (const m of ctx.methods) {
    const r = rows[ctx.areaOfMethod.get(m.name)];
    r.methods += 1;
    r.lines += countLines(m.text);
  }
  return rows;
}

/**
 * @param {string} source supabaseDataService.js の今の字
 * @param {string[]} areas 移す領域
 * @param {{table?: object, maxLines?: number, existingFiles?: string[]}} [opts]
 * @returns {{files: Record<string, string>, facade: string, mapping: object[], report: object}}
 */
export function planSplit(source, areasIn, opts = {}) {
  const ctx = analyzeService(parseService(source), opts.table ?? METHOD_TABLE);
  // 渡す順で出力を変えない（表の順にそろえる。知らない名前は checkAreas が止める）
  const known = Object.keys(ctx.table);
  const areas = [...known.filter((a) => areasIn.includes(a)), ...areasIn.filter((a) => !known.includes(a))];
  checkAreas(ctx, areas);
  const moving = movingItems(ctx, areas);
  const r = fit(ctx, moving, areas, opts.maxLines ?? MAX_LINES);
  const existing = new Set(opts.existingFiles ?? []);
  for (const f of Object.keys(r.files)) if (existing.has(f)) throw new Error(`src/services/${f} が既にある`);
  const mapping = mappingOf(moving, r.files);
  checkFacade(ctx, r.facade);
  checkImports({ ...r.files, [SERVICE_FILE]: r.facade }, new Set(ctx.topOf.keys()));
  return { files: r.files, facade: r.facade, mapping, report: reportOf(ctx) };
}

// 書かずに、今の殻に残る物を領域ごとに数える
export function reportSplit(source, opts = {}) {
  return reportOf(analyzeService(parseService(source), opts.table ?? METHOD_TABLE));
}
