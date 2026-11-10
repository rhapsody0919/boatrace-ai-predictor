/**
 * splitDataLayer/ast.js - 構文木の道具（split-data-layer.mjs、BOA-1432）: 読む・辿る・AST hash・宣言の名前・this.X
 */
import { createHash } from "node:crypto";
import { parse } from "@babel/parser";

export function parseModule(source) {
  return parse(source, { sourceType: "module", plugins: ["jsx"] });
}

// 位置・注釈・字の書き方（extra.raw 等）は hash にも辿りにも入れない
export const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);
// this が変わる関数（矢の関数は this を変えない）
export const isFunctionNode = (n) => FUNCTION_TYPES.has(n.type);
export const isAnyFunction = (n) =>
  isFunctionNode(n) || n.type === "ArrowFunctionExpression";

const isNode = (n) =>
  !!n && typeof n === "object" && typeof n.type === "string";

// visit(node, parent, key) が false を返すとその下に入らない
export function walk(node, visit, parent = null, key = null) {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit, parent, key));
    return;
  }
  if (!isNode(node) || visit(node, parent, key) === false) return;
  for (const k of Object.keys(node)) {
    if (!SKIP_KEYS.has(k)) walk(node[k], visit, node, k);
  }
}

// --- AST hash: メソッドと関数の宣言・this.X と X・export の有無を同じに数える
const isThisMember = (n) =>
  (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") &&
  !n.computed &&
  n.object.type === "ThisExpression" &&
  n.property.type === "Identifier";

function normalizeNode(node) {
  if (isThisMember(node)) return { type: "Identifier", name: node.property.name };
  if (node.type === "ExportNamedDeclaration" && node.declaration)
    return normalize(node.declaration);
  if (node.type === "ObjectMethod" || node.type === "FunctionDeclaration") {
    return {
      type: "Function",
      name: node.key ? node.key.name : node.id.name,
      async: node.async,
      generator: node.generator,
      params: normalize(node.params),
      body: normalize(node.body),
    };
  }
  const out = {};
  for (const key of Object.keys(node)) {
    if (!SKIP_KEYS.has(key)) out[key] = normalize(node[key]);
  }
  return out;
}

export function normalize(node) {
  if (Array.isArray(node)) return node.map(normalize);
  return isNode(node) ? normalizeNode(node) : node;
}

export function astHash(node) {
  return createHash("sha256")
    .update(JSON.stringify(normalize(node)))
    .digest("hex")
    .slice(0, 16);
}

// --- 宣言の名前
export function bindingNames(p, out = []) {
  if (!p) return out;
  if (p.type === "Identifier") out.push(p.name);
  else if (p.type === "ObjectPattern")
    p.properties.forEach((q) =>
      bindingNames(q.type === "RestElement" ? q.argument : q.value, out),
    );
  else if (p.type === "ArrayPattern") p.elements.forEach((e) => bindingNames(e, out));
  else if (p.type === "AssignmentPattern") bindingNames(p.left, out);
  else if (p.type === "RestElement") bindingNames(p.argument, out);
  return out;
}

// 上の文が宣言する名前（export を外して見る）
export function declaredNames(stmt) {
  const d = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
  if (!d) return [];
  if (d.type === "VariableDeclaration")
    return d.declarations.flatMap((x) => bindingNames(x.id));
  if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id)
    return [d.id.name];
  return [];
}

// メソッドの this.X の位置（入れ子の function の中は this が変わるので数えない）。this のほかの使い方は bad に
export function thisMembers(method) {
  const found = [];
  const bad = [];
  const visit = (n, parent, key) => {
    if (n !== method && isFunctionNode(n)) return false;
    if (n.type !== "ThisExpression") return undefined;
    if (parent && key === "object" && isThisMember(parent))
      found.push({ name: parent.property.name, start: parent.start, end: parent.end });
    else bad.push(n.start);
    return undefined;
  };
  walk(method.params, visit, method, "params");
  walk(method.body, visit, method, "body");
  return { found, bad };
}
