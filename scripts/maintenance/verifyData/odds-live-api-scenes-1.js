/**
 * verify-odds-live-api.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-odds-live-api.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  CACHE_OK_EARLY,
  handleLiveOddsRequest,
  CACHE_OK,
  parseLiveOddsPage,
  CACHE_FINAL,
  CACHE_UPSTREAM_ERROR,
  CACHE_NO_STORE,
  isCanonicalLiveOddsSearch,
} from "../../lib/liveOdds.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { FetchError } from "../../lib/scrapeJobs/politeFetch.js";

let check, show, FINAL, T3_PREDEADLINE, TF_UNPUBLISHED, NOW, TODAY_RACE, htmlResponse, fetcher, live;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const run = (query, politeFetch, method) =>
    handleLiveOddsRequest({ query, method, politeFetch, now: () => NOW });
  const f1 = fetcher(() => htmlResponse(T3_PREDEADLINE));
  const r1 = await run({ raceId: TODAY_RACE, page: "3t" }, f1);
  check(
    "成功（締切51分前）: 200・s-maxage=30, stale-while-revalidate=120・本文の形（ok/raceId/page/fetchedAt/officialUpdatedAt/final/data）",
    r1.status === 200 &&
      r1.cacheControl === CACHE_OK_EARLY &&
      show(Object.keys(r1.body)) ===
        show([
          "ok",
          "raceId",
          "page",
          "fetchedAt",
          "officialUpdatedAt",
          "final",
          "data",
        ]) &&
      r1.body.ok === true &&
      r1.body.fetchedAt === NOW.toISOString() &&
      r1.body.officialUpdatedAt === "08:14" &&
      r1.body.final === false &&
      Object.keys(r1.body.data.trifectaAll).length === 120,
    show({ ...r1, body: { ...r1.body, data: "…" } }),
  );
  // BOA-573: 締切まで10分以内は stale-while-revalidate を60秒のまま（鮮度優先）。締切時刻が読めないときも60秒
  {
    const near = await handleLiveOddsRequest({
      query: { raceId: TODAY_RACE, page: "3t" },
      politeFetch: fetcher(() => htmlResponse(T3_PREDEADLINE)),
      now: () => new Date("2026-09-29T09:01:00+09:00"), // 2R 締切 09:10 の9分前
    });
    check(
      "締切まで10分以内（9分前）: stale-while-revalidate=60 のまま",
      near.cacheControl === CACHE_OK,
      near.cacheControl,
    );
    const edge = await handleLiveOddsRequest({
      query: { raceId: TODAY_RACE, page: "3t" },
      politeFetch: fetcher(() => htmlResponse(T3_PREDEADLINE)),
      now: () => new Date("2026-09-29T08:57:00+09:00"), // 13分前
    });
    check(
      "締切まで10分＋150秒超（13分前）: stale-while-revalidate=120",
      edge.cacheControl === CACHE_OK_EARLY,
      edge.cacheControl,
    );
    // 11分前: 120秒で返すと最大150秒残り締切10分前以降に食い込むため、60秒のまま（/code-review の指摘）
    const eleven = await handleLiveOddsRequest({
      query: { raceId: TODAY_RACE, page: "3t" },
      politeFetch: fetcher(() => htmlResponse(T3_PREDEADLINE)),
      now: () => new Date("2026-09-29T08:59:00+09:00"),
    });
    check(
      "締切11分前: 締切10分前以降に食い込まないよう stale-while-revalidate=60",
      eleven.cacheControl === CACHE_OK,
      eleven.cacheControl,
    );
    const noDeadline = await handleLiveOddsRequest({
      query: { raceId: TODAY_RACE, page: "3t" },
      politeFetch: fetcher(() =>
        htmlResponse(T3_PREDEADLINE.replace("締切予定時刻", "（見出しなし）")),
      ),
      now: () => NOW,
    });
    check(
      "締切時刻が読めない: stale-while-revalidate=60（鮮度優先に倒す）",
      noDeadline.cacheControl === CACHE_OK,
      noDeadline.cacheControl,
    );
    const t3 = parseLiveOddsPage("3t", T3_PREDEADLINE);
    check(
      "締切予定時刻をレース番号の位置で読む（2R=09:10、12R=14:29）",
      t3.deadlineTimes?.[1] === "09:10" && t3.deadlineTimes?.[11] === "14:29",
      show(t3.deadlineTimes),
    );
  }
  return { run, f1 };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ run, f1 }) {
  check(
    "成功: 取得したURLは公式の odds3t の1ページだけ",
    show(f1.calls) ===
      show([
        "https://www.boatrace.jp/owpc/pc/race/odds3t?rno=2&jcd=21&hd=20260929",
      ]),
  );
  const r2 = await run(
    { raceId: TODAY_RACE, page: "2tf" },
    fetcher(() => htmlResponse(FINAL["2tf"])),
  );
  check(
    "締切時オッズ: final=true・s-maxage=300",
    r2.status === 200 &&
      r2.body.final === true &&
      r2.cacheControl === CACHE_FINAL,
  );
  const r3 = await run(
    { raceId: TODAY_RACE, page: "tf" },
    fetcher(() => htmlResponse(TF_UNPUBLISHED)),
  );
  check(
    "未発売: 200・ok:false・reason=not_on_sale・s-maxage=10",
    r3.status === 200 &&
      r3.body.ok === false &&
      r3.body.reason === "not_on_sale" &&
      r3.cacheControl === CACHE_UPSTREAM_ERROR,
  );
  const r4 = await run(
    { raceId: TODAY_RACE, page: "tf" },
    fetcher(() => htmlResponse("busy", 503)),
  );
  check(
    "公式が503: 200・ok:false・reason=upstream_http_503・retryAfterSec・s-maxage=10",
    r4.status === 200 &&
      r4.body.ok === false &&
      r4.body.reason === "upstream_http_503" &&
      r4.body.retryAfterSec > 0 &&
      r4.cacheControl === CACHE_UPSTREAM_ERROR,
  );
  const r5 = await run(
    { raceId: TODAY_RACE, page: "tf" },
    fetcher(() => {
      throw new FetchError("https://x", 1, new Error("timeout"));
    }),
  );
  check(
    "通信失敗・タイムアウト: reason=fetch_failed・s-maxage=10",
    r5.status === 200 &&
      r5.body.reason === "fetch_failed" &&
      r5.cacheControl === CACHE_UPSTREAM_ERROR,
  );
  const f6 = fetcher(() => {
    throw new BreakerOpenError("host:boatrace.jp", NOW.getTime() + 45_000);
  });
  const r6 = await run({ raceId: TODAY_RACE, page: "3t" }, f6);
  check(
    "ブレーカーが開いている: reason=breaker_open・retryAfterSec=45",
    r6.status === 200 &&
      r6.body.reason === "breaker_open" &&
      r6.body.retryAfterSec === 45 &&
      r6.cacheControl === CACHE_UPSTREAM_ERROR,
    show(r6.body),
  );
  const f7 = fetcher(() => htmlResponse(T3_PREDEADLINE));
  const r7 = await run({ raceId: "2026-09-28-21-02", page: "3t" }, f7);
  return { run, f7, r7 };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ run, f7, r7 }) {
  check(
    "前日のレース: 400・no-store・公式へ取りに行かない",
    r7.status === 400 &&
      r7.cacheControl === CACHE_NO_STORE &&
      r7.body.ok === false &&
      f7.calls.length === 0,
  );
  const r8 = await run(
    { raceId: TODAY_RACE, page: "3t" },
    fetcher(() => htmlResponse(T3_PREDEADLINE)),
    "POST",
  );
  check(
    "GET以外: 405・no-store",
    r8.status === 405 && r8.cacheControl === CACHE_NO_STORE,
  );
  let threw = false;
  try {
    await run(
      { raceId: TODAY_RACE, page: "3t" },
      fetcher(() => {
        throw new TypeError("バグ");
      }),
    );
  } catch {
    threw = true;
  }
  check("想定外の例外は握りつぶさず投げる（500）", threw);
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・FINAL・T3_PREDEADLINE・TF_UNPUBLISHED・NOW・TODAY_RACE・htmlResponse・fetcher） */
export async function runOddsLiveApiScenes1(env) {
  ({ check, show, FINAL, T3_PREDEADLINE, TF_UNPUBLISHED, NOW, TODAY_RACE, htmlResponse, fetcher } = env);
  await scene4();
}

