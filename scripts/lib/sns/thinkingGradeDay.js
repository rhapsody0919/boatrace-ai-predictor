// 思考投稿（today_thinking）の受ける場・レースの判定。push-finals-image.js から移した純粋関数（グレードの日の場の選び・今日の対象か）。

/**
 * グレードの日に /today の対象の外でも受ける格（races.race_grade の値、強い順。hq の a2、オーナー 2026-10-31・11-02 の (a)）。
 * races.race_grade は raceListParser.js が SG・G1・G2・G3・ippan で書き、PG1 は G1 として入る（本番 2026 年の値に PG1 は0件。
 * BBCトーナメント・スピードクイーンメモリアル・マスターズチャンピオン・レディースチャンピオン・ヤングダービーの行は G1、
 * race_series.grade も G1。2026-11-02 に読み取りで確認）。そのため今の DB では PG1 と G1 の場は同じ格として比べる。
 * 他の書き手が PG1 と書けば G1 より上として扱う
 */
export const THINKING_GRADE_DAY_GRADES = Object.freeze(["SG", "PG1", "G1"]);
/** グレードの日に受けるレース番号（hq は開催場の 12R→11R→10R から選ぶ） */
export const THINKING_GRADE_DAY_MIN_RACE_NUMBER = 10;
export const THINKING_GRADE_DAY_MAX_RACE_NUMBER = 12;

const gradeRankOf = (grade) =>
  typeof grade === "string"
    ? THINKING_GRADE_DAY_GRADES.indexOf(grade.toUpperCase())
    : -1;
/** race_id（YYYY-MM-DD-会場-R）の日と会場の部分 */
const venueKeyOf = (raceId) =>
  typeof raceId === "string" ? raceId.slice(0, 13) : null;

/**
 * その日の思考投稿を受ける場（純粋関数）。twelves はその日の 12R の races の行（race_id・race_grade・start_time）。
 * 格の最上位（SG ＞ PG1 ＞ G1）の場で、同じ格が2場以上なら 12R の締切（start_time）が遅い方。締切も同じなら race_id の小さい方
 * （行の順に依らず、本投稿と展示後のリプで同じ場を選ぶ）。中止は見ない（日中に中止が入っても場が入れ替わらないように。
 * 中止のレースそのものは checkRace がはじく）。当たる場が無ければ null。返り値は race_id の日と会場の部分（例 2026-11-01-13）
 */
export function thinkingGradeDayVenue(twelves) {
  const better = (a, b) =>
    gradeRankOf(a.race_grade) - gradeRankOf(b.race_grade) ||
    b.start_time.localeCompare(a.start_time) ||
    a.race_id.localeCompare(b.race_id);
  const best = (twelves ?? [])
    .filter(
      (r) =>
        typeof r?.race_id === "string" &&
        gradeRankOf(r?.race_grade) >= 0 &&
        typeof r?.start_time === "string",
    )
    .reduce((top, r) => (!top || better(r, top) < 0 ? r : top), null);
  return best ? venueKeyOf(best.race_id) : null;
}

const inVenueRange = (race, venue) => {
  const n = race?.race_number;
  return (
    venue !== null &&
    venueKeyOf(race?.race_id) === venue &&
    Number.isInteger(n) &&
    n >= THINKING_GRADE_DAY_MIN_RACE_NUMBER &&
    n <= THINKING_GRADE_DAY_MAX_RACE_NUMBER
  );
};

/** races の行が、その日の受ける場（thinkingGradeDayVenue）の 10〜12R か（純粋関数） */
export const isThinkingGradeDayRace = (race, twelves) =>
  inVenueRange(race, thinkingGradeDayVenue(twelves));

/**
 * 思考投稿を受けるレースか（純粋関数）。その日の /today の X 投稿が送られている（posted）ことを求めたうえで、次のどちらか:
 *   - その投稿の対象（today-picks.js の readTodayPicks の featured か list）に race_id が入っている（審査の P2）
 *   - その日の格の最上位（SG ＞ PG1 ＞ G1）の場の 10〜12R。同じ格が2場以上なら 12R の締切が遅い方の場
 *     （hq の a2、オーナー 2026-10-31・11-02 の (a)。正本は hq の drafts/x-thinking-today-20261027.md v2）
 * どちらでもなければ理由を返す。race は races の行（race_number）、twelves はその日の 12R の races の行
 */
export function todayTargetReason(picks, raceId, race = null, twelves = []) {
  if (!picks?.draft_id)
    return "その日の /today の X 投稿が無い（today_thinking の対象を確かめられない）";
  // 送られた /today の投稿の対象だけ（held・pending_review のまま出ていない投稿の候補には出さない。hq は呼び直すので、7:00 の後に通る）
  if (picks.status !== "posted")
    return `その日の /today の X 投稿がまだ送られていない（status=${picks.status ?? "不明"}）`;
  const ids = [picks.featured, ...(picks.list ?? [])]
    .filter(Boolean)
    .map((r) => r.race_id);
  if (ids.includes(raceId)) return null;
  const notToday = `/today の X 投稿の対象でない（${raceId}）`;
  // races の行が無い・別のレースの行なら、グレードを見ずにそう書く（checkRace も行が無いことを別に書く）
  if (race?.race_id !== raceId)
    return `${notToday}。races の行が無くグレードを確かめられない`;
  const venue = thinkingGradeDayVenue(twelves);
  if (inVenueRange(race, venue)) return null;
  return `${notToday}。その日の格の最上位の場（${venue ?? "SG・PG1・G1 の場が無い"}）の ${THINKING_GRADE_DAY_MIN_RACE_NUMBER}〜${THINKING_GRADE_DAY_MAX_RACE_NUMBER}R でもない（race_grade=${race.race_grade ?? "不明"}・race_number=${race.race_number ?? "不明"}）`;
}
