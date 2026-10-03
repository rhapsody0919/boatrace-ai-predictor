#!/usr/bin/env node
/**
 * レース詳細の色分け統一の積み残し（BOA-711）の修正を固定する。DB 接続は不要。
 * 画面はブラウザでしか動かないため、ソースと文言を検査する（verify-motor-tab-readability.js と同じ方式）。
 * 数値の判定（ST考察の差の色 diffTone）は verify-race-indicator-tones.js で検査する。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const LANGS = ["ja", "en", "zh-TW", "ko"];

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const meetCss = read("src/components/race/RaceMeetTab.css");
check(
  "今節の6艇の表: 着順の並びの1着は金（日別の表と同じ）",
  /\.rmt-finishes \.is-win \{[^}]*color: var\(--brand-accent-primary\)/.test(
    meetCss,
  ),
);
check(
  "今節の6艇の表: 選択中の行は塗りだけで、太字にしない（金枠の太字と区別する）",
  !/\.rmt-compare tbody tr\.is-current \{[^}]*font-weight/.test(meetCss),
);

const st = read("src/components/race/RaceStConsiderationCard.jsx");
check(
  "ST考察: 差は表示と同じ1桁に丸めた値どうしで出す（安定率・出遅率・抜出）",
  /diffFromBaseline\(\s*round1\(value\),\s*round1\(cell\?\.stable_rate\)/.test(
    st,
  ) &&
    /diffFromBaseline\(\s*round1\(value\),\s*round1\(cell\?\.late_rate\)/.test(
      st,
    ) &&
    st.includes("count - round1(expected)"),
);
check(
  "ST考察: 各行に「高い・多い・低いほど良い」を添える（4言語）",
  ["dirHigher", "dirMore", "dirLower"].every((k) =>
    st.includes(`t("stConsideration.${k}")`),
  ) &&
    LANGS.every((l) => {
      const c = json(`src/locales/${l}/common.json`).stConsideration;
      return c.dirHigher && c.dirMore && c.dirLower;
    }),
);
const stCss = read("src/components/race/RaceStConsiderationCard.css");
check(
  "ST考察: 平均・注記はセル内で折らない（375px で列ごとに行の高さがずれた）",
  /\.rsc-baseline \{[^}]*white-space: nowrap/.test(stCss) &&
    /\.rsc-note-small \{[^}]*text-wrap: balance/.test(stCss),
);
check(
  "ST考察: 360px 未満では平均・注記を折る（320px で表がカードからはみ出した）",
  /@media \(max-width: 359px\) \{\s*\.rsc-baseline,\s*\.rsc-note-small \{\s*white-space: normal/.test(stCss),
);
check(
  "ST考察の注記に「±0.1以内は色なし」を書く",
  json("src/locales/ja/common.json").stConsideration.caveat.includes("±0.1以内"),
);
check(
  "ST考察: 「〜ほど良い」は行見出しの列の中で折り返す（375px で隣の列にはみ出した）",
  /\.rsc-dir \{[^}]*white-space: normal/.test(stCss),
);
check(
  "ST考察・直前情報・モーターの注記に条件を書く（抜出の色なし、⚠の6件、上ほど速い）",
  json("src/locales/ja/common.json").stConsideration.caveat.includes(
    "平均が1回未満で0回",
  ) &&
    json("src/locales/ja/common.json").beforeInfo.bestLegend.includes(
      "6件未満",
    ) &&
    json(
      "src/locales/ja/common.json",
    ).analysis.motor.exhibitionTrendHeader.includes("上ほど速い"),
);

check(
  "展示タイムの推移グラフ: 横軸の左に余白（左下の目盛りと日付が接していた）",
  read("src/components/analysis/TrendLineChart.jsx").includes(
    "padding={{ left: 12 }}",
  ),
);
check(
  "確定後の展開予測の「的中」タグは緑（要約文と同じ）",
  /\.turn-pattern-hit-tag \{[^}]*color: var\(--color-success-text\)/.test(
    read("src/components/race/TurnPatternList.css"),
  ),
);
for (const f of [
  "src/components/analysis/WinningTechniqueChart.jsx",
  "src/components/analysis/LosingTechniqueChart.jsx",
  "src/components/analysis/RacerTechniqueProfileChart.jsx",
]) {
  check(
    `${f}: 凡例の文字は本文色（系列色の文字はライトで読みにくい）`,
    /<Legend[\s\S]{0,300}color: "var\(--text-primary\)"/.test(read(f)) &&
      !/<Legend \/>/.test(read(f)),
  );
}
check(
  "結果タブ: 2号艇（黒）の ST の矢印に明るい輪郭",
  read("src/components/race/RaceResult.jsx").includes('" is-black"') &&
    /\.rr-st-dot\.is-black \{[^}]*drop-shadow/.test(read("src/App.css")),
);
const mood = read("src/components/race/RaceMoodEffect.jsx");
const scales = [...mood.matchAll(/maxScale: ([\d.]+)/g)].map((m) =>
  Number(m[1]),
);
check(
  "イン崩れのアイコンの波紋はカードの外・見出しにかからない大きさ（2倍以下）",
  scales.length === 3 && scales.every((x) => x <= 2),
);
check(
  "イン崩れ注意度のカードの中の比較バーは、カードの地に合わせる",
  /\.volatility-display \.vpb \{[^}]*--vpb-bg: var\(--surface-card\)/.test(
    read("src/components/race/VolatilityPercentileBar.css"),
  ),
);
check(
  "イン崩れ注意度の「高」はカードの地に橙を少し濃く混ぜる（ダークで灰に寄った）",
  /level === "high" \? 12 : 8/.test(
    read("src/components/race/VolatilityDisplay.jsx"),
  ),
);
if (failures.length > 0) {
  console.error(`\nverify-race-detail-boa711: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nverify-race-detail-boa711: すべて成功");
