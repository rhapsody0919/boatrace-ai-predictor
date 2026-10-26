#!/usr/bin/env node
/**
 * PR の差分から、PR ゲートの e2e をどこまで流すかを決める（BOA-929、ADR は e2e-smoke-test.yml の冒頭を参照）。
 *
 *   none  全ファイルが e2eSkipPathPatterns（docs/ だけ。docs/content-manifests は除く）に当たる。e2e を流さずに成功
 *   light 全ファイルが allowedPathPatterns（記事の中身だけの PR の許可の一覧）か e2eSkipPathPatterns に当たる。
 *         vite build と @blog の印の試験だけを流す
 *   full  それ以外。1つでも一覧から外れたら全部流す（.github・scripts・src・e2e・package*.json・設定は一覧に無いので必ず full）
 *
 * 一覧は scripts/content/content-pr-gate.json を読む（写さない）。PR の側でこのファイルやこのスクリプトを
 * 書き換えて軽い組に逃げられないよう、ワークフローは base（master）側の2つを取り出して実行し、
 * マージ時は guard-pr-merge.js が master の一覧でもう一度判定する。
 * そのため、このファイルは node の組み込み以外を import しない（単独で取り出して動かすため）。
 *
 * 例外（オーナー決定 2026-10-26）: 記事の PR は、免除の一覧（content-pr-gate.json の internalLinkGrandfathered）から
 * 行を外すだけの変更を同じ PR に含めてよい。その変更は一覧の外（scripts/）でも軽い組のまま扱う。
 * 判定は base と HEAD の設定を JSON で比べる（grandfatherRemovals）。HEAD は CI のチェックアウト（base と
 * PR のマージコミット）を git show で読む。読めない・削除だけでないときは今までどおり full。
 * 一覧は e2e の結果に効かない（e2e・src は読まない）ので、軽い組で足りる。
 *
 * 使い方（CI）:
 *   node e2e-scope.mjs --config <content-pr-gate.json> --files <改行区切りのパス一覧>
 *   → 標準出力に scope=<none|light|full> を1行出す（$GITHUB_OUTPUT に足す）。理由は標準エラー
 *
 * 検証: scripts/maintenance/verify-e2e-scope.js
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toRegexps = (patterns, key) => {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`content-pr-gate.json の ${key} が空か配列ではありません`);
  }
  return patterns.map((p) => new RegExp(p));
};

export const GATE_CONFIG_PATH = "scripts/content/content-pr-gate.json";
const GRANDFATHERED_KEY = "internalLinkGrandfathered";
const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * base から HEAD への設定の変更が、internalLinkGrandfathered から行を外すだけか（純関数）。
 * そうなら外した行の一覧（1行以上）、違えば null。一覧の外のキー・キーの順・残った行の順が変わる、
 * 行を足す・重複させる、外した行が無い（整形だけ）は null。記事の PR の関門（scripts/lib/contentPrGate.js）も使う
 */
export function grandfatherRemovals(baseConfig, headConfig) {
  if (!isPlainObject(baseConfig) || !isPlainObject(headConfig)) return null;
  const before = baseConfig[GRANDFATHERED_KEY];
  const after = headConfig[GRANDFATHERED_KEY];
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const kept = new Set(after);
  const removed = before.filter((p) => !kept.has(p));
  if (removed.length === 0) return null;
  const expected = {
    ...baseConfig,
    [GRANDFATHERED_KEY]: before.filter((p) => kept.has(p)),
  };
  return JSON.stringify(expected) === JSON.stringify(headConfig)
    ? removed
    : null;
}

/**
 * 差分のパス一覧と設定から、流す範囲を決める（純関数）。
 * 空の差分は判定の材料が無いので full に倒す。
 * gateConfigRemovalOnly: 設定（GATE_CONFIG_PATH）の変更が免除の一覧から外すだけと確かめたとき true。
 * そのときだけ設定のパスを軽い組の一覧に当たるものとして扱う（既定は false で、設定を触る PR は full）
 * @returns {{ scope: "none" | "light" | "full", outside: string[] }} outside は一覧から外れたパス（full の理由）
 */
export function classifyE2eScope(
  files,
  config,
  { gateConfigRemovalOnly = false } = {},
) {
  const light = toRegexps(config?.allowedPathPatterns, "allowedPathPatterns");
  const skip = toRegexps(config?.e2eSkipPathPatterns, "e2eSkipPathPatterns");
  const paths = [...new Set(files.map((f) => f.trim()).filter(Boolean))];
  if (paths.length === 0) return { scope: "full", outside: [] };
  const matches = (res, p) => res.some((re) => re.test(p));
  if (paths.every((p) => matches(skip, p)))
    return { scope: "none", outside: [] };
  const outside = paths.filter(
    (p) =>
      !matches(light, p) &&
      !matches(skip, p) &&
      !(gateConfigRemovalOnly && p === GATE_CONFIG_PATH),
  );
  return { scope: outside.length === 0 ? "light" : "full", outside };
}

/**
 * CI のチェックアウト（HEAD は base と PR のマージコミット）の設定が、base の設定から免除の一覧を外すだけか。
 * 読めない・壊れているときは false（full に倒す）
 */
function headGateConfigRemovalOnly(baseConfig) {
  try {
    const head = JSON.parse(
      execFileSync("git", ["show", `HEAD:${GATE_CONFIG_PATH}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    return grandfatherRemovals(baseConfig, head) !== null;
  } catch (error) {
    console.error(
      `HEAD の ${GATE_CONFIG_PATH} を読めないため、設定の変更は全部流す側で扱います: ${error.message}`,
    );
    return false;
  }
}

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) throw new Error(`--${name} <パス> を指定してください`);
  return value;
}

function main() {
  let result;
  let files;
  try {
    const config = JSON.parse(readFileSync(argOf("config"), "utf8"));
    files = readFileSync(argOf("files"), "utf8").split("\n");
    const gateConfigRemovalOnly =
      files.some((f) => f.trim() === GATE_CONFIG_PATH) &&
      headGateConfigRemovalOnly(config);
    result = classifyE2eScope(files, config, { gateConfigRemovalOnly });
  } catch (error) {
    // 判定できないときは全部流す側に倒す（軽い組に倒すと退行を見逃す）
    console.error(`e2e の範囲を判定できないため全部流します: ${error.message}`);
    console.log("scope=full");
    return;
  }
  const count = files.filter((f) => f.trim()).length;
  console.error(`差分 ${count} ファイル → ${result.scope}`);
  for (const p of result.outside.slice(0, 20))
    console.error(`  一覧の外: ${p}`);
  console.log(`scope=${result.scope}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
