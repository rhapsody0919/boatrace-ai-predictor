/**
 * verify-scrape-daily-jobs.js の後半の場面（6/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { FetchError } from "../../lib/scrapeJobs/politeFetch.js";
import { runRacerNewsJob } from "../../lib/racerNewsJob.js";
import { createDbPendingStore, mergePendingLists } from "../../lib/racerNews/pendingReview.js";
import { createFakeSupabaseClient as createFakeClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { newsTables, newsFetch, NEWS_BASE } from "./scrape-daily-jobs-scenes-5.js";

let check, show, jst, liveRow, runJob;

// ===========================================================================
// (g) 選手プロフィール・期別成績（B6）: チャンクの再開位置
// ===========================================================================
export const summaryOf = ({
  processed = 100,
  last = 4099,
  remaining = 1500,
  fail = 0,
  attempts,
  aborted = false,
  saveErrors = 0,
  targetCount,
} = {}) => {
  const total = attempts ?? processed;
  return {
    targetCount: targetCount ?? processed,
    processedPrefix: processed,
    lastProcessedRacerId: processed > 0 ? last : null,
    remaining,
    aborted,
    deadlineStopped: remaining > 0 && !aborted,
    durationSeconds: 1,
    profile: {
      successCount: 0,
      failCount: 0,
      saveErrorCount: saveErrors,
      failedRacerIds: [],
    },
    season: {
      successCount: Math.max(
        0,
        total - fail - Math.min(10, Math.max(0, total - fail)),
      ),
      unchangedCount: Math.min(10, Math.max(0, total - fail)),
      noDataCount: 0,
      failCount: fail,
      failedRacerIds: [],
    },
  };
};

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const at = jst("2026-09-19T23:10:00");
  const runIt = (store, client, fetchImpl, when = at) =>
    runJob({
      job: "racer_news",
      run: (ctx) => runRacerNewsJob(ctx),
      store,
      client,
      politeFetch: fetchImpl,
      at: when,
    });
  // shadow: 取得・解析・照合のみ。書かない
  {
    const client = createFakeClient({ tables: newsTables() });
    const store = createMemoryStore({
      rows: { racer_news: { ...liveRow("racer_news"), mode: "shadow" } },
    });
    const fetchImpl = newsFetch();
    const res = await runIt(store, client, fetchImpl);
    const report = store.state.get("racer_news").last_report;
    check(
      "選手ニュース shadow: 当月・前月の一覧を取得し、生成2・要確認2・対象外1を数えるが、racer_news・racer_news_pending へ書かない",
      res.status === 200 &&
        fetchImpl.log.length === 2 &&
        report.generated === 2 &&
        report.pending === 2 &&
        report.skipped === 1 &&
        client.writesTo("racer_news").length === 0 &&
        client.writesTo("racer_news_pending").length === 0 &&
        store.state.get("racer_news").last_target_date === undefined,
      show({ body: res.body, report }),
    );
  }
  // live: racer_news へ2件・要確認リスト(DBの表)へ2件。pending.json(fs)には書かない
  const client = createFakeClient({ tables: newsTables() });
  {
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(store, client, newsFetch());
    const news = client.data.racer_news;
    const pending = client.data.racer_news_pending;
    check(
      "選手ニュース live: 照合を通過した2件(当月・前月)を racer_news へ、選手を特定できない・見出しの形式が違う2件を要確認リスト(DB)へ書く",
      res.status === 200 &&
        news.length === 2 &&
        news.every((n) => n.racer_id === 4444 && /山田太郎/.test(n.title)) &&
        pending.length === 2 &&
        pending.every((p) => p.status === "pending") &&
        pending.some((p) => /見つかりません/.test(p.reason)) &&
        pending.some((p) => /抽出できません/.test(p.reason)) &&
        store.state.get("racer_news").last_target_date === "2026-09-19",
      show({ n: news.length, p: pending.length, body: res.body }),
    );
  }
  return { runIt, client };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ runIt, client }) {
  // 冪等: 別の実行(補足の起動・GitHub Actionsとの並走)でも、処理済みの記事は増えない
  {
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(
      store,
      client,
      newsFetch(),
      jst("2026-09-20T01:10:00"),
    );
    check(
      "選手ニュース: 処理済みの記事(racer_news・要確認リストに記録済み)は、二度目の実行で増えない(生成0・要確認0)",
      res.status === 200 &&
        client.data.racer_news.length === 2 &&
        client.data.racer_news_pending.length === 2 &&
        res.body.generated === 0 &&
        res.body.pending === 0 &&
        res.body.skipped === 5 &&
        store.state.get("racer_news").last_target_date === "2026-09-19",
      show(res.body),
    );
  }
  // 取得失敗はエラー（一覧の1ページだけでも）
  for (const [label, overrides] of [
    [
      "当月の一覧の取得失敗",
      { [`${NEWS_BASE}/2026/09/`]: new FetchError("u", 3, new Error("x")) },
    ],
    [
      "当月・前月とも取得失敗",
      {
        [`${NEWS_BASE}/2026/09/`]: new FetchError("u", 3, new Error("x")),
        [`${NEWS_BASE}/2026/08/`]: new Response("", { status: 503 }),
      },
    ],
  ]) {
    const c = createFakeClient({ tables: newsTables() });
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(store, c, newsFetch(overrides));
    check(
      `選手ニュース: ${label}は、エラー(500)。対象日を処理済みにしない（補足の起動が再試行する）`,
      res.status === 500 &&
        store.state.get("racer_news").last_target_date === undefined,
      show(res.body),
    );
  }
  // 記事の処理エラー（DBの書き込み失敗）はエラー
  {
    const c = createFakeClient({
      tables: newsTables(),
      failOn: { "racer_news:insert": "disk full" },
    });
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(store, c, newsFetch());
    check(
      "選手ニュース: racer_news の書き込みエラーは、エラー(500)（ログだけで成功にしない）",
      res.status === 500 &&
        store.state.get("racer_news").last_target_date === undefined,
      show(res.body),
    );
  }
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3() {
  // 要確認リストのDBストア: 追加は冪等・承認/却下の反映・未確認の一覧・移行期間の統合(DB優先)
  {
    const c = createFakeClient({ tables: { racer_news_pending: [] } });
    const store = createDbPendingStore(c);
    const item = {
      id: "grade-announcement-https://x/1",
      source: "grade-announcement",
      reason: "テスト",
      candidate: { racerId: 1 },
      sourceUrl: "https://x/1",
      sourceName: "公式",
      detectedAt: "2026-09-19",
    };
    await store.addPendingItem(item);
    await store.addPendingItem(item);
    check(
      "要確認リスト(DB): 同じ id の追加は冪等(1行)。未確認の一覧・処理済みの判定(source_url)ができる",
      c.data.racer_news_pending.length === 1 &&
        (await store.listPending()).length === 1 &&
        (await store.hasItemForSourceUrl("https://x/1")) === true &&
        (await store.hasItemForSourceUrl("https://x/2")) === false,
    );
    await store.updateStatus(item.id, "approved");
    const row = c.data.racer_news_pending[0];
    let missing = null;
    try {
      await store.updateStatus("no-such-id", "rejected");
    } catch (error) {
      missing = error.message;
    }
    check(
      "要確認リスト(DB): 承認を反映すると status=approved・resolved_at が入り、未確認の一覧から消える。存在しない id は例外",
      row.status === "approved" &&
        typeof row.resolved_at === "string" &&
        (await store.listPending()).length === 0 &&
        /見つかりません/.test(missing ?? ""),
      show({ row, missing }),
    );
    const merged = mergePendingLists(
      [{ id: "a", status: "approved" }],
      [
        { id: "a", status: "pending" },
        { id: "b", status: "pending" },
      ],
    );
    check(
      "要確認リスト: DB と pending.json の統合は、id で重複を除き、DB を優先する(DBで承認済みの項目が、ファイルの未確認で復活しない)",
      merged.length === 2 &&
        merged.find((m) => m.id === "a").status === "approved" &&
        merged.find((m) => m.id === "b").status === "pending",
      show(merged),
    );
    const failing = createDbPendingStore(
      createFakeClient({ failOn: { "racer_news_pending:select": "no table" } }),
    );
    let msg = "";
    try {
      await failing.listPending();
    } catch (error) {
      msg = error.message;
    }
    check(
      "要確認リスト(DB): DBエラーは、握りつぶさず、意味のあるメッセージの例外",
      /racer_news_pending.*取得に失敗/.test(msg),
      msg,
    );
  }
}

async function scene4() {
  {
    const s1 = await scene1();
    await scene2(s1);
    await scene3();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・jst・liveRow・runJob） */
export async function runScrapeDailyJobsScenes8(env) {
  ({ check, show, jst, liveRow, runJob } = env);
  await scene4();
}
