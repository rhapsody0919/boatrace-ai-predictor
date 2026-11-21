/**
 * pr-lane.js の部品: 規則の読みと判定の本体 classify（git に触れない）。git から読む部分と CLI は pr-lane.js。
 * Node の組み込みと相対の import だけ。hq の写しの一覧に入る（pr-lane.js の頭の注釈）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE, reach } from "../lib/relativeImportGraph.js";
import { count, withoutMovedLines, globalSelectors } from "./prLaneLines.js";
import { anyMatch, explain } from "./prLaneHuman.js";

const SELF_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** コミットの木を辿るときの仮の絶対パスの根（手元のファイルと混ざらないよう実在しない名前にする） */
export const TREE_ROOT = "/__pr_lane_tree__";

/**
 * 規則を読む（risk-rules の platforms: all の語を H9 に足す）。
 * config/pr-path-rules.json はこのスクリプトの隣から読む（hq の写しは pr-lane.js・規則・relativeImportGraph.js だけを持つ）。
 * risk-rules.json は readRisk で読む。CLI は判定する repo の merge-base の木から読む（PR 自身が語を消して軽くできないように）
 */
export function loadRules(
  root = SELF_ROOT,
  readRisk = (p) => readFileSync(join(root, p), "utf8"),
) {
  const config = JSON.parse(
    readFileSync(join(root, "config/pr-path-rules.json"), "utf8"),
  );
  return config.rules.map((rule) => {
    if (!rule.terms) return rule;
    const risk = rule.terms.riskRules
      ? JSON.parse(readRisk(rule.terms.riskRules))
      : { rules: [] };
    const fromRisk = risk.rules
      .filter((r) => r.platforms === "all")
      .flatMap((r) => r.patterns);
    return {
      ...rule,
      terms: {
        ...rule.terms,
        words: [...new Set([...rule.terms.words, ...fromRisk])],
      },
    };
  });
}

/** config/pr-path-rules.json の moveOnly（移すだけの判定の from・to。無ければ undefined） */
export function loadMoveOnly(root = SELF_ROOT) {
  return JSON.parse(readFileSync(join(root, "config/pr-path-rules.json"), "utf8"))
    .moveOnly;
}

/** config/pr-path-rules.json の human（人にしか判断できない理由の kind ごとの型） */
export function loadHuman(root = SELF_ROOT) {
  return JSON.parse(readFileSync(join(root, "config/pr-path-rules.json"), "utf8"))
    .human;
}

/**
 * 語を見るファイル（withoutMovedLines の移し元・移し先の候補）。この規則が見ないファイル（except・移すだけで外すファイル）は
 * 候補にしない（外れたファイルが移し元の席を取り、別のファイルの新しい語を通すのを防ぐ）
 */
const termPaths = (rule, changes, moved) =>
  changes
    .map((c) => c.path)
    .filter(
      (p) =>
        anyMatch(rule.terms.scan, p) &&
        !anyMatch(rule.terms.except, p) &&
        !anyMatch(rule.except, p) &&
        !(rule.exceptMoveOnly && moved.has(p)),
    );

/**
 * import の閉包: reachFrom の入口から届く差分のファイル → 経路
 * @param {{ files: string[], io: import("../lib/relativeImportGraph.js").GraphIo }[]} trees
 * @returns {Map<string, string>} 差分のファイル → 理由
 */
function reachedFiles(entryPatterns, trees, changedSet) {
  const found = new Map();
  for (const tree of trees) {
    const starts = tree.files
      .filter(
        (f) =>
          CODE.test(f) &&
          !/(^|\/)node_modules\//.test(f) &&
          anyMatch(entryPatterns, f),
      )
      .map((f) => `${TREE_ROOT}/${f}`);
    const { via, missing } = reach(starts, tree.io);
    const rel = (p) => p.slice(TREE_ROOT.length + 1);
    for (const [abs, path] of via) {
      const file = rel(abs);
      if (changedSet.has(file) && !found.has(file))
        found.set(file, `入口から届く: ${path.map(rel).join(" → ")}`);
    }
    // 差分のファイル自身の import の行き先が見つからないときは、届く先を確かめられないので当てる（安全側）
    for (const m of missing) {
      const file = rel(m.from);
      if (changedSet.has(file) && via.has(m.from) && !found.has(file))
        found.set(file, `参照先が見つからない import（安全側）: ${m.spec}`);
    }
  }
  return found;
}

/** パス・追加・変更の型の当たりの理由（元の順: パス → 新しいファイル → 既存のファイルの変更・削除。当たらない物は falsy） */
function pathReasons(rule, { status, path }) {
  const added = status === "A";
  const p = (rule.paths ?? []).find((re) => new RegExp(re).test(path));
  const a =
    added && (rule.added ?? []).find((re) => new RegExp(re).test(path));
  const c =
    !added && (rule.changed ?? []).find((re) => new RegExp(re).test(path));
  return [
    p && `パス ${p}`,
    a && `新しいファイル ${a}`,
    c && `既存のファイルの変更・削除 ${c}`,
  ];
}

