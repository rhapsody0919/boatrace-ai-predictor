/**
 * 思考アシストの図の印（buildMarks）とレンズごとの要約の材料（buildSummary）。画面の部品に依らない計算。
 * src/pages/ThinkingAssistPage.jsx から本文を変えずに移した（振る舞いは変えない）。utils と文言（data/thinkingAssistCopy）を読むので
 * src/pure ではなくここに置く（src/pure の根は src/pure の外を読めない、src/utils への新しいファイルは R3 で赤）
 */
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { exhRanks } from "../../../utils/assistModel";
import {
  axisMarks,
  boardFactMark,
  factsScopeLabel,
  HINT_BOAT,
  partsChangedBoats,
  tiltOutliers,
} from "../../../utils/assistSummary";
import { ATTACK_BOAT } from "../../../utils/analogyScenario";
import { popularityRanks } from "../../../utils/oddsMath";

/** 図の印（screens「レンズごとの図 C」の印）。印の付く艇ごとに並べる */
export function buildMarks({
  lens,
  boatFacts,
  flowHint,
  post,
  racers,
  maintenanceRows,
}) {
  const out = new Map();
  const add = (boat, mark) => out.set(boat, [...(out.get(boat) ?? []), mark]);
  if (lens === "axis") addAxisMarks(add, boatFacts);
  if (lens === "flow" && flowHint) addFlowMarks(add, flowHint);
  if (lens === "power" && post) addPowerMarks(add, racers, maintenanceRows);
  return out;
}

function addAxisMarks(add, boatFacts) {
  boatFacts.forEach((f, i) => {
    const c = boardFactMark(f.chips);
    if (c)
      add(i + 1, {
        text: ASSIST_COPY.factMark(
          ASSIST_COPY.factNames[c.key],
          ASSIST_COPY.factWords[c.good],
        ),
        hit: true,
        theory: `TC-F:${i + 1}:${c.key}`,
      });
  });
}

function addFlowMarks(add, flowHint) {
  const top = flowHint;
  const boat = HINT_BOAT[top.id];
  if (boat)
    add(boat, {
      text: ASSIST_COPY.hintMark(ASSIST_COPY.formNames[top.form]),
      hit: true,
      theory: `TC-H:${top.id}`,
    });
  const attacker = ATTACK_BOAT[top.form];
  if (attacker)
    add(attacker, {
      text: ASSIST_COPY.attackMark(ASSIST_COPY.formNames[top.form]),
      hit: false,
      theory: `TC-S:${top.form}`,
    });
}

function addPowerMarks(add, racers, maintenanceRows) {
  // 1号艇の展示タイムの偏り（TC-X1）。展示の値があるときだけ
  if (racers[0]?.exhTime != null)
    add(1, { text: ASSIST_COPY.exhBiasMark, hit: false, theory: "TC-X1" });
  for (const [boat, tilt] of tiltOutliers(racers))
    add(boat, {
      text: ASSIST_COPY.tiltMark(tilt),
      hit: false,
      theory: "TC-T5",
    });
  for (const boat of partsChangedBoats(maintenanceRows))
    add(boat, {
      text: ASSIST_COPY.partsMark,
      hit: false,
      theory: "TC-T6",
    });
}

function summaryAxis(c) {
  const { factsAll, boatFacts, venueName, scope, rough, vaKey, venueAll } = c;
  const { today, act } = c;
  return factsAll
    ? {
        scope: boatFacts[0].scope,
        chips: boatFacts[0].chips,
        venue: venueName,
        headerScope: scope,
        headerInCaution: rough?.inCaution ?? null,
        vaFacts: vaKey ? factsAll[vaKey] : null,
        vaCell: venueAll,
        classes: today?.classes ?? null,
        onFacts: (all) => act({ type: "openFacts", boat: 1, all }),
      }
    : null;
}

