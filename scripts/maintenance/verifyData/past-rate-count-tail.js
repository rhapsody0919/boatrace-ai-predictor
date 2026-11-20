/**
 * verify-past-rate-count.js の末尾（変異検証の回しと KNOWN_GAPS の観測）。大きさの関所のため、本文を字のまま移した。verify ではない。
 * 判定は verify 側の SUITES・MUTANTS をそのまま使い、検出できなかった数を返す（失敗の数は verify が数える）。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 変異を1つずつ入れたコピーに同じ検証をかけ、検出できなかった変異の数を返す */
export async function runMutants({ MUTANTS, SUITES, loadMutant, show, quiet }) {
  let missed = 0;
  for (const [i, [target, name, from, to]] of MUTANTS.entries()) {
    let killed = false;
    let detail = "検出されなかった（この変異を入れても検証が通る）";
    try {
      const mod = await loadMutant(i, target, from, to);
      let failed = 0;
      console.error = () => {}; // 保存の失敗の console.error を変異検証では黙らせる
      try {
        SUITES[target](mod, (_label, actual, expected) => {
          if (show(actual) !== show(expected)) failed++;
        });
      } catch {
        failed++;
      } finally {
        console.error = quiet;
      }
      killed = failed > 0;
    } catch (error) {
      detail = error.message;
    }
    if (killed) console.log(`✅ 変異検証（${target}）: 「${name}」を検出できる`);
    else {
      missed++;
      console.error(`❌ 変異検証（${target}）: 「${name}」\n  ${detail}`);
    }
  }
  return missed;
}

/** 仕様が未定の入力の今の値を出すだけ（合否には含めない） */
export async function showKnownGaps({ ROOT, TARGETS, show }) {
  const KNOWN_GAPS = [
    { input: { first: 2, second: [1, 1], third: [3] }, spec: "欄内の重複の扱いは未定（画面では足し外し）" },
    { input: { first: "1", second: [1], third: [2] }, spec: "1着が文字列のときの同一艇判定は未定" },
    { input: undefined, spec: "入力がundefinedのときの扱いは未定" },
  ];
  const countModule = await import(pathToFileURL(path.join(ROOT, TARGETS.count)).href);
  console.log(`\n## KNOWN_GAPS（${KNOWN_GAPS.length}件、合否判定の対象外）`);
  for (const { input, spec } of KNOWN_GAPS) {
    let current;
    try {
      current = { combos: countModule.orderCombos(input), points: countModule.orderPoints(input) };
    } catch (error) {
      current = { exception: error.name };
    }
    console.log(`- 入力: ${show(input) ?? "undefined"} / 仕様: ${spec} / 今の値: ${show(current)}`);
  }
}
