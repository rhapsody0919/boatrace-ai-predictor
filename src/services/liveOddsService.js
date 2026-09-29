/**
 * オッズのライブ取得（BOA-487）。/api/odds/live を呼ぶ。
 *
 * withCache は使わない。鮮度が要点のデータで、キャッシュは API 側の CDN（s-maxage=30）に任せる。
 * 失敗（HTTP エラー・公式側の失敗 ok:false・通信エラー）は例外にする。呼び出し側は失敗を state に持ち、
 * スナップショットへのフォールバックと「最新の取得に失敗しました」を出す（frontend-data-fetch.md §3）。
 */

/** 券種 → 公式のページ（api/odds/live の page） */
export const LIVE_PAGE_OF_BET_TYPE = {
  winPlace: "tf",
  trifecta: "3t",
  trio: "3f",
  exacta: "2tf",
  quinella: "2tf",
  wide: "k",
};

export class LiveOddsError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "LiveOddsError";
    this.reason = reason;
  }
}

/**
 * @param {string} raceId YYYY-MM-DD-VV-RR
 * @param {"tf"|"3t"|"3f"|"2tf"|"k"} page
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{ok: true, raceId: string, page: string, fetchedAt: string, officialUpdatedAt: string|null, final: boolean, data: Record<string, unknown>}>}
 */
export async function fetchLiveOdds(raceId, page, { signal } = {}) {
  const params = new URLSearchParams({ raceId, page });
  const response = await fetch(`/api/odds/live?${params}`, { signal });
  if (!response.ok) {
    throw new LiveOddsError(
      `オッズのライブ取得に失敗しました（HTTP ${response.status}）`,
      `http_${response.status}`,
    );
  }
  const body = await response.json();
  if (!body?.ok) {
    throw new LiveOddsError(
      `オッズのライブ取得に失敗しました（${body?.reason ?? "unknown"}）`,
      body?.reason ?? "unknown",
    );
  }
  return body;
}