/** rowsOnlyAdded: 行の追加だけでない（既存の行を変えた・消した）ときの理由 */
function rowsReason(rule, { status, path }, patches) {
  if (!anyMatch(rule.rowsOnlyAdded, path)) return null;
  const patch = patches.get(path);
  // 配列の末尾に足すと前の行の "}" が "}," に変わる。この形の消した行は書き換えに数えない
  const removed = patch?.removed.filter(
    (line) => !patch.added.includes(`${line},`),
  );
  return status === "D" || removed === undefined || removed.length > 0
    ? "既存の行を変えた・消した（行の追加だけではない）"
    : null;
}

/** 既存の .css は changed で当てるので、全体のセレクタは新しいファイル（中身が全部足した行）だけで見る */
function selectorReason(rule, { status, path }, patches) {
  if (status !== "A" || !anyMatch(rule.globalSelectors, path)) return null;
  const patch = patches.get(path);
  if (!patch) return "差分の行を読めない（安全側）";
  const found = globalSelectors(patch.added);
  return found.length > 0
    ? `全体に効くセレクタ: ${found.join("・")}`
    : null;
}

/** 語（H9）: 足した行に新しく入った語の理由 */
function termReason(rule, { path }, patches, termLines) {
  if (
    !rule.terms ||
    !anyMatch(rule.terms.scan, path) ||
    anyMatch(rule.terms.except, path)
  )
    return null;
  // 行を読めないときは語を確かめられないので当てる（安全側。rowsOnlyAdded と同じ）
  if (!patches.get(path)) return "差分の行を読めない（安全側）";
  // 別のファイルから字のまま移した行は数えない（withoutMovedLines）。語の一覧は merge-base の木から読んだ物
  const lines = termLines.get(path);
  const fresh = rule.terms.words.filter(
    (w) => count(lines.added, w) > count(lines.removed, w),
  );
  return fresh.length > 0
    ? `足した行に新しく入った語: ${fresh.join("・")}`
    : null;
}

/** この規則が、このファイルを見ない（except・追加の except・移すだけ） */
function skipped(rule, { status, path }, moved) {
  if (anyMatch(rule.except, path)) return true;
  if (status === "A" && anyMatch(rule.exceptAdded, path)) return true;
  // 移すだけ（moveOnlyPaths）と分かったデータ層のファイルは、H3（数字の定義）と H9（語が新しく入る）を外す
  return Boolean(rule.exceptMoveOnly && moved.has(path));
}

/** 1つの規則の当たり（[ファイル, 理由] を元の順で: 差分の順にファイルごとの理由、最後に import の閉包） */
function ruleHits(rule, { changes, patches, trees, moved, changedSet }) {
  const termLines = rule.terms
    ? withoutMovedLines(
        patches,
        termPaths(rule, changes, moved),
        rule.terms.words,
      )
    : null;
  const found = [];
  for (const change of changes) {
    if (skipped(rule, change, moved)) continue;
    const reasons = [
      ...pathReasons(rule, change),
      rowsReason(rule, change, patches),
      selectorReason(rule, change, patches),
      termReason(rule, change, patches, termLines),
    ];
    for (const reason of reasons) if (reason) found.push([change.path, reason]);
  }
  if (rule.reachFrom && trees.length > 0)
    found.push(...reachedFiles(rule.reachFrom, trees, changedSet));
  return found;
}

/**
 * 判定の本体（git に触れない）
 * @param {{
 *   changes: { status: string, path: string }[],
 *   patches?: Map<string, { added: string[], removed: string[] }>,
 *   trees?: { files: string[], io: import("../lib/relativeImportGraph.js").GraphIo }[],
 *   rules?: object[],
 * }} input
 * @returns {{ lane: "light"|"heavy", hits: { rule: string, file: string, reason: string }[],
 *   human: { kind: string, file: string, reason: string }[], needs: { kind: string, file: string, rule: string }[] }}
 */
export function classify({
  changes,
  patches = new Map(),
  trees = [],
  rules = loadRules(),
  moved = new Set(),
  human = loadHuman(),
  readBlob = () => null,
}) {
  const changedSet = new Set(changes.map((c) => c.path));
  const hits = [];
  // 同じ規則×ファイルは先の理由が勝つ
  const hit = (rule, file, reason) => {
    if (!hits.some((h) => h.rule === rule.id && h.file === file))
      hits.push({ rule: rule.id, file, reason });
  };
  for (const rule of rules) {
    const ctx = { changes, patches, trees, moved, changedSet };
    for (const [file, reason] of ruleHits(rule, ctx)) hit(rule, file, reason);
  }
  const order = (h) => Number(h.rule.slice(1));
  hits.sort((x, y) => order(x) - order(y) || x.file.localeCompare(y.file));
  const lane = hits.length > 0 ? "heavy" : "light";
  const why =
    lane === "light"
      ? { human: [], needs: [] }
      : explain({ hits, changes, patches, rules, human, readBlob });
  return { lane, hits, ...why };
}

export { SELF_ROOT };
