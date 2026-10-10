/**
 * verify-thinking-assist-model.js - 思考アシスト（BOA-430）の画面のモデル（src/utils/assistModel.js）
 *
 * 固定データは 2026-10-06 徳山10R（準優勝戦・1号艇B1）の本番 v16 API の値
 * （scripts/lib/__fixtures__/thinking-assist/tokuyama-2026-10-06-10r.json）。モック v7・spec の数字と一致することを見る:
 *   全国・級の並びが同じ 3,276件・1号艇の1着 1,074・万舟 713、準優勝戦に絞ると 112件・65・23、類似レース 63件・万舟 11件
 *
 * 実行: node scripts/maintenance/verify-thinking-assist-model.js
 */
import { shouldOpenAssist, showNewBadge } from "../../src/utils/raceView.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baseVerdict,
  bestBoats,
  betForm,
  boardModel,
  buildRacers,
  classLineup,
  firstPlaceComposite,
  hasPricedTicket,
  raceRound,
  roughCard,
  roughState,
  sameClassLabel,
  sameClassScope,
  similarSummary,
  stageFromExhibition,
  venueTechniqueTrend,
} from "../../src/utils/assistModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(
  fs.readFileSync(
    path.join(
      here,
      "../lib/__fixtures__/thinking-assist/tokuyama-2026-10-06-10r.json",
    ),
  ),
);

let failures = 0;
const check = (label, pass, detail = "") => {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};
const pct = (x) => Math.round(x * 100);

// ---- ラウンド（D-36 (4)）----
check(
  "raceRound: v16 の round が優先、無ければ raceStage（準優勝戦・優勝戦・準優進出戦は対象外）",
  raceRound({ round: "junyu" }, null) === "junyu" &&
    raceRound(null, "準優勝戦") === "junyu" &&
    raceRound(null, "優勝戦") === "yusho" &&
    raceRound(null, "準優進出戦") === null &&
    raceRound({ round: "yosen" }, "一般") === null,
);
// v16 がラウンドを持つときは出走表より優先する（予選と言っているのに出走表の準優勝戦へ戻さない。Codex 依頼25 F01）
check(
  "raceRound: v16 の round が優勝戦・準優勝戦以外なら、出走表が準優勝戦・優勝戦でも null",
  raceRound({ round: "yosen" }, "準優勝戦") === null &&
    raceRound({ round: "other" }, "優勝戦") === null &&
    raceRound({ round: null }, "優勝戦") === "yusho",
);

// ---- 全国・級の並びが同じ（D-37）----
const scope = sameClassScope({ today: fx.today, scenarios: fx.scenario });
check(
  "準優勝戦の日は同じラウンド（NCR）: 112件・1号艇の1着 65・万舟 23、呼び名「全国・級の並びが同じ準優勝戦」",
  scope?.kind === "NCR" &&
    scope.cell.n === 112 &&
    scope.cell.b1_win === 65 &&
    scope.cell.manshu === 23 &&
    !scope.few &&
    sameClassLabel(scope) === "全国・級の並びが同じ準優勝戦",
  JSON.stringify({ kind: scope?.kind, n: scope?.cell?.n }),
);
check(
  "開いた中の「予選も含めると」はラウンドを問わない NC: 3,276件・1,074（33%）",
  scope?.withoutRound?.n === 3276 &&
    scope.withoutRound.b1_win === 1074 &&
    pct(scope.withoutRound.b1_win / scope.withoutRound.n) === 33,
);
const na = fx.scenario.NA.scenario.cells.all.forms.any;
const card = roughCard(scope, na);
check(
  "準優勝戦 112件の1号艇の1着 58% は全国の全レース 55% と差ははっきりしない（矢印なし）",
  pct(card.b1.rate) === 58 &&
    pct(card.b1.base) === 55 &&
    card.b1.verdict === "unclear",
  JSON.stringify(card.b1),
);

