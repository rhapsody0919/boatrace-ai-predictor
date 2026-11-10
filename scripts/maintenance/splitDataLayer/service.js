/**
 * splitDataLayer/service.js - supabaseDataService.js を字の節に切る（split-data-layer.mjs、BOA-1432）。
 * 節は「前の節の行の終わりから自分の行の終わりまで」の字（前の空行・注釈は後ろの節に付く、行末の注釈は自分に付く）。
 * 上の文（import・宣言・再 export・殻の object）と、殻の object のメンバー（メソッド・移した後の短い形）の2段
 */
import { parseModule, declaredNames } from "./ast.js";
import { SERVICE_OBJECT } from "./table.js";

export const lineEndAfter = (src, pos) => {
  const i = src.indexOf("\n", pos);
  return i === -1 ? src.length : i + 1;
};

export const lineStartOf = (src, pos) => src.lastIndexOf("\n", pos - 1) + 1;

export const countLines = (text) =>
  text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;

function segments(src, nodes, from, to) {
  const segs = [];
  let cur = from;
  for (const node of nodes) {
    const end = Math.min(lineEndAfter(src, node.end), to);
    segs.push({ node, start: cur, end, text: src.slice(cur, end) });
    cur = end;
  }
  return { segs, tail: src.slice(cur, to) };
}

const isServiceObject = (s) =>
  s.type === "ExportNamedDeclaration" &&
  s.declaration?.type === "VariableDeclaration" &&
  s.declaration.declarations[0]?.id.name === SERVICE_OBJECT;

function memberOf(source, s) {
  const p = s.node;
  if (p.type === "ObjectMethod" && p.kind === "method" && !p.computed && p.key.type === "Identifier")
    return { ...s, kind: "method", name: p.key.name };
  if (p.type === "ObjectProperty" && p.shorthand && p.value.type === "Identifier")
    return { ...s, kind: "moved", name: p.key.name };
  const at = source.slice(p.start, p.start + 40);
  throw new Error(`${SERVICE_OBJECT} のメンバーの形を扱えない（${at}…）`);
}

function unitOf(s, i, objIdx) {
  const u = {
    ...s,
    index: i,
    isObject: i === objIdx,
    isImport: s.node.type === "ImportDeclaration",
    isReexport: s.node.type === "ExportNamedDeclaration" && !!s.node.source,
    names: declaredNames(s.node),
  };
  u.isDecl = !u.isObject && !u.isImport && !u.isReexport;
  if (u.isDecl && u.names.length === 0)
    throw new Error(`上の文の形を扱えない（宣言でない: ${u.text.trim().slice(0, 40)}…）`);
  return u;
}

export function parseService(source) {
  const body = parseModule(source).program.body;
  const objIdx = body.findIndex(isServiceObject);
  if (objIdx < 0) throw new Error(`export const ${SERVICE_OBJECT} = { … } が見つからない`);
  const obj = body[objIdx].declaration.declarations[0].init;
  if (obj?.type !== "ObjectExpression") throw new Error(`${SERVICE_OBJECT} が object の字でない`);
  const { segs, tail } = segments(source, body, 0, source.length);
  const objSeg = segs[objIdx];
  const innerFrom = lineEndAfter(source, obj.start);
  const last = obj.properties[obj.properties.length - 1];
  const innerTo = last ? lineEndAfter(source, last.end) : innerFrom;
  const inner = segments(source, obj.properties, innerFrom, innerTo);
  return {
    source,
    tail,
    units: segs.map((s, i) => unitOf(s, i, objIdx)),
    members: inner.segs.map((s) => memberOf(source, s)),
    objOpen: source.slice(objSeg.start, innerFrom),
    objClose: inner.tail + source.slice(innerTo, objSeg.end),
  };
}

export function importParts(node) {
  return node.specifiers.map((s) => ({
    kind: s.type,
    local: s.local.name,
    imported:
      s.type !== "ImportSpecifier"
        ? null
        : s.imported.type === "Identifier"
          ? s.imported.name
          : s.imported.value,
  }));
}
