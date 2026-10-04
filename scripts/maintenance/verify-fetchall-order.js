/**
 * verify-fetchall-order.js - 共通の fetchAll（scripts/lib/supabaseClient.js）が、並び順の無いページ送りをしないこと（BOA-753）
 *
 * fetchAll は .range() で1000行ずつページ送りする。並び順（.order()）が無いと、PostgREST は行の順を決めないので、
 * 1000行を超える読み取りでページの間に行の重複・欠落が起きうる（BOA-595・BOA-745 で同じ型を個別に直し、3回目で仕組みにした）。
 *
 *   (a) 静的: scripts/・api/ で supabaseClient.js から import した fetchAll の呼び出しすべてが、次のどれかを満たす
 *       - 組み立て関数（第3引数）の中に .order( がある
 *       - 組み立てが変数・関数呼び出しなら、同じファイルのその定義の中に .order( がある
 *       - オプションに unordered: "<理由>"（空でない文字列）がある
 *   (b) 実行時: 並び順の無いクエリは、最初のリクエストの前に例外になる（呼び出し元と直し方を書く）。理由が空の unordered も例外。
 *       並び順付き・理由付きの unordered は、並び順の検査を通る
 *   (c) 変異検証: 静的検査が、並び順の無い呼び出し・定義に並び順の無い変数・空の理由を見逃さない
 *
 * 実行: node scripts/maintenance/verify-fetchall-order.js
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { fetchAll } from "../lib/supabaseClient.js";

const require = createRequire(import.meta.url);
const espree = require("espree");
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CLIENT_MODULE = "scripts/lib/supabaseClient.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n${detail}` : ""}`);
  }
}

const parse = (src) =>
  espree.parse(src, {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
    range: true,
    loc: true,
  });

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value.type === "string") walk(value, visit);
  }
}

/** ファイル内で名前 → 定義（変数の初期値・関数宣言）のソース */
function definitions(ast, src) {
  const defs = new Map();
  walk(ast, (node) => {
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init
    ) {
      defs.set(node.id.name, src.slice(...node.init.range));
    }
    if (node.type === "FunctionDeclaration" && node.id) {
      defs.set(node.id.name, src.slice(...node.range));
    }
  });
  return defs;
}

/**
 * 1ファイルの fetchAll の呼び出しを検査する（純関数）。
 * @param {string} src ソース
 * @param {string} file リポジトリからの相対パス（import の解決に使う）
 * @returns {Array<{line: number, table: string, problem: string}>} 並び順の無い呼び出し
 */
export function findUnorderedCalls(src, file) {
  if (!src.includes("fetchAll")) return [];
  const ast = parse(src);
  const names = new Set();
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue;
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), node.source.value),
    );
    if (resolved !== CLIENT_MODULE) continue;
    for (const spec of node.specifiers) {
      if (spec.imported?.name === "fetchAll") names.add(spec.local.name);
    }
  }
  // const { fetchAll } = await import(".../supabaseClient.js")（ビルド時の generate-sitemap.js 等）
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.id.type !== "ObjectPattern")
      return;
    const init =
      node.init?.type === "AwaitExpression" ? node.init.argument : node.init;
    if (init?.type !== "ImportExpression" || init.source.type !== "Literal")
      return;
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), init.source.value),
    );
    if (resolved !== CLIENT_MODULE) return;
    for (const prop of node.id.properties) {
      if (prop.key?.name === "fetchAll" && prop.value?.type === "Identifier") {
        names.add(prop.value.name);
      }
    }
  });
  if (names.size === 0) return [];
  const defs = definitions(ast, src);
  const problems = [];
  walk(ast, (node) => {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "Identifier" ||
      !names.has(node.callee.name)
    ) {
      return;
    }
    const [table, , build, options] = node.arguments;
    const tableText = table ? src.slice(...table.range) : "?";
    const reason =
      options?.type === "ObjectExpression"
        ? options.properties.find((p) => p.key?.name === "unordered")
        : null;
    if (reason) {
      const ok =
        reason.value.type === "Literal" &&
        typeof reason.value.value === "string" &&
        reason.value.value.trim() !== "";
      if (!ok) {
        problems.push({
          line: node.loc.start.line,
          table: tableText,
          problem: "unordered に理由（空でない文字列）が無い",
        });
      }
      return;
    }
    let text = null;
    if (
      build &&
      (build.type === "ArrowFunctionExpression" ||
        build.type === "FunctionExpression")
    ) {
      text = src.slice(...build.range);
    } else if (build?.type === "Identifier") {
      text = defs.get(build.name) ?? null;
    } else if (
      build?.type === "CallExpression" &&
      build.callee.type === "Identifier"
    ) {
      text = defs.get(build.callee.name) ?? null;
    }
    if (text === null) {
      problems.push({
        line: node.loc.start.line,
        table: tableText,
        problem: build
          ? `組み立て（${src.slice(...build.range).slice(0, 40)}）の定義が同じファイルに無く、並び順を確かめられない`
          : "組み立て（第3引数）が無い",
      });
    } else if (!/\.order\(/.test(text)) {
      problems.push({
        line: node.loc.start.line,
        table: tableText,
        problem: "組み立てに .order( が無い",
      });
    }
  });
  return problems;
}

