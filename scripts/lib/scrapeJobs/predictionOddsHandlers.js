/**
 * 買い目オッズ（A4、prediction_odds）を、A3（オッズ取得、race_odds）の成功フックから導出する（BOA-404、
 * tasks.md T4b-10-3、2026-09-20の決定）。
 *
 * 専用の5分間隔Cronは作らない（T4b-10-2は不採用）。api/cron/odds.js の共通ラッパ（cronWrapper.js）が処理した
 * スロットのうち、live で完了（race_odds にその窓のオッズがある）したレースIDを
 * scripts/lib/scrapeJobs/oddsHandlers.js の onChanged で集め、全スロットの完了後に1回、まとめて導出する
 * （race-info.js・exhibition.js が mainRefresh を「全スロット完了後に1回」呼ぶのと同じ設計。plan.md §5）。
 *
 * モード（scrape_job_state.mode の job='prediction_odds'。A3（job='odds'）とは独立。DBの更新のみで切り替える）:
 *   off（または行なし）  導出せず、prediction_odds にも予定表にも書かない（行が無ければ off の行を作るのみ）
 *   shadow              導出のみ。prediction_odds へは書かず、既存の値（GHA側のA4が書いた最終値）と比べた
 *                        ダイジェスト（summarizePredictionOddsDiff）を last_report に記録する
 *   live                prediction_odds へ書き込む（upsertChangedRows。変更のある行のみ）。GitHub Actions側の
 *                        A4（scrape-prediction-odds.js）と並走してよい（同じ行を上書きするだけで、
 *                        並走による実害は無い。停止はユーザー承認後に別途）
 *
 * A3自体の挙動（取得・解析・race_odds への書き込み）は変えない。この導出の失敗は、A3の成功・失敗の判定に混ぜない
 * （catchして prediction_odds のジョブ状態にのみ記録する。race_odds は取得・保存済みのため、その成否と混同しない）。
 */
import { latestByRaceId } from "../latestByRaceId.js";
import { upsertChangedRows } from "../unchangedRows.js";
import {
  buildPredictionOddsRow,
  summarizePredictionOddsDiff,
} from "../predictionOddsDerive.js";
import { createSupabaseStore } from "./store.js";
import { isAuthorized, runScrapeJob } from "./cronWrapper.js";
import { createOddsSlotHandler } from "./oddsHandlers.js";
import { SCRAPE_JOBS } from "./registry.js";

/** このジョブの scrape_job_state.job */
export const PREDICTION_ODDS_JOB = "prediction_odds";

/**
 * 対象レースの予測（3モデルの買い目）を取得する。is_shadow=false（本番の予測）のみ。
 * legacy（scrape-prediction-odds.js の fetchPredictions）と同じクエリ・同じ形。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} raceIds
 * @returns {Promise<Map<string, Record<string, {top1: number, top2: number, top3: number}>>>}
 */
export async function fetchPredictionsByModel(client, raceIds) {
  if (raceIds.length === 0) return new Map();
  const { data, error } = await client
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd")
    .in("race_id", raceIds)
    .eq("is_shadow", false);
  if (error) {
    throw new Error(`predictions の取得に失敗しました: ${error.message}`);
  }
  const map = new Map();
  for (const row of data ?? []) {
    if (!map.has(row.race_id)) map.set(row.race_id, {});
    map.get(row.race_id)[row.model_id] = {
      top1: row.top_pick,
      top2: row.top_2nd,
      top3: row.top_3rd,
    };
  }
  return map;
}

/**
 * 対象レースの race_odds の最新スナップショットから、trifecta_all・trio_all を取り出す。
 * 窓（window_min）ごとに別行のため、列ごとに「値が入っている最新の行」を独立に選ぶ（片方の券種だけ、直近の窓で
 * 取得できなかった＝null の場合に、より古い窓の非null値を捨てないため）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} raceIds
 * @returns {Promise<Map<string, {trifectaAll: Record<string, number>|null, trioAll: Record<string, number>|null}>>}
 */
