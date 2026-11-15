/**
 * 思考アシストの文だけのセオリーカード（TC-T1〜T10・TC-X1）と、カードの「今日」の小さな部品。純粋関数だけ
 * （assistTheoryCards.js の theoryCard から呼ぶ）
 */
import { formSummary, hintSummary } from "./assistSummary.js";
import { TEXT_THEORY } from "../data/theoryCatalog.js";
import { ASSIST_COPY as C } from "../data/thinkingAssistCopy.js";

export const hit = (text) => ({ state: "hit", text });
export const miss = (text) => ({ state: "miss", text });
export const pending = (text) => ({ state: "pending", text });

/** 向かい風・追い風が強い（4m以上）: 今日の向きが合うときだけ当てはまる（BOA-809） */
function windRelToday(id, ctx) {
  if (!(ctx.post && ctx.wind?.speed != null)) return null;
  const want = id === "TC-T1" ? "head" : "tail";
  const speed = ctx.wind.speed;
  const rel = C.windRelation[ctx.wind.rel] ?? null;
  return ctx.wind.rel === want && speed >= 4
    ? hit(C.theoryWindTodayRel(rel, speed))
    : miss(C.theoryWindTodayRel(rel, speed));
}

/** 文だけのセオリーの「今日」。id ごとに、材料の足りないときは null */
const TEXT_TODAY = {
  "TC-T4": (ctx, boat, r) =>
    r?.fCount > 0 ? hit(C.theoryTodayBoat(boat, `F${r.fCount}`)) : null,
  "TC-T5": (ctx, boat, r) =>
    r?.tilt != null && ctx.post
      ? hit(C.theoryTodayBoat(boat, C.tiltMark(r.tilt)))
      : null,
  "TC-T6": (ctx) => {
    if (!(ctx.post && ctx.partsBoats)) return null;
    return ctx.partsBoats.length
      ? hit(C.partsBoats(ctx.partsBoats))
      : miss(C.partsNone);
  },
  "TC-T1": (ctx) => windRelToday("TC-T1", ctx),
  "TC-T2": (ctx) => windRelToday("TC-T2", ctx),
  "TC-T8": (ctx) =>
    ctx.roundLabel ? hit(C.theoryTodayRound(ctx.roundLabel)) : null,
  "TC-X1": (ctx) => {
    if (!ctx.post) return pending(C.theoryPendingExhibition);
    return ctx.b1Exh
      ? hit(C.theoryTodayX1(ctx.b1Exh.text, ctx.b1Exh.rank))
      : null;
  },
};

/** TC-T7 の「関連」: 今日の手がかりの一番上の形でよく出た3連単 */
function sujiRelated(ctx) {
  const hs = ctx.scenario ? hintSummary(ctx.scenario, ctx.today) : null;
  const f = hs?.top ? formSummary(ctx.scenario, hs.top.form) : null;
  if (!(f && !f.few && f.topTrifecta.length)) return null;
  return C.theorySujiRelated(
    C.formNames[f.form],
    f.attacker,
    f.n,
    [
      ...f.topTrifecta.map(([x, k]) => C.trifectaCount(x.join("-"), k)),
      ...(f.trifectaTies ? [C.comboTiesMore(f.trifectaTies)] : []),
    ].join("・"),
  );
}

/** 文だけのセオリー（成立率は準備中）。TC-X1 は固定の値の注記を持つ */
export function textCard(id, ctx) {
  const t = TEXT_THEORY[id];
  if (!t) return null;
  const boat = ctx.boat ?? null;
  const r = boat ? ctx.racers?.[boat - 1] : null;
  return {
    id,
    title: t.title,
    cond: t.cond,
    likely: t.likely,
    today: TEXT_TODAY[id]?.(ctx, boat, r) ?? null,
    meas: t.fixedNote ? { scope: null, bars: [], notes: [t.fixedNote] } : null,
    prepNote: t.prepNote ?? null,
    related: id === "TC-T7" ? sujiRelated(ctx) : null,
  };
}