function summaryFlow(c) {
  const { ncScenario, today, post, v16Exhibition, courseByBoat, similar } = c;
  const { data, v16Status, racers, flowHint, flowForms, act, v16Off } = c;
  const { venueName, state } = c;
  return {
    scenario: ncScenario,
    today,
    post,
    v16Exhibition,
    courseByBoat,
    similar,
    racecardStage: data.similar.racecardStage,
    reflecting: v16Status === "exhibition_reflecting",
    round: data.round,
    exhRanks: post ? exhRanks(racers) : null,
    hint: flowHint,
    forms: flowForms,
    onForm: (form) => act({ type: "flowForm", form }),
    national: v16Off ? null : (data.scenario.na.data?.scenario ?? null),
    original:
      data.original.data?.state === "published" ? data.original.data : null,
    racers,
    venue: venueName,
    onPower: () => act({ type: "lens", lens: "power" }),
    onBet: () => act({ type: "lens", lens: "bet" }),
    basis: state.stBasis,
  };
}

function motorChipOf(c) {
  const { motorFact, b1u, racers, winFacts, venueName, today } = c;
  return motorFact && b1u && racers[0].motor2 != null
    ? {
        top: motorFact.bucket === 1,
        value: racers[0].motor2,
        rate: Math.round(motorFact.rate * 100),
        base: Math.round((b1u.k / b1u.n) * 100),
        // どのレースから出した割合か（271 の指摘の型）
        scope: ASSIST_COPY.scopeChip(
          factsScopeLabel(winFacts[0].scope, venueName, 1, today?.classes?.[0]),
          winFacts[0].scope.n,
        ),
      }
    : null;
}

function summaryPower(c) {
  const { post, racers, maintenanceRows, data, venueName } = c;
  return {
    post,
    racers,
    maintenance: maintenanceRows,
    original:
      data.original.data?.state === "published" ? data.original.data : null,
    venue: venueName,
    motorChip: motorChipOf(c),
  };
}

/** 相手レンズの「{X}号艇を軸にしたときの2着」（BOA-845、spec D-48）。範囲は全艇とも会場の全レース（VA） */
function summaryPlace(c) {
  const { v16Off, placeF, vaScenario, placeAxis, placeAuto, venueName } = c;
  const { raceId, act, data } = c;
  return v16Off
    ? null
    : {
        f: placeF,
        marks: axisMarks(vaScenario, placeF, placeAxis),
        axis: placeAxis,
        auto: placeAuto,
        venue: venueName,
        raceId,
        onAxis: (boat) => act({ type: "placeAxis", boat }),
        ready: data.scenario.va.status === "ready",
        failed: data.scenario.va.status === "error",
      };
}

function summaryBet(c) {
  const { tickets, betSummary, compareRows, onBetType, trifecta, data } = c;
  const { oddsAt, race, scope, national, similar, venueAll, venueName } = c;
  const { today } = c;
  return {
    bet: {
      points: tickets.length,
      summary: betSummary,
      compare: compareRows,
      onBetType,
      trifecta: trifecta ?? {},
      trifectaFinal: data.odds.data?.byType?.trifecta?.final === true,
      ranks: popularityRanks(trifecta ?? {}),
      oddsAt,
      finished: Boolean(race?.result?.finished),
    },
    scope,
    national,
    similar,
    sim: data.similar.data?.similar ?? null,
    venueAll,
    venue: venueName,
    classes: today?.classes ?? null,
  };
}

/** レンズごとの要約（LensSummary に渡す材料）。c は本体で組んだ材料の束 */
export function buildSummary(c) {
  return {
    axis: summaryAxis(c),
    flow: summaryFlow(c),
    power: summaryPower(c),
    // 相手レンズの「{X}号艇を軸にしたときの2着」（BOA-845、spec D-48）。範囲は全艇とも会場の全レース（VA）
    place: summaryPlace(c),
    bet: summaryBet(c),
  };
}
