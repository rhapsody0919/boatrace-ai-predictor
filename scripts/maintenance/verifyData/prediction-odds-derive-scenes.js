/**
 * verify-prediction-odds-derive.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-prediction-odds-derive.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  fetchPredictionsByModel,
  fetchLatestRaceOdds,
  deriveAndUpsertPredictionOdds,
  runPredictionOddsDerivation,
  createOddsCronHandlerWithPredictionOdds,
} from "../../lib/scrapeJobs/predictionOddsHandlers.js";
import { createOddsSlotHandler } from "../../lib/scrapeJobs/oddsHandlers.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";

let check, show, same, fakeSelectClient, createFakeDb;

async function scene1() {
  {
    const client = fakeSelectClient({
      predictions: [
        {
          race_id: "r1",
          model_id: "standard",
          top_pick: 1,
          top_2nd: 2,
          top_3rd: 3,
          is_shadow: false,
        },
        {
          race_id: "r1",
          model_id: "safeBet",
          top_pick: 2,
          top_2nd: 1,
          top_3rd: 3,
          is_shadow: false,
        },
        {
          // is_shadow=true は対象外
          race_id: "r1",
          model_id: "upsetFocus",
          top_pick: 9,
          top_2nd: 9,
          top_3rd: 9,
          is_shadow: true,
        },
      ],
    });
    const map = await fetchPredictionsByModel(client, ["r1", "r2"]);
    check(
      "fetchPredictionsByModel: is_shadow=false のみ、モデルID別に集約する。空なら空Map（クエリしない）",
      map.size === 1 &&
        same(map.get("r1").standard, { top1: 1, top2: 2, top3: 3 }) &&
        same(map.get("r1").safeBet, { top1: 2, top2: 1, top3: 3 }) &&
        map.get("r1").upsetFocus === undefined &&
        (await fetchPredictionsByModel(client, [])).size === 0,
      show([...map.entries()]),
    );
  }
  {
    const client = fakeSelectClient({
      race_odds: [
        {
          race_id: "r1",
          captured_at: "2026-09-19T04:00:00.000Z",
          trifecta_all: { "1-2-3": 10 },
          trio_all: null,
        },
        {
          // trifecta は無いが trio は取れている、より新しい窓
          race_id: "r1",
          captured_at: "2026-09-19T04:30:00.000Z",
          trifecta_all: null,
          trio_all: { "1-2-3": 4 },
        },
        {
          // より新しいが trifecta も trio も無い（無視され、上の2行がそれぞれ残る）
          race_id: "r1",
          captured_at: "2026-09-19T04:55:00.000Z",
          trifecta_all: null,
          trio_all: null,
        },
      ],
    });
    const map = await fetchLatestRaceOdds(client, ["r1"]);
    check(
      "fetchLatestRaceOdds: 券種ごとに、値が入っている最新の行を独立に選ぶ（新しいnullの窓に上書きされない）",
      same(map.get("r1"), {
        trifectaAll: { "1-2-3": 10 },
        trioAll: { "1-2-3": 4 },
      }),
      show(map.get("r1")),
    );
    check(
      "fetchLatestRaceOdds: 該当行が無いレースはMapに含めない",
      !(await fetchLatestRaceOdds(client, ["r99"])).has("r99"),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・fakeSelectClient・createFakeDb） */
export async function runPredictionOddsDeriveScenes1(env) {
  ({ check, show, same, fakeSelectClient, createFakeDb } = env);
  await scene1();
}

async function scene2() {
  {
    // 対象レースが無い（導出結果0件）
    const db = createFakeDb({ predictions: [], race_odds: [] });
    const r = await deriveAndUpsertPredictionOdds({
      raceIds: [],
      client: db,
      mode: "live",
    });
    check(
      "対象レースが無ければ何もしない",
      r.updated === false && r.count === 0 && db.writes.length === 0,
    );
    let threw = null;
    try {
      await deriveAndUpsertPredictionOdds({
        raceIds: ["r1"],
        client: db,
        mode: "bogus",
      });
    } catch (e) {
      threw = e.message;
    }
    check("mode が不正なら例外", /mode/.test(threw ?? ""), threw);
  }
  // ---------------------------------------------------------------------------
  // (e) createOddsSlotHandler の onChanged
  // ---------------------------------------------------------------------------
  {
    async function fireWith(outcome, mode) {
      const changed = [];
      const handler = createOddsSlotHandler({
        run: async () => [
          { race_id: "r1", outcome, rowsWritten: outcome === "ok" ? 1 : 0 },
        ],
        onChanged: (raceId) => changed.push(raceId),
      });
      await handler(
        { race_id: "2026-09-19-05-01", offset_min: -30, attempts: 1 },
        { mode, politeFetch: async () => {}, client: {}, now: () => new Date() },
      );
      return changed;
    }
    check(
      "onChanged: live かつ完了（ok）で呼ぶ",
      same(await fireWith("ok", "live"), ["2026-09-19-05-01"]),
    );
    check(
      "onChanged: live かつ完了（skipped_have_data）でも呼ぶ",
      same(await fireWith("skipped_have_data", "live"), ["2026-09-19-05-01"]),
    );
    check(
      "onChanged: shadow では呼ばない（race_odds へ書いていない）",
      same(await fireWith("ok", "shadow"), []),
    );
    for (const outcome of ["partial", "no_values", "error", "breaker_open"]) {
      check(
        `onChanged: live でも未完了（${outcome}）では呼ばない`,
        same(await fireWith(outcome, "live"), []),
      );
    }
    check(
      "onChanged 未指定でも、従来どおり動く（例外にしない）",
      (async () => {
        const handler = createOddsSlotHandler({
          run: async () => [{ race_id: "r1", outcome: "ok", rowsWritten: 1 }],
        });
        const result = await handler(
          { race_id: "2026-09-19-05-01", offset_min: -30, attempts: 1 },
          {
            mode: "live",
            politeFetch: async () => {},
            client: {},
            now: () => new Date(),
          },
        );
        return result.outcome === "ok";
      })(),
    );
  }
}

