#!/usr/bin/env node
/**
 * レース詳細まわりの色の直書きを、トークン（src/styles/design-tokens.css）に置き換えたことを固定する
 * （docs/design/race-detail-ui-unify spec R6・FR-6、BOA-450）。DB 接続は不要。
 *
 * 守ること:
 *   - 決まり手の色は src/utils/techniqueColors.js の 1か所だけで決める。以前は同じ hex の表が
 *     4つのコンポーネントに複製されていた。名前ごとの色の割り当て（逃げ＝1 …）が変わらないこと
 *   - 結果タブの1着の行・最速STのタグ・払戻の最高額の背景に、金の rgba を直書きしない
 *     （--brand-accent-primary から作る。ダークでは金の色が切り替わる）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { techniqueColor } from "../../src/utils/techniqueColors.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const CHARTS = [
  "src/components/analysis/WinningTechniqueChart.jsx",
  "src/components/analysis/LosingTechniqueChart.jsx",
  "src/components/analysis/RacerTechniqueProfileChart.jsx",
  "src/components/racer/RacerPerformanceStats.jsx",
];
for (const file of CHARTS) {
  const src = read(file);
  check(
    `${file} は決まり手の色を直書きせず techniqueColor を使う`,
    !/TECHNIQUE_COLORS/.test(src) &&
      !/"#(0ea5e9|10b981|f59e0b|ef4444|8b5cf6|94a3b8|ec4899)"/.test(src) &&
      src.includes('from "../../utils/techniqueColors"'),
  );
}

check(
  "決まり手の名前ごとの色の割り当てが変わらない",
  techniqueColor("逃げ") === "var(--technique-color-1)" &&
    techniqueColor("差し") === "var(--technique-color-2)" &&
    techniqueColor("まくり") === "var(--technique-color-3)" &&
    techniqueColor("まくり差し") === "var(--technique-color-4)" &&
    techniqueColor("抜き") === "var(--technique-color-5)" &&
    techniqueColor("恵まれ") === "var(--technique-color-6)",
);
check(
  "名前に色の無い決まり手は、並び順で7色を回す（並び順が無ければ灰色）",
  techniqueColor("不明", 6) === "var(--technique-color-7)" &&
    techniqueColor("不明", 7) === "var(--technique-color-1)" &&
    techniqueColor("不明") === "var(--technique-color-6)",
);
const tokens = read("src/styles/design-tokens.css");
check(
  "決まり手の色のトークン7つが design-tokens.css にある",
  [1, 2, 3, 4, 5, 6, 7].every((n) =>
    tokens.includes(`--technique-color-${n}:`),
  ),
);

const appCss = read("src/App.css");
check(
  "結果タブの金の背景に rgba(201, 162, 39, …) を直書きしない",
  !/rgba\(201,\s*162,\s*39/.test(appCss),
);

if (failures.length > 0) {
  console.error(`\nverify-race-detail-color-tokens: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nverify-race-detail-color-tokens: すべて成功");
