/**
 * lintDepTree.js - lint-changed --ci の依存の向きの関所（BOA-1435、BOA-1425 を割った 2/2）。
 * dependency-cruiser を base と HEAD に回し、違反(HEAD) − 違反(base) が空かを見る。
 * 加えて no-circular の全体 0・facade-frozen の warn→error の切り替え・src/utils の新しいファイルの禁止。
 *
 * base の worktree には node_modules が無い。外の包み（npm の名前の import）は解けないが、
 * 規則は相対 import の辺（src・scripts・api の中）だけを見るので比べる辺には影響しない。
 * 外の包みの解けなさは「パースの失敗」に数えない（数えるのは相対 import が解けないものだけ）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import {
  DATA_LAYER_KEY,
  FACADE,
  compareEdgesToBaseline,
  facadeShouldBeError,
  isDataLayer,
  newUtilsFileProblems,
} from "./lintBaselines.js";

const require = createRequire(import.meta.url);
const { DEPENDENCY_CRUISER, forbidden, options } = require("./dependency-rules.cjs");

const DIRS = ["src", "scripts", "api"];
const JS_EXT = /\.(js|jsx|mjs|cjs)$/;
const SKIP = /(^|\/)(node_modules|dist|sns-video-studio)(\/|$)/;
const CIRCULAR = "no-circular";
const FROZEN = "facade-frozen";

const git = (cwd, ...a) =>
  execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 28 }).trimEnd();

/** 辺の JSON（dependency-cruiser の出力）→ { edges, modules, unresolvedRelative } */
export function edgesOfCruise(json) {
  const violations = json?.summary?.violations ?? [];
  const edges = violations.map((v) => ({
    from: v.from,
    to: v.to,
    rule: v.rule?.name,
  }));
  const modules = json?.modules ?? [];
  const unresolvedRelative = modules.flatMap((m) =>
    (m.dependencies ?? [])
      .filter((d) => d.couldNotResolve && String(d.module).startsWith("."))
      .map((d) => `${m.source} → ${d.module}`),
  );
  return { edges, modules: modules.length, unresolvedRelative };
}

/** 規則ごとの辺の数 */
export function countByRule(edges) {
  const counts = {};
  for (const { rule } of edges) counts[rule] = (counts[rule] ?? 0) + 1;
  return counts;
}

/** 辺 a のうち b に無いもの（from・to・rule が同じなら同じ辺） */
export function subtractEdges(a, b) {
  const key = (e) => `${e.rule}\t${e.from}\t${e.to}`;
  const seen = new Set(b.map(key));
  return a.filter((e) => !seen.has(key(e)));
}

/** 辺 → 基準の形 { rule: { from: [to] } } */
export function baselineOfEdges(edges) {
  const out = {};
  for (const { rule, from: file, to } of edges) {
    const from = isDataLayer(file) ? DATA_LAYER_KEY : file;
    out[rule] ??= {};
    out[rule][from] ??= [];
    if (!out[rule][from].includes(to)) out[rule][from].push(to);
  }
  return out;
}

const countFunctions = (node) => {
  if (!node || typeof node.type !== "string") return 0;
  let n = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)
    ? 1
    : 0;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) n += value.reduce((s, c) => s + countFunctions(c), 0);
    else if (value && typeof value === "object") n += countFunctions(value);
  }
  return n;
};

/** facade の関数の本体の数。読めなければ Infinity（殻とは見なさない） */
export function facadeFunctionCount(cwd) {
  try {
    const src = fs.readFileSync(path.join(cwd, FACADE), "utf8");
    return countFunctions(
      parse(src, { ecmaVersion: "latest", sourceType: "module" }),
    );
  } catch {
    return Infinity;
  }
}

const jsFileCount = (cwd) =>
  git(cwd, "ls-files", "--", ...DIRS)
    .split("\n")
    .filter((f) => JS_EXT.test(f) && !SKIP.test(f)).length;

/** 規則の宣言だけの一時の設定（DEPENDENCY_CRUISER の定数は設定の外に出す） */
function writeConfig(dir) {
  const file = path.join(dir, "dependency-rules.json");
  fs.writeFileSync(file, JSON.stringify({ forbidden, options }));
  return file;
}

/**
 * dependency-cruiser の bin（このスクリプトの側の node_modules の物）。base の worktree には node_modules が
 * 無いので npx に頼らず、HEAD の devDependencies の固定の版を node で直に起こす（CI03・BOA-1492）。版が違えば止める
 */
