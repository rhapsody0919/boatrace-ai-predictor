/**
 * 前付けの割合と「イン屋」の判定（純関数、2026-11-03 オーナー依頼）。
 *
 * 前付けの割合 = 直近1年に4〜6号艇で出た走のうち、実際に1〜3コースに入った走の割合。
 * 1・2コースの進入率は艇番の割り当ての写しになる（Spearman 0.947）ので使わない。
 * 札（イン屋）は「4〜6号艇の走が30以上」かつ「割合の Wilson 95% 下限が0.30以上」。
 * 現役1,620人中20人（2026-11-03）。根拠は docs/reference/inya-racer.md・docs/knowledge/stat-findings.md。
 *
 * 入力は選手の走の行（getRacerRaceHistory・getRacerScopedRaceStats の返り値。どちらも raceId と
 * boatNumber と entryCourse を持つ）。DB にも DOM にも依存しない。
 */
import { wilsonLowerBound } from "./wilson.js";
import { RACE_PAGE_FROM } from "./analogySimilarDisplay.js";

export const FRONT_TAKING_MIN_RUNS = 30;
export const INYA_LOWER_BOUND = 0.3;
const WINDOW_DAYS = 365;

const shiftDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * @param {Array<{raceId: string, boatNumber: number, entryCourse?: number|null}>|null|undefined} rows
 * @param {{ today: string, beforeRaceId?: string }} opts today は JST の YYYY-MM-DD。
 *   beforeRaceId を渡すと、そのレースと後のレースを数えない（レースページで当のレースを混ぜない）
 * @returns {{ from: string, to: string, n: number, k: number, rate: number|null,
 *   status: "inya" | "rate" | "insufficient" }}
 *   from〜to は数えた期間（from はデータのある最初の日より前にしない）。
 *   rate は 30走以上のときだけ（0〜1）。insufficient は30走未満
 */
export function computeFrontTaking(rows, { today, beforeRaceId } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) {
    throw new Error(
      `computeFrontTaking: today は YYYY-MM-DD で渡す（${today}）`,
    );
  }
  const windowStart = shiftDays(today, -WINDOW_DAYS + 1);
  const from = windowStart < RACE_PAGE_FROM ? RACE_PAGE_FROM : windowStart;
  const counted = (rows ?? []).filter((r) => {
    const date = String(r.raceId ?? "").slice(0, 10);
    return (
      date >= windowStart &&
      date <= today &&
      (!beforeRaceId || r.raceId < beforeRaceId) &&
      r.boatNumber >= 4 &&
      Number.isInteger(r.entryCourse) &&
      r.entryCourse >= 1 &&
      r.entryCourse <= 6
    );
  });
  const n = counted.length;
  const k = counted.filter((r) => r.entryCourse <= 3).length;
  if (n < FRONT_TAKING_MIN_RUNS) {
    return { from, to: today, n, k, rate: null, status: "insufficient" };
  }
  const status = wilsonLowerBound(k, n) >= INYA_LOWER_BOUND ? "inya" : "rate";
  return { from, to: today, n, k, rate: k / n, status };
}