// NCR が30件未満なら NC に戻して few（矢印・言葉なし。D-37）
const keys = fx.today.scope_keys["1"];
const fewScenarios = {
  ...fx.scenario,
  [keys.NCR]: {
    scenario: {
      cells: {
        all: {
          forms: {
            any: { n: 29, b1_win: 20, manshu: 3, payout_known: 29 },
          },
        },
      },
    },
  },
};
const fewScope = sameClassScope({
  today: fx.today,
  scenarios: fewScenarios,
});
const fewCard = roughCard(fewScope, na);
check(
  "NCR が30件未満なら NC（3,276件）に戻し、few で verdict は null（「件数少なめ」）",
  fewScope.kind === "NC" &&
    fewScope.cell.n === 3276 &&
    fewScope.few === true &&
    fewCard.b1.verdict === null &&
    fewCard.few === true &&
    sameClassLabel(fewScope) === "全国・級の並びが同じ",
);
const noNcrToday = {
  ...fx.today,
  scope_keys: { 1: { ...keys, NCR: undefined } },
};
check(
  "NCR のキーが無い準優勝戦も NC に戻して few",
  sameClassScope({ today: noNcrToday, scenarios: fx.scenario })?.few === true,
);

// 予選のレース（round なし）は NC のまま、3,276件の1号艇の1着 33% は全国 55% より低め（モック v7 の「33% ↓」）
const yosenScope = sameClassScope({
  today: { ...fx.today, round: null },
  raceStage: "予選",
  scenarios: fx.scenario,
});
const yosenCard = roughCard(yosenScope, na);
check(
  "予選の日は NC: 1号艇の1着 33% は全国の全レース 55% より低め、万舟は 713/3,276",
  yosenScope.kind === "NC" &&
    !yosenScope.few &&
    pct(yosenCard.b1.rate) === 33 &&
    yosenCard.b1.verdict === "low" &&
    yosenCard.manshu.k === 713 &&
    yosenCard.manshu.n === 3276,
  JSON.stringify(yosenCard),
);
check(
  "baseVerdict: n=0 は null（行を出さない）、基準より上に外れれば高め",
  baseVerdict(0, 0, 0.5) === null &&
    baseVerdict(90, 100, 0.5).verdict === "high",
);

// ---- 類似レース（D-35・D-36 (3)）----
const sim = similarSummary(fx.similar);
check(
  "類似レース: 層が63件（400件以下）なので全件、63件・万舟 11/63、1号艇の1着 34",
  sim.n === 63 &&
    sim.nLayer === 63 &&
    sim.allInLayer &&
    sim.manshu.k === 11 &&
    sim.manshu.n === 63 &&
    sim.win[0] === 34,
  JSON.stringify({ n: sim.n, manshu: sim.manshu, win1: sim.win[0] }),
);
check(
  "類似レース: よく出た3連単は上位3組に件数",
  sim.topTrifecta.length === 3 &&
    sim.topTrifecta.every(([combo, c]) => combo.length === 3 && c > 0),
);
// 着順が無効の件・払戻 null の件・層 > 400（D-36 (3)）
const synthetic = {
  n_layer: 1000,
  neighbors: Array.from({ length: 500 }, (_, i) => ({
    finish: i === 0 ? [1, 1] : [1, 2, 3, 4, 5, 6],
    technique: "逃げ",
    payout_3tan: i === 1 ? null : i < 10 ? 12000 : 800,
  })),
};
const s2 = similarSummary(synthetic);
check(
  "類似レース: 層 > 400 は上位400件、件数は着順が有効な件（399）、万舟は払戻のある件（399件中9件。着順が無効でも払戻があれば数える）",
  s2.n === 399 && !s2.allInLayer && s2.manshu.n === 399 && s2.manshu.k === 9,
  JSON.stringify({ n: s2.n, manshu: s2.manshu }),
);

// ---- 級の並び（D-31）----
const lineup = classLineup(fx.today.classes, 1);
check(
  "級の並び: 1号艇 B1 固定、残りは今日の艇番順（A2・A1・A2・A1・B1）",
  lineup.map((x) => x.cls).join(",") === "B1,A2,A1,A2,A1,B1" &&
    lineup
      .filter((x) => x.fixed)
      .map((x) => x.boat)
      .join() === "1",
);

