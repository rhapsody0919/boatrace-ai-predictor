/**
 * 思考アシスト（BOA-430）のセオリーカードとガイドのモデル。純粋関数だけ（取得・描画はしない）。
 * カードの形（spec FR-6、screens S-1b）: 条件 → 起きやすいこと → 今日（当てはまる／当てはまらない／展示の後に分かる）
 * → 過去レースの傾向（v16 の値。無いものは準備中）。「今日当てはまる」は v16 が今日の値で判定したものだけ（新しい自動検出は作らない）。
 * 検査は scripts/maintenance/verify-thinking-assist-summary.js（徳山10R 2026-10-06 の本番 v16 の値で固定）
 */
import { HINT_FORM, ATTACK_BOAT, windBand } from "./analogyScenario.js";
import { usualOf, windWaveView } from "./analogyFacts.js";
import { entrySummary, formSummary, hintSummary } from "./assistSummary.js";
import { courseFilled, stText } from "./assistModel.js";
import {
  ENTRY_THEORY,
  FORM_THEORY,
  TEXT_THEORY,
} from "../data/theoryCatalog.js";
import { ASSIST_COPY as C } from "../data/thinkingAssistCopy.js";

const pct = (k, n) => (n ? Math.round((k / n) * 100) : 0);

/** 風速の区分の書き方（"4-5" → "4〜5m"、"6+" → "6m以上"） */
export const windBandLabel = (band) =>
  band?.endsWith("+")
    ? `${band.slice(0, -1)}m以上`
    : band
      ? `${band.replace("-", "〜")}m`
      : "";

/**
 * 今日の6艇の平均ST（このコース・直近30走）。手がかりが何の値から出たかを見せる（ファン評価 PR5 1周目 指摘7）。
 * 判定（v16 の手がかり）と同じ補った値（course_filled）を3桁で出し、補った艇はそう書く（BOA-815 方針4）
 */
const courseStText = (today) =>
  (today?.course_st?.course_filled ?? today?.course_st?.course ?? [])
    .map((v, i) =>
      v == null
        ? null
        : `${i + 1}号艇 ${stText(v)}${courseFilled(today?.course_st, i) ? `（${C.stFilled}）` : ""}`,
    )
    .filter(Boolean)
    .join("・");

const hit = (text) => ({ state: "hit", text });
const miss = (text) => ({ state: "miss", text });
const pending = (text) => ({ state: "pending", text });

/**
 * セオリーカード1枚
 * @param {string} id "TC-S:{形}"・"TC-H:{手がかり}"・"TC-E:{型}"・"TC-F:{艇}:{項目}"・"TC-V1"・"TC-W1"・"TC-T1"〜"TC-T10"・"TC-X1"
 * @param {object} ctx ThinkingAssistPage が作る材料（下の各分岐を参照）。boat はカードを開いた艇（F・チルト・体重など）
 * @returns {null | {id: string, title: string, cond: string, likely: string,
 *   today: null | {state: "hit"|"miss"|"pending", text: string},
 *   meas: null | {scope: string|null, bars: Array<{label: string, k: number, n: number}>, table?: Array<{boat: number, p: number, base: number}>, notes: string[], tag?: string},
 *   prepNote?: string, related?: string|null, also?: object[]}}
 */
export function theoryCard(id, ctx) {
  const [kind, a, b] = id.split(":");
  if (kind === "TC-S") return formCard(a, ctx);
  if (kind === "TC-H") return hintCard(a, ctx);
  if (kind === "TC-E") return entryCard(a, ctx);
  if (kind === "TC-F") return factCard(Number(a), b, ctx);
  if (id === "TC-V1") return venueCard(ctx);
  if (id === "TC-W1") return windCard(ctx);
  return textCard(id, ctx);
}