function cruiserBin() {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../node_modules/dependency-cruiser",
  );
  const want = DEPENDENCY_CRUISER.split("@").pop();
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  if (pkg.version !== want) {
    throw new Error(
      `dependency-cruiser の版が ${pkg.version}（固定は ${want}）。npm ci をやり直す`,
    );
  }
  return path.join(dir, pkg.bin.depcruise);
}

function cruise(cwd, config, tmp, label) {
  const out = path.join(tmp, `${label}.json`);
  const fd = fs.openSync(out, "w");
  const res = spawnSync(
    process.execPath,
    [
      cruiserBin(),
      "--config",
      config,
      "--output-type",
      "json",
      ...DIRS.filter((d) => fs.existsSync(path.join(cwd, d))),
    ],
    { cwd, stdio: ["ignore", fd, "inherit"] },
  );
  fs.closeSync(fd);
  try {
    return { json: JSON.parse(fs.readFileSync(out, "utf8")), status: res.status };
  } catch (e) {
    throw new Error(
      `${label}: dependency-cruiser の結果が読めない（終了コード ${res.status}）: ${e.message}`,
    );
  }
}

// 黙った 0 を緑にしない: モジュールの数が JS の数の半分未満・相対 import の解けなさは赤
function sanity(label, cwd, result, errors) {
  const jsCount = jsFileCount(cwd);
  if (result.modules * 2 < jsCount) {
    errors.push(
      `依存の向き(${label}): モジュール ${result.modules} が JS ${jsCount} の半分未満（パースの失敗の疑い）`,
    );
  }
  for (const u of result.unresolvedRelative.slice(0, 5)) {
    errors.push(`依存の向き(${label}): 相対の import が解けない ${u}`);
  }
}

function withBaseTree(root, sha, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-deptree-base-"));
  const wt = path.join(dir, "wt");
  try {
    git(root, "worktree", "add", "--detach", "--no-checkout", wt, sha);
    git(wt, "checkout", sha, "--", ...DIRS);
    return fn(wt, dir);
  } finally {
    try {
      git(root, "worktree", "remove", "--force", wt);
    } catch {
      // worktree が作れなかったときは消すものが無い
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const formatCounts = (counts) =>
  Object.entries(counts)
    .map(([r, n]) => `${r}=${n}`)
    .join(" ") || "違反なし";

/**
 * @returns {{ errors: string[], warnings: string[], log: string[] }}
 */
export function runDepTreeGate({ cwd, base, changed }) {
  const errors = [];
  const warnings = [];
  const log = [];

  const addedPaths = changed.filter((c) => c.added).map((c) => c.file);
  errors.push(...newUtilsFileProblems(addedPaths));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-deptree-"));
  try {
    const config = writeConfig(tmp);
    const head = edgesOfCruise(cruise(cwd, config, tmp, "HEAD").json);
    const baseRes = withBaseTree(cwd, base, (wt) =>
      edgesOfCruise(cruise(wt, config, tmp, "base").json),
    );
    sanity("HEAD", cwd, head, errors);
    log.push(
      `依存の向き: base ${base} と比べた。HEAD の違反 ${formatCounts(countByRule(head.edges))}／base の違反 ${formatCounts(countByRule(baseRes.edges))}／モジュール HEAD ${head.modules}・base ${baseRes.modules}`,
    );

    const cycles = head.edges.filter((e) => e.rule === CIRCULAR);
    cycles.forEach((e) => errors.push(`循環の import(no-circular): ${e.from} → ${e.to}`));

    const frozenIsError = facadeShouldBeError(facadeFunctionCount(cwd));
    log.push(`facade-frozen: ${frozenIsError ? "error（殻だけ）" : "warn（関数の本体が残る）"}`);

    const diff = (rule) =>
      subtractEdges(
        head.edges.filter((e) => e.rule === rule),
        baseRes.edges.filter((e) => e.rule === rule),
      );
    const rules = [...new Set(head.edges.map((e) => e.rule))].filter(
      (r) => r !== CIRCULAR,
    );
    for (const rule of rules) {
      const extra = diff(rule);
      if (extra.length === 0) continue;
      const target = rule === FROZEN && !frozenIsError ? warnings : errors;
      // データ層の和は from を1つにまとめ、base の違反の to の集合を越えた分だけ見る
      const baseline = baselineOfEdges(baseRes.edges.filter((e) => e.rule === rule));
      compareEdgesToBaseline(extra, baseline).problems.forEach((p) =>
        target.push(`依存の向き ${p}`),
      );
    }
  } catch (e) {
    errors.push(`依存の向き: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { errors, warnings, log };
}