async function scene5() {
  // ---- (f) 生のクエリの形（BOA-1110）: 並び替え・エンコード・余計な & でキャッシュを外させない ----
  {
    const target = { raceId: TODAY_RACE, page: "3t" };
    const canonical = `?${new URLSearchParams(target)}`;
    check(
      "画面と同じ形（URLSearchParams({raceId, page})）は通る",
      isCanonicalLiveOddsSearch(canonical, target),
      canonical,
    );
    for (const [label, raw] of [
      ["並び替え", `?page=3t&raceId=${TODAY_RACE}`],
      ["ハイフンのエンコード", `?raceId=${TODAY_RACE.replace(/-/g, "%2D")}&page=3t`],
      ["末尾の &", `${canonical}&`],
      ["空のパラメータ", `${canonical}&=`],
    ]) {
      check(`形の違うクエリは通らない: ${label}`, !isCanonicalLiveOddsSearch(raw, target), raw);
    }
    const f = fetcher(() => htmlResponse(T3_PREDEADLINE));
    const reordered = await handleLiveOddsRequest({
      query: target,
      politeFetch: f,
      now: () => NOW,
      rawSearch: `?page=3t&raceId=${TODAY_RACE}`,
    });
    check(
      "並び替えたクエリ: 400・no-store・公式へ取りに行かない",
      reordered.status === 400 &&
        reordered.cacheControl === CACHE_NO_STORE &&
        f.calls.length === 0,
      show({ status: reordered.status, cacheControl: reordered.cacheControl, calls: f.calls }),
    );
    const ok = await handleLiveOddsRequest({
      query: target,
      politeFetch: f,
      now: () => NOW,
      rawSearch: canonical,
    });
    check("正しい形のクエリ: 200", ok.status === 200, show(ok.status));
    const viaApi = await live.live.call(live.liveReq(`?page=3t&raceId=${live.LIVE_RACE}`));
    check(
      "api/odds/live.js: req.url の生のクエリを rawSearch に渡す",
      live.first.status === 200 && viaApi.status === 400 && viaApi.headers["Cache-Control"] === CACHE_NO_STORE,
      show({ canonical: live.first.status, reordered: viaApi.status, cacheControl: viaApi.headers["Cache-Control"] }),
    );
  }
}

