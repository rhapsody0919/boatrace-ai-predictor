/**
 * verify-thinking-assist-model.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-thinking-assist-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  venueTechniqueTrend,
  stageFromExhibition,
  buildRacers,
  boardModel,
} from "../../../src/utils/assistModel.js";

let fx, check, row, hNige;
let down, exh, players, loc, flow, exhCmp, flowPre, filledToday;
export let racers, axis, racersFilled;

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

export const bestOfNum = (m, i) =>
  m.rows
    .filter((r) => r.nums[i]?.best)
    .map((r) => r.boat)
    .join();

function scene1() {
  check(
    "会場の決まり手: 90日 37% 対 前の275日 15%台のように重ならなければ印、向きは90日の側から",
    hNige.mark === "up",
    JSON.stringify(hNige),
  );
  down = venueTechniqueTrend([
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
  exh = [1, 2, 3, 4, 5, 6].map((boat) => ({ boat, time: 6.8 }));
  check(
    "時点: 出走する艇の展示タイムが全部そろえば展示後、1艇でも欠ければ展示前、欠場の艇は数えない",
    stageFromExhibition(exh, [1, 2, 3, 4, 5, 6]) === "post" &&
      stageFromExhibition(exh.slice(0, 5), [1, 2, 3, 4, 5, 6]) === "pre" &&
      stageFromExhibition(exh.slice(0, 5), [1, 2, 3, 4, 5]) === "post" &&
      stageFromExhibition([], []) === "pre",
  );
  // 出走表（getPredictions の players は aiScore 順。艇番は number）
  players = [3, 1, 5, 2, 4, 6].map((n) => ({
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
  racers = buildRacers({
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
  axis = boardModel({
    lens: "axis",
    stage: "post",
    racers,
    finalRound: true,
  });
}

function scene2() {
  check(
    "軸レンズ: 横軸は全国勝率、数字は勝率と平均ST の2個（N-2）。最良は勝率=3号艇（7.29）、平均ST=1号艇（.132、小さいほど良い）",
    axis.title === "全国勝率" &&
      axis.rows.every((r) => r.nums.length === 2) &&
      bestOfNum(axis, 0) === "3" &&
      bestOfNum(axis, 1) === "1" &&
      axis.rows[0].nums[1].text === ".132" &&
      axis.rows[0].nums[1].aria === "0.132",
  );
  loc = boardModel({
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
  flow = boardModel({
    lens: "flow",
    stage: "post",
    racers,
    finalRound: true,
  });
  check(
    "展開レンズ（展示後）: 横軸は展示前と同じ平均ST（このコース）。展示ST は図にしない（spec D-47 (1)）",
    flow.title === "平均ST（このコース・直近30走） 左ほど早い" &&
      flow.basis === "course" &&
      flow.rows[2].dotText === ".142" &&
      flow.rows.every((r) => !r.flying),
    flow.title,
  );
  check(
    "展開レンズ（展示後）: 各艇に展示タイムの6艇の順位（6.84・6.84・6.89・6.83・6.90・6.89 → 2,2,4,1,6,4。同タイムは同じ順位。spec D-47 (2)）",
    flow.rows.map((r) => r.exhRank).join() === "2,2,4,1,6,4" &&
      boardModel({ lens: "flow", stage: "pre", racers }).rows.every(
        (r) => r.exhRank == null,
      ),
    flow.rows.map((r) => r.exhRank).join(),
  );
  check(
    "展開レンズ（展示後）: 点の値を押すと展示ST の6艇比較。読み上げは見えている平均ST から始める",
    flow.rows.every((r) => r.dotMetric === "exh_st") &&
      flow.rows[0].dotLabel ===
        "平均ST 0.148、展示ST（本番のスタートとは別）を6艇で比べる",
    flow.rows[0].dotLabel,
  );
  exhCmp = boardModel({
    lens: "flow",
    stage: "post",
    racers,
    metric: "exh_st",
  });
}

function scene3() {
  check(
    "展示ST の6艇比較: 名前は「展示ST（本番のスタートとは別）」、戻るは「平均ST（このコース・直近30走）に戻す」。5号艇の F は .00 より左（BOA-801 2）、最良は F を外して4号艇（.05）",
    exhCmp.title === "展示ST（本番のスタートとは別）を6艇で比べる" &&
      exhCmp.back === "平均ST（このコース・直近30走）に戻す" &&
      exhCmp.rows[4].x < 0 &&
      exhCmp.rows[4].flying === true &&
      exhCmp.rows.filter((r) => r.flying).length === 1 &&
      exhCmp.rows
        .filter((r) => r.nums[0].best)
        .map((r) => r.boat)
        .join() === "4",
    JSON.stringify([exhCmp.title, exhCmp.back]),
  );
  flowPre = boardModel({
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
  filledToday = {
    ...fx.today,
    course_st: {
      ...fx.today.course_st,
      // 2号艇はこのコースの走が3走（生の値 .120）。v16 は直近30走 .147 で補う
      course: [0.148, 0.12, 0.1417, 0.181, 0.142, 0.185],
      course_n: [30, 3, 30, 30, 5, 30],
      course_filled: [0.148, 0.1473, 0.1417, 0.181, 0.142, 0.185],
    },
  };
  racersFilled = buildRacers({
    players,
    today: filledToday,
    exhibition: exhibitionRows,
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（fx・check・row・hNige） */
export function runThinkingAssistModelScenes1(env) {
  ({ fx, check, row, hNige } = env);
  scene1();
  scene2();
  scene3();
}
