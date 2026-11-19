/**
 * verify-thinking-assist-summary.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-thinking-assist-summary.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  meetRuns,
  priorRuns,
  courseWins,
  featChips,
  monthDay,
  factsScope,
  factChips,
} from "../../../src/utils/assistSummary.js";
import { theoryCard } from "../../../src/utils/assistTheory.js";

let today, facts, check, nc, run, records, RACE;
let meet, prior, cw, feats, tech, fRun, absentRun, meetF, theoryFacts, cS, cH, cE, cF, cV;
export let tctx, cWpre, cWpost;

function scene1() {
  meet = meetRuns(records, RACE);
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
  prior = priorRuns(records, RACE, [...meet.past, ...meet.today]);
  check(
    "今節より前の5走: 今節と後の走を除いて新しい順に5走（9/29 10R から）",
    prior.length === 5 &&
      prior[0].raceId === "2026-09-29-13-10" &&
      prior[4].raceId === "2026-09-27-13-08",
    prior.map((r) => r.raceId).join(),
  );
  cw = courseWins(records, RACE, 1);
  check(
    "1コースで走ったとき: 進入コースで集める（3号艇で1コースに入った 9/27 8R を含む）。表示中より後は入れない → 1着 3/4",
    cw.k === 3 && cw.n === 4,
    JSON.stringify(cw),
  );
  // ---- 成績から付けた札（D-41）----
  feats = featChips({ boat: 1, today, finalRound: true }).map((f) => f.id);
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
  tech = featChips({
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
  fRun = {
    ...run("2026-09-28-14-01", 1, null),
    flyingStartTiming: 0.02,
    finishMark: "F",
  };
  absentRun = {
    ...run("2026-09-28-14-03", 3, null),
    absent: true,
    finishMark: "欠",
  };
  meetF = meetRuns(
    [
      run("2026-09-27-14-02", 2, 1),
      run("2026-09-27-14-09", 4, 3),
      fRun,
      absentRun,
      run("2026-09-28-14-11", 5, 1),
    ],
    "2026-09-29-14-05",
  );
}

function scene2() {
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
  theoryFacts = [1, 2, 3, 4, 5, 6].map((boat) => {
    const scope = factsScope(facts, today, boat, "junyu");
    return {
      scope,
      chips: factChips({ scope, today, boat, post: false, finalRound: true }),
    };
  });
  tctx = {
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
  cS = theoryCard("TC-S:d2", tctx);
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
  cH = theoryCard("TC-H:d2_slow01", tctx);
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
    "TC-H は今日の平均ST（このコース・直近30走）の値を判定と同じ補った値の3桁で添える（2号艇 .161、ファン評価 PR5 1周目 指摘7・BOA-815）",
    cH.today.text.includes("このコース・直近30走") &&
      cH.today.text.includes("2号艇 .161") &&
      cH.today.text.includes("3号艇 .142"),
    cH.today.text,
  );
  cE = theoryCard("TC-E:waku", tctx);
}

function scene3() {
  check(
    "TC-E 枠なり: 展示前は「進入は展示の後に分かる」、出現 2,463/3,276・1号艇の1着 870/2,463",
    cE.today.state === "pending" &&
      cE.today.text === "進入は展示の後に分かる" &&
      cE.meas.bars[0].k === 2463 &&
      cE.meas.bars[0].n === 3276 &&
      cE.meas.bars[1].k === 870,
    JSON.stringify(cE),
  );
  cF = theoryCard("TC-F:1:motor_2", tctx);
  check(
    "TC-F 1号艇のモーター2連率: 今日は一番低い、一番高いとき 19/40・一番低いとき 15/26、差ははっきりしない",
    cF.today.text === "今日の1号艇は6艇で一番低い" &&
      cF.meas.bars[0].k === 19 &&
      cF.meas.bars[1].k === 15 &&
      cF.meas.bars[1].n === 26 &&
      cF.meas.tag === "件数が少なく差ははっきりしない",
    JSON.stringify(cF.meas),
  );
  cV = theoryCard("TC-V1", tctx);
  check(
    "TC-V1 徳山の全レース 11,008/17,552 と NCR 65/119 を並べ、範囲が違うと書く",
    cV.meas.bars[0].k === 11008 &&
      cV.meas.bars[0].n === 17552 &&
      cV.meas.bars[1].k === 65 &&
      cV.meas.notes[0].includes("範囲が違う"),
  );
  cWpre = theoryCard("TC-W1", tctx);
  cWpost = theoryCard("TC-W1", { ...tctx, post: true });
}

/** verify から呼ぶ入口。env は verify 側の束縛（today・facts・check・nc・run・records・RACE） */
export function runThinkingAssistSummaryScenes1(env) {
  ({ today, facts, check, nc, run, records, RACE } = env);
  scene1();
  scene2();
  scene3();
}
