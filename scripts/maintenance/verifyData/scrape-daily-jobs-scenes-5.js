/**
 * verify-scrape-daily-jobs.js の後半の場面（5/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { FetchError } from "../../lib/scrapeJobs/politeFetch.js";
import {
  updateHealthForDate,
  isTransientReason,
  reasonFromError,
  previouslySettledVenues,
} from "../../lib/scrapeJobs/venueJobSupport.js";
import { runVenueMotorStatsJob } from "../../lib/venueMotorStatsJob.js";
import { VENUE_MOTOR_STATS_CONFIG } from "../../lib/venueMotorStats/venueConfig.js";
import { createFakeSupabaseClient as createFakeClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let check, show, same, jst, MOTOR, createFakeFetch, liveRow, runJob, fukuoka;
let NEWS_SEPT, NEWS_AUG;

// ---- B3 会場別モーター成績 --------------------------------------------------
export const byName = (name) =>
  VENUE_MOTOR_STATS_CONFIG.find((v) => v.name === name);

// ===========================================================================
// (f) 選手ニュース（B5）
// ===========================================================================
export const NEWS_BASE = "https://www.boatrace.jp/owpc/pc/site/news/racer";

const newsHtml = (items) =>
  `<ul class="news4_newsList">${items
    .map(
      (i) =>
        `<li><a href="${i.href}"><span class="news4_newsTitle">${i.title}</span><span class="news4_dateText">${i.date}</span></a></li>`,
    )
    .join("")}</ul>`;

export const newsFetch = (overrides = {}) =>
  createFakeFetch((url) => {
    if (url in overrides) return overrides[url];
    if (url === `${NEWS_BASE}/2026/09/`) return NEWS_SEPT;
    if (url === `${NEWS_BASE}/2026/08/`) return NEWS_AUG;
    return new Response("", { status: 404 });
  });

export const newsTables = () => ({
  racer_profiles: [{ racer_id: 4444, name: "山田 太郎", branch: "東京" }],
  racer_news: [],
  racer_news_pending: [],
});

function scene1() {
  // 同じ日の再実行は、連続失敗日数を増やさない（履歴の冪等）
  {
    let entry;
    const fail = {
      success: false,
      reason: "table_not_found",
      date: "2026-09-19",
    };
    entry = updateHealthForDate(entry, fail);
    entry = updateHealthForDate(entry, fail);
    entry = updateHealthForDate(entry, fail);
    check(
      "履歴: 同じ日に3回失敗しても、連続失敗日数は1（補足の起動で増えない）",
      entry.consecutiveFailDays === 1 && entry.lastReason === "table_not_found",
      show(entry),
    );
    entry = updateHealthForDate(entry, { ...fail, date: "2026-09-20" });
    check("履歴: 翌日も失敗なら2", entry.consecutiveFailDays === 2, show(entry));
    entry = updateHealthForDate(entry, {
      success: true,
      reason: null,
      date: "2026-09-20",
    });
    check(
      "履歴: 同じ日に、失敗の後で成功すれば、その日の失敗を取り消して0(連続日数は前日までの分でなく、成功でリセット)",
      entry.consecutiveFailDays === 0 && entry.lastReason === null,
      show(entry),
    );
    check(
      "理由コード: timeout・network_error・http_5xx・breaker_open は一時的。構造の理由(no_data_rows等)・http_404は一時的でない",
      ["timeout", "network_error", "http_503", "http_429", "breaker_open"].every(
        isTransientReason,
      ) &&
        ["no_data_rows", "entry_course_table_not_found", "http_404", null].every(
          (r) => !isTransientReason(r),
        ),
    );
    check(
      "理由コード: FetchError(タイムアウト由来)→timeout、FetchError(その他)→network_error、それ以外はメッセージのまま",
      reasonFromError(
        new FetchError(
          "u",
          3,
          Object.assign(new Error("a"), { name: "AbortError" }),
        ),
      ) === "timeout" &&
        reasonFromError(new FetchError("u", 3, new Error("x"))) ===
          "network_error" &&
        reasonFromError(new Error("http_404")) === "http_404",
    );
  }
  {
    const report = (mode, date, settled) => ({
      mode,
      date,
      settledVenues: settled,
    });
    const set = (r, date, mode) => [...previouslySettledVenues(r, date, mode)];
    check(
      "書き込み済みの会場の引き継ぎ: live 同士・同じ日だけ引き継ぐ。shadow の記録・別の日・現在が shadow の場合は引き継がない",
      same(
        set(report("live", "2026-09-19", [8, 18]), "2026-09-19", "live"),
        [8, 18],
      ) &&
        same(
          set(report("shadow", "2026-09-19", [8]), "2026-09-19", "live"),
          [],
        ) &&
        same(set(report("live", "2026-09-18", [8]), "2026-09-19", "live"), []) &&
        same(
          set(report("live", "2026-09-19", [8]), "2026-09-19", "shadow"),
          [],
        ) &&
        same(set(null, "2026-09-19", "live"), []),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・MOTOR・createFakeFetch・liveRow・runJob） */
