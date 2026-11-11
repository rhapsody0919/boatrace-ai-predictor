/**
 * lintDuplicates.js - lint-changed.js --ci の jscpd の重なりを、赤と警告に分ける（HR03 第2波 RA11〜13 の詰まりの直し）。
 *
 * 赤: 重なりの片側に差分のファイルがあり、その中に新しいファイルがあるもの（今まで）。
 *     ただし差分の側が全部「移しただけ」のファイル（split-data-layer.mjs の出力そのまま。prLaneMoveOnly.js の
 *     moveOnlyPaths が from と to を返した PR）なら警告に下げる。移した字は base の殻（supabaseDataService.js）の字そのまま
 *     （正規化 this.X→X・メソッドの頭→関数の頭だけ）なので、誰も新しく写していない。正規化で base より重なりが長く見える
 *     ことはありうる（未検証）が、中身の同じコードは base に既にある。
 * 手で足した写しは今までどおり赤: 移すだけの判定は1字・1行でも足すと空集合を返す。to・from でない新しいファイルの側は下げない。
 * 警告: 差分の側が既にあるファイルだけのもの（今まで）。
 * 移すだけの判定は pr-lane.js（H3・H9 を外す）とここの2か所で使う。prLaneMoveOnly.js を直すと両方に効く。
 * 設定（config/pr-path-rules.json の moveOnly）は head の作業ツリーから読む（lint-changed.js 自身も head から走る。
 * 設定は CODEOWNERS と H の対象で、判定は殻の名前と to の頭2行の注釈に固定）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { moveOnlyPaths, moveOnlyReason } from "./prLaneMoveOnly.js";

/** lint-changed.js の changed（{ file, oldFile, added }）を、moveOnlyPaths の changes（{ status, path }）に直す */
export const toChanges = (changed) =>
  changed.map(({ file, oldFile, added }) => ({
    status: added ? "A" : oldFile !== file ? "R" : "M",
    path: file,
  }));

/**
 * 移しただけのファイルの集合。違えば・読めなければ空（下げない＝安全側）
 * @param {{from: string, to: string[]}|undefined} moveOnly config/pr-path-rules.json の moveOnly
 * @param {{file: string, oldFile: string|null, added: boolean}[]} changed
 * @param {(side: "base"|"head", path: string) => string|null} readText
 */
export const movedFiles = (moveOnly, changed, readText) =>
  moveOnlyPaths(moveOnly, toChanges(changed), readText);

/** lint-changed.js の木の読み方: base は merge-base の git の木、head は作業ツリー（lint-changed は作業ツリーを見るため） */
export const treeReader = (root, base) => (side, p) => {
  try {
    return side === "base"
      ? execFileSync("git", ["show", `${base}:${p}`], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
      : fs.readFileSync(path.join(root, p), "utf8");
  } catch {
    return null;
  }
};

/** config/pr-path-rules.json の moveOnly（pr-lane.js の loadMoveOnly と同じ所。pr-lane.js は import すると重いので読むだけ写す） */
export const loadMoveOnly = (root) => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, "config/pr-path-rules.json"), "utf8"),
    ).moveOnly;
  } catch (e) {
    throw new Error(
      `config/pr-path-rules.json の moveOnly が読めない: ${e.message}`,
    );
  }
};

/** to の形のファイルを足したのに移すだけと見なさないときの理由（作者が「本物の重なり」と見分けるため）。ほかは null */
export const notMovedReason = (moveOnly, changed, readText) => {
  const toLike = changed.some(
    ({ file, added }) =>
      added && (moveOnly?.to ?? []).some((p) => new RegExp(p).test(file)),
  );
  return toLike ? moveOnlyReason(moveOnly, toChanges(changed), readText) : null;
};

/**
 * @param {{lines: number, firstFile: {name: string, start: number, end: number}, secondFile: {name: string, start: number, end: number}}[]} duplicates jscpd の json の duplicates
 * @param {Map<string, {added: boolean}>} byFile 差分のファイル
 * @param {Set<string>} moved 移しただけのファイル
 * @returns {{errors: string[], warnings: string[]}}
 */
export function classifyDuplicates(duplicates, byFile, moved) {
  const errors = [];
  const warnings = [];
  for (const d of duplicates) {
    const sides = [d.firstFile, d.secondFile];
    const hit = sides.filter((s) => byFile.has(s.name));
    if (hit.length === 0) continue;
    const text = `重なり ${d.lines} 行: ${sides.map((s) => `${s.name}:${s.start}-${s.end}`).join(" と ")}`;
    if (!hit.some((s) => byFile.get(s.name).added)) warnings.push(text);
    else if (hit.every((s) => moved.has(s.name)))
      warnings.push(`${text}（移しただけ。base の殻の字そのまま）`);
    else errors.push(text);
  }
  return { errors, warnings };
}
