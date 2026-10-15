/**
 * 直前情報タブ「今節の足の推移と着順」（BOA-885）の表示用モデル（純関数）。
 *
 * 新しい集計はしない。既にこのタブ・今節タブが取っている値を、艇ごと・走ごとに並べ直すだけ:
 * - 走の集合と展示タイム: getRacerMeetExhibitionTrendBefore（今節展示情報の数字と同じ走）
 * - 一周・まわり足・直線: getMeetOriginalExhibitionByRaceBoat の byKey
 * - 着順: getMeetScoreboard の meetRunsByRacer（今節タブの着順と同じ印。F・欠・転を含む）
 * - 進入: getRacerScopedRaceStats の actualCourse（「この枠からの進入コース」と同じ値）
 * - その日の会場平均: getMeetScoreboard の venueDailyExhibitionAvg（今節タブの推移と同じ値）
 */

/**
 * カードの id。思考アシスト・龍神ソナーからの導線は `?tab=beforeInfo&boat=N#meet-form-trend` で開き、
 * カードが出たところまで下げる（直前情報タブの上には気象・展示・表があり、開いただけでは見えない）
 */
export const MEET_FORM_ANCHOR = "meet-form-trend";

/** 指標。並びはタブの順（2026-10-15 承認のモック） */
export const MEET_FORM_METRICS = Object.freeze([
  { key: "exhibition", originalKind: null },
  { key: "lap", originalKind: "一周" },
  { key: "turn", originalKind: "まわり足" },
  { key: "straight", originalKind: "直線" },
]);

const toNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {Object} input
 * @param {Array<{number:number, racerId:number|null}>} input.players 艇番順
 * @param {Object<string, Array<{raceId:string, boatNumber:number, exhibitionTime:number|null}>|null|undefined>} input.trendByRacer
 * @param {Object<string, Object<string, number>>|null} input.originalByKey `${raceId}-${boatNumber}` → { 一周: 37.1, ... }
 * @param {Object<string, Array<{raceId:string, finish:number|string|null}>>} input.runsByRacer
 * @param {Object<string, Array<{raceId:string, actualCourse:number|null}>|null|undefined>} input.scopedByRacer
 * @returns {{boats: Array<{boat:number, runs:Array}>, metrics: string[], maxRuns: number}}
 */
export function buildMeetFormTrend({
  players,
  trendByRacer,
  originalByKey,
  runsByRacer,
  scopedByRacer,
}) {
  const boats = (players ?? []).map((p) => {
    const trend = Array.isArray(trendByRacer?.[p.racerId])
      ? trendByRacer[p.racerId]
      : [];
    const finishByRace = new Map(
      (runsByRacer?.[p.racerId] ?? []).map((r) => [r.raceId, r.finish]),
    );
    const courseByRace = new Map(
      (Array.isArray(scopedByRacer?.[p.racerId])
        ? scopedByRacer[p.racerId]
        : []
      ).map((r) => [r.raceId, r.actualCourse]),
    );
    const runs = trend.map((e) => {
      const ori = originalByKey?.[`${e.raceId}-${e.boatNumber}`] ?? null;
      const values = Object.fromEntries(
        MEET_FORM_METRICS.map((m) => [
          m.key,
          m.originalKind === null
            ? toNumber(e.exhibitionTime)
            : toNumber(ori?.[m.originalKind]),
        ]),
      );
      return {
        raceId: e.raceId,
        date: e.raceId.slice(0, 10),
        raceNo: Number(e.raceId.slice(14, 16)),
        boatNumber: e.boatNumber,
        course: courseByRace.get(e.raceId) ?? null,
        finish: finishByRace.has(e.raceId) ? finishByRace.get(e.raceId) : null,
        values,
      };
    });
    return { boat: p.number, runs };
  });
  const metrics = MEET_FORM_METRICS.map((m) => m.key).filter((key) =>
    boats.some((b) => b.runs.some((r) => r.values[key] !== null)),
  );
  const maxRuns = Math.max(0, ...boats.map((b) => b.runs.length));
  return { boats, metrics, maxRuns };
}

/**
 * 線の区間。値のある点どうしを結び、間に値の無い走を挟む区間は点線にする（承認のモック）。
 * @param {Array<number|null>} values 走の順
 * @returns {Array<{from:number, to:number, gap:boolean}>} 走の添字の組
 */
export function segmentsOf(values) {
  const idx = values
    .map((v, i) => (v === null ? null : i))
    .filter((i) => i !== null);
  return idx.slice(1).map((to, k) => {
    const from = idx[k];
    return { from, to, gap: to - from > 1 };
  });
}

/**
 * 縦軸の範囲（小さいほど速い）。6艇の値と、その日の会場平均を含める。上下に8%の余白
 * @returns {{lo:number, hi:number}|null} 値が1つも無ければ null
 */
export function domainOf(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (v.length === 0) return null;
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi - lo < 0.02) {
    lo -= 0.01;
    hi += 0.01;
  }
  const pad = (hi - lo) * 0.08;
  return { lo: lo - pad, hi: hi + pad };
}