// (a) 静的: リポジトリ全体
const files = execSync("git ls-files scripts api", { cwd: ROOT })
  .toString()
  .trim()
  .split("\n")
  .filter((f) => /\.(m?js|jsx)$/.test(f) && !f.includes("__fixtures__"));
const found = [];
let calls = 0;
for (const file of files) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (!src.includes("fetchAll")) continue;
  calls += (src.match(/\bfetchAll\(/g) ?? []).length;
  for (const p of findUnorderedCalls(src, file))
    found.push(`${file}:${p.line} ${p.table}: ${p.problem}`);
}
check(
  `(a) 静的: fetchAll の呼び出しすべてに並び順（.order）か理由付きの unordered がある（fetchAll( の出現 ${calls}か所を検査）`,
  found.length === 0,
  found.map((l) => `  ${l}`).join("\n") +
    (found.length
      ? '\n  直し方: 主キーの .order() を付ける（例: (q) => q.order("race_id")）'
      : ""),
);

// (b) 実行時: URL を持つ本物のクエリビルダーで、リクエストの前に止まることを確かめる（接続先は無い）
const client = createClient("http://127.0.0.1:1", "test-key");
async function errorOf(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}
const unorderedError = await errorOf(() =>
  fetchAll("races", "race_id", (q) => q.eq("race_date", "2026-10-03"), {
    client,
  }),
);
check(
  "(b) 実行時: 並び順の無いクエリは、リクエストの前に例外になる（BOA-753・呼び出し元・直し方を書く）",
  unorderedError !== null &&
    /BOA-753/.test(unorderedError.message) &&
    /呼び出し元: .*verify-fetchall-order\.js/.test(unorderedError.message) &&
    /\.order\(/.test(unorderedError.message),
  unorderedError?.message,
);
const noBuildError = await errorOf(() =>
  fetchAll("races", "race_id", undefined, { client }),
);
check(
  "(b) 実行時: 組み立てが無い呼び出しも、並び順なしとして例外になる",
  noBuildError !== null && /BOA-753/.test(noBuildError.message),
  noBuildError?.message,
);
const orderedError = await errorOf(() =>
  fetchAll("races", "race_id", (q) => q.order("race_id"), { client }),
);
check(
  "(b) 実行時: 並び順付きなら並び順の検査は通る（接続先が無いので、その後の取得エラーになる）",
  orderedError !== null && !/BOA-753/.test(orderedError.message),
  orderedError?.message,
);
const optOutError = await errorOf(() =>
  fetchAll("races", "race_id", undefined, {
    client,
    unordered: "テストの理由",
  }),
);
check(
  "(b) 実行時: 理由付きの unordered は並び順の検査を通る",
  optOutError !== null && !/BOA-753/.test(optOutError.message),
  optOutError?.message,
);
const emptyReasonError = await errorOf(() =>
  fetchAll("races", "race_id", undefined, { client, unordered: " " }),
);
check(
  "(b) 実行時: 理由が空の unordered は例外になる",
  emptyReasonError !== null && /理由/.test(emptyReasonError.message),
  emptyReasonError?.message,
);

// (c) 変異検証: 静的検査が見逃さない
const IMPORT = 'import { fetchAll } from "../lib/supabaseClient.js";\n';
const FILE = "scripts/daily/x.js";
const cases = [
  [
    "並び順のある組み立て",
    'await fetchAll("races", "race_id", (q) => q.eq("a", 1).order("race_id"));',
    0,
  ],
  [
    "並び順の無い組み立て",
    'await fetchAll("races", "race_id", (q) => q.eq("a", 1));',
    1,
  ],
  ["組み立てが無い", 'await fetchAll("races", "race_id");', 1],
  [
    "変数の定義に並び順がある",
    'const b = (q) => q.order("race_id");\nawait fetchAll("races", "race_id", b);',
    0,
  ],
  [
    "変数の定義に並び順が無い",
    'const b = (q) => q.eq("a", 1);\nawait fetchAll("races", "race_id", b);',
    1,
  ],
  [
    "関数呼び出しの定義に並び順がある",
    'const inDay = (d) => (q) => q.gte("race_id", d).order("race_id");\nawait fetchAll("races", "race_id", inDay("x"));',
    0,
  ],
  [
    "理由付きの unordered",
    'await fetchAll("t", "id", null, { unordered: "偽のクライアント" });',
    0,
  ],
  [
    "理由が空の unordered",
    'await fetchAll("t", "id", null, { unordered: "" });',
    1,
  ],
  [
    "動的 import（await import）で取り出した fetchAll も対象",
    'const { fetchAll: fa } = await import("../lib/supabaseClient.js");\nawait fa("races", "race_id", (q) => q.eq("a", 1));',
    1,
  ],
  [
    "別名の import",
    'import { fetchAll as fa } from "../lib/supabaseClient.js";\nawait fa("races", "race_id", (q) => q);',
    1,
  ],
];
for (const [label, body, expected] of cases) {
  const src = body.startsWith("import") ? body : IMPORT + body;
  const got = findUnorderedCalls(src, FILE).length;
  check(
    `(c) 静的検査: ${label} → 指摘 ${expected}件`,
    got === expected,
    `実際 ${got}件`,
  );
}
check(
  "(c) 静的検査: 別のモジュールの fetchAll（自前の関数）は対象にしない",
  findUnorderedCalls(
    'async function fetchAll() {}\nawait fetchAll("races", "race_id");',
    FILE,
  ).length === 0,
);

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
