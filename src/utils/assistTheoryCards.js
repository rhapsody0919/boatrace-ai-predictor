/**
 * 思考アシストのセオリーカード1枚を作る関数（assistTheory.js の theoryCard から呼ぶ）。純粋関数だけ。
 * カードの形・検査は assistTheory.js と同じ
 */
import { HINT_FORM, ATTACK_BOAT, windBand } from "./analogyScenario.js";
import { usualOf, windWaveView } from "./analogyFacts.js";
import { entrySummary, formSummary, hintSummary } from "./assistSummary.js";
import { courseFilled, stText } from "./assistModel.js";
import { ENTRY_THEORY, FORM_THEORY } from "../data/theoryCatalog.js";
import { ASSIST_COPY as C } from "../data/thinkingAssistCopy.js";
import { hit, miss, pending, textCard } from "./assistTheoryText.js";

export const pct = (k, n) => (n ? Math.round((k / n) * 100) : 0);

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

/** 形のカードの「今日」。形は本番の結果なので、手がかり・展示が合っても「今日当てはまる」とは書かない（ファン評価 PR5 1周目 指摘2） */
function formToday(form, ctx, hintRow) {
  const exhForms = ctx.v16Exhibition?.forms;
  if (hintRow)
    return pending(C.theoryTodayFormHint(pct(hintRow.hit[0], hintRow.hit[1])));
  if (ctx.post && Array.isArray(exhForms) && exhForms.includes(form))
    return pending(C.theoryTodayFormExhibition);
  if (!ctx.post) return pending(C.theoryPendingForm);
  if (Array.isArray(exhForms)) return miss(C.theoryMissForm);
  return null;
}

/** 形のカードの「過去レースの傾向」（f は formSummary の値） */
function formMeas(f, att, ctx) {
  if (!f) return null;
  if (f.few) return { scope: null, bars: [], notes: [C.flowFew] };
  const bars = [];
  if (att)
    bars.push({ label: C.theoryAttackWin(att), k: f.first[att - 1], n: f.n });
  bars.push({ label: C.theoryB1Win, k: f.first[0], n: f.n });
  return {
    scope: C.flowFormScope(C.flowScopeLabel(Boolean(ctx.round)), f.n),
    bars,
    notes: [C.theoryFormAfter],
    tag: att ? C.theoryNotHappened(100 - pct(f.first[att - 1], f.n)) : null,
  };
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
  return {
    id: `TC-S:${form}`,
    title: name,
    cond: t.cond,
    likely: t.likely,
    today: formToday(form, ctx, hintRow),
    meas: formMeas(f, att, ctx),
    related: null,
  };
}

function hintToday(ctx, hintId) {
  if (!ctx.today) return null;
  const applies = ctx.today?.hints?.course?.[hintId] === true;
  return applies
    ? hit(C.theoryTodayHint(courseStText(ctx.today)))
    : miss(C.theoryMissHint);
}

function hintMeas(ctx, formName, hitPair, missPair, notes) {
  if (!(hitPair?.[1] && missPair?.[1])) return null;
  return {
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
  const notes = [C.flowHintSource];
  if (hitPair?.[1] && hitPair[0] / hitPair[1] < 0.5)
    notes.push(C.theoryHintNotDecisive(formName));
  return {
    id: `TC-H:${hintId}`,
    title: C.theoryHintTitle(formName),
    cond,
    likely: C.theoryHintLikely(formName),
    today: hintToday(ctx, hintId),
    meas: hintMeas(ctx, formName, hitPair, missPair, notes),
  };
}

function entryToday(ctx, group) {
  if (!ctx.post) return pending(C.theoryPendingEntry);
  const e = entrySummary(ctx.scenario, ctx.courseByBoat);
  if (!e) return null;
  return e.group === group
    ? hit(C.entryToday(C.entryNames[e.type]))
    : miss(C.entryToday(C.entryNames[e.type]));
}

function entryMeas(ctx, name, all, cell) {
  if (!(all?.n && cell)) return null;
  return {
    scope: C.scopeChip(C.flowScopeLabel(Boolean(ctx.round)), all.n),
    bars: [
      { label: C.theoryEntryShare(name), k: cell.n, n: all.n },
      ...(cell.n
        ? [{ label: C.entryB1(name), k: cell.b1_win, n: cell.n }]
        : []),
    ],
    notes: [],
  };
}

function entryCard(group, ctx) {
  const t = ENTRY_THEORY[group];
  if (!t) return null;
  const name = C.entryNames[group === "mae" ? "maeOther" : group];
  const all = ctx.scenario?.cells?.all?.forms?.any;
  const cell = ctx.scenario?.cells?.[group]?.forms?.any;
  return {
    id: `TC-E:${group}`,
    title: name,
    cond: t.cond,
    likely: t.likely,
    today: entryToday(ctx, group),
    meas: entryMeas(ctx, name, all, cell),
  };
}

function factToday(chip, boat, good, bad) {
  if (chip.off) return null;
  if (!chip.bucket) return miss(C.factNoToday);
  if (chip.bucket === 1) return hit(C.theoryFactToday(boat, `一番${good}`));
  if (chip.bucket === 6) return hit(C.theoryFactToday(boat, `一番${bad}`));
  return miss(C.theoryFactToday(boat, `${chip.bucket}番目`));
}

function factBars(chip, good, bad) {
  return [
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
}

/** 差がつく材料（TC-F1〜F8）。その艇の材料の範囲で、一番良いとき／一番悪いときの割合（着順は軸・買い目の切り替え。D-44） */
function factCard(boat, key, ctx) {
  const f = ctx.boatFacts?.[boat - 1];
  const chip = f?.chips?.find((c) => c.key === key);
  if (!f?.scope || !chip) return null;
  const name = C.factNames[key];
  const good = C.factWords[chip.good];
  const bad = C.factWords[chip.bad];
  const bars = factBars(chip, good, bad);
  return {
    id: `TC-F:${boat}:${key}`,
    title: C.theoryFactTitle(name, boat),
    cond: C.theoryFactCond(name, good, bad),
    likely: C.theoryFactLikely(boat, ctx.target ?? 1),
    today: factToday(chip, boat, good, bad),
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

/** 風のカードの艇番ごとの1着の表（今日の風速の区分の値と、会場の普段の値） */
function windTable(ctx, view) {
  if (!view) return null;
  return [1, 2, 3, 4, 5, 6].map((boat) => {
    const w = view.rows[String(boat)]?.win;
    const u = usualOf(ctx.vaFacts, boat, 1);
    return {
      boat,
      p: w?.[1] ? (w[0] / w[1]) * 100 : null,
      base: u?.[1] ? (u[0] / u[1]) * 100 : null,
    };
  });
}

function windToday(ctx, speed) {
  if (!ctx.post) return pending(C.theoryPendingWind);
  if (speed == null) return null;
  return hit(
    C.theoryWindToday(
      ctx.wind?.dir ?? "",
      speed,
      C.windRelation[ctx.wind?.rel] ?? null,
    ),
  );
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
  const table = windTable(ctx, view);
  return {
    id: "TC-W1",
    title: C.theoryWindTitle(speed),
    cond: C.theoryWindCond(venue, windBandLabel(band)),
    likely: C.theoryWindLikely,
    today: windToday(ctx, speed),
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
