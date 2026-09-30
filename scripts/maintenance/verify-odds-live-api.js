/**
 * verify-odds-live-api.js - オッズのライブ取得（BOA-487、api/odds/live.js）の検証。
 * DBにも取得先にも接続しない（取得関数と時計を差し替え、フィクスチャのHTMLを返す）。
 *
 * 確認すること:
 *   (a) パーサー: 「オッズ更新時間」（parseOddsUpdatedAt）・締切時オッズ（isFinalOdds）を、発売中の実ページ
 *       （江戸川8R 13:46・芦屋2R 8:14）と締切後の実ページ（桐生1R）で読み分ける。票0（「0.0」）は keepZero で 0 のまま残り、
 *       既定（cron の保存用）では従来どおり捨てる／null にする
 *   (b) parseLiveOddsPage: 5ページ（tf/3t/3f/2tf/k）の通り数、票0の艇・組み合わせが 0 で返る、未公開は published=false
 *   (c) クエリの検証: raceId の形式・JSTの当日のみ・page の列挙値・未知のパラメータ・GET以外 → 400/405（no-store）
 *   (d) handleLiveOddsRequest: 成功（s-maxage=30）・締切時オッズ（s-maxage=300）・未発売・HTTP非200・通信失敗・
 *       ブレーカー（retryAfterSec）→ 200+ok:false（s-maxage=10）。取得するURLが公式の該当ページ
 *   (e) 設定: api/odds/live.js の maxDuration=30・再試行なし・ブレーカーを DB ストアで共有、vite の READ_ONLY_API に odds
 */
import fs from "node:fs";
import * as cheerio from "cheerio";
import {
  parseOddsUpdatedAt,
  isFinalOdds,
  parseTrifectaAll,
  parseExactaAll,
  parseWideAll,
  parseRangeOddsValue,
} from "../lib/oddsParser.js";
import { scrapeWinOdds, scrapePlaceOdds } from "../daily/scrape-odds.js";
import {
  validateLiveOddsQuery,
  parseLiveOddsPage,
  handleLiveOddsRequest,
  liveOddsUrl,
  CACHE_OK,
  CACHE_OK_EARLY,
  CACHE_FINAL,
  CACHE_UPSTREAM_ERROR,
  CACHE_NO_STORE,
} from "../lib/liveOdds.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { FetchError } from "../lib/scrapeJobs/politeFetch.js";

const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

const FIX = (name) =>
  fs.readFileSync(
    new URL(`../lib/__fixtures__/odds/${name}`, import.meta.url),
    "utf8",
  );
// 締切後（「締切時オッズ」表示）の実ページ（桐生1R、2026-09-19）
const FINAL = {
  tf: FIX("oddstf-2026-09-19-05-01.html"),
  "3t": FIX("odds3t-2026-09-19-05-01.html"),
  "3f": FIX("odds3f-2026-09-19-05-01.html"),
  "2tf": FIX("odds2tf-2026-09-19-05-01.html"),
  k: FIX("oddsk-2026-09-19-05-01.html"),
};
// 発売中・単勝1艇と複勝4艇が票0の実ページ（江戸川8R、2026-09-28 13:55取得。オッズ更新時間 13:46）
const TF_ZERO_VOTES = FIX("oddstf-zero-votes-2026-09-28-03-08.html");
// 発売中・3連単の5通りが票0の実ページ（芦屋2R、2026-09-29 8:36取得。オッズ更新時間 " 8:14"）
const T3_PREDEADLINE = FIX("odds3t-predeadline-2026-09-29-21-02.html");
const TF_UNPUBLISHED = FIX("oddstf-unpublished-2026-09-25-05-01.html");