async function scene6() {
  // ---- (g) BOA-1149: 公式取得は締切 -90〜+10分（両端を含む） ----
  {
    const snapshot = {
      fetchedAt: "2026-09-29T05:00:00Z", officialUpdatedAt: null,
      final: false, data: { trifectaAll: { "1-2-3": 12.3 } },
    };
    for (const minutes of [100, 90, 75, 30, -10, -15, 90.001, -10.001]) {
      let fetches = 0;
      let reads = 0;
      const outside = minutes > 90 || minutes < -10;
      const result = await handleLiveOddsRequest({
        query: { raceId: TODAY_RACE, page: "3t" }, now: () => NOW,
        getDeadline: async () => new Date(NOW.getTime() + minutes * 60000),
        getLatestSnapshot: async (id, page) => {
          check("DBへ要求レース・ページを渡す", id === TODAY_RACE && page === "3t");
          reads++; return snapshot;
        },
        politeFetch: async () => { fetches++; return htmlResponse(T3_PREDEADLINE); },
      });
      check(`締切まで${minutes}分: 公式取得とDBの分岐`,
        fetches === (outside ? 0 : 1) && reads === (outside ? 1 : 0));
      check(`締切まで${minutes}分: 成功応答`, result.status === 200 && result.body.ok);
      if (outside) check("DBの取得時刻・値を保持", show(result.body) === show({
        ok: true, raceId: TODAY_RACE, page: "3t", ...snapshot,
      }));
    }
    for (const missing of [null, { ...snapshot, data: {} }]) {
      const result = await handleLiveOddsRequest({
        query: { raceId: TODAY_RACE, page: "3t" }, now: () => NOW,
        getDeadline: async () => new Date(NOW.getTime() - 15 * 60000),
        getLatestSnapshot: async () => missing,
        politeFetch: async () => htmlResponse(T3_PREDEADLINE),
      });
      check("窓・要求券種なし: 時刻を作らずsnapshot_unavailable", result.status === 200 &&
        result.cacheControl === CACHE_UPSTREAM_ERROR && show(result.body) === show({
          ok: false, reason: "snapshot_unavailable", retryAfterSec: 60,
        }));
    }
    for (const source of ["deadline", "snapshot"]) {
      const failure = new Error("DB read failed");
      let caught;
      try {
        await handleLiveOddsRequest({
          query: { raceId: TODAY_RACE, page: "3t" }, now: () => NOW,
          getDeadline: async () => {
            if (source === "deadline") throw failure;
            return new Date(NOW.getTime() + 100 * 60000);
          },
          getLatestSnapshot: async () => { throw failure; },
          politeFetch: async () => htmlResponse(T3_PREDEADLINE),
        });
      } catch (error) { caught = error; }
      check(`${source}の読取失敗は投げる`, caught === failure);
    }
    let fetched = 0;
    await handleLiveOddsRequest({
      query: { raceId: TODAY_RACE, page: "3t" }, now: () => NOW,
      getDeadline: async () => null,
      getLatestSnapshot: async () => { throw new Error("呼ばない"); },
      politeFetch: async () => { fetched++; return htmlResponse(T3_PREDEADLINE); },
    });
    check("締切不明は従来どおり公式取得", fetched === 1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・FINAL・T3_PREDEADLINE・TF_UNPUBLISHED・NOW・TODAY_RACE・htmlResponse・fetcher・live） */
export async function runOddsLiveApiScenes2(env) {
  ({ check, show, FINAL, T3_PREDEADLINE, TF_UNPUBLISHED, NOW, TODAY_RACE, htmlResponse, fetcher, live } = env);
  await scene5();
  await scene6();
}