// ---- 最良の金枠（FR-3a）----
const v = (arr) => arr.map((value, i) => ({ boat: i + 1, value }));
check(
  "bestBoats: 全国勝率は max・2桁（同値の最良は全部）",
  [...bestBoats("nat_win", v([5.1, 6.333, 6.33, 4, null, 5]))].join() === "2,3",
);
check(
  "bestBoats: 平均ST は min・3桁",
  [
    ...bestBoats("st_mean30", v([0.15, 0.131, 0.14, 0.2, 0.16, 0.18])),
  ].join() === "2",
);
check(
  "bestBoats: 当地勝率の 0.00 は記録なし（最良にも比べる値にもしない）",
  [...bestBoats("loc_win", v([0, 0, 0, 0, 0, 5.2]))].join() === "" &&
    [...bestBoats("loc_win", v([0, 4.1, 6.2, null, 3, 5.2]))].join() === "3",
);
check(
  "bestBoats: 展示ST の F は候補から外す",
  [
    ...bestBoats("exh_st", [
      { boat: 1, value: 0.01, flying: true },
      { boat: 2, value: 0.08 },
      { boat: 3, value: 0.12 },
    ]),
  ].join() === "2",
);
check(
  "bestBoats: 走数が少ない最良には付けず、次の艇にも繰り下げない",
  [
    ...bestBoats("course_win", [
      { boat: 1, value: 80, runs: 3 },
      { boat: 2, value: 40, runs: 20 },
      { boat: 3, value: 20, runs: 20 },
    ]),
  ].join() === "",
);
check(
  "bestBoats: 優勝戦・準優勝戦の今節の平均着順点には付けない",
  bestBoats("series_score", v([8.57, 7, 6, 5, 4, 3]), { finalRound: true })
    .size === 0 &&
    [...bestBoats("series_score", v([8.57, 7, 6, 5, 4, 3]))].join() === "1",
);

// ---- 会場の決まり手（D-37 U-18）----
const row = (days, technique, count, total) => ({
  period_days: days,
  winning_technique: technique,
  race_count: count,
  total_races: total,
});
// 徳山（2026-10-05 時点）: 365日 2,592件・逃げ 1,516、90日 612件・逃げ 339
const tokuyama = venueTechniqueTrend([
  row(365, "逃げ", 1516, 2592),
  row(365, "差し", 317, 2592),
  row(365, "まくり", 332, 2592),
  row(365, "まくり差し", 240, 2592),
  row(365, "抜き", 175, 2592),
  row(365, "恵まれ", 12, 2592),
  row(90, "逃げ", 339, 612),
  row(90, "差し", 79, 612),
  row(90, "まくり", 80, 612),
  row(90, "まくり差し", 58, 612),
  row(90, "抜き", 52, 612),
  row(90, "恵まれ", 4, 612),
]);
const nige = tokuyama.rows.find((r) => r.technique === "逃げ");
check(
  "会場の決まり手: 徳山 365日 逃げ 58%（1,516/2,592）、90日 55%、前の275日 59%。印は付かない",
  tokuyama.total365 === 2592 &&
    pct(nige.rate365) === 58 &&
    pct(nige.rate90) === 55 &&
    pct(nige.ratePrev) === 59 &&
    tokuyama.rows.every((r) => r.mark === null),
  JSON.stringify(nige),
);
// 平和島の逃げ（実測 44.4%→36.6%）のように、90日と前の275日のぶれ幅が重ならなければ「最近↓」
const heiwajima = venueTechniqueTrend([
  row(365, "逃げ", 1000 * 0.42, 1887),
  row(90, "逃げ", 220, 600),
  row(365, "差し", 1467, 1887),
  row(90, "差し", 380, 600),
]);
const hNige = heiwajima.rows.find((r) => r.technique === "逃げ");
check(
  "会場の決まり手: 90日 37% 対 前の275日 15%台のように重ならなければ印、向きは90日の側から",
  hNige.mark === "up",
  JSON.stringify(hNige),
);
const down = venueTechniqueTrend([
  row(365, "逃げ", 838, 1887),
  row(90, "逃げ", 168, 459),
  row(365, "差し", 1049, 1887),
  row(90, "差し", 291, 459),
]);
check(
  "会場の決まり手: 90日 36.6% 対 前の275日 47.0% は「最近↓」",
  down.rows.find((r) => r.technique === "逃げ").mark === "down",
  JSON.stringify(down.rows[0]),
);
check(
  "会場の決まり手: 想定外の決まり手（逃げ抜き）は「その他」に寄せる、365日が無ければ null",
  venueTechniqueTrend([
    row(365, "逃げ", 10, 11),
    row(365, "逃げ抜き", 1, 11),
  ]).rows.some((r) => r.technique === "その他") &&
    venueTechniqueTrend([row(90, "逃げ", 1, 1)]) === null &&
    venueTechniqueTrend([]) === null,
);

