/**
 * sizeBaselines.js - 大きさの関所の部品（BOA-1429、BOA-1425 を割った 2/2）。
 * 関数の単位の AST hash と、基準（{initial_count, units}）と比べる判定の純関数。
 * child_process・ネットワーク・ファイルの読み書きをしない（字は呼び出し側が渡す）。
 *
 * 単位: 最上位の関数の宣言・変数に入れた関数・class のメソッド・object のメソッド。
 * hash: コメント・空白・export を除き、識別子の名前は残した AST の sha256。
 *   メソッドは関数の宣言と同じ形にし、同じ領域（同じファイルの単位）の `this.X(` は `X(` にする
 *   （メソッドを `export async function` へ移すだけの変更で hash を変えないため。async は残す）。
 * 基準は減る向きだけ。線は目安（根拠なし）。
 */
import crypto from "node:crypto";
import { parse } from "@babel/parser";

export const MAX_FN_LINES = 100; // max-lines-per-function
export const MAX_COMPLEXITY = 15;
export const MAX_FILE_LINES = 400; // max-lines

const SKIP_KEYS = new Set([
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "errors",
]);
const FN_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod",
]);
const BRANCH_TYPES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
  "LogicalExpression",
  "AssignmentPattern",
  "OptionalMemberExpression",
  "OptionalCallExpression",
]);
const LOGICAL_ASSIGN = new Set(["&&=", "||=", "??="]);

const isNode = (v) => v && typeof v === "object" && typeof v.type === "string";

function childNodes(node) {
  const out = [];
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_KEYS.has(k) || v === null || typeof v !== "object") continue;
    if (Array.isArray(v)) out.push(...v.filter(isNode));
    else if (isNode(v)) out.push(v);
  }
  return out;
}

function branchWeight(node) {
  if (BRANCH_TYPES.has(node.type)) return 1;
  if (node.type === "SwitchCase") return node.test ? 1 : 0;
  if (node.type === "AssignmentExpression") {
    return LOGICAL_ASSIGN.has(node.operator) ? 1 : 0;
  }
  return 0;
}

// 巡回の複雑さ（目安）。入れ子の関数は数えない（eslint の complexity と同じ）
function complexityOf(fn) {
  let n = 1;
  const visit = (node) => {
    for (const c of childNodes(node)) {
      if (FN_TYPES.has(c.type)) continue;
      n += branchWeight(c);
      visit(c);
    }
  };
  visit(fn);
  return n;
}

const keyName = (key) => {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral" || key.type === "NumericLiteral") {
    return String(key.value);
  }
  return null;
};

function objectUnits(obj) {
  const out = [];
  for (const p of obj.properties) {
    const name = p.computed || !p.key ? null : keyName(p.key);
    if (name === null) continue;
    if (p.type === "ObjectMethod") out.push({ name, fn: p });
    else if (p.type === "ObjectProperty" && FN_TYPES.has(p.value?.type)) {
      out.push({ name, fn: p.value });
    }
  }
  return out;
}

function declarationUnits(decl) {
  if (!decl) return [];
  if (decl.type === "FunctionDeclaration") {
    return decl.id ? [{ name: decl.id.name, fn: decl }] : [];
  }
  if (decl.type === "ObjectExpression") return objectUnits(decl);
  if (decl.type === "ClassDeclaration") {
    return decl.body.body
      .filter((m) => m.type === "ClassMethod" && !m.computed)
      .flatMap((m) => {
        const name = keyName(m.key);
        return name === null ? [] : [{ name, fn: m }];
      });
  }
  if (decl.type !== "VariableDeclaration") return [];
  return decl.declarations.flatMap((d) => {
    if (d.id.type !== "Identifier" || !d.init) return [];
    if (FN_TYPES.has(d.init.type)) return [{ name: d.id.name, fn: d.init }];
    return d.init.type === "ObjectExpression" ? objectUnits(d.init) : [];
  });
}

export function extractUnits(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  return ast.program.body.flatMap((stmt) => {
    const decl =
      stmt.type === "ExportNamedDeclaration" ||
      stmt.type === "ExportDefaultDeclaration"
        ? stmt.declaration
        : stmt;
    return declarationUnits(decl);
  });
}

const isRegionThisCall = (v, names) =>
  (v.type === "CallExpression" || v.type === "OptionalCallExpression") &&
  v.callee?.type === "MemberExpression" &&
  v.callee.object.type === "ThisExpression" &&
  !v.callee.computed &&
  v.callee.property.type === "Identifier" &&
  names.has(v.callee.property.name);