export async function fetchLatestRaceOdds(client, raceIds) {
  if (raceIds.length === 0) return new Map();
  const { data, error } = await client
    .from("race_odds")
    .select("race_id, captured_at, trifecta_all, trio_all")
    .in("race_id", raceIds);
  if (error) {
    throw new Error(`race_odds の取得に失敗しました: ${error.message}`);
  }
  const rows = data ?? [];
  const latestTrifecta = latestByRaceId(rows.filter((r) => r.trifecta_all));
  const latestTrio = latestByRaceId(rows.filter((r) => r.trio_all));
  const raceIdSet = new Set([...latestTrifecta.keys(), ...latestTrio.keys()]);
  const map = new Map();
  for (const raceId of raceIdSet) {
    map.set(raceId, {
      trifectaAll: latestTrifecta.get(raceId)?.trifecta_all ?? null,
      trioAll: latestTrio.get(raceId)?.trio_all ?? null,
    });
  }
  return map;
}

/**
 * 対象レースの prediction_odds 行を、予測と race_odds の最新スナップショットから組み立てる。
 * 予測が無い、または race_odds のスナップショットが無い（trifecta_all・trio_all とも無い）レースは含めない
 * （書く価値の無い行を作らない。既存の値をnullで上書きしない）。
 *
 * @param {Object} params
 * @param {string[]} params.raceIds
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {() => Date} [params.now]
 * @returns {Promise<Array<{race_id: string, row: Object}>>}
 */
export async function deriveRowsForRaces({
  raceIds,
  client,
  now = () => new Date(),
}) {
  const ids = [...new Set(raceIds)];
  if (ids.length === 0) return [];
  const [predictionsMap, raceOddsMap] = await Promise.all([
    fetchPredictionsByModel(client, ids),
    fetchLatestRaceOdds(client, ids),
  ]);
  const updatedAtIso = now().toISOString();
  const derived = [];
  for (const raceId of ids) {
    const predictionsByModel = predictionsMap.get(raceId);
    const oddsSnapshot = raceOddsMap.get(raceId);
    if (!predictionsByModel || !oddsSnapshot) continue;
    const row = buildPredictionOddsRow({
      raceId,
      predictionsByModel,
      trifectaAll: oddsSnapshot.trifectaAll,
      trioAll: oddsSnapshot.trioAll,
      updatedAtIso,
    });
    if (row) derived.push({ race_id: raceId, row });
  }
  return derived;
}

/**
 * shadow検証用のダイジェスト: 導出値と、現在の prediction_odds の値（GHA側のA4が書いた最終値。並走中は
 * A4が書き続けているため、DBの値がそのまま比較対象になる）を比べる。
 *
 * @param {Object} params
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {Array<{race_id: string, row: Object}>} params.derived
 */
export async function buildShadowDigest({ client, derived }) {
  const ids = derived.map((d) => d.race_id);
  if (ids.length === 0) {
    return summarizePredictionOddsDiff([], new Map());
  }
  const { data, error } = await client
    .from("prediction_odds")
    .select("*")
    .in("race_id", ids);
  if (error) {
    throw new Error(
      `prediction_odds の既存値の取得に失敗しました: ${error.message}`,
    );
  }
  const existingByRaceId = new Map((data ?? []).map((r) => [r.race_id, r]));
  return summarizePredictionOddsDiff(derived, existingByRaceId);
}

/**
 * 導出して、mode に応じて書き込む（またはshadowのダイジェストを作る）本体。
 *
 * @param {Object} params
 * @param {string[]} params.raceIds
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {"shadow"|"live"} params.mode
 * @param {() => Date} [params.now]
 * @returns {Promise<{updated: boolean, count: number, shadowDigest?: Object, stats?: Object}>}
 */
export async function deriveAndUpsertPredictionOdds({
  raceIds,
  client,
  mode,
  now = () => new Date(),
}) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  const derived = await deriveRowsForRaces({ raceIds, client, now });
  if (derived.length === 0) return { updated: false, count: 0 };

  if (mode === "shadow") {
    const shadowDigest = await buildShadowDigest({ client, derived });
    return { updated: false, count: 0, shadowDigest };
  }

  const { written, error, stats } = await upsertChangedRows(
    client,
    "prediction_odds",
    derived.map((d) => d.row),
    {
      onConflict: "race_id",
      keyColumns: ["race_id"],
      stampUpdatedAt: true,
      now: now(),
      label: "prediction_odds",
    },
  );
  if (error) throw error;
  return { updated: written > 0, count: written, stats };
}