// ---- 時点（D-36 (1)）----
const exh = [1, 2, 3, 4, 5, 6].map((boat) => ({ boat, time: 6.8 }));
check(
  "時点: 出走する艇の展示タイムが全部そろえば展示後、1艇でも欠ければ展示前、欠場の艇は数えない",
  stageFromExhibition(exh, [1, 2, 3, 4, 5, 6]) === "post" &&
    stageFromExhibition(exh.slice(0, 5), [1, 2, 3, 4, 5, 6]) === "pre" &&
    stageFromExhibition(exh.slice(0, 5), [1, 2, 3, 4, 5]) === "post" &&
    stageFromExhibition([], []) === "pre",
);

// ---- レースの図（screens「レンズごとの図 C」、PR3）----
// 展示は本番 exhibition_data（2026-10-06 徳山10R）の値。5号艇は展示 F（start_flag "F"）
const exhibitionRows = [
  { boat: 1, time: 6.84, st: 0.07, startFlag: null, absent: false },
  { boat: 2, time: 6.84, st: 0.17, startFlag: null, absent: false },
  { boat: 3, time: 6.89, st: 0.06, startFlag: null, absent: false },
  { boat: 4, time: 6.83, st: 0.05, startFlag: null, absent: false },
  { boat: 5, time: 6.9, st: 0.01, startFlag: "F", absent: false },
  { boat: 6, time: 6.89, st: 0.12, startFlag: null, absent: false },
];
// 出走表（getPredictions の players は aiScore 順。艇番は number）
const players = [3, 1, 5, 2, 4, 6].map((n) => ({
  number: n,
  name: [
    "三馬 崇史",
    "仲道 大輔",
    "西岡 顕心",
    "中村 栄治",
    "濱野 斗馬",
    "倉富 大誠",
  ][n - 1],
  grade: fx.today.classes[n - 1],
  winRate: String(fx.today.items.nat_win.values[n - 1]),
  localWinRate: String(fx.today.items.loc_win.values[n - 1]),
  motor2Rate: String(fx.today.items.motor_2.values[n - 1]),
}));
const racers = buildRacers({
  players,
  today: fx.today,
  exhibition: exhibitionRows,
  rates: [
    { boat_number: 3, f_count: 1 },
    { boat_number: 6, f_count: 1 },
  ],
});
check(
  "buildRacers: 艇番順に並べ直し、苗字・級・勝率・平均ST（v16）・展示・F を艇ごとにそろえる",
  racers.map((r) => r.boat).join() === "1,2,3,4,5,6" &&
    racers[0].surname === "三馬" &&
    racers[0].cls === "B1" &&
    racers[2].natWin === 7.29 &&
    racers[0].stMean === 0.132 &&
    racers[4].exhFlying === true &&
    racers[2].fCount === 1 &&
    racers[0].fCount === null,
  JSON.stringify(racers[0]),
);
const axis = boardModel({
  lens: "axis",
  stage: "post",
  racers,
  finalRound: true,
});
const bestOfNum = (m, i) =>
  m.rows
    .filter((r) => r.nums[i]?.best)
    .map((r) => r.boat)
    .join();
