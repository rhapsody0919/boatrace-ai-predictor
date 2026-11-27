/**
 * sizeBaselines.js - 大きさの関所の部品（BOA-1429、2026-11-25 に全体で0＋例外の表へ、ADR-0110）。
 * 関数の単位の行数・複雑さと、ファイルの実質の行（空行・注釈を除く）を数え、線と例外の表で判定する純関数。
 * child_process・ネットワーク・ファイルの読み書きをしない（字は呼び出し側が渡す）。
 *
 * 単位: 最上位の関数の宣言・変数に入れた関数・class のメソッド・object のメソッド。
 * 線は目安（根拠なし）。表は減る向きだけ。
 */
import { parse } from "@babel/parser";

export const MAX_FN_LINES = 100; // max-lines-per-function
export const MAX_COMPLEXITY = 15;
export const MAX_FILE_LINES = 400; // max-lines

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
  for (const v of Object.values(node)) {
    // 位置（loc・start）・注釈の配列も辿るが、注釈は枝を持たず複雑さに入らない（2026-11-27 に全 15,619 単位で同じと確かめて SKIP_KEYS を外した）
    if (v === null || typeof v !== "object") continue;
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
  // 名前の無い export default の関数・アロー関数は「default」の名で数える（2026-11-27 まで単位から抜け、線に掛からなかった）
  if (decl.type === "FunctionDeclaration" || FN_TYPES.has(decl.type)) {
    return [{ name: decl.id?.name ?? "default", fn: decl }];
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

/** ファイルの字 → 単位ごとの {name, lines, start, end, complexity} */
export function unitsOfSource(source) {
  return extractUnits(source).map((u) => ({
    name: u.name,
    lines: u.fn.loc.end.line - u.fn.loc.start.line + 1,
    start: u.fn.loc.start.line,
    end: u.fn.loc.end.line,
    complexity: complexityOf(u.fn),
  }));
}

export const isOverLine = (u) =>
  u.lines > MAX_FN_LINES || u.complexity > MAX_COMPLEXITY;

/** 空行とコメントだけの行を除いた行の番号（1 始まり）の一覧。parse できなければ throw */
export function substantiveLineNumbers(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const chars = source.split("");
  for (const c of ast.comments) {
    for (let i = c.start; i < c.end; i += 1) {
      if (chars[i] !== "\n") chars[i] = " ";
    }
  }
  return chars
    .join("")
    .split("\n")
    .flatMap((t, i) => (t.trim() === "" ? [] : [i + 1]));
}

/**
 * 全体で0の大きさの関所（2026-11-25、ADR-0110）。files: {path: source}（HEAD の木の全部）。
 * - 線を越える単位（関数 100 行・複雑さ 15）は1つも置かない（__fixtures__ は呼び出し側で外す）
 * - 実質の行（空行・注釈を除く）が 400 を越えるファイルは exceptions.files[path] に要り、その数を越えない
 * - 表の上限が今の行より多い・ファイルが無い行も赤（表をちょうどに保つ）
 * exceptions: { files: { path: 上限の実質の行 } }。parse できないファイルは skipped に返す（eslint が別に見る）
 */
export function judgeTreeSize({ files, exceptions }) {
  const errors = [];
  const warnings = [];
  const skipped = [];
  const caps = exceptions?.files ?? {};
  for (const file of Object.keys(files).sort()) {
    let units;
    let lines;
    try {
      units = unitsOfSource(files[file]);
      lines = substantiveLineNumbers(files[file]).length;
    } catch {
      skipped.push(file);
      continue;
    }
    for (const u of units.filter(isOverLine)) {
      errors.push(`${file} ${u.name}（${u.lines} 行・複雑さ ${u.complexity}）が線（${MAX_FN_LINES} 行・複雑さ ${MAX_COMPLEXITY}）を越える`);
    }
    const cap = caps[file];
    if (lines > MAX_FILE_LINES && cap === undefined) {
      errors.push(`${file} 実質の行 ${lines} が ${MAX_FILE_LINES} を越える（例外の表に無い）`);
    } else if (cap !== undefined && lines > cap) {
      errors.push(`${file} 実質の行 ${lines} が例外の表の上限 ${cap} を越えた`);
    } else if (cap !== undefined && lines < cap) {
      // 上限を残すと、分けた後に戻しても通る（減る向きだけが名前だけになる）。縮めた PR の中で表も縮める
      errors.push(`${file} 実質の行 ${lines} が例外の表の上限 ${cap} より少ない（上限を ${lines > MAX_FILE_LINES ? lines : "行ごと消す"} へ）`);
    }
  }
  for (const file of Object.keys(caps).filter((f) => files[f] === undefined)) {
    errors.push(`${file} 例外の表にあるがファイルが無い（行を消す）`);
  }
  return { errors, warnings, skipped };
}

/** 例外の表は減る向きだけ: base に無い path・上限の引き上げは赤 */
export function sizeExceptionsGrowth(baseExceptions, headExceptions) {
  const before = baseExceptions?.files ?? {};
  return Object.entries(headExceptions?.files ?? {}).flatMap(([file, cap]) =>
    before[file] === undefined
      ? [`大きさの例外の表に行を足した: ${file}`]
      : cap > before[file]
        ? [`大きさの例外の表の上限を上げた: ${file} ${before[file]} → ${cap}`]
        : [],
  );
}