function formCard(form, ctx) {
  const t = FORM_THEORY[form];
  if (!t) return null;
  const name = C.formNames[form];
  const f = formSummary(ctx.scenario, form);
  const att = ATTACK_BOAT[form] ?? null;
  const hs = ctx.scenario ? hintSummary(ctx.scenario, ctx.today) : null;
  const hintRow = (hs?.rows ?? [])
    .filter((r) => r.kind === "up" && r.form === form)
    .sort((a, b) => b.ph - a.ph)[0];
  const exhForms = ctx.v16Exhibition?.forms;
  // 形は本番の結果なので、手がかり・展示が合っても「今日当てはまる」とは書かない（ファン評価 PR5 1周目 指摘2）
  let today = null;
  if (hintRow)
    today = pending(C.theoryTodayFormHint(pct(hintRow.hit[0], hintRow.hit[1])));
  else if (ctx.post && Array.isArray(exhForms) && exhForms.includes(form))
    today = pending(C.theoryTodayFormExhibition);
  else if (!ctx.post) today = pending(C.theoryPendingForm);
  else if (Array.isArray(exhForms)) today = miss(C.theoryMissForm);
  let meas = null;
  if (f && !f.few) {
    const bars = [];
    if (att)
      bars.push({ label: C.theoryAttackWin(att), k: f.first[att - 1], n: f.n });
    bars.push({ label: C.theoryB1Win, k: f.first[0], n: f.n });
    meas = {
      scope: C.flowFormScope(C.flowScopeLabel(Boolean(ctx.round)), f.n),
      bars,
      notes: [C.theoryFormAfter],
      tag: att ? C.theoryNotHappened(100 - pct(f.first[att - 1], f.n)) : null,
    };
  } else if (f) meas = { scope: null, bars: [], notes: [C.flowFew] };
  return {
    id: `TC-S:${form}`,
    title: name,
    cond: t.cond,
    likely: t.likely,
    today,
    meas,
    related: null,
  };
}

function hintCard(hintId, ctx) {
  const form = HINT_FORM[hintId];
  const cond = C.hintConds[hintId];
  if (!form || !cond) return null;
  const formName = C.formNames[form];
  const c = ctx.scenario?.hints?.course?.[hintId]?.[form];
  const hitPair = c?.hit ?? null;
  const missPair = c?.miss ?? null;
  const applies = ctx.today?.hints?.course?.[hintId] === true;
  const notes = [C.flowHintSource];
  if (hitPair?.[1] && hitPair[0] / hitPair[1] < 0.5)
    notes.push(C.theoryHintNotDecisive(formName));
  return {
    id: `TC-H:${hintId}`,
    title: C.theoryHintTitle(formName),
    cond,
    likely: C.theoryHintLikely(formName),
    today: ctx.today
      ? applies
        ? hit(C.theoryTodayHint(courseStText(ctx.today)))
        : miss(C.theoryMissHint)
      : null,
    meas:
      hitPair?.[1] && missPair?.[1]
        ? {
            scope: C.scopeChip(
              C.flowScopeLabel(Boolean(ctx.round)),
              hitPair[1] + missPair[1],
            ),
            bars: [
              {
                label: C.theoryHintHit(formName),
                k: hitPair[0],
                n: hitPair[1],
              },
              { label: C.flowMissBar, k: missPair[0], n: missPair[1] },
            ],
            notes,
          }
        : null,
  };
}

function entryCard(group, ctx) {
  const t = ENTRY_THEORY[group];
  if (!t) return null;
  const name = C.entryNames[group === "mae" ? "maeOther" : group];
  const all = ctx.scenario?.cells?.all?.forms?.any;
  const cell = ctx.scenario?.cells?.[group]?.forms?.any;
  let today;
  if (!ctx.post) today = pending(C.theoryPendingEntry);
  else {
    const e = entrySummary(ctx.scenario, ctx.courseByBoat);
    today = e
      ? e.group === group
        ? hit(C.entryToday(C.entryNames[e.type]))
        : miss(C.entryToday(C.entryNames[e.type]))
      : null;
  }
  return {
    id: `TC-E:${group}`,
    title: name,
    cond: t.cond,
    likely: t.likely,
    today,
    meas:
      all?.n && cell
        ? {
            scope: C.scopeChip(C.flowScopeLabel(Boolean(ctx.round)), all.n),
            bars: [
              { label: C.theoryEntryShare(name), k: cell.n, n: all.n },
              ...(cell.n
                ? [{ label: C.entryB1(name), k: cell.b1_win, n: cell.n }]
                : []),
            ],
            notes: [],
          }
        : null,
  };
}

