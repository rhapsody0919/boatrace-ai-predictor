/**
 * verify-scrape-odds-job.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-odds-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { shouldProbeWinFirst } from "../../lib/scrapeJobs/oddsHandlers.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { runOdds, slotOf } from "./scrape-odds-job-scenes-3.js";

let check, show, same, HTML_UNPUBLISHED, RACE_A, RACE_B, RACE_C, NOW, pageOfUrl, createFetcher;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  // 延長した窓（-60）の、未公開の間の再試行は、単勝1ページの確認に絞る（追加リクエストを未公開のレースだけ・1ページにする）
  check(
    "shouldProbeWinFirst: 延長した窓（-60）で、直前の試行が未公開（outcome=no_values）のときだけ true（初回・他の窓・他の結果は false）",
    shouldProbeWinFirst({ offset_min: -60, outcome: "no_values" }) === true &&
      shouldProbeWinFirst({ offset_min: -60, outcome: null }) === false &&
      shouldProbeWinFirst({ offset_min: -60 }) === false &&
      shouldProbeWinFirst({ offset_min: -60, outcome: "error" }) === false &&
      shouldProbeWinFirst({ offset_min: -60, outcome: "partial" }) === false &&
      [-30, -15, -10, -5, 0].every(
        (o) =>
          shouldProbeWinFirst({ offset_min: o, outcome: "no_values" }) ===
          false,
      ),
  );
  const liveRows = {
    odds: { job: "odds", mode: "live", consecutive_failures: 0 },
  };
  const probeUnpub = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -60, { attempts: 4, outcome: "no_values" })],
    fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "延長中の -60 の再試行（前回も未公開）で、まだ未公開: 取得先へのリクエストは単勝の1ページだけ。pending に戻り（no_values・約50秒後に再試行）、race_odds へ書かない",
    probeUnpub.fetcher.calls.length === 1 &&
      pageOfUrl(probeUnpub.fetcher.calls[0]) === "oddstf" &&
      probeUnpub.store.retried.length === 1 &&
      probeUnpub.store.retried[0].outcome === "no_values" &&
      Math.round(
        (probeUnpub.store.retried[0].retryAt.getTime() - NOW.getTime()) / 1000,
      ) ===
        SCRAPE_JOBS.odds.retrySec - 10 &&
      probeUnpub.db.writes.length === 0,
    show(probeUnpub.fetcher.calls.map(pageOfUrl)),
  );
  const probePub = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -60, { attempts: 4, outcome: "no_values" })],
  });
  return { liveRows, probePub };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ liveRows, probePub }) {
  check(
    "延長中の -60 の再試行で、公開されていた: 全通りを取得して書き込み（window_min=-60・source=vercel）、done（ok）にする。単勝は重複して取らない（計5リクエスト）",
    probePub.fetcher.calls.length === 5 &&
      probePub.store.completed.length === 1 &&
      probePub.store.completed[0].outcome === "ok" &&
      probePub.db.rows.length === 1 &&
      probePub.db.rows[0].window_min === -60 &&
      probePub.db.rows[0].source === "vercel",
    show(probePub.fetcher.calls.map(pageOfUrl)),
  );
  const firstTry = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -60, { attempts: 1, outcome: null })],
    fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "-60 の初回の試行（outcome なし）は、従来どおり全5ページを並列に取る（通常の取得の所要時間・リクエストを変えない）",
    firstTry.fetcher.calls.length === 5,
    show(firstTry.fetcher.calls.map(pageOfUrl)),
  );
  const otherWindow = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -30, { attempts: 2, outcome: "no_values" })],
    fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "他の窓（-30）は、前回が未公開でも、従来どおり全5ページを取る（延長・1ページの確認は -60 だけ）",
    otherWindow.fetcher.calls.length === 5,
    show(otherWindow.fetcher.calls.map(pageOfUrl)),
  );
  // 追加リクエストの見積り: 未公開のレース N 件 × 最大27回（-60〜-33 の毎分。-30 の窓が始まるまで）× 1ページ
  const graceMin = SCRAPE_JOBS.odds.graceMinByOffset[-60];
  const maxProbes = Math.floor(
    (graceMin * 60 - SCRAPE_JOBS.odds.graceMin * 60) /
      (SCRAPE_JOBS.odds.retrySec - 10 + 10),
  );
  check(
    "追加リクエストの上限の見積り: 1レースあたり、延長した27分の間、毎分1ページ（最大約27件。従来の窓内は3分・5ページ）",
    maxProbes === 27 && graceMin === 30,
    show([graceMin, maxProbes]),
  );
  // ハンドラーが runForRaces に渡す引数
  const seen = [];
  const rec = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(RACE_C, -10, { attempts: 3 })],
    run: async (races, options) => {
      seen.push({ races, options });
      return [
        {
          race_id: races[0].race_id,
          outcome: "ok",
          rowsWritten: 1,
          rowsParsed: 1,
          rowsExpected: 1,
        },
      ];
    },
  });
  const s = seen[0];
  check(
    "ハンドラー: スロットの窓（offset_min）が window_min、試行回数が attempts、race_id から日付・会場・レース番号を解いて渡す",
    s.races[0].window_min === -10 &&
      s.races[0].attempts === 3 &&
      s.races[0].venue_code === 5 &&
      s.races[0].race_number === 3 &&
      s.options.date === "2026-09-19" &&
      s.options.mode === "live" &&
      s.options.client === rec.db &&
      rec.store.completed.length === 1,
    show(s),
  );
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3() {
  const bad = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf("bad-race-id", -30)],
  });
  check(
    "ハンドラー: 不正な race_id は error として再試行に戻す（ジョブは落ちない）",
    bad.store.retried[0]?.outcome === "error" &&
      /race_id の形式が不正/.test(bad.store.retried[0].error),
    show(bad.result.body),
  );
}

async function scene4() {
  {
    const shadow = await runOdds({
      rows: { odds: { job: "odds", mode: "shadow", consecutive_failures: 0 } },
      slots: [slotOf(RACE_A, -30), slotOf(RACE_B, -15)],
    });
    const claim = shadow.store.calls.find((c) => c.name === "claimSlots");
    check(
      "ラッパ: shadow は、race_odds へ書かず、予定表のスロットを done にして digest を記録する（run_mode は shadow で claim）",
      shadow.result.status === 200 &&
        shadow.db.writes.length === 0 &&
        shadow.db.rows.length === 0 &&
        shadow.store.completed.length === 2 &&
        shadow.store.completed.every(
          (c) => c.outcome === "ok" && /^[0-9a-f]{16}$/.test(c.resultDigest),
        ) &&
        claim.mode === "shadow",
      show({
        body: shadow.result.body,
        completed: shadow.store.completed.length,
      }),
    );
    const live = await runOdds({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
      slots: [slotOf(RACE_A, -30), slotOf(RACE_B, -15)],
    });
    check(
      "ラッパ: live は race_odds へ書き込み（2レース×2窓の別の行）、スロットを done にする",
      live.result.status === 200 &&
        live.db.rows.length === 2 &&
        live.db.rows.every((r) => r.source === "vercel") &&
        live.store.completed.length === 2 &&
        live.result.body.rowsWritten === 2,
      show(live.result.body),
    );
    check(
      "ラッパ: shadow と live で、同じスロットの digest が一致する（shadow の一致率の比較が成り立つ）",
      same(
        shadow.store.completed.map((c) => c.resultDigest),
        live.store.completed.map((c) => c.resultDigest),
      ),
    );
  }
}

async function scene5() {
  {
    const partial = await runOdds({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
      slots: [slotOf(RACE_A, -30)],
      fetcher: createFetcher({ odds2tf: 500 }),
    });
    check(
      "ラッパ: partial は done にせず、pending に戻す（再試行の間隔は retrySec の60秒−ジッターで、claim した時刻が起点）。取れた分は書き込み済み",
      partial.result.status === 200 &&
        partial.store.completed.length === 0 &&
        partial.store.retried.length === 1 &&
        partial.store.retried[0].outcome === "partial" &&
        /exacta_all/.test(partial.store.retried[0].error) &&
        partial.db.rows.length === 1 &&
        Math.round(
          (partial.store.retried[0].retryAt.getTime() - NOW.getTime()) / 1000,
        ) ===
          SCRAPE_JOBS.odds.retrySec - 10,
      show(partial.store.retried.map((r) => [r.outcome, r.retryAt])),
    );
    const allError = await runOdds({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
      slots: [slotOf(RACE_A, -30), slotOf(RACE_B, -30)],
      fetcher: createFetcher({ oddstf: 500 }),
    });
    check(
      "ラッパ: 処理した全スロットが error なら、この実行は失敗（HTTP 500・連続失敗数を増やす）。書き込みなし",
      allError.result.status === 500 &&
        allError.store.state.get("odds").consecutive_failures === 1 &&
        allError.db.writes.length === 0 &&
        allError.store.retried.length === 2,
      show(allError.result.body),
    );
    const noValues = await runOdds({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
      slots: [slotOf(RACE_A, -60)],
      fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
    });
    check(
      "ラッパ: 未公開（no_values）は再試行に戻し、200（失敗にしない。許容幅を過ぎれば expired として通知される）",
      noValues.result.status === 200 &&
        noValues.store.retried[0]?.outcome === "no_values" &&
        noValues.store.completed.length === 0,
    );
    const breaker = await runOdds({
      rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
      slots: [slotOf(RACE_A, -30)],
      fetcher: createFetcher({
        oddstf: new BreakerOpenError("host:boatrace.jp", NOW.getTime() + 90000),
      }),
    });
    check(
      "ラッパ: ブレーカーが開いていたら、ブレーカーが閉じる頃まで再試行を遅らせる（retryAt）",
      breaker.store.retried[0]?.outcome === "breaker_open" &&
        breaker.store.retried[0].retryAt.getTime() === NOW.getTime() + 90000,
    );
  }
  {
    const s1 = await scene1();
    await scene2(s1);
    await scene3();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_UNPUBLISHED・RACE_A・RACE_B・RACE_C・NOW・pageOfUrl・createFetcher） */
export async function runScrapeOddsJobScenes4(env) {
  ({ check, show, same, HTML_UNPUBLISHED, RACE_A, RACE_B, RACE_C, NOW, pageOfUrl, createFetcher } = env);
  await scene4();
  await scene5();
}
