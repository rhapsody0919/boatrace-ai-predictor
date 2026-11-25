/**
 * lintDepTree.js - lint-changed --ci の依存の向きの関所（BOA-1435、BOA-1425 を割った 2/2）。
 * dependency-cruiser を HEAD に回し、違反の辺が全部 dependency-exceptions.json（減る向きだけ）にあるかを見る
 * （2026-11-25 に base との差から全体で0＋例外の表へ）。加えて no-circular の全体 0・src/utils の新しいファイルの禁止。
 * 外の包みの解けなさは「パースの失敗」に数えない（数えるのは相対 import が解けないものだけ）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  DATA_LAYER_KEY,
  compareBaselines,
  isDataLayer,
  judgeAgainstExceptions,
  newServicesFileProblems,
  newUtilsFileProblems,
} from "./lintBaselines.js";

export const EXCEPTIONS_PATH = "scripts/maintenance/dependency-exceptions.json";

const require = createRequire(import.meta.url);
const { DEPENDENCY_CRUISER, forbidden, options } = require("./dependency-rules.cjs");

const DIRS = ["src", "scripts", "api"];
const JS_EXT = /\.(js|jsx|mjs|cjs)$/;
const SKIP = /(^|\/)(node_modules|dist|sns-video-studio)(\/|$)/;
const CIRCULAR = "no-circular";

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

/** 辺 → 基準の形 { rule: { from: [to] } }（和の中の from は1つにまとめる。今の関所は使わず、試験だけが読む。消すのは別の PR） */
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

const formatCounts = (counts) =>
  Object.entries(counts)
    .map(([r, n]) => `${r}=${n}`)
    .join(" ") || "違反なし";

/** base の例外の表。base の木に無いとき（表を足す PR）だけ null。ほかの失敗は throw して赤にする */
function readBaseExceptions(cwd, base) {
  const has = spawnSync("git", ["cat-file", "-e", `${base}:${EXCEPTIONS_PATH}`], { cwd }).status === 0;
  if (!has) {
    git(cwd, "rev-parse", "--verify", `${base}^{commit}`); // base そのものが読めないなら throw
    return null;
  }
  return JSON.parse(git(cwd, "show", `${base}:${EXCEPTIONS_PATH}`)).edges;
}

/**
 * 全体で0の関所（2026-11-25、点検の案 B-1）。HEAD だけに dependency-cruiser を回し、
 * 違反の辺が例外の表 dependency-exceptions.json にちょうどあるかを見る（ADR-0110）。表は減る向きだけ（base の表より行が増えたら赤）、
 * 今は違反でない行が残っても赤。
 * 以前は base と HEAD の違反の差で見ていたので、master に一度入った違反がそのまま基準になった。
 * @returns {{ errors: string[], warnings: string[], log: string[] }}
 */
export function runDepTreeGate({ cwd, base, changed }) {
  const errors = [];
  const warnings = [];
  const log = [];

  const addedPaths = changed.filter((c) => c.added).map((c) => c.file);
  errors.push(...newUtilsFileProblems(addedPaths));
  errors.push(...newServicesFileProblems(addedPaths));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-deptree-"));
  try {
    const config = writeConfig(tmp);
    const head = edgesOfCruise(cruise(cwd, config, tmp, "HEAD").json);
    sanity("HEAD", cwd, head, errors);
    const exceptions = JSON.parse(
      fs.readFileSync(path.join(cwd, EXCEPTIONS_PATH), "utf8"),
    ).edges;
    log.push(
      `依存の向き: HEAD の違反 ${formatCounts(countByRule(head.edges))}／モジュール ${head.modules}／例外の表 ${EXCEPTIONS_PATH}`,
    );

    head.edges
      .filter((e) => e.rule === CIRCULAR)
      .forEach((e) => errors.push(`循環の import(no-circular): ${e.from} → ${e.to}`));

    const judged = judgeAgainstExceptions(
      head.edges.filter((e) => e.rule !== CIRCULAR),
      exceptions,
    );
    judged.problems.forEach((p) => errors.push(`依存の向き ${p}`));
    // 消せる行を残すと、直した違反を後で戻しても通る（減る向きだけが名前だけになる）。直した PR の中で表も縮める
    judged.stale.forEach((r) =>
      errors.push(`依存の向き: 例外の表の行が今は違反でない（この PR で行を消す）: ${r}`),
    );

    const baseExceptions = readBaseExceptions(cwd, base);
    if (baseExceptions === null) {
      log.push(`依存の向き: base ${base} に例外の表が無い（表を足す PR）。表の増えは見ない`);
    } else {
      compareBaselines(baseExceptions, exceptions).problems.forEach((p) =>
        errors.push(`依存の向き: 例外の表は減る向きだけ。${p}`),
      );
    }
  } catch (e) {
    errors.push(`依存の向き: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { errors, warnings, log };
}
