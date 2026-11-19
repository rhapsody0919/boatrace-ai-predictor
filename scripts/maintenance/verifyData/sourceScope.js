/**
 * verify が製品の本文を読む範囲。ファイルを割った後も、割る前と同じ字を読む（字の位置・ファイル名の一覧に縛られない）。
 *
 * 本文の読みは呼ぶ verify が持つ（src・scripts の本文を読むのは今までどおりその verify。fs は渡された read・exists だけ）。
 * - localSourceFiles(fsx, rel): rel と、rel から相対 import で辿れる（推移）同じフォルダとその下の .js・.jsx・.mjs。
 *   上のフォルダ（共通の部品）・CSS は辿らない。rel が無ければ [rel] を返す（有無の扱いは呼ぶ側）
 * - declarationSource(fsx, rel, name, injected): rel の上の宣言 name と、それが使う上の宣言を、名前と import の結び付き
 *   （import { x } from "./y.js" → y.js の x の宣言）で辿って集めた字。injected に入る名前は呼ぶ側が渡すので辿らない。
 *   name が見つからなければ例外（黙って空の字を評価しない）
 * fsx は { read(rel): string, exists(rel): boolean }（rel はリポジトリのルートからの相対）
 */
import path from "node:path";
import { parse } from "@babel/parser";

const CODE_EXT = /\.(m?js|jsx)$/;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

const parsed = new WeakMap();
function program(fsx, rel) {
  if (!parsed.has(fsx)) parsed.set(fsx, new Map());
  const cache = parsed.get(fsx);
  if (!cache.has(rel)) {
    const text = fsx.read(rel);
    const ast = parse(text, { sourceType: "module", plugins: ["jsx"] });
    cache.set(rel, { text, body: ast.program.body });
  }
  return cache.get(rel);
}

const EXTS = ["", ".js", ".jsx", "/index.js", "/index.jsx"];
function resolveSpec(fsx, fromRel, spec) {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRel), spec),
  );
  return EXTS.map((e) => base + e).find(
    (p) => CODE_EXT.test(p) && fsx.exists(p),
  );
}

function relativeSpecs({ text, body }) {
  const specs = body
    .filter((n) => n.source && /^\.{1,2}\//.test(n.source.value))
    .map((n) => n.source.value);
  return [...specs, ...[...text.matchAll(DYNAMIC_IMPORT)].map((m) => m[1])];
}

export function localSourceFiles(fsx, rel) {
  if (!fsx.exists(rel)) return [rel];
  const dir = `${path.posix.dirname(rel)}/`;
  const seen = [rel];
  for (let i = 0; i < seen.length; i++) {
    for (const spec of relativeSpecs(program(fsx, seen[i]))) {
      const target = resolveSpec(fsx, seen[i], spec);
      if (target && target.startsWith(dir) && !seen.includes(target))
        seen.push(target);
    }
  }
  return seen;
}

function declaredNames(node) {
  const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  if (!decl) return [];
  if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration")
    return [decl.id.name];
  if (decl.type === "VariableDeclaration")
    return decl.declarations
      .filter((d) => d.id.type === "Identifier")
      .map((d) => d.id.name);
  return [];
}

/** rel の上で name を宣言する文、または name を相対 import する先。どちらでもなければ null */
function lookup(fsx, rel, name) {
  const { body } = program(fsx, rel);
  const node = body.find((n) => declaredNames(n).includes(name));
  if (node)
    return {
      rel,
      node: node.type === "ExportNamedDeclaration" ? node.declaration : node,
    };
  for (const n of body) {
    if (n.type !== "ImportDeclaration" || !/^\.{1,2}\//.test(n.source.value))
      continue;
    const s = n.specifiers.find((sp) => sp.local.name === name);
    if (!s) continue;
    if (
      s.type !== "ImportSpecifier" ||
      (s.imported.name ?? s.imported.value) !== name
    )
      throw new Error(
        `${rel}: ${name} は別名・default・名前空間の import で、名前で辿れない`,
      );
    const target = resolveSpec(fsx, rel, n.source.value);
    if (!target) throw new Error(`${rel}: ${n.source.value} が見つからない`);
    return lookup(fsx, target, name);
  }
  return null;
}

const NOT_CHILDREN = new Set([
  "loc",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "extra",
]);

/** 名前でない子（a.b の b、{ b: 1 } の b）か */
function isLabel(node, key) {
  if (key === "property")
    return node.type === "MemberExpression" && !node.computed;
  if (key === "key")
    return node.type === "ObjectProperty" && !node.computed && !node.shorthand;
  return false;
}

function identifiers(node, out = new Set()) {
  if (!node || typeof node.type !== "string") return out;
  if (node.type === "Identifier") out.add(node.name);
  for (const [key, value] of Object.entries(node)) {
    if (NOT_CHILDREN.has(key) || isLabel(node, key)) continue;
    for (const child of [value].flat())
      if (child && typeof child === "object") identifiers(child, out);
  }
  return out;
}

export function declarationSource(fsx, rel, name, injected = []) {
  const skip = new Set(injected);
  const seen = new Set();
  const hits = new Map(); // 宣言の位置 → { rel, node }
  const owner = new Map(); // 名前 → 宣言の位置（1つの関数の中に並べるので、同じ名前を2つの本から入れない）
  const pending = [[rel, name]];
  while (pending.length > 0) {
    const [file, n] = pending.shift();
    if (skip.has(n) || seen.has(`${file}:${n}`)) continue;
    seen.add(`${file}:${n}`);
    const hit = lookup(fsx, file, n);
    if (!hit) {
      if (n === name && file === rel)
        throw new Error(`${rel}: ${name} の宣言が見つからない`);
      continue;
    }
    const at = `${hit.rel}:${hit.node.start}`;
    for (const declared of declaredNames(hit.node)) {
      if (owner.has(declared) && owner.get(declared) !== at)
        throw new Error(
          `${declared} の宣言が2か所（${owner.get(declared)}・${at}）にあり、1つの字にまとめられない`,
        );
      owner.set(declared, at);
    }
    if (hits.has(at)) continue;
    hits.set(at, hit);
    for (const id of identifiers(hit.node)) pending.push([hit.rel, id]);
  }
  const unique = [...hits.values()];
  const order = [...new Set(unique.map((h) => h.rel))];
  unique.sort(
    (a, b) =>
      order.indexOf(a.rel) - order.indexOf(b.rel) ||
      a.node.start - b.node.start,
  );
  return unique
    .map((h) => program(fsx, h.rel).text.slice(h.node.start, h.node.end))
    .join("\n");
}