// ---- (a) パーサー ----
{
  check(
    "parseOddsUpdatedAt: 発売中の単勝ページ → 13:46",
    parseOddsUpdatedAt(cheerio.load(TF_ZERO_VOTES)) === "13:46",
  );
  check(
    "parseOddsUpdatedAt: 1桁の時（' 8:14'）→ 08:14",
    parseOddsUpdatedAt(cheerio.load(T3_PREDEADLINE)) === "08:14",
  );
  check(
    "parseOddsUpdatedAt: 締切後のページ・未公開のページ → null",
    parseOddsUpdatedAt(cheerio.load(FINAL.tf)) === null &&
      parseOddsUpdatedAt(cheerio.load(TF_UNPUBLISHED)) === null,
  );
  check(
    "isFinalOdds: 締切後の5ページは true、発売中・未公開は false",
    Object.values(FINAL).every((html) => isFinalOdds(cheerio.load(html))) &&
      !isFinalOdds(cheerio.load(TF_ZERO_VOTES)) &&
      !isFinalOdds(cheerio.load(T3_PREDEADLINE)) &&
      !isFinalOdds(cheerio.load(TF_UNPUBLISHED)),
  );

  const $tf = cheerio.load(TF_ZERO_VOTES);
  check(
    "scrapeWinOdds: 既定は票0を null（cron の保存は従来どおり）",
    show(scrapeWinOdds($tf)) === show([1, 14.2, 14.2, null, 14.2, 14.2]),
    show(scrapeWinOdds($tf)),
  );
  check(
    "scrapeWinOdds keepZero: 票0を 0 で返す",
    show(scrapeWinOdds($tf, { keepZero: true })) ===
      show([1, 14.2, 14.2, 0, 14.2, 14.2]),
  );
  check(
    "scrapePlaceOdds: 既定は 0.0-0.0 を null、keepZero は {low:0,high:0}",
    scrapePlaceOdds($tf)[2] === null &&
      show(scrapePlaceOdds($tf, { keepZero: true })[2]) ===
        show({ low: 0, high: 0 }) &&
      show(scrapePlaceOdds($tf, { keepZero: true })[0]) ===
        show({ low: 1, high: 1.5 }),
  );
  check(
    "parseRangeOddsValue: 既定の挙動は変えない（0.0-0.0・逆転・全角は従来どおり）",
    parseRangeOddsValue("0.0-0.0") === null &&
      parseRangeOddsValue("2.0-1.0") === null &&
      show(parseRangeOddsValue("1.5－1.9")) === show({ low: 1.5, high: 1.9 }),
  );

  const $3t = cheerio.load(T3_PREDEADLINE);
  const def = parseTrifectaAll($3t);
  const keep = parseTrifectaAll($3t, { keepZero: true });
  check(
    "parseTrifectaAll: 既定は票0を捨て（115通り）、keepZero は 0 で残す（120通り・0が5件）",
    def.size === 115 &&
      keep.size === 120 &&
      [...keep.values()].filter((v) => v === 0).length === 5,
    `default=${def.size} keep=${keep.size}`,
  );
  check(
    "parseExactaAll/parseWideAll: keepZero を付けても締切後のページの通り数は同じ",
    parseExactaAll(cheerio.load(FINAL["2tf"]), { keepZero: true }).size ===
      30 && parseWideAll(cheerio.load(FINAL.k), { keepZero: true }).size === 15,
  );
}

// ---- (b) parseLiveOddsPage ----
{
  const tf = parseLiveOddsPage("tf", TF_ZERO_VOTES);
  check(
    "tf（発売中）: 単勝6・複勝6、票0の艇は 0、公式更新 13:46、final=false",
    tf.published &&
      !tf.final &&
      tf.officialUpdatedAt === "13:46" &&
      Object.keys(tf.data.win).length === 6 &&
      tf.data.win["4"] === 0 &&
      tf.data.win["1"] === 1 &&
      Object.keys(tf.data.place).length === 6 &&
      show(tf.data.place["6"]) === show({ low: 0, high: 0 }),
    show(tf),
  );
  const t3 = parseLiveOddsPage("3t", T3_PREDEADLINE);
  check(
    "3t（発売中）: 120通り・票0は0・公式更新 08:14",
    t3.published &&
      !t3.final &&
      t3.officialUpdatedAt === "08:14" &&
      Object.keys(t3.data.trifectaAll).length === 120 &&
      Object.values(t3.data.trifectaAll).filter((v) => v === 0).length === 5,
  );
  const counts = {
    tf: (d) => [Object.keys(d.win).length, Object.keys(d.place).length],
    "3t": (d) => [Object.keys(d.trifectaAll).length],
    "3f": (d) => [Object.keys(d.trioAll).length],
    "2tf": (d) => [
      Object.keys(d.exactaAll).length,
      Object.keys(d.quinellaAll).length,
    ],
    k: (d) => [Object.keys(d.wideAll).length],
  };
  const expected = {
    tf: [6, 6],
    "3t": [120],
    "3f": [20],
    "2tf": [30, 15],
    k: [15],
  };
  for (const page of Object.keys(FINAL)) {
    const parsed = parseLiveOddsPage(page, FINAL[page]);
    const got = counts[page](parsed.data);
    check(
      `${page}（締切後）: 通り数 ${show(expected[page])}・final=true・公式更新 null`,
      parsed.published &&
        parsed.final &&
        parsed.officialUpdatedAt === null &&
        show(got) === show(expected[page]),
      show(got),
    );
  }
  const unpub = parseLiveOddsPage("tf", TF_UNPUBLISHED);
  check(
    "未公開のページ: published=false・data は空",
    !unpub.published && show(unpub.data) === "{}",
  );
}