function canon(v, names) {
  if (Array.isArray(v)) return v.map((x) => canon(x, names));
  if (v === null || typeof v !== "object") return v;
  const src = isRegionThisCall(v, names) ? { ...v, callee: v.callee.property } : v;
  const out = {};
  for (const k of Object.keys(src).sort()) {
    if (!SKIP_KEYS.has(k)) out[k] = canon(src[k], names);
  }
  return out;
}

/**
 * hash の前の正規化（これ1つを使う。RA02 の pr-lane の「移すだけ」も同じ）。
 * メソッド・変数の関数・宣言を {type:"Fn", name, async, generator, params, body} の同じ形にする。
 * names: 同じ領域の単位の名前の Set（`this.X(` を `X(` にする対象）
 */
export function normalizeForHash({ name, fn }, names = new Set()) {
  const accessor = fn.kind === "get" || fn.kind === "set" ? fn.kind : null;
  return canon(
    {
      type: "Fn",
      name,
      async: Boolean(fn.async),
      generator: Boolean(fn.generator),
      accessor,
      params: fn.params,
      body: fn.body,
    },
    names,
  );
}

export const hashUnit = (unit, names) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizeForHash(unit, names)))
    .digest("hex");

/** ファイルの字 → 単位ごとの {name, hash, lines, complexity} */
export function unitsOfSource(source) {
  const units = extractUnits(source);
  const names = new Set(units.map((u) => u.name));
  return units.map((u) => ({
    name: u.name,
    hash: hashUnit(u, names),
    lines: u.fn.loc.end.line - u.fn.loc.start.line + 1,
    complexity: complexityOf(u.fn),
  }));
}

export const isOverLine = (u) =>
  u.lines > MAX_FN_LINES || u.complexity > MAX_COMPLEXITY;

export const countLines = (text) =>
  text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** 木の全部のファイルの字（{path: source}）→ 基準。線を越える単位だけ載せる */
export function buildBaseline(files) {
  const units = {};
  for (const file of Object.keys(files).sort()) {
    for (const u of unitsOfSource(files[file])) {
      if (!isOverLine(u) || units[u.hash]) continue;
      units[u.hash] = {
        lines: u.lines,
        complexity: u.complexity,
        file,
        name: u.name,
      };
    }
  }
  const sorted = Object.fromEntries(Object.keys(units).sort().map((h) => [h, units[h]]));
  return { initial_count: Object.keys(sorted).length, units: sorted };
}

function judgeUnit(u, file, baseline, strictExisting) {
  if (!isOverLine(u) || baseline.units[u.hash]) return null;
  const where = `${file} ${u.name}（${u.lines} 行・複雑さ ${u.complexity}）`;
  const prev = Object.values(baseline.units).find(
    (b) => b.file === file && b.name === u.name,
  );
  const notGrown =
    prev && u.lines <= prev.lines && u.complexity <= prev.complexity;
  if (notGrown && !strictExisting) {
    return { level: "warn", text: `${where} 既にある大きい単位（増えていない）` };
  }
  return { level: "error", text: `${where} 線を越える単位で基準に無い` };
}

function fileLineError(file, source, units, baseline) {
  const baselined = units
    .filter((u) => baseline.units[u.hash])
    .reduce((sum, u) => sum + u.lines, 0);
  const rest = countLines(source) - baselined;
  return rest > MAX_FILE_LINES
    ? `${file} ファイル ${rest} 行（基準を持つ単位の ${baselined} 行を除く）が ${MAX_FILE_LINES} を越えた`
    : null;
}

/**
 * 基準と比べる。files: [{file, source, isNew}]。
 * strictExisting: 基準が半分以下になった旗。立てると既存のファイルの線の越えも赤にする
 */
export function checkAgainstBaseline({ baseline, files, strictExisting = false }) {
  const errors = [];
  const warnings = [];
  for (const { file, source, isNew } of files) {
    const units = unitsOfSource(source);
    for (const u of units) {
      const r = judgeUnit(u, file, baseline, strictExisting);
      if (r) (r.level === "error" ? errors : warnings).push(r.text);
    }
    if (isNew || strictExisting) {
      const e = fileLineError(file, source, units, baseline);
      if (e) errors.push(e);
    }
  }
  return { errors, warnings };
}

/** 基準は減る向きだけ。base（merge-base の基準）と今の基準を比べ、半分以下の旗も返す */
export function checkBaselineShrink({ base, current }) {
  const errors = [];
  if (current.initial_count !== base.initial_count) {
    errors.push(
      `initial_count を変えた（${base.initial_count} → ${current.initial_count}）`,
    );
  }
  const added = Object.keys(current.units).filter((h) => !base.units[h]);
  if (added.length > 0) {
    errors.push(`基準の units が増えた（${added.length} 件: ${added.join(", ")}）`);
  }
  const count = Object.keys(current.units).length;
  return { errors, strictExisting: count <= current.initial_count / 2 };
}