/**
 * ジョブ状態（job='prediction_odds'）を読み、モードに応じて導出を実行し、成否を記録する。
 * 失敗はここで吸収し（例外を投げない）、呼び出し元（odds.js のハンドラー）が A3 自体の成否と混同しないようにする。
 *
 * @param {Object} params
 * @param {string[]} params.raceIds
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {() => Date} [params.now]
 * @param {typeof deriveAndUpsertPredictionOdds} [params.derive]
 * @param {ReturnType<typeof createSupabaseStore>} [params.store]
 */
export async function runPredictionOddsDerivation({
  raceIds,
  client,
  now = () => new Date(),
  derive = deriveAndUpsertPredictionOdds,
  store = createSupabaseStore(client),
}) {
  let state;
  try {
    state = await store.readState(PREDICTION_ODDS_JOB);
  } catch (error) {
    console.error(
      `❌ ${PREDICTION_ODDS_JOB}: ジョブ状態の読み取りに失敗: ${error.message}`,
    );
    return { skipped: "read_state_failed", error: error.message };
  }
  if (!state.available) return { skipped: "scrape_schema_not_applied" };
  if (!state.row) {
    try {
      await store.ensureRow(PREDICTION_ODDS_JOB);
    } catch (error) {
      console.error(
        `⚠️ ${PREDICTION_ODDS_JOB}: ジョブ状態の作成に失敗: ${error.message}`,
      );
    }
    return { skipped: "mode_off", mode: "off" };
  }
  const mode =
    state.row.mode === "live" || state.row.mode === "shadow"
      ? state.row.mode
      : "off";
  if (mode === "off") return { skipped: "mode_off", mode };

  const previousFailures = state.row?.consecutive_failures ?? 0;
  try {
    const result = await derive({ raceIds, client, mode, now });
    await store.recordSuccess(PREDICTION_ODDS_JOB, {
      now: now(),
      rowsWritten: result.count,
      ...(result.shadowDigest !== undefined
        ? { report: { shadowDigest: result.shadowDigest } }
        : {}),
    });
    return { mode, ...result };
  } catch (error) {
    console.error(`❌ ${PREDICTION_ODDS_JOB}: 導出エラー: ${error.message}`);
    try {
      await store.recordFailure(PREDICTION_ODDS_JOB, {
        now: now(),
        error,
        previousFailures,
      });
    } catch (e) {
      console.error(
        `❌ ${PREDICTION_ODDS_JOB}: 失敗の記録に失敗: ${e.message}`,
      );
    }
    return { mode, error: error.message };
  }
}

/**
 * api/cron/odds.js のハンドラー。A3（オッズ取得）を共通ラッパで処理した後、live で完了したレースについて、
 * prediction_odds の導出（このファイルの runPredictionOddsDerivation）を1回だけ呼ぶ。
 * A3自体の応答（status・body）は、導出の成否に関わらず変えない（body に predictionOdds を足すのみ）。
 *
 * @param {Object} [options]
 * @param {() => Promise<import("@supabase/supabase-js").SupabaseClient|null>} [options.getClient]
 * @param {typeof runPredictionOddsDerivation} [options.derivePredictionOdds]
 * @param {() => Date} [options.now]
 */
export function createOddsCronHandlerWithPredictionOdds({
  getClient = async () => (await import("../supabaseClient.js")).supabase,
  derivePredictionOdds = runPredictionOddsDerivation,
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    if (!isAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }
    const client = await getClient();
    if (!client) {
      return res.status(500).json({
        success: false,
        job: "odds",
        error: "Supabase が設定されていません",
      });
    }
    const changed = new Set();
    const { status, body } = await runScrapeJob({
      job: "odds",
      definition: SCRAPE_JOBS.odds,
      store: createSupabaseStore(client),
      handleSlot: createOddsSlotHandler({
        onChanged: (raceId) => changed.add(raceId),
      }),
      modeGated: true,
      client,
      query: req.query ?? {},
    });
    if (changed.size === 0) {
      return res.status(status).json(body);
    }
    const predictionOdds = await derivePredictionOdds({
      raceIds: [...changed],
      client,
      now,
    });
    return res.status(status).json({ ...body, predictionOdds });
  };
}