export function runScrapeDailyJobsScenes5(env) {
  ({ check, show, same, jst, MOTOR, createFakeFetch, liveRow, runJob } = env);
  scene1();
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene2() {
  const ashiya = byName("芦屋");
  const gamagori = byName("蒲郡");
  const venueConfig = [fukuoka, ashiya, gamagori];
  const motorFetch = (overrides = {}) =>
    createFakeFetch((url) => {
      if (url in overrides) return overrides[url];
      if (url === fukuoka.url) return MOTOR("fukuoka");
      if (url === ashiya.url) return MOTOR("ashiya");
      if (url === gamagori.url) return MOTOR("gamagori");
      return new Response("", { status: 404 });
    });
  const at = jst("2026-09-19T06:00:00");
  const runIt = (store, client, fetchImpl, when = at) =>
    runJob({
      job: "venue_motor_stats",
      run: (ctx) => runVenueMotorStatsJob(ctx, { venueConfig }),
      store,
      client,
      politeFetch: fetchImpl,
      at: when,
    });
  // 実パーサー（3会場）で、live: 書き込み・scraped_date は対象日・履歴は last_report
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: { venue_motor_stats: liveRow("venue_motor_stats") },
    });
    const fetchImpl = motorFetch();
    const res = await runIt(store, client, fetchImpl);
    const rows = client.data.venue_motor_stats ?? [];
    const row = store.state.get("venue_motor_stats");
    check(
      "モーター成績 live: 3会場(福岡65・芦屋・蒲郡)を取得・解析して書く。scraped_date は対象日。処理済みにする",
      res.status === 200 &&
        rows.length > 65 &&
        rows.every((r) => r.scraped_date === "2026-09-19") &&
        rows.filter((r) => r.venue_code === 22).length === 65 &&
        row.last_target_date === "2026-09-19" &&
        same(Object.keys(row.last_report.health).sort(), ["21", "22", "7"]),
      show({ n: rows.length, body: res.body }),
    );
    check(
      "モーター成績: 会場の同時取得は上限内(4)。各会場は1リクエスト",
      fetchImpl.log.length === 3 && fetchImpl.maxActive <= 4,
      show({ n: fetchImpl.log.length, max: fetchImpl.maxActive }),
    );
  }
  // shadow は書かない
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: {
        venue_motor_stats: { ...liveRow("venue_motor_stats"), mode: "shadow" },
      },
    });
    await runIt(store, client, motorFetch());
    check(
      "モーター成績 shadow: 取得・解析のみ。venue_motor_stats へ書かず、処理済みにしない",
      client.writesTo("venue_motor_stats").length === 0 &&
        store.state.get("venue_motor_stats").last_target_date === undefined,
    );
  }
  return { ashiya, gamagori, motorFetch, runIt };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene3({ ashiya, gamagori, motorFetch, runIt }) {
  // 一時的な失敗(http_503)の会場だけを、補足の起動(08:00)が再取得する。構造の失敗(no_data)は再取得しない
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: { venue_motor_stats: liveRow("venue_motor_stats") },
    });
    const first = motorFetch({
      [ashiya.url]: new Response("", { status: 503 }),
    });
    const res1 = await runIt(store, client, first);
    const row = store.state.get("venue_motor_stats");
    check(
      "モーター成績: 芦屋が503。他会場は書く。incomplete(処理済みにしない)。履歴に http_503",
      res1.status === 200 &&
        res1.body.incomplete === true &&
        row.last_target_date === undefined &&
        row.last_report.health["21"].lastReason === "http_503",
      show({ body: res1.body, health: row.last_report?.health }),
    );
    const second = motorFetch();
    const res2 = await runIt(store, client, second, jst("2026-09-19T08:00:00"));
    check(
      "モーター成績: 補足の起動(08:00)は芦屋だけを再取得して、処理済みにする",
      res2.status === 200 &&
        second.log.length === 1 &&
        second.log[0] === ashiya.url &&
        row.last_target_date === "2026-09-19",
      show({ log: second.log }),
    );
  }
  // 全会場が解析0行(期待あり)は0件エラー
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: { venue_motor_stats: liveRow("venue_motor_stats") },
    });
    const res = await runIt(
      store,
      client,
      motorFetch({
        [fukuoka.url]: "<html></html>",
        [ashiya.url]: "<html></html>",
        [gamagori.url]: "<html></html>",
      }),
    );
    check(
      "モーター成績: 取得した全会場で0行は、0件エラー(500)",
      res.status === 500 && /0件/.test(res.body.error ?? ""),
      show(res.body),
    );
  }
}

async function scene4() {
  {
    const s1 = await scene2();
    await scene3(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・MOTOR・createFakeFetch・liveRow・runJob・fukuoka） */
export async function runScrapeDailyJobsScenes6(env) {
  ({ check, show, same, jst, MOTOR, createFakeFetch, liveRow, runJob, fukuoka } = env);
  await scene4();
}

function scene5() {
  NEWS_SEPT = newsHtml([
    {
      href: "/owpc/pc/site/news/n1",
      title: "登録第4444号 山田 太郎選手（東京支部）通算1000勝達成",
      date: "2026/09/10",
    },
    {
      href: "/owpc/pc/site/news/n2",
      title: "登録第9999号 鈴木 一郎選手（大阪支部）通算500勝達成",
      date: "2026/09/11",
    },
    {
      href: "/owpc/pc/site/news/n3",
      title: "登録第1234号 佐藤選手 達成のお知らせ",
      date: "2026/09/12",
    },
    {
      href: "/owpc/pc/site/news/n4",
      title: "施設メンテナンスのお知らせ",
      date: "2026/09/13",
    },
  ]);
  NEWS_AUG = newsHtml([
    {
      href: "/owpc/pc/site/news/n5",
      title: "登録第4444号 山田 太郎選手（東京支部）通算900勝達成",
      date: "2026/08/20",
    },
  ]);
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・MOTOR・createFakeFetch・liveRow・runJob・fukuoka） */
export function runScrapeDailyJobsScenes7(env) {
  ({ check, show, same, jst, MOTOR, createFakeFetch, liveRow, runJob, fukuoka } = env);
  scene5();
}
