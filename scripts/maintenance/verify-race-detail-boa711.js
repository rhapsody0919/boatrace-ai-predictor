#!/usr/bin/env node
/**
 * レース詳細の色分け統一の積み残し（BOA-711）の修正を固定する。DB 接続は不要。
 * 画面はブラウザでしか動かないため、ソースと文言を検査する（verify-motor-tab-readability.js と同じ方式）。
 * 数値の判定（ST考察の差の色 diffTone）は verify-race-indicator-tones.js で検査する。
 */
import { readFileSync, readdirSync } from "node:fs";
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
  /@media \(max-width: 359px\) \{\s*\.rsc-baseline,\s*\.rsc-note-small \{\s*white-space: normal/.test(
    stCss,
  ),
);
check(
  "ST考察: 率（安定率・出遅率）の差は ±1.0 以内を色なし、抜出は ±0.1（注記も分けて書く）",
  (st.match(/threshold: RATE_TONE_THRESHOLD/g) ?? []).length === 2 &&
    /const RATE_TONE_THRESHOLD = 1;/.test(st) &&
    json("src/locales/ja/common.json").stConsideration.caveat.includes(
      "率は±1.0以内・抜出は±0.1以内",
    ),
);
check(
  "抜出の「?」の説明: 「平均」は期待回数（率×この選手の走数）だと書く（4言語）",
  LANGS.every((l) => {
    const h = json(`src/locales/${l}/common.json`).termHints.stBreakout;
    return /走数|races|場數|출주 수/.test(h) && !h.includes("平均回数です");
  }),
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
// 2026-10-03 ユーザー判断（BOA-711 U1・U3・U4・U5・1b）
const tokens = read("src/styles/design-tokens.css");
check(
  "U1: 最良の金枠は、地が明るい金の20%、枠が濃い金の不透明",
  tokens.includes(
    "--ind-best-bg: color-mix(in srgb, var(--ryujin-gold-500) 20%, transparent);",
  ) && tokens.includes("--ind-best-ring: var(--brand-accent-primary);"),
);
check(
  "U3: 結果タブの1着の帯は最良の金枠と同じ地＋左に金の線（行の外に引き、「1着」の文字に重ねない）",
  /\.rr-row\.is-winner \{[^}]*background: var\(--ind-best-bg\)[^}]*box-shadow: -4px 0 0 0 var\(--ryujin-gold-500\)/.test(
    read("src/App.css"),
  ),
);
check(
  "ダークの金の地は暗い金の不透明な地（紺に半透明で混ぜると灰緑に見えた。2026-10-04 ユーザー判断）",
  (
    tokens.match(
      /--ind-best-bg: color-mix\(in srgb, var\(--ryujin-gold-500\) 20%, #160f03\);/g,
    ) ?? []
  ).length === 2,
);
check(
  "U4: イン崩れの比較バーは「/ 100」を添え、見出しは「崩れやすさ（同会場で0〜100）」",
  read("src/components/race/VolatilityPercentileBar.jsx").includes(
    't("volatility.percentileBarMax100")',
  ) &&
    json("src/locales/ja/common.json").volatility.percentileBarLabel ===
      "崩れやすさ（同会場で0〜100）" &&
    LANGS.every(
      (l) =>
        json(`src/locales/${l}/common.json`).volatility.percentileBarMax100 ===
        "/ 100",
    ),
);
check(
  "U5: ST考察の走数の少ない値は灰（補足の色）",
  /\.rsc-value\.is-small-sample \{[^}]*color: var\(--text-secondary\)/.test(
    stCss,
  ),
);
check(
  "U5: 枠別情報のコース別成績の走数の少ない値も灰（ST考察とそろえる）",
  [
    /\.rwit-grid-value\.is-small-sample,\s*\.rwit-grid-n\.is-small-sample \{[^}]*color: var\(--text-secondary\)/,
    /\.rwit-today-value\.is-small-sample,\s*\.rwit-today-n-td\.is-small-sample \{[^}]*color: var\(--text-secondary\)/,
  ].every((re) => re.test(read("src/components/race/RaceWakuInfoTab.css"))),
);
check(
  "枠別情報の全コース表の想定コースは灰の点線（金の線は最良の印なので使わない）",
  /\.rwit-grid-cell\.is-own-course \.rwit-grid-cell-button \{[^}]*outline: 1px dashed var\(--text-secondary\)/.test(
    read("src/components/race/RaceWakuInfoTab.css"),
  ),
);
check(
  "走数の少ない値は灰＋太字にしない（ダークで灰と白の差が小さい）",
  /\.rsc-value\.is-small-sample \{[^}]*font-weight: var\(--font-weight-normal\)/.test(
    stCss,
  ) &&
    (
      read("src/components/race/RaceWakuInfoTab.css").match(
        /is-small-sample \{[^}]*--text-secondary\);[^}]*font-weight: var\(--font-weight-normal\)/g,
      ) ?? []
    ).length === 2,
);
check(
  "枠別情報の全コース表の想定コースの見出しも点線（金の枠にしない）",
  /\.rwit-grid-course-th\.is-today \{[^}]*outline: 2px dashed/.test(
    read("src/components/race/RaceWakuInfoTab.css"),
  ) &&
    !/\.rwit-grid-course-th\.is-today \{[^}]*brand-accent-primary/.test(
      read("src/components/race/RaceWakuInfoTab.css"),
    ),
);
check(
  "結果の1着の「1着」の文字は、金に本文色を3割混ぜる（ダークの帯の上で AA を割った）",
  /\.rr-row\.is-winner \.rr-pos \{[^}]*color-mix\(in srgb, var\(--brand-accent-primary\) 70%, var\(--text-primary\)\)/.test(
    read("src/App.css"),
  ),
);
check(
  "ホームの注記は「順位」と書かない（「1 / 100」が1位＝一番崩れやすいと逆に読めた）",
  !json(
    "src/locales/ja/common.json",
  ).home.volatilityHighlightsScaleNote.includes("順位"),
);
check(
  "直前情報の金枠の凡例に「今節〜の行は前走で比べる」を書く",
  json("src/locales/ja/common.json").beforeInfo.bestLegend.includes(
    "前走の値で比べます",
  ),
);
check(
  "1b: 直前情報の今節一周・まわり足・直線にも、前走の最良に金枠",
  /const bestPrev = bestOf\([\s\S]{0,300}"min"/.test(
    read("src/components/race/RaceBeforeInfoTab.jsx"),
  ) &&
    read("src/components/race/RaceBeforeInfoTab.jsx").includes(
      "bestPrev.has(p.number)",
    ),
);

// 2026-10-04 ユーザー判断: 「イン崩れ確率高」を「イン崩れ注意（高）」に改名（0〜100 の数字と並ぶと確率に
// 読まれた）。画面・4言語の訳・ブログに旧名・旧訳が残っていないこと
{
  const OLD = [
    "イン崩れ確率高",
    "High upset chance",
    "冷門機率高",
    "이변 가능성 높음",
  ];
  const files = [
    ...LANGS.map((l) => `src/locales/${l}/common.json`),
    "src/pages/HowToUse.jsx",
    ...readdirSync(path.join(root, "public/blog"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `public/blog/${f}`),
  ];
  const left = files.filter((f) => OLD.some((o) => read(f).includes(o)));
  check(
    `「イン崩れ確率高」の旧名・旧訳が画面・ブログに残っていない（残り: ${left.join(", ") || "なし"}）`,
    left.length === 0 &&
      json("src/locales/ja/common.json").volatility.levelHigh ===
        "イン崩れ注意（高）",

// 2026-10-03 ユーザー判断（BOA-711 U2）: 準優の目安の線・目安に届く得点率は青。金は最良だけ
{
  const meet = read("src/components/race/RaceMeetTab.css");
  check(
    "U2: 準優の目安の点線・左の帯・早見の得点率は青（--color-info-text）",
    /tr\.is-border-edge td \{[^}]*dashed var\(--color-info-text\)/.test(meet) &&
      /tr\.is-in-border th \{[^}]*inset 3px 0 0 0 var\(--color-info-text\)/.test(
        meet,
      ) &&
      /td\.rmt-rate\.is-in-border \{[^}]*color: var\(--color-info-text\)/.test(
        meet,
      ),
  );
}

{
  const meet = read("src/components/race/RaceMeetTab.css");
  check(
    "U2: 得点率早見・6艇の推移の選択中の印に金を使わない（金は最良だけ）",
    /\.rmt-forecast-table tbody tr\.is-current th \{[^}]*inset 3px 0 0 0 var\(--text-primary\)/.test(
      meet,
    ) &&
      /\.rmt-trend-row\[aria-pressed="true"\] \{[^}]*inset 3px 0 0 var\(--text-primary\)/.test(
        meet,
      ) &&
      !/\.rmt-trend-row[^{]*\{[^}]*--brand-accent-primary/.test(meet),
  );
  check(
    "U2: 青の意味を文で書く（点線は「青い点線」、早見の青い得点率の注記）",
    json("src/locales/ja/common.json").meetTab.borderNote.includes(
      "青い点線",
    ) &&
      LANGS.every(
        (l) =>
          json(`src/locales/${l}/common.json`).meetTab.forecastRateBlueNote,
      ),
  );
}

if (failures.length > 0) {
  console.error(`\nverify-race-detail-boa711: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nverify-race-detail-boa711: すべて成功");
