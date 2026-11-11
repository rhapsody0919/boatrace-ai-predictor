/**
 * splitDataLayer/facade.js - 移した後の supabaseDataService.js（殻）の字（split-data-layer.mjs、BOA-1432）。
 * 残る節は字のまま。移したメソッドは `getX,` の短い形、移した名前は import、移した名前付き export は再 export、
 * 使わなくなった import の名前は外す（ファイルの頭の注釈は残す）。新しい import・再 export は最後の import の後ろ
 */
import { importParts, lineStartOf } from "./service.js";
import { renderImport, renderExportFrom, specifier } from "./render.js";
import { namesOf } from "./analyze.js";

function leftOf(ctx, areas) {
  const moved = (m) => areas.includes(ctx.areaOfMethod.get(m.name));
  const leftDecls = new Set(ctx.decls.filter((u) => !areas.includes(ctx.areaOfUnit(u))));
  const leftMethods = new Set(ctx.methods.filter((m) => !moved(m)));
  const uses = new Set();
  for (const x of [...leftDecls, ...leftMethods]) ctx.info.get(x).used.forEach((n) => uses.add(n));
  for (const m of ctx.svc.members) if (!leftMethods.has(m)) uses.add(m.name);
  return { leftDecls, leftMethods, uses };
}

function newImports(layout, uses, reexports) {
  const byFile = new Map();
  for (const n of [...uses].sort()) {
    const f = layout.fileOfName.get(n);
    if (!f) continue;
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(n);
  }
  const lines = [...byFile.keys()].sort().map((f) => renderImport(`./${f}`, byFile.get(f).map(specifier)));
  for (const f of [...reexports.keys()].sort()) lines.push(renderExportFrom(`./${f}`, reexports.get(f)));
  return lines.map((l) => l + "\n").join("");
}

function reexportsOf(layout) {
  const out = new Map();
  for (const [f, items] of layout.fileItems)
    for (const x of items)
      if (x.kind === "unit" && x.item.node.type === "ExportNamedDeclaration") {
        if (!out.has(f)) out.set(f, []);
        out.get(f).push(...namesOf(x));
      }
  return out;
}

function importText(src, u, uses) {
  const all = importParts(u.node);
  const keep = all.filter((p) => uses.has(p.local));
  if (keep.length === all.length) return u.text;
  const lead = src.slice(u.start, u.node.start);
  if (keep.length === 0) return u.index === 0 ? lead.replace(/\n+$/, "\n") : "";
  return lead + renderImport(u.node.source.value, keep) + src.slice(u.node.end, u.end);
}

function objectText(svc, leftMethods) {
  const body = svc.members.map((m) => {
    if (m.kind === "moved" || leftMethods.has(m)) return m.text;
    const indent = svc.source.slice(lineStartOf(svc.source, m.node.start), m.node.start);
    return `${indent}${m.name},\n`;
  });
  return svc.objOpen + body.join("") + svc.objClose;
}

// 殻の字と、殻が新しいファイルから読む名前（export を足す）
export function buildFacade(ctx, layout, areas) {
  const { svc } = ctx;
  const { leftDecls, leftMethods, uses } = leftOf(ctx, areas);
  const imported = [...uses].filter((n) => layout.fileOfName.has(n));
  const added = newImports(layout, uses, reexportsOf(layout));
  const lastImport = Math.max(-1, ...svc.units.filter((u) => u.isImport || u.isReexport).map((u) => u.index));
  const out = lastImport < 0 ? [added] : [];
  for (const u of svc.units) {
    if (u.isImport) out.push(importText(svc.source, u, uses));
    else if (u.isObject) out.push(objectText(svc, leftMethods));
    else if (u.isReexport || leftDecls.has(u)) out.push(u.text);
    if (u.index === lastImport) out.push(added);
  }
  out.push(svc.tail);
  return { text: out.join(""), imported };
}