// ---- (c) クエリの検証 ----
const NOW = new Date("2026-09-29T08:19:00+09:00");
const TODAY_RACE = "2026-09-29-21-02";
{
  const ok = validateLiveOddsQuery({ raceId: TODAY_RACE, page: "3t" }, NOW);
  check(
    "当日の raceId と page=3t を受け付ける",
    ok.ok && ok.venue === 21 && ok.raceNo === 2 && ok.date === "2026-09-29",
  );
  check(
    "JSTの日付で判定する（UTCでは前日の 00:30 JST も当日扱い）",
    validateLiveOddsQuery(
      { raceId: "2026-09-30-01-01", page: "tf" },
      new Date("2026-09-29T15:30:00Z"),
    ).ok,
  );
  const bad = [
    [{ raceId: "2026-09-28-21-02", page: "3t" }, "前日のレース"],
    [{ raceId: "2026-09-30-21-02", page: "3t" }, "翌日のレース"],
    [{ raceId: "2026-09-29-25-02", page: "3t" }, "会場25"],
    [{ raceId: "2026-09-29-21-13", page: "3t" }, "13R"],
    [{ raceId: "20260929-21-02", page: "3t" }, "形式違い"],
    [{ raceId: TODAY_RACE, page: "odds3t" }, "page が列挙値以外"],
    [{ raceId: TODAY_RACE }, "page なし"],
    [{ page: "3t" }, "raceId なし"],
    [{ raceId: [TODAY_RACE, TODAY_RACE], page: "3t" }, "raceId が配列"],
    [{ raceId: TODAY_RACE, page: "3t", t: "1" }, "未知のパラメータ"],
  ];
  for (const [query, label] of bad) {
    check(`400: ${label}`, validateLiveOddsQuery(query, NOW).ok === false);
  }
  check(
    "liveOddsUrl: 公式の該当ページ",
    liveOddsUrl({ ...ok, page: "2tf" }) ===
      "https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=2&jcd=21&hd=20260929",
  );
}

// ---- (d) handleLiveOddsRequest ----
const htmlResponse = (html, status = 200) => new Response(html, { status });
const fetcher = (fn) => {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    return fn(url);
  };
  f.calls = calls;
  return f;
};
{
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
      now: () => new Date("2026-09-29T08:59:00+09:00"), // 11分前
    });
    check(
      "締切まで10分超（11分前）: stale-while-revalidate=120",
      edge.cacheControl === CACHE_OK_EARLY,
      edge.cacheControl,
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

// ---- (e) 設定 ----
{
  const api = fs.readFileSync(
    new URL("../../api/odds/live.js", import.meta.url),
    "utf8",
  );
  check(
    "api/odds/live.js: maxDuration=30",
    /export const config = \{\s*maxDuration: 30,?\s*\}/.test(api),
  );
  check(
    "api/odds/live.js: 再試行なし・12秒で打ち切り・ブレーカーは DB ストア（Cron と共有）",
    /maxRetries:\s*0/.test(api) &&
      /timeoutMs:\s*12000/.test(api) &&
      /createSupabaseStore\(supabase\)\.breakerStore/.test(api),
  );
  check(
    "api/odds/live.js: race_odds に書かない",
    !/race_odds/.test(api.replace(/^\s*\*.*$/gm, "")),
  );
  const vite = fs.readFileSync(
    new URL("../../vite.config.js", import.meta.url),
    "utf8",
  );
  check(
    "vite.config.js: READ_ONLY_API に odds",
    /READ_ONLY_API = '[^']*\|odds\)/.test(vite),
  );
}

printOut("");
if (failures > 0) {
  printErr(`❌ ${failures}件の検証に失敗しました`);
  process.exit(1);
}
printOut("✅ すべての検証に成功しました");
