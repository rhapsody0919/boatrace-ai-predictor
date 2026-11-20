/**
 * verify-prediction-odds-derive.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-prediction-odds-derive.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  deriveAndUpsertPredictionOdds,
  runPredictionOddsDerivation,
} from "../../lib/scrapeJobs/predictionOddsHandlers.js";
import { createOddsSlotHandler } from "../../lib/scrapeJobs/oddsHandlers.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";

let check, show, same, createFakeDb;

async function scene1() {
  {
    // live: 変更のある行だけ書く（変更なしはスキップ）
    const db = createFakeDb({
      predictions: [
        {
          race_id: "r1",
          model_id: "standard",
          top_pick: 1,
          top_2nd: 2,
          top_3rd: 3,
          is_shadow: false,
        },
      ],
      race_odds: [
        {
          race_id: "r1",
          captured_at: "2026-09-19T04:55:00.000Z",
          trifecta_all: { "1-2-3": 10 },
          trio_all: { "1-2-3": 4 },
        },
      ],
      prediction_odds: [
        {
          race_id: "r1",
          trifecta_pred_standard: "1-2-3",
          trifecta_odds_standard: 10,
          trio_pred_standard: "1-2-3",
          trio_odds_standard: 4,
          updated_at: "2026-09-19T04:00:00.000Z",
        },
      ],
    });
    const r = await deriveAndUpsertPredictionOdds({
      raceIds: ["r1"],
      client: db,
      mode: "live",
      now: () => new Date("2026-09-19T05:00:00Z"),
    });
    check(
      "live: 値が既存と同じなら書かない（updated_atだけの差では書き込まない）",
      r.updated === false && r.count === 0 && db.writes.length === 0,
      show(r),
    );

    db.tables.race_odds[0].trifecta_all = { "1-2-3": 12 };
    const r2 = await deriveAndUpsertPredictionOdds({
      raceIds: ["r1"],
      client: db,
      mode: "live",
      now: () => new Date("2026-09-19T05:05:00Z"),
    });
    check(
      "live: オッズが変われば upsert し、updated_atを更新する",
      r2.updated === true &&
        r2.count === 1 &&
        db.tables.prediction_odds[0].trifecta_odds_standard === 12 &&
        db.tables.prediction_odds[0].updated_at === "2026-09-19T05:05:00.000Z",
      show(db.tables.prediction_odds[0]),
    );
  }
}

async function scene2() {
  {
    // shadow: 書かず、ダイジェストを返す
    const db = createFakeDb({
      predictions: [
        {
          race_id: "r1",
          model_id: "standard",
          top_pick: 1,
          top_2nd: 2,
          top_3rd: 3,
          is_shadow: false,
        },
      ],
      race_odds: [
        {
          race_id: "r1",
          captured_at: "2026-09-19T04:55:00.000Z",
          trifecta_all: { "1-2-3": 11 },
          trio_all: { "1-2-3": 4 },
        },
      ],
      prediction_odds: [
        {
          race_id: "r1",
          trifecta_pred_standard: "1-2-3",
          trifecta_odds_standard: 10,
          trio_pred_standard: "1-2-3",
          trio_odds_standard: 4,
        },
      ],
    });
    const before = JSON.stringify(db.tables.prediction_odds);
    const r = await deriveAndUpsertPredictionOdds({
      raceIds: ["r1"],
      client: db,
      mode: "shadow",
      now: () => new Date("2026-09-19T05:00:00Z"),
    });
    check(
      "shadow: prediction_odds へ書かない。既存値との%差のダイジェストを返す",
      r.updated === false &&
        r.count === 0 &&
        JSON.stringify(db.tables.prediction_odds) === before &&
        r.shadowDigest.sampleSize === 1 &&
        r.shadowDigest.comboMismatch === 0 &&
        Math.round(r.shadowDigest.trifectaOddsDiffPct.p50 * 10) / 10 === 10,
      show(r),
    );
  }
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
}

async function scene3() {
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

async function scene4() {
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

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・createFakeDb） */
export async function runPredictionOddsDeriveScenes1(env) {
  ({ check, show, same, createFakeDb } = env);
  await scene1();
  await scene2();
  await scene3();
  await scene4();
}
