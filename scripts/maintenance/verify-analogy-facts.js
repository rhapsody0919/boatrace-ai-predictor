/**
 * BOA-271 アナロジー・ファインダー v16 の定義の固定データ検査（ci）。
 *
 * 1. 優勝戦・準優勝戦の判定 v2（tasks T1-1）: 固定の82件（scripts/ml/analogy/testdata/stage-rule-v2-cases.json）で、
 *    src/constants/raceStageConfig.js の getRaceStageCategory が expected_category と一致すること。
 *    バッジ（getRaceStageKey）と今節の得点の除外（seriesPoints.js の classifyStage）が同じ判定に従うこと。
 *    Python 側（features.py の round_from_stage）は scripts/ml/analogy/tests/test_features.py が同じ82件で検査する
 * 2. 展示後の類似レースの並べ直し（tasks T4-1）: src/utils/analogySimilarRerank.js が、Python（v16_similar）の展示後の
 *    表し方での厳密な並び（scripts/ml/analogy/testdata/v16-rerank.json、例のレース）と、順位が完全に一致し、
 *    距離²の差が 1e-5 未満であること。候補が層より少ないときの厳密さの判定
 * 3. 展開シナリオの定義（src/utils/analogyScenario.js）: スリットの7形・進入の型と前付け・風速区分・手がかりの8条件が、
 *    Python（v16_defs・v16_facts）で作った固定データ（scripts/ml/analogy/testdata/v16-defs-cases.json）と一致すること
 * 4. 画面の純粋関数（tasks T6-2）: 6艇中の順位（analogyFacts.rankPositions）・Wilson の95%区間・判定の3段階が、
 *    Python で作った固定データ（testdata/v16-ui-cases.json、make_v16_ui_cases.py）と一致すること。例のレースの今日の
 *    順位（v16-example.json の today.items）を再現すること。並び・今日の位置・範囲の名前・層の説明文・表記・
 *    スライダーの段・類似レースの集計を、手で決めた答えで確かめる
 *
 * 使い方: node scripts/maintenance/verify-analogy-facts.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getRaceStageCategory,
  getRaceStageKey,
} from "../../src/constants/raceStageConfig.js";
import { classifyStage } from "../../src/components/race/seriesPoints.js";
import {
  exhibitionItemLevels,
  rerankSimilar,
} from "../../src/utils/analogySimilarRerank.js";
import {
  clearDiff,
  entryType,
  hintBadgeByForm,
  hintConditions,
  hintRows,
  minRanks,
  rankBand,
  maedukeBoats,
  slitForms,
  waveBand,
  windBand,
} from "../../src/utils/analogyScenario.js";
import {
  defaultScope,
  factRows,
  judgeGap,
  parseScopeKey,
  rankPositions,
  seriesScoreNote,
  todayPosition,
  windWaveView,
} from "../../src/utils/analogyFacts.js";
import { wilsonInterval } from "../../src/utils/wilson.js";
import {
  fmtDate,
  fmtEntry,
  fmtExhSt,
  fmtRateCount,
  fmtSt3,
  scopeName,
} from "../../src/utils/analogyFormat.js";
import { describeAnalogyLayer } from "../../src/utils/analogyLayer.js";
import {
  aggregateNeighbors,
  defaultStepIndex,
  itemRates,
  neighborCounts,
  normalizeNeighbor,
  sliderSteps,
  trifectaList,
} from "../../src/utils/analogyAggregate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(
  __dirname,
  "../ml/analogy/testdata/stage-rule-v2-cases.json",
);

let failures = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  failures += 1;
  console.error(
    `❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ---- 1. 優勝戦・準優勝戦の判定 v2 ----------------------------------------
const { cases } = JSON.parse(fs.readFileSync(CASES, "utf8"));
check("固定データの件数", cases.length, 82);
for (const c of cases) {
  const category = getRaceStageCategory(c.stage)?.key ?? null;
  check(`種別 ${c.stage}`, category, c.expected_category);
  const roundKey = ["final", "semifinal"].includes(c.expected_category)
    ? c.expected_category
    : null;
  check(`バッジ ${c.stage}`, getRaceStageKey(c.stage), roundKey);
  if (roundKey)
    check(`今節の得点から除く ${c.stage}`, classifyStage(c.stage), "excluded");
}

// 旧判定から変わる本体の6レースの名前（analysis/t1/t1-1-stage-rule.json の v2.d）
for (const [stage, key] of [
  ["準決勝戦", "semifinal"],
  ["決勝戦", "final"],
  ["王将位決定戦", "final"],
  ["県内選手権優", "final"],
  ["賞金女王決定", "final"],
]) {
  check(`v2 で変わる名前のバッジ ${stage}`, getRaceStageKey(stage), key);
  check(
    `v2 で変わる名前の今節の得点 ${stage}`,
    classifyStage(stage),
    "excluded",
  );
}

// ---- 2. 展示後の並べ直し ------------------------------------------------
const rerank = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-rerank.json"),
    "utf8",
  ),
);
const got = rerankSimilar(rerank.candidates, rerank.today);
check(
  "並べ直しの順位",
  got.neighbors.map((n) => n.race_id),
  rerank.expected.race_ids,
);
const maxDiff = Math.max(
  ...got.neighbors.map((n, i) => Math.abs(n.d2 - rerank.expected.d2[i])),
);
check("並べ直しの距離²の差 < 1e-5", maxDiff < 1e-5, true);
check("候補が層の全件なら厳密", got.exact, true);
// 候補が層の一部（層 100件・候補 3件）: 候補の最後の出走表の距離²が、2件目の展示後の距離²より大きければ厳密
const tiny = {
  n_layer: 100,
  lambda_racecard: 0.1,
  candidates: ["a", "b", "c"],
  d2_racecard: [0.1, 0.2, 0.9],
  venue_match: [true, true, true],
  exhibition: {
    lambda: 0.2,
    columns: [{ feature: "wind_speed", slot: 0, kind: "race_num" }],
    weights: [1],
    norm: { wind_speed: { mean: 0, sd: 1 } },
  },
  exhibition_raw: { race: { wind_speed: [0, 0, 0] }, boats: {} },
};
const today0 = { boats: {}, race: { wind_speed: 0 } };
check(
  "厳密（下限 0.9 ≥ 2件目 0.2）",
  rerankSimilar(tiny, today0, 2).exact,
  true,
);
// 展示の列で b・c が遠くなる（b 0.2+1、c 0.9+1）と、2件目は b の 1.2 で、候補の外の下限 0.9 より大きい
check(
  "厳密でない（下限 0.9 < 2件目 1.2）",
  rerankSimilar(
    { ...tiny, exhibition_raw: { race: { wind_speed: [0, 1, 1] }, boats: {} } },
    today0,
    2,
  ).exact,
  false,
);

// 展示で決まる5項目の「同じ・近い」（Python の item_levels と同じ基準）
const exhItems = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-exh-items.json"),
    "utf8",
  ),
);
exhItems.candidates.forEach((c, j) => {
  check(
    `展示で決まる5項目 ${j}`,
    exhibitionItemLevels(exhItems.today, c),
    c.levels,
  );
});

// ---- 3. 展開シナリオの定義 ------------------------------------------------
const defs = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-defs-cases.json"),
    "utf8",
  ),
);
for (const c of defs.slit_forms)
  check(`スリットの形 ${c.st.join(",")}`, slitForms(c.st), c.forms);
for (const c of defs.entry_types) {
  check(`進入の型 ${c.course.join(",")}`, entryType(c.course), c.type);
  check(`前付け ${c.course.join(",")}`, maedukeBoats(c.course), c.maeduke);
}
for (const c of defs.wind_bands)
  check(`風速区分 ${c.wind_speed}`, windBand(c.wind_speed), c.band);
for (const c of defs.hints)
  check(`手がかり ${c.avg_st.join(",")}`, hintConditions(c.avg_st), c.conds);

// ---- 4. 画面の純粋関数 ------------------------------------------------------
const ui = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-ui-cases.json"),
    "utf8",
  ),
);
for (const c of ui.rank_positions)
  check(
    `6艇中の順位 ${c.values.join(",")} hib=${c.hib}`,
    rankPositions(c.values, c.hib),
    c.positions,
  );
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
for (const c of ui.wilson)
  check(
    `Wilson ${c.x}/${c.n}`,
    close(wilsonInterval(c.x, c.n), c.interval),
    true,
  );
for (const c of ui.judge)
  check(`判定 ${c.best}/${c.worst}`, judgeGap(c.best, c.worst).level, c.level);
check("判定（件数0）", judgeGap([0, 0], [1, 2]).level, "none");
check("判定（逆向き）", judgeGap([10, 100], [60, 100]).reversed, true);

// 例のレースの今日の順位（Python の today_payload と同じ）
const example = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-example.json"),
    "utf8",
  ),
);
const HIB = { st_mean30: false };
for (const [k, v] of Object.entries(example.today.items))
  check(
    `例のレースの順位 ${k}`,
    rankPositions(v.values, HIB[k] ?? true),
    v.positions,
  );
// 今日の位置: 同じ値の艇は一番良い・一番悪いの両方（3艇が同じ値の真ん中は min 順位）
check(
  "今日の位置（同じ値の最良）",
  todayPosition([7, 7, 6, 5, 4, 3], true, 2),
  { bucket: 1, same: 2, value: 7, min: 3, max: 7 },
);
check(
  "今日の位置（中間の同じ値）",
  todayPosition([7, 5, 5, 5, 4, 3], true, 3).bucket,
  2,
);
check(
  "今日の位置（値なし）",
  todayPosition([null, 5, 5, 5, 4, 3], true, 1),
  null,
);
check(
  "今日の位置（遅いほど悪い）",
  todayPosition([0.15, 0.12, 0.13, 0.11, 0.18, 0.18], false, 6).bucket,
  6,
);

// カードの並び: 差がはっきりしている（大きい・小さい）ものが先、その中は差の大きい順
const pairs = (b, w) => ({
  1: { win: b },
  2: { win: [0, 0] },
  3: { win: [0, 0] },
  4: { win: [0, 0] },
  5: { win: [0, 0] },
  6: { win: w },
});
const scopeFacts = {
  by: {
    1: {
      nat_win: pairs([60, 100], [40, 100]), // はっきり・差20
      loc_win: pairs([52, 100], [48, 100]), // はっきりしない
      motor_2: pairs([700, 1000], [600, 1000]), // はっきり・差10
      exh_time: pairs([90, 100], [10, 100]), // 展示前は出さない
    },
  },
};
check(
  "カードの並び（展示前）",
  factRows(scopeFacts, 1, 1, false).map((r) => r.key),
  ["nat_win", "motor_2", "loc_win"],
);
check(
  "カードの並び（展示後）",
  factRows(scopeFacts, 1, 1, true).map((r) => r.key),
  ["exh_time", "nat_win", "motor_2", "loc_win"],
);

// 今節の平均着順点の注記（R1: 最小3未満かつ最大1以上。優勝戦・準優勝戦の日は final だけ）
check(
  "注記: 序盤",
  seriesScoreNote({
    round: "yosen",
    series_runs_before_today: [1, 2, 3, 3, 4, 2],
  }),
  "early",
);
check(
  "注記: 初日",
  seriesScoreNote({
    round: "yosen",
    series_runs_before_today: [0, 0, 0, 0, 0, 0],
  }),
  null,
);
check(
  "注記: 走数が足りる",
  seriesScoreNote({
    round: "yosen",
    series_runs_before_today: [3, 3, 4, 5, 3, 3],
  }),
  null,
);
check(
  "注記: 優勝戦",
  seriesScoreNote({
    round: "yusho",
    series_runs_before_today: [1, 1, 1, 1, 1, 1],
  }),
  "final",
);

// 既定の範囲（VC が300件未満なら NC）
const keys = { VC: "VC:20:2-1-3-0:1A1", NC: "NC:2-1-3-0:1A1", VA: "VA:20" };
check("既定の範囲（VC）", defaultScope(keys, () => 300).key, keys.VC);
check(
  "既定の範囲（NC）",
  defaultScope(keys, () => 299),
  { key: keys.NC, fellBack: true, vcCount: 299 },
);
check(
  "既定の範囲（VC の集計が無い）",
  defaultScope(keys, (k) => (k === keys.VC ? null : 500)).key,
  keys.NC,
);
check(
  "既定の範囲（級別なし）",
  defaultScope({ VA: "VA:20" }, () => 0).key,
  "VA:20",
);
check("範囲キーの分解", parseScopeKey("NCR:6-0-0-0:3A1:yusho"), {
  kind: "NCR",
  venue: null,
  combo: [6, 0, 0, 0],
  boat: 3,
  cls: "A1",
  round: "yusho",
});

// 範囲の名前・層の説明文（日本語の文言で組み立てる）
const ja = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../src/locales/ja/common.json"),
    "utf8",
  ),
);
const t = (key, opts = {}) => {
  const v = key.split(".").reduce((o, k) => o?.[k], ja);
  if (typeof v !== "string") return typeof opts === "string" ? opts : key;
  return v.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ""));
};
check(
  "範囲の名前 VC（6艇とも）",
  scopeName("VC:20:6-0-0-0:1A1", t),
  "若松・6艇ともA1",
);
check(
  "範囲の名前 VC（混ざる）",
  scopeName("VC:20:2-1-3-0:1A1", t),
  "若松・A1が2艇・A2が1艇・B1が3艇（1号艇はA1）",
);
check(
  "範囲の名前 NCR",
  scopeName("NCR:6-0-0-0:1A1:yusho", t),
  "全国・6艇ともA1の優勝戦",
);
check("範囲の名前 VA", scopeName("VA:20", t), "若松の全レース");
check("範囲の名前 VG", scopeName("VG:20", t), "若松のG1");
check("範囲の名前 NA", scopeName("NA", t), "全国の全レース");
check(
  "層の説明文（G1以上の優勝戦・件数）",
  describeAnalogyLayer({ round: "yusho", grade_g1plus: true }, t, {
    count: 7286,
  }),
  "今日と同じ『G1以上の優勝戦』で、1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番がそろう過去レース7,286件",
);
check(
  "層の説明文（そろえない日・件数なし）",
  describeAnalogyLayer({ round: null, grade_g1plus: false }, t),
  "今日と同じく、1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番がそろう過去レース",
);

// 表記
check("日付", fmtDate("2019-04-01〜2026-09-26"), "2019/4/1〜2026/9/26");
check("平均ST", fmtSt3(0.1333), ".133");
check("展示ST（F）", fmtExhSt(-0.09), "F.09");
check("展示ST", fmtExhSt(0.07), ".07");
check("割合と件数", fmtRateCount([16, 45]), "36%（16/45）");
check("進入", fmtEntry([2, 3, 1, 4, 5, 6]), "312/456");

// スライダーの段（spec B-4）
check("段（15件の層）", sliderSteps(15), [10, 15]);
check("段（800件以上）", sliderSteps(800).length, 12);
check(
  "既定の段（800件）",
  sliderSteps(800)[defaultStepIndex(sliderSteps(800))],
  400,
);
check(
  "既定の段（15件）",
  sliderSteps(15)[defaultStepIndex(sliderSteps(15))],
  15,
);

// 類似レースの集計
const nb = [
  {
    race_id: "2021-10-14-16-12",
    finish: [1, 3, 6],
    technique: "逃げ",
    items: { venue: 1, nat_win_6: 2, is_final_day: -1 },
  },
  {
    race_id: "2019-08-06-11-12",
    finish: [3, 1, 4],
    technique: "まくり",
    items: { venue: 0, nat_win_6: 2 },
  },
  {
    race_id: "2020-01-01-01-01",
    finish: [3, 1, 0],
    technique: null,
    items: {},
  },
].map(normalizeNeighbor);
check(
  "日付・会場・R（race_id から）",
  [nb[0].date, nb[0].venue_code, nb[0].race_number],
  ["2021-10-14", 16, 12],
);
const ag = aggregateNeighbors(nb);
check("集計: 件数（着順の欠けを除く）", ag.n, 2);
check("集計: 1着", ag.win, [1, 0, 1, 0, 0, 0]);
check("集計: 3着以内", ag.hit[3], [2, 0, 2, 1, 0, 1]);
check("集計: 決まり手", ag.tech, { 逃げ: 1, まくり: 1 });
check("3連単", trifectaList(ag.tri, { not1: true }), [[[3, 1, 4], 1]]);
const rates = itemRates(nb, [
  { key: "venue" },
  { key: "nat_win_6" },
  { key: "is_final_day" },
]);
check(
  "同じ割合（会場）",
  [rates.venue.same, rates.venue.near, rates.venue.n],
  [0, 1, 2],
);
check("同じ割合（欠損は数えない）", rates.is_final_day.n, 0);
check("1件の同じ・近い・違う", neighborCounts(nb[0], false), {
  same: 1,
  near: 1,
  diff: 0,
  total: 2,
});

// 展開シナリオの画面の判定
const sh = {
  course: {
    kado4: { kado: { hit: [45, 220], miss: [66, 678] } },
    in_slow02: { d1: { hit: [31, 175], miss: [62, 723] } },
    flat03: { flat: { hit: [3, 20], miss: [100, 900] } },
  },
};
const rows = hintRows(
  sh,
  { kado4: true, in_slow02: true, flat03: true },
  "course",
  wilsonInterval,
);
check(
  "手がかりの札",
  rows.map((r) => [r.id, r.kind]),
  [
    ["kado4", "up"],
    ["in_slow02", "up"],
    ["flat03", "unclear"],
  ],
);
check("札は形ごとに1つ", Object.keys(hintBadgeByForm(rows)), ["kado", "d1"]);
check("min 順位", minRanks([34.2, 37.2, 39, null, 37.2, 30], true), [
  4,
  2,
  1,
  null,
  2,
  5,
]);
check("③の区分", [1, 2, 3, 4, 5, 6, null].map(rankBand), [
  "top",
  "top",
  "mid",
  "mid",
  "low",
  "low",
  null,
]);
check("差がはっきりする", clearDiff([60, 100], [30, 100]), true);
check("差がはっきりしない", clearDiff([6, 10], [5, 10]), false);

// 今日の風・波の数え方（Q-F3）: 波が別の情報を持つ会場だけ風×波、今日の区分が300件未満なら風だけ
const pair = (n) =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((b) => [String(b), { win: [1, n] }]),
  );
const va = (useWave, waveN) => ({
  wind: { "2-3": pair(5000) },
  wind_wave: { "2-3": { "3-5": pair(waveN) } },
  wave_mode: { use_wave: useWave, corr: useWave ? 0.52 : 1 },
});
const exh = { wind_band: "2-3", wind_speed: 3, wave_height: 4 };
check("波の区分", [0, 2, 3, 5, 6, null].map(waveBand), [
  "0-2",
  "0-2",
  "3-5",
  "3-5",
  "6+",
  null,
]);
check(
  "風・波: 波が別の情報で300件以上",
  windWaveView(va(true, 300), exh).mode,
  "wave",
);
check("風・波: 300件以上のときの件数", windWaveView(va(true, 300), exh).n, 300);
check("風・波: 300件未満は風だけ", windWaveView(va(true, 299), exh), {
  mode: "waveFew",
  rows: pair(5000),
  n: 5000,
  waveN: 299,
  wind: "2-3",
  wave: "3-5",
});
check(
  "風・波: 波＝風の会場は風だけ",
  windWaveView(va(false, 9999), exh).mode,
  "wind",
);
check(
  "風・波: 古い集計（wave_mode 無し）は風だけ",
  windWaveView({ wind: { "2-3": pair(10) } }, exh).mode,
  "wind",
);
check(
  "風・波: 波＝風の会場は「波高は風速とほぼ同じ」の注記を出す",
  windWaveView(va(false, 9999), exh).sameAsWind,
  true,
);
check(
  "風・波: 波で分ける会場でも今日の波高が無ければ風だけ・注記は出さない",
  (({ mode, sameAsWind }) => ({ mode, sameAsWind }))(
    windWaveView(va(true, 500), { wind_speed: 3 }),
  ),
  { mode: "wind", sameAsWind: false },
);
check(
  "風・波: Q-F3 より前の集計（wave_mode 無し）は注記を出さない",
  windWaveView({ wind: { "2-3": pair(10) } }, exh).sameAsWind,
  false,
);
check(
  "風・波: 今日の風が無ければ出さない",
  windWaveView(va(true, 500), { wave_height: 3 }),
  null,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log(
  `✅ 優勝戦・準優勝戦の判定 v2: ${cases.length} 件と旧判定から変わる5種の名前が一致。展示後の並べ直しが Python と一致（距離²の差の最大 ${maxDiff.toExponential(1)}）。画面の純粋関数: 順位 ${ui.rank_positions.length}・Wilson ${ui.wilson.length}・判定 ${ui.judge.length} 件が Python と一致`,
);