/** 差がつく材料（TC-F1〜F8）。その艇の材料の範囲で、一番良いとき／一番悪いときの1着 */
function factCard(boat, key, ctx) {
  const f = ctx.boatFacts?.[boat - 1];
  const chip = f?.chips?.find((c) => c.key === key);
  if (!f?.scope || !chip) return null;
  const name = C.factNames[key];
  const good = C.factWords[chip.good];
  const bad = C.factWords[chip.bad];
  let today = null;
  if (chip.off) today = null;
  else if (!chip.bucket) today = miss(C.factNoToday);
  else if (chip.bucket === 1)
    today = hit(C.theoryFactToday(boat, `一番${good}`));
  else if (chip.bucket === 6)
    today = hit(C.theoryFactToday(boat, `一番${bad}`));
  else if (chip.bucket)
    today = miss(C.theoryFactToday(boat, `${chip.bucket}番目`));
  const bars = [
    chip.best?.[1] && {
      label: C.theoryFactWhen(good),
      k: chip.best[0],
      n: chip.best[1],
    },
    chip.worst?.[1] && {
      label: C.theoryFactWhen(bad),
      k: chip.worst[0],
      n: chip.worst[1],
    },
  ].filter(Boolean);
  return {
    id: `TC-F:${boat}:${key}`,
    title: C.theoryFactTitle(name, boat),
    cond: C.theoryFactCond(name, good, bad),
    likely: C.theoryFactLikely(boat),
    today,
    meas: bars.length
      ? {
          scope: C.scopeChip(ctx.scopeLabelOf(f.scope, boat), f.scope.n),
          bars,
          notes: [C.factsNotCause, ...(chip.off ? [C.theoryFactFinalOff] : [])],
          tag: C.factLevel[chip.level] ?? null,
        }
      : null,
  };
}

/** この会場の1号艇の1着（TC-V1）。全国・級の並びが同じの値と並べるときは範囲が違うと書く */
function venueCard(ctx) {
  const venue = ctx.venue ?? "";
  const va = ctx.vaFacts ? usualOf(ctx.vaFacts, 1, 1) : null;
  const axis = ctx.boatFacts?.[0]?.scope;
  const u = axis ? usualOf(axis.facts, 1, 1) : null;
  const bars = [
    va?.[1] && { label: C.theoryVenueAll(venue, va[1]), k: va[0], n: va[1] },
    u?.[1] && {
      label: C.scopeChip(ctx.scopeLabelOf(axis, 1), u[1]),
      k: u[0],
      n: u[1],
    },
  ].filter(Boolean);
  return {
    id: "TC-V1",
    title: C.theoryVenueTitle(venue),
    cond: C.theoryVenueCond(venue),
    likely: C.theoryVenueLikely,
    today: null,
    meas: bars.length
      ? { scope: C.theorySince, bars, notes: [C.theoryVenueNote] }
      : null,
  };
}

/** 今日の風速の区分での艇番ごとの1着（TC-W1）。追い風・向かい風の区別なし。TC-T1・T2 を同じシートに並べる */
function windCard(ctx) {
  const venue = ctx.venue ?? "";
  const speed = ctx.wind?.speed ?? null;
  const view =
    ctx.post && ctx.vaFacts
      ? windWaveView(ctx.vaFacts, {
          wind_speed: speed,
          wave_height: ctx.wind?.wave ?? null,
        })
      : null;
  const band = view?.wind ?? windBand(speed);
  const table = view
    ? [1, 2, 3, 4, 5, 6].map((boat) => {
        const w = view.rows[String(boat)]?.win;
        const u = usualOf(ctx.vaFacts, boat, 1);
        return {
          boat,
          p: w?.[1] ? (w[0] / w[1]) * 100 : null,
          base: u?.[1] ? (u[0] / u[1]) * 100 : null,
        };
      })
    : null;
  return {
    id: "TC-W1",
    title: C.theoryWindTitle(speed),
    cond: C.theoryWindCond(venue, windBandLabel(band)),
    likely: C.theoryWindLikely,
    today: ctx.post
      ? speed != null
        ? hit(
            C.theoryWindToday(
              ctx.wind?.dir ?? "",
              speed,
              C.windRelation[ctx.wind?.rel] ?? null,
            ),
          )
        : null
      : pending(C.theoryPendingWind),
    meas: table
      ? {
          scope: C.scopeChip(
            C.theoryWindScope(venue, windBandLabel(band)),
            view.n,
          ),
          bars: [],
          table,
          notes: [C.theoryWindMixed],
        }
      : null,
    also: ["TC-T1", "TC-T2"].map((x) => textCard(x, ctx)),
  };
}

