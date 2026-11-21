/**
 * odds-live-api-wiring-scenes.js - verify-odds-live-api.js の (e) 設定の場面。api/odds/live.js の本文の字は読まず、
 * live-odds-wiring.js で読み込んで export と、手前の部品（politeFetch・DB ストア・supabase）へ渡した引数と呼び出しの記録で見る。
 * 当日のレースだけ受けるので raceId は今日（JST）の物。公式へは偽の fetch（発売中の実ページ）で答え、DB は記録する偽物（繋がない）
 */
import { loadLiveOddsApi } from "./live-odds-wiring.js";

/** @returns {Promise<{ live, first, liveReq, writes: string[] }>} 読み込んだ api・正しい形の最初の応答・req を作る関数・race_odds への書きの記録 */
export async function runLiveOddsWiringScenes({ check, show, htmlResponse, page, WRITE_METHODS }) {
  const LIVE_RACE = `${new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)}-21-02`;
  const liveReq = (search) => ({
    method: "GET",
    url: `/api/odds/live${search}`,
    query: { raceId: LIVE_RACE, page: "3t" },
  });
  const canonical = `?${new URLSearchParams({ raceId: LIVE_RACE, page: "3t" })}`;
  const live = await loadLiveOddsApi({ fetchImpl: async () => htmlResponse(page) });
  const first = await live.call(liveReq(canonical));
  check(
    "api/odds/live.js: maxDuration=30",
    JSON.stringify(live.config) === JSON.stringify({ maxDuration: 30 }),
    show(live.config),
  );
  const opts = live.record.politeFetchOptions;
  check(
    "api/odds/live.js: 再試行なし・12秒で打ち切り・ブレーカーは DB ストア（Cron と共有）",
    first.status === 200 &&
      opts.length === 1 &&
      opts[0].maxRetries === 0 &&
      opts[0].timeoutMs === 12000 &&
      live.record.stores.length === 1 &&
      live.record.stores[0].client === live.supabase &&
      live.record.queries.some((q) => q.table === "scrape_job_state"),
    show({
      status: first.status,
      opts: opts.map(({ maxRetries, timeoutMs }) => ({ maxRetries, timeoutMs })),
      stores: live.record.stores.length,
      tables: [...new Set(live.record.queries.map((q) => q.table))],
    }),
  );
  // 締切が分かり範囲の外（今日の 00:01 締切）→ race_odds の最新行を読む経路も通す。どちらの経路でも race_odds に書かない
  live.record.rows.races = { race_date: LIVE_RACE.slice(0, 10), start_time: "00:01" };
  await live.call(liveReq(canonical));
  const writes = [
    ...live.record.queries
      .filter((q) => q.table === "race_odds" && WRITE_METHODS.has(q.method))
      .map((q) => `${q.table}.${q.method}(`),
    ...live.record.rpcs.filter((r) => /odds/i.test(r.name)).map((r) => `rpc ${r.name}`),
  ];
  return { live, first, liveReq, writes, LIVE_RACE };
}
