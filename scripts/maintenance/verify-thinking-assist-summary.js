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
  factsEntry,
  b1Usual,
  boardFactMark,
  entrySummary,
  exhibitionTable,
  exhToday,
  attackTech,
  descending,
  exhBands,
  hintForms,
  originalBest,
  factChips,
  factsScope,
  formSummary,
  hintSummary,
  partsChangedBoats,
  powerWinners,
  tiltOutliers,
} from "../../src/utils/assistSummary.js";


import { ASSIST_COPY } from "../../src/data/thinkingAssistCopy.js";
import { runThinkingAssistSummaryScenes1 } from "./verifyData/thinking-assist-summary-scenes-1.js";
import { runThinkingAssistSummaryScenes2 } from "./verifyData/thinking-assist-summary-scenes-2.js";
import { runThinkingAssistSummaryScenes3 } from "./verifyData/thinking-assist-summary-scenes-3.js";

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
// 軸の要約の入口1行（2026-10-11 ユーザー決定 案D）: ▲の数と、深掘りの先頭と同じ順の項目2つまで
{
  const e = factsEntry(chipsNc);
  const hits = chipsNc.filter((c) => c.hit);
  check(
    "入口1行: ▲の数・先頭2項目（深掘りの先頭と同じ順）・残りの件数",
    e.hits === hits.length &&
      JSON.stringify(e.keys) ===
        JSON.stringify(hits.slice(0, 2).map((c) => c.key)) &&
      e.rest === Math.max(0, hits.length - 2),
    JSON.stringify(e),
  );
  check(
    "入口1行: ▲が無い日は hits 0、材料が無い（範囲が無い）ときは出さない",
    factsEntry(chipsNc.map((c) => ({ ...c, hit: false }))).hits === 0 &&
      factsEntry([]) === null &&
      factsEntry(null) === null,
  );
  check(
    "入口1行の文: ▲あり・項目名と「ほか{n}件」・▲なし",
    ASSIST_COPY.factsEntry(1, 3) === "1号艇の差がつく材料 ▲3件" &&
      ASSIST_COPY.factsEntryNames(["当地勝率", "平均ST（直近30走）"], 1) ===
        "当地勝率・平均ST（直近30走） ほか1件" &&
      ASSIST_COPY.factsEntryNames(["当地勝率"], 0) === "当地勝率" &&
      ASSIST_COPY.factsEntryNone(1) === "1号艇の全部の材料（今日は▲なし）",
  );
}
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
// ---- 展開レンズの中身（spec D-47 (4)〜(7)、PR-2）----
const na = fx.scenario.NA.scenario;
const forms2 = hintForms(nc, today);
check(
  "当てはまる形: 2コース凹みの1つ（d2_slow01、65/501）",
  forms2.length === 1 &&
    forms2[0].form === "d2" &&
    forms2[0].hit.join() === "65,501",
  JSON.stringify(forms2.map((f) => [f.form, f.id])),
);
const tech2 = attackTech(nc, "d2");
check(
  "もし2コース凹み: 攻める3号艇が1着の36件の決まり手 まくり15・まくり差し17・差し2・ほか2（抜き。合計が36にそろう）",
  tech2?.att === 3 &&
    tech2.w === 36 &&
    JSON.stringify(tech2.rows) ===
      JSON.stringify([
        ["makuri", 15],
        ["makurizashi", 17],
        ["sashi", 2],
        ["other", 2],
      ]),
  JSON.stringify(tech2),
);
const bands2 = exhBands(nc, na, "d2", [2, 2, 4, 1, 6, 4]);
check(
  "今日の展示を入れると: 攻める3号艇（4位・mid）は 14/61・13/53・9/47、1号艇（2位・top）の逃げは 33/78・15/40・15/43",
  bands2.att.today === "mid" &&
    bands2.att.rows.map((r) => `${r.k}/${r.n}`).join() === "14/61,13/53,9/47" &&
    bands2.b1.today === "top" &&
    bands2.b1.rows.map((r) => `${r.k}/${r.n}`).join() === "33/78,15/40,15/43",
  JSON.stringify(bands2),
);
check(
  "今日の展示を入れると: 全国は攻める艇 24%・18%・13%、1号艇の逃げ 59%・51%・46%（どちらも順位が上ほど多い）",
  bands2.att.nat.map((v) => Math.round(v * 100)).join() === "24,18,13" &&
    bands2.b1.nat.map((v) => Math.round(v * 100)).join() === "59,51,46" &&
    descending(bands2.att.nat) &&
    descending(bands2.b1.nat) &&
    !descending([0.3, 0.31, 0.2]),
);
check(
  "今日の展示を入れると: 展示タイムが欠けた日は区分の値だけ出し、今日の区分を付けない",
  exhBands(nc, na, "d2", [2, 2, null, 1, 5, 3]).att.today === null &&
    exhBands(nc, na, "nope", [2, 2, 4, 1, 6, 4]) === null,
);
check(
  "今日の展示を入れると: 攻める艇の無い形（横一線）は1号艇の逃げの区分だけ出す（/code-review 指摘）",
  exhBands(nc, na, "flat", [2, 2, 4, 1, 6, 4])?.att === null &&
    exhBands(nc, na, "flat", [2, 2, 4, 1, 6, 4])?.b1?.today === "top",
);
{
  const rs = [1, 2, 3, 4, 5, 6].map((boat) => ({ boat, absent: false }));
  const org = {
    kinds: ["一周", "まわり足", "直線"],
    byBoat: {
      1: { 一周: 37.31, まわり足: 11.49, 直線: 7.1 },
      2: { 一周: 37.5, まわり足: 11.6, 直線: 6.9 },
      3: { 一周: 37.6, まわり足: 11.7, 直線: 7.0 },
      4: { 一周: 37.4, まわり足: 11.55, 直線: 7.0 },
      5: { 一周: 37.8, まわり足: 11.9, 直線: 7.2 },
      6: { 一周: 37.7, まわり足: 11.8, 直線: 7.3 },
    },
  };
  check(
    "オリジナル展示: 一周・まわり足だけ（直線は出さない）。徳山の例は1号艇が両方とも6艇で一番",
    JSON.stringify(originalBest(org, rs)) ===
      JSON.stringify([
        { kind: "一周", boats: [1] },
        { kind: "まわり足", boats: [1] },
      ]) && originalBest(null, rs).length === 0,
    JSON.stringify(originalBest(org, rs)),
  );
}
// 図の上の「今日の展示」（spec D-47 (3)）。展示タイムの順位 2,2,4,1,6,4 → 攻める3号艇は4位（3〜4位）
const ext = exhToday(nc, "d2", [2, 2, 4, 1, 6, 4]);
check(
  "今日の展示: 攻める3号艇は展示4位（3〜4位）→ 2コース凹みのとき1着 13/53（件数30以上なので割合を出す）",
  ext?.att === 3 &&
    ext.rank === 4 &&
    ext.band === "mid" &&
    ext.k === 13 &&
    ext.n === 53 &&
    ext.few === false,
  JSON.stringify(ext),
);
const ncFew = structuredClone(nc);
ncFew.attack.d2.by_exh.mid.att_win = [1, 4];
check(
  "今日の展示: 区分の件数が30件未満なら few（割合を出さない）",
  exhToday(ncFew, "d2", [2, 2, 4, 1, 6, 4])?.few === true,
);
check(
  "今日の展示: 展示タイムが1艇でも無ければ（区分の表は6艇そろったレースだけ）・形の攻めの集計が無ければ null",
  exhToday(nc, "d2", [2, 2, null, 1, 6, 4]) === null &&
    exhToday(nc, "d2", [2, null, 3, 1, 5, 3]) === null &&
    exhToday(nc, "d2", null) === null &&
    exhToday(nc, "flat", [2, 2, 4, 1, 6, 4]) === null,
);
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
// 機力の結論は展示タイムだけで決めない（BOA-808 2）。徳山10R: 展示タイム・モーター2連率は4号艇、一周・まわり足は1号艇
const motorBest = new Set([4]);
const motor2 = [19.2, 38.0, 25.8, 38.5, 32.7, 30.4];
// オリジナル展示は徳山10R の本番の値（6艇）
const lap = [37.31, 37.94, 38.23, 37.93, 38.26, 37.76];
const turn = [11.49, 11.64, 11.92, 11.87, 12.02, 11.72];
const tblFull = exhibitionTable({
  racers,
  maintenance: null,
  original: {
    kinds: ["一周", "まわり足"],
    byBoat: Object.fromEntries(
      racers.map((r, i) => [r.boat, { 一周: lap[i], まわり足: turn[i] }]),
    ),
  },
});
const conclusion = ASSIST_COPY.powerConclusion(
  powerWinners({
    table: tblFull,
    motor: { best: motorBest, valueOf: (b) => motor2[b - 1] },
  }),
);
check(
  "機力の結論: オリジナル展示の一番（1号艇）も入り、一番の艇が同じ項目はまとまる",
  conclusion ===
    "展示タイム・モーター2連率は4号艇（6.83秒・38.5%）、一周・まわり足は1号艇（37.31秒・11.49秒）が一番",
  conclusion,
);
const conclusionPre = ASSIST_COPY.powerConclusion(
  powerWinners({
    table: null,
    motor: { best: motorBest, valueOf: (b) => motor2[b - 1] },
  }),
);
check(
  "機力の結論: 展示前はモーター2連率だけ",
  conclusionPre === "モーター2連率は4号艇（38.5%）が一番",
  conclusionPre,
);
check(
  "類似レースの3連単の表の注記: 件数は過去、オッズ・人気は今日の時刻（BOA-808 P3）",
  ASSIST_COPY.simTopNote(63, "13:14") ===
    "件数は類似レース63件のうち。オッズ・人気は今日の13:14時点" &&
    ASSIST_COPY.oddsTimes(6.4) === "6.4倍" &&
    // 終わったレースは「今日」と書かない（/code-review の指摘）
    ASSIST_COPY.simTopNote(63, "13:14", true) ===
      "件数は類似レース63件のうち。オッズ・人気はこのレースの13:14時点で、確定オッズではない",
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

// ---- 後半の場面（verifyData/thinking-assist-summary-scenes-1.js・thinking-assist-summary-scenes-2.js・thinking-assist-summary-scenes-3.js） ----
runThinkingAssistSummaryScenes1({ today, facts, check, nc, run, records, RACE });
runThinkingAssistSummaryScenes2({ today, check, s1, hs, conclusion });
runThinkingAssistSummaryScenes3({ fx, check, nc });

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
