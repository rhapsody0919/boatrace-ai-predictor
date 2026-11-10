/**
 * splitDataLayer/render.js - 字を作る（split-data-layer.mjs、BOA-1432）: import・再 export の行、単位の字、ファイルへの詰め方
 */
import { lineStartOf, countLines } from "./service.js";
import { fileNameOf } from "./table.js";
import { namesOf } from "./analyze.js";

const named = (p) => (p.imported === p.local ? p.local : `${p.imported} as ${p.local}`);

// prettier の形（80字を越えれば1行に1つ）
export function renderImport(source, parts) {
  const def = parts.find((p) => p.kind === "ImportDefaultSpecifier");
  const ns = parts.find((p) => p.kind === "ImportNamespaceSpecifier");
  const names = parts.filter((p) => p.kind === "ImportSpecifier").map(named);
  const lead = [def?.local, ns ? `* as ${ns.local}` : null].filter(Boolean);
  const braces = names.length ? [`{ ${names.join(", ")} }`] : [];
  const line = `import ${[...lead, ...braces].join(", ")} from "${source}";`;
  if (line.length <= 80 || names.length === 0) return line;
  const leadText = lead.length ? `${lead.join(", ")}, ` : "";
  return `import ${leadText}{\n${names.map((n) => `  ${n},`).join("\n")}\n} from "${source}";`;
}

export function renderExportFrom(source, names) {
  const line = `export { ${names.join(", ")} } from "${source}";`;
  if (line.length <= 80) return line;
  return `export {\n${names.map((n) => `  ${n},`).join("\n")}\n} from "${source}";`;
}

export const specifier = (name) => ({ kind: "ImportSpecifier", local: name, imported: name });

function unitText(u, needExport) {
  if (u.node.type === "ExportNamedDeclaration" || !u.names.some((n) => needExport.has(n)))
    return u.text;
  const at = u.node.start - u.start;
  return u.text.slice(0, at) + "export " + u.text.slice(at);
}

// メソッド → `export [async] function getX(…) { … }`。本体の字・字下げはそのまま、this.X は X、後ろの , は外す。
// 前の注釈は、メソッドの行の字下げの分だけ外す
function methodText(src, m, thisRefs) {
  const node = m.node;
  const lineStart = lineStartOf(src, node.start);
  const indent = src.slice(lineStart, node.start);
  const lead = src
    .slice(m.start, lineStart)
    .split("\n")
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
    .join("\n");
  const head = `export ${node.async ? "async " : ""}function ${node.generator ? "* " : ""}${node.key.name}`;
  let body = src.slice(node.key.end, node.end);
  for (const r of [...thisRefs].sort((p, q) => q.start - p.start)) {
    const a = r.start - node.key.end;
    body = body.slice(0, a) + r.name + body.slice(r.end - node.key.end);
  }
  const after = src.slice(node.end, m.end).replace(/^\s*,/, "");
  return lead + head + body + after;
}

export function itemText(ctx, x, needExport) {
  return x.kind === "unit"
    ? unitText(x.item, needExport)
    : methodText(ctx.svc.source, x.item, ctx.info.get(x.item).thisRefs);
}

// 並びのまま、本体の行が maxBody を越える手前で次のファイルへ
export function pack(ctx, moving, maxBody) {
  const fileOfName = new Map();
  const fileItems = new Map();
  for (const [area, items] of moving) {
    let idx = 0;
    let lines = 0;
    for (const x of items) {
      const n = countLines(itemText(ctx, x, new Set()));
      if (lines > 0 && lines + n > maxBody) {
        idx += 1;
        lines = 0;
      }
      lines += n;
      const f = fileNameOf(area, idx);
      if (!fileItems.has(f)) fileItems.set(f, []);
      fileItems.get(f).push(x);
      namesOf(x).forEach((nm) => fileOfName.set(nm, f));
    }
  }
  return { fileOfName, fileItems };
}

// import の並び: 元の import の順 → 出したファイル（名前の順）
export function sortSources(ctx, sources) {
  const order = ctx.svc.units.filter((u) => u.isImport).map((u) => u.node.source.value);
  const key = (s) => (order.includes(s) ? [0, order.indexOf(s), ""] : [1, 0, s]);
  return [...sources].sort((p, q) => {
    const [a, b] = [key(p), key(q)];
    return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
  });
}

export function renderFile(ctx, area, items, deps, needExport) {
  const header = [
    `// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: ${area}）。`,
    "// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい",
  ];
  const imps = sortSources(ctx, deps.keys()).map((s) => {
    const parts = [...deps.get(s).values()];
    const rest = parts.filter((p) => p.kind !== "ImportSpecifier");
    // 元の import は元の名前の並び（本文の import の字を見る verify があるため）、出したファイルからは名前の順
    const names = parts
      .filter((p) => p.kind === "ImportSpecifier")
      .sort((p, q) => (p.idx ?? 0) - (q.idx ?? 0) || (p.local < q.local ? -1 : p.local > q.local ? 1 : 0));
    return renderImport(s, [...rest, ...names]);
  });
  const bodies = items.map((x, i) => {
    const t = itemText(ctx, x, needExport);
    return i === 0 ? t.replace(/^\n+/, "") : t;
  });
  return [...header, ...(imps.length ? ["", ...imps] : []), "", bodies.join("")].join("\n");
}