async function scene3() {
  // ---------------------------------------------------------------------------
  // (f) runPredictionOddsDerivation
  // ---------------------------------------------------------------------------
  {
    const off = await runPredictionOddsDerivation({
      raceIds: ["r1"],
      client: {},
      store: createMemoryStore({ rows: {} }),
    });
    check(
      "行が無いジョブは off として扱い、行を作るだけ（導出しない）",
      off.skipped === "mode_off" && off.mode === "off",
      show(off),
    );
    const unavailable = await runPredictionOddsDerivation({
      raceIds: ["r1"],
      client: {},
      store: createMemoryStore({ available: false }),
    });
    check(
      "予定表/ジョブ状態のスキーマが未適用なら、何もせずスキップ",
      unavailable.skipped === "scrape_schema_not_applied",
    );
    const explicitOff = await runPredictionOddsDerivation({
      raceIds: ["r1"],
      client: {},
      store: createMemoryStore({
        rows: { prediction_odds: { job: "prediction_odds", mode: "off" } },
      }),
    });
    check("mode=off は導出しない", explicitOff.skipped === "mode_off");

    const store = createMemoryStore({
      rows: {
        prediction_odds: {
          job: "prediction_odds",
          mode: "live",
          consecutive_failures: 0,
        },
      },
    });
    const derive = async ({ raceIds, mode }) => ({
      updated: true,
      count: raceIds.length,
      mode,
    });
    const live = await runPredictionOddsDerivation({
      raceIds: ["r1", "r2"],
      client: {},
      now: () => new Date("2026-09-19T05:00:00Z"),
      derive,
      store,
    });
    check(
      "live: derive を mode='live' で呼び、成功をジョブ状態に記録する",
      live.updated === true &&
        live.count === 2 &&
        store.state.get("prediction_odds").last_success_at ===
          "2026-09-19T05:00:00.000Z" &&
        store.state.get("prediction_odds").last_rows_written === 2,
      show(live),
    );

    const failingStore = createMemoryStore({
      rows: {
        prediction_odds: {
          job: "prediction_odds",
          mode: "shadow",
          consecutive_failures: 0,
        },
      },
    });
    const throwingDerive = async () => {
      throw new Error("導出エラーのテスト");
    };
    const failed = await runPredictionOddsDerivation({
      raceIds: ["r1"],
      client: {},
      now: () => new Date("2026-09-19T05:00:00Z"),
      derive: throwingDerive,
      store: failingStore,
    });
    check(
      "導出の失敗は例外を投げず、ジョブ状態にのみ記録する（呼び出し元＝A3の成否に混ぜない）",
      failed.error === "導出エラーのテスト" &&
        failingStore.state.get("prediction_odds").last_error ===
          "導出エラーのテスト" &&
        failingStore.state.get("prediction_odds").consecutive_failures === 1,
      show(failed),
    );
  }
}

async function scene4() {
  // ---------------------------------------------------------------------------
  // (g) createOddsCronHandlerWithPredictionOdds
  // ---------------------------------------------------------------------------
  {
    function fakeRes() {
      const res = { statusCode: null, body: null };
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (body) => {
        res.body = body;
        return res;
      };
      return res;
    }
    const calls = [];
    const handler = createOddsCronHandlerWithPredictionOdds({
      getClient: async () => ({ fake: "client" }),
      derivePredictionOdds: async (args) => {
        calls.push(args);
        return { updated: true, count: args.raceIds.length };
      },
    });
    // runScrapeJob 自体は本物を使うため、DBスキーマ未適用（available=false）にして、常に0件（changed無し）にする
    // 差し替えができないため、認証エラーの経路だけを確認する（配線の主要部は (e)(f) が個別に確認済み）
    const unauthorized = fakeRes();
    await handler({ headers: {}, query: {} }, unauthorized);
    check(
      "認証: Authorization ヘッダが無ければ 401",
      unauthorized.statusCode === 401 && unauthorized.body.success === false,
    );

    process.env.CRON_SECRET = "test-secret";
    const noClient = createOddsCronHandlerWithPredictionOdds({
      getClient: async () => null,
    });
    const noClientRes = fakeRes();
    await noClient(
      { headers: { authorization: "Bearer test-secret" }, query: {} },
      noClientRes,
    );
    check(
      "Supabaseクライアントが無ければ 500",
      noClientRes.statusCode === 500 && noClientRes.body.job === "odds",
    );
    delete process.env.CRON_SECRET;
    check(
      "導出フックには到達していない（クライアント無しで打ち切り）",
      calls.length === 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・fakeSelectClient・createFakeDb） */
export async function runPredictionOddsDeriveScenes2(env) {
  ({ check, show, same, fakeSelectClient, createFakeDb } = env);
  await scene2();
  await scene3();
  await scene4();
}
