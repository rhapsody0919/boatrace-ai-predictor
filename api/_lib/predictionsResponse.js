/**
 * /api/predictions/{date}（api/predictions/[date].js）の入口の検査と、応答から外す欄（BOA-1110）。
 *
 * 1. 入口の検査: CDN のキャッシュのキーにはクエリが入る。余計なクエリ・実在しない日付・遠い未来の日付を受けると、
 *    毎回 RPC（重い）まで届く。呼び出し元（画面・botRace・hq・fetch-materials）が使うのは「クエリ無し」か
 *    「?light=true」だけなので、それ以外は 400 にする。date は Vercel が動的ルートの値をクエリに足す場合に備えて、
 *    パスの日付と同じ値だけ許す
 * 2. 外す欄: 読み手が無い欄だけを名指しで外す（残す欄を列挙しない。列挙にすると、後で RPC に足したキーが
 *    /api だけで黙って消え、RPC 直のフォールバックと verify-rpc-output-keys では気づけない）。
 *    - entries[].aiScoreStandard・aiScoreSafeBet・aiScoreUpsetFocus（廃止した3モデルの点）
 *    - races[].predictionOdds（廃止した3モデルの3連単・3連複の予想とオッズ）
 *    RPC は変えない（同じ欄は RPC 直では今も返る。外すのは次に RPC を変えるマイグレーションに同梱する）。
 *
 * 検証: scripts/maintenance/verify-predictions-response.js
 */

export const REMOVED_ENTRY_FIELDS = Object.freeze([
  "aiScoreStandard",
  "aiScoreSafeBet",
  "aiScoreUpsetFocus",
]);
export const REMOVED_RACE_FIELDS = Object.freeze(["predictionOdds"]);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 暦にある日付か（2026-02-30 等を弾く） */
function isCalendarDate(date) {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}

/**
 * @param {string} date - パスの日付
 * @param {URLSearchParams} params
 * @param {number} nowMs
 * @returns {{ok: true, light: boolean} | {ok: false, error: string}}
 */
export function validatePredictionsRequest(date, params, nowMs) {
  if (!isCalendarDate(date)) {
    return { ok: false, error: "Invalid date format. Use YYYY-MM-DD" };
  }
  // JST の明日まで（前日の夜に翌日の出走表を見る）。それより先は出走表が無いので RPC を呼ばない
  const jstTomorrow = new Date(nowMs + JST_OFFSET_MS + DAY_MS)
    .toISOString()
    .slice(0, 10);
  if (date > jstTomorrow) {
    return { ok: false, error: "date must be on or before tomorrow (JST)" };
  }
  const keys = [...params.keys()];
  const unknown = keys.filter((k) => k !== "light" && k !== "date");
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown query parameter: ${unknown.join(", ")}`,
    };
  }
  const light = params.getAll("light");
  if (light.length > 1 || (light.length === 1 && light[0] !== "true")) {
    return { ok: false, error: "light must be omitted or 'true'" };
  }
  const dates = params.getAll("date");
  if (dates.some((d) => d !== date)) {
    return { ok: false, error: "date in query must match the path" };
  }
  return { ok: true, light: light.length === 1 };
}

const omit = (obj, fields) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !fields.includes(k)));

/**
 * RPC の応答から、読み手の無い欄を外す。races が配列でない・形が違う要素はそのまま通す
 * @param {unknown} data
 * @returns {unknown}
 */
export function stripUnusedPredictionFields(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.races)) {
    return data;
  }
  return {
    ...data,
    races: data.races.map((race) => {
      if (!race || typeof race !== "object") return race;
      const stripped = omit(race, REMOVED_RACE_FIELDS);
      if (Array.isArray(race.entries)) {
        stripped.entries = race.entries.map((e) =>
          e && typeof e === "object" ? omit(e, REMOVED_ENTRY_FIELDS) : e,
        );
      }
      return stripped;
    }),
  };
}
