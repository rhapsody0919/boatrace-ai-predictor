#!/usr/bin/env node
/**
 * レース詳細の色分け統一の積み残し（BOA-711）の修正を固定する。DB 接続は不要。
 * 部品（.jsx）は ja の訳で描いて、描いた結果を見る（verifyData/race-detail-boa711-render.js。取得は写し）。
 * CSS・色のトークン・訳（locales）・ブログの本文は字で見る（描いても jsdom は CSS を当てない）。
 * 数値の判定（ST考察の差の色 diffTone）の単体は verify-race-indicator-tones.js で検査する。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beforeInfoBest,
  formationHullStrokes,
  howToUseText,
  moodRingScales,
  stConsiderationRows,
  techniqueLegend,
  trendChartAxis,
  volatilityCard,
} from "./verifyData/race-detail-boa711-render.js";

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

// ST考察のカード: 1号艇（28走）は率が 9/28=32.14（表示 32.1）で平均 32.86（表示 32.9）。丸めた値どうしの差は −0.8、
// 丸めずに引くと −0.7。2号艇（10走）は率 50.0 に平均 48.9 で差 1.1（色あり）、抜出は2回で期待 1.25回（表示 1.3）、
// 丸めた差は +0.7（丸めずに引くと +0.75 → +0.8）。3号艇は率 50.0 に平均 49.0 で差 1.0（±1.0 以内で色なし）
const stRec = (course, st, innerMinSt = course === 1 ? null : 0.1) => ({ actualCourse: course, raceBestSt: 0.1, stForRank: st, innerMinSt, isFlying: false });
const stRuns = (course, { stable, late, middle = 0, breakout = 0 }) => [
  ...Array.from({ length: stable }, (_, i) => stRec(course, 0.12, i < breakout ? 0.2 : undefined)),
  ...Array.from({ length: late }, () => stRec(course, 0.22)),
  ...Array.from({ length: middle }, () => stRec(course, 0.17)),
];
const stBase = (course, rate, breakoutRate) => ({ course, grade: "A1", stable_rate: rate, late_rate: rate, breakout_rate: breakoutRate, window_start: "2026-01-01", window_end: "2026-09-30" });
const stRows = await stConsiderationRows({
  players: [1, 2, 3].map((number) => ({ number, racerId: 100 + number, grade: "A1" })),
  records: {
    101: stRuns(1, { stable: 9, late: 9, middle: 10 }),
    102: stRuns(2, { stable: 5, late: 5, breakout: 2 }),
    103: stRuns(3, { stable: 5, late: 5 }),
  },
  baseline: [stBase(1, 32.86, null), stBase(2, 48.9, 12.5), stBase(3, 49.0, 0)],
});
const [stableRow, breakoutRow, lateRow] = stRows;
const diffText = (row, i) => row?.diffs[i]?.text ?? null;
const diffTone = (row, i) => row?.diffs[i]?.tone ?? null;
check(
  "ST考察: 差は表示と同じ1桁に丸めた値どうしで出す（安定率・出遅率・抜出。描いたカード）",
  diffText(stableRow, 0) === "−0.8" &&
    diffText(lateRow, 0) === "−0.8" &&
    diffText(breakoutRow, 1) === "+0.7",
);
check(
  "ST考察: 各行に「高い・多い・低いほど良い」を添える（描いたカード、4言語の訳は下で見る）",
  [stableRow, breakoutRow, lateRow].map((r) => r?.dir).join("/") ===
    ["dirHigher", "dirMore", "dirLower"].map((k) => json("src/locales/ja/common.json").stConsideration[k]).join("/") &&
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
  "ST考察: 率（安定率・出遅率）の差は ±1.0 以内を色なし、抜出は ±0.1（注記も分けて書く。描いたカード）",
  [stableRow, lateRow].every((r) => diffTone(r, 0) === null && diffTone(r, 2) === null) &&
    diffTone(stableRow, 1) === "better" &&
    diffTone(lateRow, 1) === "worse" &&
    diffTone(breakoutRow, 1) === "better" &&
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

{
  const axis = await trendChartAxis({
    data: [{ date: "10/1", ex: 6.8 }, { date: "10/2", ex: 6.75 }, { date: "10/3", ex: 6.9 }],
    series: [{ dataKey: "ex", name: "展示", stroke: "#f00" }],
  });
  check(
    `展示タイムの推移グラフ: 横軸の左に余白12（左下の目盛りと日付が接していた。描いたグラフの最初の日付 ${axis.firstTickX}・縦軸 ${axis.yAxisX}）`,
    axis.tickCount === 3 && axis.firstTickX - axis.yAxisX === 12,
  );
}
check(
  "確定後の展開予測の「的中」タグは緑（要約文と同じ）",
  /\.turn-pattern-hit-tag \{[^}]*color: var\(--color-success-text\)/.test(
    read("src/components/race/TurnPatternList.css"),
  ),
);
{
  // 決まり手のグラフ3つ。系列は2つ（逃げ・差し）で、凡例の文字の色を見る（既定の凡例は系列の色の文字）
  const techs = [
    { technique: "逃げ", count: 6, percentage: 60 },
    { technique: "差し", count: 4, percentage: 40 },
  ];
  const venueStats = { venue_name: "常滑", last_updated: "2026-10-01", data: { 1: { techniques: techs }, 2: { techniques: techs } } };
  const charts = {
    WinningTechniqueChart: ["winning", venueStats],
    LosingTechniqueChart: ["losing", venueStats],
    RacerTechniqueProfileChart: ["profile", [{ boat_number: 1, player_name: "選手 一", techniques: techs }]],
  };
  for (const [name, [kind, value]] of Object.entries(charts)) {
    const legend = await techniqueLegend(kind, value);
    check(
      `${name}: 凡例の文字は本文色（系列色の文字はライトで読みにくい。描いた凡例 ${legend.map((x) => `${x.text}=${x.color}`).join(", ")}）`,
      legend.length === 2 && legend.every((x) => x.color === "var(--text-primary)"),
    );
  }
}
// 結果タブの ST の矢印は、スタート隊形の絵（BOA-811、暗い水面）に置き換えた。2号艇（黒）が溶けないよう、
// F 以外の艇には白い輪郭を付ける（E2E は race-result-display-fixes.spec.js の「輪郭」）
check(
  "結果タブ: スタート隊形の絵で、2号艇（黒）の艇に明るい輪郭（F の艇は赤。描いた絵）",
  (
    await formationHullStrokes([
      { course: 1, boat: 1, st: 0.12, flying: false, late: false, absent: false, mae: false, fastest: true },
      { course: 2, boat: 2, st: 0.15, flying: false, late: false, absent: false, mae: false, fastest: false },
      { course: 3, boat: 3, st: -0.01, flying: true, late: false, absent: false, mae: false, fastest: false },
    ])
  ).join(",") === "#ffffff,#ffffff,#ff6b6b",
);
{
  const scales = {};
  for (const level of ["high", "standard", "low"]) scales[level] = await moodRingScales(level);
  const all = Object.values(scales).flat();
  check(
    `イン崩れのアイコンの波紋はカードの外・見出しにかからない大きさ（2倍以下。描いた波紋 ${Object.entries(scales).map(([k, v]) => `${k}=${v.join("/")}`).join(" ")}）`,
    Object.values(scales).every((v) => v.length > 0) && all.every((x) => x <= 2),
  );
}
check(
  "イン崩れ注意度のカードの中の比較バーは、カードの地に合わせる",
  /\.volatility-display \.vpb \{[^}]*--vpb-bg: var\(--surface-card\)/.test(
    read("src/components/race/VolatilityPercentileBar.css"),
  ),
);
const volHigh = await volatilityCard(0.9);
const volStandard = await volatilityCard(0.5);
check(
  "イン崩れ注意度の「高」はカードの地に橙を少し濃く混ぜる（ダークで灰に寄った。描いたカードの地）",
  volHigh.level === "high" &&
    / 12%, var\(--surface-card\)\)$/.test(volHigh.background ?? "") &&
    volStandard.level === "standard" &&
    / 8%, var\(--surface-card\)\)$/.test(volStandard.background ?? ""),
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
  "U4: イン崩れの比較バーは「/ 100」を添え、見出しは「崩れやすさ（同会場で0〜100）」（描いたバー）",
  volHigh.barMax === "/ 100" &&
    volHigh.barValue === "90/ 100" &&
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
{
  // 直前情報の表の今節一周・まわり足・直線（前走の値で比べる行）。1号艇は前走が遅いが節平均は最速、
  // 2号艇は前走が最速、3号艇は値なし（今節初戦）。金枠は前走の最良の2号艇だけ
  const players = [1, 2, 3].map((number) => ({ number, racerId: 200 + number, motorNumber: 30 + number, name: `選手${number}` }));
  const trend = (boatNumber) => [
    { raceId: "r1", boatNumber, exhibitionTime: null },
    { raceId: "r2", boatNumber, exhibitionTime: null },
  ];
  const byKey = {
    "r1-1": { 一周: "36.00", まわり足: "5.00", 直線: "6.50" },
    "r2-1": { 一周: "37.80", まわり足: "5.60", 直線: "7.00" },
    "r1-2": { 一周: "37.60", まわり足: "5.40", 直線: "6.90" },
    "r2-2": { 一周: "37.50", まわり足: "5.30", 直線: "6.80" },
  };
  const rows = await beforeInfoBest({
    players,
    analysis: { pending: {}, failed: {}, motorMaintenance: [], hasFailure: false, reload() {} },
    fetched: {
      meetTrendByRacer: { 201: trend(1), 202: trend(2), 203: [] },
      meetOriginal: { state: "published", byKey },
      originalExhibition: { state: "none" },
      entryWeights: { state: "none" },
      scopedStatsByRacer: {},
    },
  });
  const ja = json("src/locales/ja/common.json").beforeInfo;
  const labels = [ja.rowMeetOriLap, ja.rowMeetOriTurn, ja.rowMeetOriStraight];
  const bestOfRow = (label) => Object.entries(rows).find(([head]) => head.startsWith(label))?.[1]?.best ?? null;
  check(
    `1b: 直前情報の今節一周・まわり足・直線にも、前走の最良に金枠（描いた表 ${labels.map((l) => `${l}=${JSON.stringify(bestOfRow(l))}`).join(" ")}）`,
    labels.every((l) => JSON.stringify(bestOfRow(l)) === "[2]"),
  );
}

// 2026-10-04 ユーザー判断: 「イン崩れ確率高」を「イン崩れ注意（高）」に改名（0〜100 の数字と並ぶと確率に
// 読まれた）。画面・4言語の訳・ブログに旧名・旧訳が残っていないこと
{
  const OLD = [
    "イン崩れ確率高",
    "High upset chance",
    "冷門機率高",
    "이변 가능성 높음",
  ];
  // 画面は使い方ガイドを描いて全ステップの文を見る（割ったページも描いた先に入る）。訳とブログは字で見る
  const howTo = await howToUseText();
  const files = [
    ...LANGS.map((l) => `src/locales/${l}/common.json`),
    ...readdirSync(path.join(root, "public/blog"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `public/blog/${f}`),
  ];
  const left = files.filter((f) => OLD.some((o) => read(f).includes(o)));
  if (howTo.steps !== 6 || OLD.some((o) => howTo.text.includes(o))) left.push(`描いた使い方ガイド（${howTo.steps}ステップ）`);
  check(
    `「イン崩れ確率高」の旧名・旧訳が画面・ブログに残っていない（残り: ${left.join(", ") || "なし"}）`,
    left.length === 0 &&
      json("src/locales/ja/common.json").volatility.levelHigh ===
        "イン崩れ注意（高）",
  );
}

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