check(
  "軸レンズ: 横軸は全国勝率、数字は勝率と平均ST の2個（N-2）。最良は勝率=3号艇（7.29）、平均ST=1号艇（.132、小さいほど良い）",
  axis.title === "全国勝率" &&
    axis.rows.every((r) => r.nums.length === 2) &&
    bestOfNum(axis, 0) === "3" &&
    bestOfNum(axis, 1) === "1" &&
    axis.rows[0].nums[1].text === ".132" &&
    axis.rows[0].nums[1].aria === "0.132",
);
const loc = boardModel({
  lens: "axis",
  stage: "post",
  metric: "loc_win",
  racers,
  finalRound: true,
});
check(
  "6艇比較（当地勝率）: 0.00 の6号艇は「記録なし」で点を置かず、最良は3号艇（7.57）",
  loc.rows[5].x === null &&
    loc.rows[5].nums[0].text === "記録なし" &&
    bestOfNum(loc, 0) === "3",
);
check(
  "6艇比較（今節の平均着順点）: 準優勝戦の日は最良を付けない（FR-3a）。予選の日は1号艇（8.57）",
  bestOfNum(
    boardModel({
      lens: "axis",
      stage: "post",
      metric: "series_score",
      racers,
      finalRound: true,
    }),
    0,
  ) === "" &&
    bestOfNum(
      boardModel({
        lens: "axis",
        stage: "post",
        metric: "series_score",
        racers,
        finalRound: false,
      }),
      0,
    ) === "1",
);
const flow = boardModel({
  lens: "flow",
  stage: "post",
  racers,
  finalRound: true,
});
check(
  "展開レンズ（展示後）: 展示ST。5号艇の F.01 は最良の候補から外し、最良は4号艇（.05）",
  flow.rows[4].dotText === "F.01" &&
    flow.rows
      .filter((r) => r.dotBest)
      .map((r) => r.boat)
      .join() === "4",
);
const flowPre = boardModel({
  lens: "flow",
  stage: "pre",
  racers,
  finalRound: true,
});
check(
  "展開レンズ（展示前）: 平均ST（このコース・直近30走）。3号艇 .1417 と5号艇 .142 は3桁で同じなので両方が最良",
  flowPre.rows[2].dotText === ".142" &&
    flowPre.rows
      .filter((r) => r.dotBest)
      .map((r) => r.boat)
      .join() === "3,5",
);
// 平均ST の定義（BOA-815）: このコースは判定と同じ補った値（course_filled）・走数、5走未満は「全体で補った」
check(
  "展開レンズ（展示前）: 横軸の名前に期間、切り替えは「このコース」。course_n・course_filled の無い古い保存は course をそのまま使い、補った印を付けない",
  flowPre.title === "平均ST（このコース・直近30走） 左ほど早い" &&
    flowPre.basis === "course" &&
    flowPre.rows.every((r) => r.filled === false) &&
    racers[0].stCourse === 0.148 &&
    racers[0].stCourseN === null,
  flowPre.title,
);
const filledToday = {
  ...fx.today,
  course_st: {
    ...fx.today.course_st,
    // 2号艇はこのコースの走が3走（生の値 .120）。v16 は直近30走 .147 で補う
    course: [0.148, 0.12, 0.1417, 0.181, 0.142, 0.185],
    course_n: [30, 3, 30, 30, 5, 30],
    course_filled: [0.148, 0.1473, 0.1417, 0.181, 0.142, 0.185],
  },
};
const racersFilled = buildRacers({
  players,
  today: filledToday,
  exhibition: exhibitionRows,
});
const flowFilled = boardModel({
  lens: "flow",
  stage: "pre",
  racers: racersFilled,
});
check(
  "このコース: 5走未満は補った値（生の .120 ではなく .147）で「全体で補った」。5走は補わない。走数が少ない艇（6走未満）は金枠を付けない",
  racersFilled[1].stCourse === 0.1473 &&
    flowFilled.rows[1].dotText === ".147" &&
    flowFilled.rows[1].filled === true &&
    flowFilled.rows[4].filled === false &&
    flowFilled.rows
      .filter((r) => r.dotBest)
      .map((r) => r.boat)
      .join() === "3",
  JSON.stringify(flowFilled.rows.map((r) => [r.dotText, r.filled, r.dotBest])),
);
const flowOverall = boardModel({
  lens: "flow",
  stage: "pre",
  racers,
  stBasis: "overall",
});
check(
  "切り替えで直近30走: 横軸は平均ST（直近30走）、点は st_mean30（1号艇 .132）、補った印は付けない",
  flowOverall.title === "平均ST（直近30走） 左ほど早い" &&
    flowOverall.basis === "overall" &&
    flowOverall.rows[0].dotText === ".132" &&
    flowOverall.rows[0].dotMetric === "st_mean30" &&
    flowOverall.rows.every((r) => !r.filled),
  flowOverall.title,
);
check(
  "展示の後は横軸が展示ST で、切り替えを出さない",
  boardModel({ lens: "flow", stage: "post", racers, stBasis: "overall" })
    .basis === null,
);
check(
  "v16 の保存が無いと分かったレースだけ、軸レンズに平均ST を出せない理由（読み込み中は出さない。BOA-808 6）",
  boardModel({
    lens: "axis",
    stage: "pre",
    racers,
    hasToday: false,
    stMissing: true,
  }).noSt === true &&
    boardModel({ lens: "axis", stage: "pre", racers, hasToday: false }).noSt ===
      false,
);
const power = boardModel({
  lens: "power",
  stage: "post",
  racers,
  finalRound: true,
});
check(
  "機力レンズ（展示後）: 一番速い艇との差。モーター2連率の最良は4号艇（38.5）、展示タイムは4号艇（6.83）",
  power.rows[3].x === 0 &&
    bestOfNum(power, 0) === "4" &&
    bestOfNum(power, 1) === "4",
);
check(
  "機力レンズ（展示前）: 数字はモーター2連率の1個（展示の値を出さない）",
  boardModel({ lens: "power", stage: "pre", racers }).rows.every(
    (r) => r.nums.length === 1 && r.nums[0].metric === "motor_2",
  ),
);
const tri = { "1-2-3": 6.4, "1-2-4": 15.2, "2-1-3": 37.5, "4-1-2": 133 };
const comp = firstPlaceComposite(tri, [4]);
check(
  "1着の合成オッズ: 1着が同じ組をまとめ、欠場の艇（4）を含む組は2着・3着でも数えない（D-38）",
  Math.abs(comp.get(1) - 6.4) < 1e-9 && // 1-2-4 は4号艇を含むので外れる
    Math.abs(firstPlaceComposite(tri).get(1) - 1 / (1 / 6.4 + 1 / 15.2)) <
      1e-9 &&
    Math.abs(comp.get(2) - 37.5) < 1e-9 &&
    !comp.has(4),
);
check(
  "買い目レンズ: オッズが無ければ図に点を置かない（noOdds、「オッズは締切の約1時間前から出る」）",
  boardModel({ lens: "bet", stage: "post", racers, trifecta: null }).noOdds ===
    true,
);
check(
  "買い目の表記: 着ごとの候補を艇番の昇順で「1-23-234」、候補の無い着は「—」",
  betForm({ 1: new Set([1]), 2: new Set([3, 2]), 3: new Set([4, 2, 3]) }) ===
    "1-23-234" &&
    betForm({ 1: new Set(), 2: new Set([2]), 3: new Set() }) === "—-2-—",
);

