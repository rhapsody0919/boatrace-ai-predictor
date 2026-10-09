/**
 * verify-thinking-assist-summary.js - 思考アシスト（BOA-430）のレンズの要約・図の印・深掘りのモデル
 * （src/utils/assistSummary.js）
 *
 * v16 の固定データは 2026-10-06 徳山10R（準優勝戦・1号艇B1）の本番応答（e2e/thinking-assist-fixture.json.gz、
 * 受け入れ E2E と同じもの）。承認モック v7 の数字と一致することを見る:
 *   1号艇の差がつく材料は準優勝戦（NCR 119件）・1着 65/119、2コース凹みの手がかり 65/501（当てはまらない 96/1,956）、
 *   枠なりの2コース凹み 161件・1着 65/18/36/29/10/3、攻め手は3号艇
 * 今節の走・今節より前の5走・コースの1着は作った走で、今日の走を点に入れない（D-29）・今節と後の走を除く（D-36 (10)）・
 * 進入コースで集める（D-36 (11)）ことを見る
 *
 * 実行: node scripts/maintenance/verify-thinking-assist-summary.js
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  axisFactChips,
  b1Usual,
  boardFactMark,
  courseWins,
  entrySummary,
  exhibitionTable,
  factChips,
  factsScope,
  featChips,
  formSummary,
  hintSummary,
  meetRuns,
  monthDay,
  partsChangedBoats,
  priorRuns,
  tiltOutliers,
} from "../../src/utils/assistSummary.js";
import { guideSteps, theoryCard } from "../../src/utils/assistTheory.js";
import { GLOSSARY } from "../../src/data/thinkingAssistCopy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(
  zlib.gunzipSync(
    fs.readFileSync(
      path.join(here, "../../e2e/thinking-assist-fixture.json.gz"),
    ),
  ),
);
const today = fx.facts.today;
const facts = fx.facts.facts;

let failures = 0;
const check = (label, pass, detail = "") => {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};

// ---- 差がつく材料の範囲（D-37）----
const s1 = factsScope(facts, today, 1, "junyu");
check(
  "準優勝戦の日・1号艇: VC 75件は少ないので全国、さらに同じラウンドの NCR 119件に絞る",
  s1?.kind === "NCR" &&
    s1.n === 119 &&
    s1.fellBack === true &&
    s1.vcCount === 75,
  JSON.stringify({ kind: s1?.kind, n: s1?.n }),
);
const u1 = b1Usual(s1);
check("1号艇の1着 65/119（返還を含む）", u1?.k === 65 && u1?.n === 119);
const s1n = factsScope(facts, today, 1, null);
check(
  "予選（ラウンドなし）なら NC 3,339件のまま",
  s1n?.kind === "NC" && s1n.n === 3339,
);
const s2 = factsScope(facts, today, 2, "junyu");
check(
  "2号艇: 徳山の級の並びが同じ 451件（300件以上）なので VC のまま（NCR に絞らない）",
  s2?.kind === "VC" && s2.n === 451,
);

// ---- 差がつく材料の札（FR-5・v16 Q7）----
const chipsNc = factChips({
  scope: s1n,
  today,
  boat: 1,
  post: false,
  finalRound: true,
});
const series = chipsNc.find((c) => c.key === "series_score");
check(
  "準優勝戦の日の今節の平均着順点は off（今日に使わない）",
  series?.off === true && series.hit === false,
);
const st = chipsNc.find((c) => c.key === "st_mean30");
check(
  "平均ST は1号艇が6艇で一番早い → hit・一番早いときの割合（NC の 1着 123/277）",
  st?.bucket === 1 && st.hit && st.pair[0] === 123 && st.pair[1] === 277,
  JSON.stringify(st),
);
const motor = chipsNc.find((c) => c.key === "motor_2");
check(
  "モーター2連率は1号艇が6艇で最下位 → bucket 6・最下位のときの割合 205/675",
  motor?.bucket === 6 && motor.pair[0] === 205 && motor.pair[1] === 675,
  JSON.stringify(motor),
);
const axisChips = axisFactChips(chipsNc);
check(
  "軸の要約の札: 差が大きい項目だけ・今日当てはまるものが先・4つまで",
  axisChips.length <= 4 &&
    axisChips.every((c) => c.level === "large") &&
    axisChips[0].hit,
);
check(
  "図の良い方の札: 一番良い（bucket 1）だけ。1号艇は平均ST",
  boardFactMark(chipsNc)?.key === "st_mean30",
);
check(
  "図の良い方の札: 一番悪い側（モーター最下位）は図に出さない",
  boardFactMark(chipsNc.filter((c) => c.key === "motor_2")) === null,
);

// ---- 展開（手がかり・形・進入）----
const nc = fx.scenario[today.scope_keys["1"].NC].scenario;
const hs = hintSummary(nc, today);
check(
  "今日の手がかりは 2コースの平均STが遅い（d2_slow01）: 当てはまるとき 65/501・当てはまらないとき 96/1,956",
  hs.top?.id === "d2_slow01" &&
    hs.top.hit[0] === 65 &&
    hs.top.hit[1] === 501 &&
    hs.top.miss[0] === 96 &&
    hs.top.miss[1] === 1956,
  JSON.stringify(hs.top),
);
const fm = formSummary(nc, "d2");
check(
  "2コース凹み（枠なり）161件・1着 [65,18,36,29,10,3]・攻め手は3号艇・よく出た3連単の先頭は 9件",
  fm?.n === 161 &&
    fm.first.join() === "65,18,36,29,10,3" &&
    fm.attacker === 3 &&
    fm.topTrifecta[0][1] === 9 &&
    !fm.few,
);
check("形の集計が無ければ null", formSummary(nc, "nope") === null);
const en = entrySummary(nc, [1, 2, 3, 4, 5, 6]);
check(
  "進入: 枠なり → 型 waku、そのときの1号艇の1着（scenario の waku の値）",
  en?.type === "waku" && en.n === nc.cells.waku.forms.any.n,
);
const enMae = entrySummary(nc, [1, 2, 3, 4, 6, 5]);
check(
  "進入: 前付け（6号艇）→ 型 mae6、割合は前付けをまとめた mae の値",
  enMae?.type === "mae6" &&
    enMae.group === "mae" &&
    enMae.n === nc.cells.mae.forms.any.n,
);
check(
  "進入が1艇でも分からなければ出さない",
  entrySummary(nc, [1, 2, null, 4, 5, 6]) === null,
);

// ---- 機力（展示の表・チルト・部品交換）----
const racers = [1, 2, 3, 4, 5, 6].map((boat, i) => ({
  boat,
  absent: false,
  exhTime: [6.84, 6.84, 6.89, 6.83, 6.9, 6.89][i],
  exhSt: [0.07, 0.17, 0.06, 0.05, 0.01, 0.12][i],
  exhFlying: boat === 5,
  tilt: [0, 0, 0, 0, -0.5, -0.5][i],
}));
const tbl = exhibitionTable({
  racers,
  maintenance: racers.map((r, i) => ({
    boat_number: r.boat,
    today_weight: [52.8, 52.0, 51.0, 52.0, 52.7, 52.0][i],
  })),
  original: {
    kinds: ["一周", "まわり足", "謎の項目"],
    byBoat: { 1: { 一周: 37.31, まわり足: 11.49 }, 2: { 一周: 37.94 } },
  },
});
check(
  "展示の表: 展示タイムの最良は 6.83 の4号艇、展示ST は F の5号艇（.01）を外して 4号艇（.05）",
  [...tbl.best.exh].join() === "4" && [...tbl.best.exhSt].join() === "4",
);
check(
  "展示の表: 知らないオリジナル展示の種別は列にしない・一番軽い艇（51.0kg の3号艇）に印",
  tbl.kinds.join() === "一周,まわり足" &&
    tbl.rows
      .filter((r) => r.light)
      .map((r) => r.boat)
      .join() === "3",
);
check(
  "チルト: 一番多い値（0）と違う艇だけ（5・6号艇の -0.5）",
  [...tiltOutliers(racers).keys()].join() === "5,6",
);
check(
  "チルト: 全艇ばらばらなら印を付けない",
  tiltOutliers(racers.map((r, i) => ({ ...r, tilt: i * 0.5 }))).size === 0,
);
check(
  "部品交換: 部品名の配列が空でない艇とプロペラ交換の艇",
  partsChangedBoats([
    { boat_number: 1, parts_changed: [] },
    { boat_number: 2, parts_changed: ["リング×２"] },
    { boat_number: 3, propeller_change: "新" },
    { boat_number: 4, parts_changed: null },
  ]).join() === "2,3",
);

// ---- 深掘り（今節・今節より前の5走・コースの1着）----
// 表示中のレースは 2026-10-06 徳山10R。今節は 10/2〜10/6 の徳山（会場18）、前節は 9/27〜9/29 の尼崎（会場13）
const run = (raceId, boat, finish, course = boat) => {
  const ranks = {};
  for (let k = 1; k <= 6; k++) ranks[`rank${k}`] = null;
  if (finish) ranks[`rank${finish}`] = boat;
  return {
    raceId,
    date: raceId.slice(0, 10),
    venueCode: Number(raceId.slice(11, 13)),
    boatNumber: boat,
    actualCourse: course,
    entryCourse: course,
    ...ranks,
  };
};
const records = [
  run("2026-09-27-13-03", 1, 2),
  run("2026-09-27-13-08", 3, 1, 1),
  run("2026-09-28-13-04", 3, 2),
  run("2026-09-28-13-12", 5, 6),
  run("2026-09-29-13-02", 1, 1),
  run("2026-09-29-13-10", 6, 4),
  run("2026-10-02-18-02", 5, 2),
  run("2026-10-02-18-10", 4, 2),
  run("2026-10-03-18-06", 1, 1),
  run("2026-10-05-18-02", 2, 1),
  run("2026-10-05-18-10", 3, 1),
  run("2026-10-06-18-03", 5, 3), // 今日の前の走（点に入れない）
  run("2026-10-06-18-12", 1, 1), // 表示中のレースより後
];
const RACE = "2026-10-06-18-10";
const meet = meetRuns(records, RACE);
check(
  "今節: 今日の走（10/6 3R）は点に入れず、後の走（12R）は入れない。過去5走 8+8+10+10+10=46点",
  meet.today.length === 1 &&
    meet.today[0].raceId === "2026-10-06-18-03" &&
    meet.past.length === 5 &&
    meet.sum === 46 &&
    meet.count === 5 &&
    meet.avg === 46 / 5,
  JSON.stringify({
    sum: meet.sum,
    count: meet.count,
    today: meet.today.length,
  }),
);
check(
  "今節の着順の並びは日ごと",
  meet.byDay.map((d) => `${d.date.slice(5)}:${d.finishes.join("")}`).join() ===
    "10-02:22,10-03:1,10-05:11",
);
const prior = priorRuns(records, RACE, [...meet.past, ...meet.today]);
check(
  "今節より前の5走: 今節と後の走を除いて新しい順に5走（9/29 10R から）",
  prior.length === 5 &&
    prior[0].raceId === "2026-09-29-13-10" &&
    prior[4].raceId === "2026-09-27-13-08",
  prior.map((r) => r.raceId).join(),
);
const cw = courseWins(records, RACE, 1);
check(
  "1コースで走ったとき: 進入コースで集める（3号艇で1コースに入った 9/27 8R を含む）。表示中より後は入れない → 1着 3/4",
  cw.k === 3 && cw.n === 4,
  JSON.stringify(cw),
);

// ---- 成績から付けた札（D-41）----
const feats = featChips({ boat: 1, today, finalRound: true }).map((f) => f.id);
check(
  "1号艇: 平均ST が一番早い → スタートが早い。準優勝戦の日は今節好調を出さない",
  feats.includes("stFast") && !feats.includes("seriesGood"),
  feats.join(),
);
check(
  "予選なら今節の平均着順点が一番高い1号艇に今節好調",
  featChips({ boat: 1, today, finalRound: false })
    .map((f) => f.id)
    .includes("seriesGood"),
);
check(
  "当地勝率 0.00（6号艇）は当地の記録なし",
  featChips({ boat: 6, today, finalRound: true })
    .map((f) => f.id)
    .includes("locNone"),
);
const tech = featChips({
  boat: 4,
  today,
  finalRound: true,
  technique: {
    win_count: 11,
    techniques: [
      { technique: "まくり", count: 4 },
      { technique: "逃げ", count: 3 },
    ],
  },
}).find((f) => f.id === "tech");
check(
  "勝ち決まり手: 逃げ以外が1着8回以上の3割以上 → 「まくりで勝つことが多い」",
  tech?.technique === "まくり" && tech.wins === 11 && tech.count === 4,
);

// data-accuracy-verifier の指摘: F・失格は0点で走数に入れ、欠場は入れない（v16 の今節の平均着順点と同じ）
const fRun = {
  ...run("2026-09-28-14-01", 1, null),
  flyingStartTiming: 0.02,
  finishMark: "F",
};
const absentRun = {
  ...run("2026-09-28-14-03", 3, null),
  absent: true,
  finishMark: "欠",
};
const meetF = meetRuns(
  [
    run("2026-09-27-14-02", 2, 1),
    run("2026-09-27-14-09", 4, 3),
    fRun,
    absentRun,
    run("2026-09-28-14-11", 5, 1),
  ],
  "2026-09-29-14-05",
);
check(
  "今節に F（0点・走数に入れる）と欠場（入れない）: 10+6+0+10=26点÷4走",
  meetF.sum === 26 && meetF.count === 4 && meetF.avg === 6.5,
  JSON.stringify({ sum: meetF.sum, count: meetF.count }),
);
check(
  "着順の並びには着の無い走の記号（F）を出す",
  meetF.byDay.map((d) => d.finishes.join("")).join("/") === "13/F欠1",
  JSON.stringify(meetF.byDay),
);

// /code-review 指摘3: 着順の並びと1走ずつの表で日付の書き方をそろえる（日の0埋めをしない）
check(
  "日付は「10/2」（月・日とも0埋めしない）",
  monthDay("2026-10-02") === "10/2" && monthDay("2026-09-29") === "9/29",
);

// ---- セオリーカード（FR-6、PR5）。承認モック v7 の数字と一致すること ----
const theoryFacts = [1, 2, 3, 4, 5, 6].map((boat) => {
  const scope = factsScope(facts, today, boat, "junyu");
  return {
    scope,
    chips: factChips({ scope, today, boat, post: false, finalRound: true }),
  };
});
const tctx = {
  post: false,
  venue: "徳山",
  round: "junyu",
  roundLabel: "準優勝戦",
  scenario: nc,
  today,
  v16Exhibition: null,
  courseByBoat: null,
  boatFacts: theoryFacts,
  racers: [],
  vaFacts: facts["VA:18"],
  wind: { speed: 4, dir: "北西", wave: 4 },
  partsBoats: null,
  b1Exh: null,
  scopeLabelOf: (sc) => sc.kind,
};
const cS = theoryCard("TC-S:d2", tctx);
check(
  "TC-S 2コース凹み: 枠なり161件・攻める艇（3号艇）の1着 36/161・1号艇の1着 65/161、今日は「手がかりあり 13%」で当てはまるとは書かない",
  cS.meas.bars[0].k === 36 &&
    cS.meas.bars[0].n === 161 &&
    cS.meas.bars[1].k === 65 &&
    cS.meas.tag === "攻める艇が1着にならなかった 78%" &&
    // 形は本番の結果なので「今日当てはまる」にしない（ファン評価 PR5 1周目 指摘2）
    cS.today.state === "pending" &&
    cS.today.text.includes("13%"),
  JSON.stringify(cS.meas),
);
const cH = theoryCard("TC-H:d2_slow01", tctx);
check(
  "TC-H 2コースの平均STが遅い: 当てはまるとき 65/501・当てはまらないとき 96/1,956、決め手ではないの注記",
  cH.meas.bars[0].k === 65 &&
    cH.meas.bars[0].n === 501 &&
    cH.meas.bars[1].k === 96 &&
    cH.meas.bars[1].n === 1956 &&
    cH.meas.notes.some((n) => n.includes("決め手ではなく手がかり")),
  JSON.stringify(cH.meas),
);
check(
  "TC-H は今日の平均ST（このコース）の値を添える（2号艇 .16、ファン評価 PR5 1周目 指摘7）",
  cH.today.text.includes("2号艇 .16") && cH.today.text.includes("3号艇 .14"),
  cH.today.text,
);
const cE = theoryCard("TC-E:waku", tctx);
check(
  "TC-E 枠なり: 展示前は「進入は展示の後に分かる」、出現 2,463/3,276・1号艇の1着 870/2,463",
  cE.today.state === "pending" &&
    cE.today.text === "進入は展示の後に分かる" &&
    cE.meas.bars[0].k === 2463 &&
    cE.meas.bars[0].n === 3276 &&
    cE.meas.bars[1].k === 870,
  JSON.stringify(cE),
);
const cF = theoryCard("TC-F:1:motor_2", tctx);
check(
  "TC-F 1号艇のモーター2連率: 今日は一番低い、一番高いとき 19/40・一番低いとき 15/26、差ははっきりしない",
  cF.today.text === "今日の1号艇は6艇で一番低い" &&
    cF.meas.bars[0].k === 19 &&
    cF.meas.bars[1].k === 15 &&
    cF.meas.bars[1].n === 26 &&
    cF.meas.tag === "件数が少なく差ははっきりしない",
  JSON.stringify(cF.meas),
);
const cV = theoryCard("TC-V1", tctx);
check(
  "TC-V1 徳山の全レース 11,008/17,552 と NCR 65/119 を並べ、範囲が違うと書く",
  cV.meas.bars[0].k === 11008 &&
    cV.meas.bars[0].n === 17552 &&
    cV.meas.bars[1].k === 65 &&
    cV.meas.notes[0].includes("範囲が違う"),
);
const cWpre = theoryCard("TC-W1", tctx);
const cWpost = theoryCard("TC-W1", { ...tctx, post: true });
check(
  "TC-W1 展示前は「風は展示の後に分かる」で数値を出さない。展示後は風速4〜5m 4,040件・1号艇 2,352件、TC-T1・T2 を並べる",
  cWpre.today.state === "pending" &&
    cWpre.meas === null &&
    cWpost.meas.scope === "徳山・風速4〜5m 4,040件" &&
    Math.abs(cWpost.meas.table[0].p - (2352 / 4040) * 100) < 1e-9 &&
    cWpost.also.map((c) => c.id).join() === "TC-T1,TC-T2",
  JSON.stringify(cWpost.meas?.scope),
);
const cT6 = theoryCard("TC-T6", tctx);
check(
  "文だけのカード（TC-T6 部品交換）は過去レースの傾向を出さない（準備中）",
  cT6.meas === null,
);
const cT7 = theoryCard("TC-T7", tctx);
check(
  "TC-T7 スジは、今日の手がかりの形（2コース凹み161件）のよく出た3連単を関連の実データとして添える",
  cT7.related?.includes("161件") && cT7.related.includes("1-3-4（9件）"),
  cT7.related,
);
// 用語の辞書・カードの文に禁止語が無い（D-41・D-42・N-7）
const BANNED = /数え|集計|算出|対象|似た|似てい|ふつう|いつも|競艇|鉄板|大本線/;
const theoryTexts = [
  "TC-S:flat",
  "TC-S:wall",
  "TC-S:d2",
  "TC-S:d3",
  "TC-S:kado",
  "TC-S:d1",
  "TC-S:dash",
  "TC-H:d2_slow01",
  "TC-E:waku",
  "TC-E:mae",
  "TC-E:inlost",
  "TC-F:1:motor_2",
  "TC-V1",
  "TC-T1",
  "TC-T2",
  "TC-T3",
  "TC-T4",
  "TC-T5",
  "TC-T6",
  "TC-T7",
  "TC-T8",
  "TC-T9",
  "TC-T10",
  "TC-X1",
].map((id) => JSON.stringify(theoryCard(id, { ...tctx, post: true })));
const bannedHits = [
  JSON.stringify(GLOSSARY),
  JSON.stringify(cWpost),
  ...theoryTexts,
]
  .map((t) => t.match(BANNED)?.[0])
  .filter(Boolean);
check(
  "セオリーカード・用語の文に禁止語が無い",
  bannedHits.length === 0,
  bannedHits.join(","),
);
const steps = guideSteps({ post: false, rough: null, hintTop: hs.top });
check(
  "ガイドは5段（軸・軸・展開・機力・買い目）、各段の1文は40字以内、展示前の④は展示の値を出さない",
  steps.map((x) => x.lens).join() === "axis,axis,flow,power,bet" &&
    steps.every((x) => x.sub.length <= 40 && x.q.length <= 40) &&
    !steps[3].sub.includes("金枠"),
  JSON.stringify(steps.map((x) => x.sub)),
);

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