/** 文だけのセオリー（成立率は準備中）。TC-X1 は固定の値の注記を持つ */
function textCard(id, ctx) {
  const t = TEXT_THEORY[id];
  if (!t) return null;
  const boat = ctx.boat ?? null;
  const r = boat ? ctx.racers?.[boat - 1] : null;
  let today = null;
  let related = null;
  if (id === "TC-T4" && r?.fCount > 0)
    today = hit(C.theoryTodayBoat(boat, `F${r.fCount}`));
  if (id === "TC-T5" && r?.tilt != null && ctx.post)
    today = hit(C.theoryTodayBoat(boat, C.tiltMark(r.tilt)));
  if (id === "TC-T6" && ctx.post && ctx.partsBoats)
    today = ctx.partsBoats.length
      ? hit(C.partsBoats(ctx.partsBoats))
      : miss(C.partsNone);
  // 向かい風・追い風が強い（4m以上）: 今日の向きが合うときだけ当てはまる（BOA-809）
  if (
    (id === "TC-T1" || id === "TC-T2") &&
    ctx.post &&
    ctx.wind?.speed != null
  ) {
    const want = id === "TC-T1" ? "head" : "tail";
    const speed = ctx.wind.speed;
    const rel = C.windRelation[ctx.wind.rel] ?? null;
    today =
      ctx.wind.rel === want && speed >= 4
        ? hit(C.theoryWindTodayRel(rel, speed))
        : miss(C.theoryWindTodayRel(rel, speed));
  }
  if (id === "TC-T8" && ctx.roundLabel)
    today = hit(C.theoryTodayRound(ctx.roundLabel));
  if (id === "TC-X1")
    today = ctx.post
      ? ctx.b1Exh
        ? hit(C.theoryTodayX1(ctx.b1Exh.text, ctx.b1Exh.rank))
        : null
      : pending(C.theoryPendingExhibition);
  if (id === "TC-T7") {
    const hs = ctx.scenario ? hintSummary(ctx.scenario, ctx.today) : null;
    const f = hs?.top ? formSummary(ctx.scenario, hs.top.form) : null;
    if (f && !f.few && f.topTrifecta.length)
      related = C.theorySujiRelated(
        C.formNames[f.form],
        f.attacker,
        f.n,
        f.topTrifecta
          .map(([x, k]) => C.trifectaCount(x.join("-"), k))
          .join("・"),
      );
  }
  return {
    id,
    title: t.title,
    cond: t.cond,
    likely: t.likely,
    today,
    meas: t.fixedNote ? { scope: null, bars: [], notes: [t.fixedNote] } : null,
    prepNote: t.prepNote ?? null,
    related,
  };
}

// ---- ガイド（FR-10、screens S-1c）----

/**
 * ガイドの5段。各段1文（40字以内、D-32）。展示前は④を出し分ける。光らせる場所は data-guide の名前
 * @param {{post: boolean, rough: object|null, hintTop: object|null}} ctx
 * @returns {Array<{lens: string, target: string, step: string, q: string, sub: string, at: "top"|"bottom"}>}
 */
export function guideSteps({ post, rough, hintTop }) {
  const b1 = rough?.b1?.verdict;
  const m = rough?.manshu?.verdict;
  const roughSub =
    b1 && m
      ? C.guideRoughSub(C.guideVerdictWord[b1], C.guideVerdictWord[m])
      : C.guideRoughSubNone;
  const flowSub = hintTop
    ? C.guideFlowSub(
        C.formNames[hintTop.form],
        pct(hintTop.hit[0], hintTop.hit[1]),
        ATTACK_BOAT[hintTop.form] ?? null,
      )
    : C.guideFlowSubNone;
  return [
    {
      lens: "axis",
      target: "rough",
      ...C.guide[0],
      sub: roughSub,
      at: "bottom",
    },
    {
      lens: "axis",
      target: "axis",
      ...C.guide[1],
      sub: C.guideAxisSub,
      at: "top",
    },
    { lens: "flow", target: "board", ...C.guide[2], sub: flowSub, at: "top" },
    {
      lens: "power",
      target: "power",
      ...C.guide[3],
      sub: post ? C.guidePowerSubPost : C.guidePowerSubPre,
      at: "top",
    },
    {
      lens: "bet",
      target: "foot",
      ...C.guide[4],
      sub: C.guideBetSub,
      at: "top",
    },
  ];
}