// ---- PR #1308 /code-review の再現テスト ----
check(
  "堅い？荒れる？: 1号艇の NC・NA の範囲キーが無いレースは「読み込み中」に残さず empty（取得しないので終わらない）",
  roughState({
    factsStatus: "ready",
    today: { scope_keys: { 1: { VA: "VA:18" } } },
    ncStatus: "idle",
    naStatus: "idle",
  }) === "empty" &&
    roughState({
      factsStatus: "ready",
      today: null,
      ncStatus: "idle",
      naStatus: "idle",
    }) === "empty" &&
    roughState({
      factsStatus: "ready",
      today: fx.today,
      ncStatus: "loading",
      naStatus: "ready",
    }) === "loading" &&
    roughState({
      factsStatus: "ready",
      today: fx.today,
      ncStatus: "error",
      naStatus: "ready",
    }) === "error",
);
check(
  "配分: オッズの付いた組が無い（発売前）ときは配分を出さない（「N点には最低0円」を出さない）",
  hasPricedTicket(["1-2-3"], {}) === false &&
    hasPricedTicket(["1-2-3"], null) === false &&
    hasPricedTicket(["1-2-3", "1-2-4"], { "1-2-4": 15.2 }) === true,
);

// ---- 上部の切り替え（PR6、D-22・D-36 (6)）----
{
  const base = { saved: "assist", search: "", lang: "ja", enabled: true };
  check(
    "思考アシストを選んだ ja の端末は、tab・boat の指定が無いときだけ思考アシストへ移る",
    shouldOpenAssist(base) === true &&
      shouldOpenAssist({ ...base, search: "?tab=analogy" }) === false &&
      shouldOpenAssist({ ...base, search: "?boat=1" }) === false &&
      shouldOpenAssist({ ...base, lang: "en" }) === false &&
      shouldOpenAssist({ ...base, enabled: false }) === false &&
      shouldOpenAssist({ ...base, saved: "race" }) === false &&
      shouldOpenAssist({ ...base, saved: null }) === false,
  );
  check(
    "「新」の札: まだ選んでいない端末で、公開前は出し、公開から30日だけ出す",
    showNewBadge({ saved: null, today: "2026-10-09", publishedOn: null }) &&
      !showNewBadge({
        saved: "race",
        today: "2026-10-09",
        publishedOn: null,
      }) &&
      showNewBadge({
        saved: null,
        today: "2026-11-08",
        publishedOn: "2026-10-10",
      }) &&
      !showNewBadge({
        saved: null,
        today: "2026-11-09",
        publishedOn: "2026-10-10",
      }),
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
