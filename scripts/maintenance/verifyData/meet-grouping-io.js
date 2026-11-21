// verify-meet-grouping.js から字のまま移した、全件読み・日付の小道具・境界の列挙（検査の判定は元のファイルに残る）。
import { fetchAll } from "../../lib/supabaseClient.js";

/**
 * 1ページあたりの待ち時間の上限（ms）。共有クライアント
 * （`scripts/lib/supabaseClient.js`）の15秒では `race_conditions` の全件取得が
 * 中断する（2026-09-28に実際に中断した。`scripts/lib/meetBoundaries.js` の
 * `fetchAllByRaceId` が同じ問題に当たっている）。
 */
export const FETCH_TIMEOUT_MS = 90000;
/** ページ取得の再試行回数。1ページの中断で検査全体を落とさないため */
export const PAGE_RETRIES = 3;
export const dayDiff = (a, b) => (new Date(a) - new Date(b)) / 86400000;
/** race_id（YYYY-MM-DD-VV-RR）の会場コード部分 */
export const venueOf = (raceId) => raceId.split("-")[3];
export const dateOf = (raceId) => raceId.slice(0, 10);
export const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
/**
 * 「今日」をJSTで返す。`race_id` の日付はJSTなので、UTCで求めると
 * JSTの午前0〜9時に1日前の日付を「今日」と判定し、前日の本当の取得漏れを
 * 「当日だから当然」として除外してしまう。
 */
export const todayJst = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 取得失敗を「該当0件」と混同しないため、全クエリで throwOnError を立てる
 * （空データで合格すると、一致率100%という結論が「何も読めていないだけ」で出る）。
 * `race_id` で並べるのは、offsetページングで行が入れ替わって取りこぼすのを防ぐため。
 */
export async function readAll(client, table, select, build) {
  // 並び順は**全順序**にする。`fetchAll` は `.range(offset, …)` のoffsetページングで、
  // 同じ値が並ぶ並び順だとページの境目で行を取りこぼす・重複させる。`race_entries`
  // は1つの `race_id` に6行あるので `race_id` だけでは足りず、`racer_id` を足す
  // （`scripts/lib/meetBoundaries.js` の `fetchAllByRaceId` は同じ問題をキーセット
  // 方式で解くが、フィルタを渡せないのでここでは使えない）
  const withOrder = (q) => {
    const ordered = (build ? build(q) : q).order("race_id");
    return select.includes("racer_id") ? ordered.order("racer_id") : ordered;
  };
  let lastError = null;
  for (let attempt = 1; attempt <= PAGE_RETRIES; attempt++) {
    try {
      return await fetchAll(table, select, withOrder, {
        throwOnError: true,
        client,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `${table} の取得に${PAGE_RETRIES}回失敗: ${lastError?.message}`,
  );
}

export async function fetchByIn(client, table, select, col, ids, chunk = 150) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    out.push(
      ...(await readAll(client, table, select, (q) => q.in(col, slice))),
    );
  }
  return out;
}

/** 推定が誤りうる境界（繋げる・切る）を列挙する */
export function findRiskyBoundaries(segmentsByVenue) {
  const risky = [];
  for (const [venue, segments] of segmentsByVenue) {
    for (let s = 1; s < segments.length; s++) {
      const prev = segments[s - 1];
      const next = segments[s];
      const gap = dayDiff(next.dates[0], prev.dates.at(-1));
      if (gap <= 2) {
        risky.push({
          venue,
          kind: "繋げる",
          gap,
          label: `${prev.dates.at(-1)}→${next.dates[0]}`,
          left: prev.dates,
          right: next.dates,
        });
      }
    }
    for (const seg of segments) {
      for (let i = 1; i < seg.dates.length; i++) {
        const gap = dayDiff(seg.dates[i], seg.dates[i - 1]);
        if (gap > 2) {
          risky.push({
            venue,
            kind: "切る",
            gap,
            label: `${seg.dates[i - 1]}→${seg.dates[i]}`,
            left: seg.dates.slice(0, i),
            right: seg.dates.slice(i),
          });
        }
      }
    }
  }
  return risky;
}

/** 左側の最後の出走・右側の最初の出走を選手ごとに集める */
export function lastLeftFirstRight(entries, leftDates, rightDates) {
  const lastLeft = new Map();
  const firstRight = new Map();
  for (const e of entries) {
    const d = dateOf(e.race_id);
    if (leftDates.has(d)) {
      const cur = lastLeft.get(e.racer_id);
      if (!cur || d > cur) lastLeft.set(e.racer_id, d);
    }
    if (rightDates.has(d)) {
      const cur = firstRight.get(e.racer_id);
      if (!cur || d < cur) firstRight.set(e.racer_id, d);
    }
  }
  return { lastLeft, firstRight };
}
