/**
 * レース情報（A1）・展示（A2）の Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関数の組み立て）。
 * plan.md §3.6・§4.1・§5、tasks.md T4b-09-1〜3・T4b-06-2。
 *
 *   createRaceInfoSlotHandler     api/cron/race-info.js   レース情報のスロット（発走60分前から許容幅3分）を1件ずつ処理する
 *   createExhibitionSlotHandler   api/cron/exhibition.js  展示のスロット（発走33分前〜7分前）を1件ずつ処理する
 *   createRefreshingCronHandler   api/cron/race-info.js   スロットの処理後に、変更を書いたレースの予測を再計算する（案1）
 *   createExhibitionCronHandler   api/cron/exhibition.js  mode（off・shadow・live）で、従来の経路とスロットの経路を切り替える
 *
 * 取得・解析・書き込みの本体は、既存の scripts/daily/update-race-info.js・scrape-exhibition-data.js の
 * runForRaces を再利用する（二重実装しない。GitHub Actions・CLIの入口 run と、解析・行の組み立て・書き込みを共有する）。
 * shadow のとき、データテーブルへは一切書かない（runForRaces が mode で守る）。
 *
 * D2（beforeinfo の重複取得）の解消: レース情報は出走表（racelist）だけを取り、直前情報（beforeinfo）は展示が、
 * 展示データ・気象・全項目を1回で取る。気象は、展示の取得時の値になる（発走60分前の値は取らない）。
 *
 * 依存（runForRaces 等）は引数で差し替えられる（scripts/maintenance/verify-scrape-pre-race-job.js が、DB・取得先なしで検証する）。
 */
import { waitUntil } from "@vercel/functions";
import { runForRaces as runRaceInfoForRaces } from "../../daily/update-race-info.js";
import {
  run as runExhibitionLegacy,
  runForRaces as runExhibitionForRaces,
} from "../../daily/scrape-exhibition-data.js";
import { getRaceSchedule } from "../raceSchedule.js";
import { refreshAfterChange } from "../predictionRefresh.js";
import { SCRAPE_JOBS } from "./registry.js";
import { isAuthorized, runScrapeJob } from "./cronWrapper.js";
import { createSupabaseStore } from "./store.js";
import { toJstDateString } from "./time.js";

const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

/**
 * race_id（YYYY-MM-DD-VV-RR）から、runForRaces に渡すレースの情報を作る。形式が不正なら例外。
 * （scrape-odds.js・scrape-results.js の重い依存を持ち込まないため、ここで持つ）
 */
export function parsePreRaceId(raceId) {
  const m = RACE_ID_RE.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  return { date: m[1], venue_code: Number(m[2]), race_number: Number(m[3]) };
}

/**
 * その日のスケジュール（races の start_time）を、1回の起動（ctx）の中で1回だけ読む。
 * スロットごとに読むと、1回の起動で最大24回の同じ読み取りになる。DBの障害は例外にする（「対象なし」に化けさせない）。
 * 締切予定時刻による start_time の更新が、同じ起動の別のスロットの判定より後になっても、更新は冪等（同じ値）。
 */
export function createScheduleLoader({
  load = (date, client) =>
    getRaceSchedule(date, { client, throwOnError: true }),
} = {}) {
  const cache = new WeakMap();
  return (ctx, date) => {
    let byDate = cache.get(ctx);
    if (!byDate) {
      byDate = new Map();
      cache.set(ctx, byDate);
    }
    if (!byDate.has(date)) {
      const pending = Promise.resolve().then(() => load(date, ctx.client));
      // 失敗した読み取りを覚えない（次のスロットが、もう一度試す）
      pending.catch(() => byDate.delete(date));
      byDate.set(date, pending);
    }
    return byDate.get(date);
  };
}

function slotHandler({ run, loadSchedule, onChanged }) {
  const scheduleFor = loadSchedule ?? createScheduleLoader();
  return async function handleSlot(slot, ctx) {
    const race = parsePreRaceId(slot.race_id);
    const [result] = await run(
      [
        {
          race_id: slot.race_id,
          venue_code: race.venue_code,
          race_number: race.race_number,
        },
      ],
      {
        date: race.date,
        mode: ctx.mode,
        fetchFn: (url) => ctx.politeFetch(url),
        client: ctx.client,
        concurrency: 1,
        schedule: await scheduleFor(ctx, race.date),
      },
    );
    if (!result) {
      return { outcome: "error", error: "処理結果が空でした" };
    }
    const { race_id: _raceId, changed, ...slotResult } = result;
    // 変更を書いた（live のみ。shadow は書かない）レースは、予測の再計算の対象として集める
    if (changed && ctx.mode === "live") onChanged?.(race.date, slot.race_id);
    return slotResult;
  };
}

/**
 * レース情報のスロットのハンドラー。1スロット＝1レースの出走表を、取得・解析し、live なら書き込む。
 * shadow は、取得・解析のみで、resultDigest を返す（データテーブルへは書かない）。
 *
 * outcome は runForRaces の語彙（ok / no_values / error / breaker_open）。ok は完了、それ以外は、次の再試行（retrySec）まで
 * pending に戻る。許容幅（3分）の間、60秒おきに再試行する。
 *
 * @param {Object} [options]
 * @param {typeof runRaceInfoForRaces} [options.run]
 * @param {ReturnType<typeof createScheduleLoader>} [options.loadSchedule]
 * @param {(date: string, raceId: string) => void} [options.onChanged] 変更を書いたレースの通知
 */
export function createRaceInfoSlotHandler({
  run = runRaceInfoForRaces,
  loadSchedule,
  onChanged,
} = {}) {
  return slotHandler({ run, loadSchedule, onChanged });
}

/**
 * 展示のスロットのハンドラー。1スロット＝1レースの直前情報を、取得・解析し、live なら展示データ・気象を書き込む。
 * live は、展示タイムが取得済みなら取得しない（skipped_have_data）。shadow は、取得済みでも取得・解析する。
 *
 * outcome は runForRaces の語彙（ok / skipped_have_data / partial / no_values / error / breaker_open）。
 * ok・skipped_have_data は完了、それ以外は、次の再試行（retrySec。120秒）まで pending に戻る。
 */
export function createExhibitionSlotHandler({
  run = runExhibitionForRaces,
  loadSchedule,
  onChanged,
} = {}) {
  return slotHandler({ run, loadSchedule, onChanged });
}

/** mainRefresh を、必要なときだけ読み込む（無効なときは、従来と完全に同じ動作にする） */
const defaultRefresh = async (args) =>
  (await import("../../daily/generate-predictions.js")).mainRefresh(args);

/**
 * スロットの処理（runScrapeJob）の後に、変更を書いたレースの予測を再計算する（案1。plan.md §5）。
 * 再計算は、全スロットの完了後に、日付ごとに1回だけ呼ぶ（スロットのリースの外。mainRefresh の固定費を1回で済ませる）。
 * REFRESH_ON_VERCEL が有効でなければ、何もしない。再計算の失敗は、投げずに応答の refresh に入れる
 * （データの取得・保存は済んでいるため、その成否と混同しない。失敗は関数ログに残る）。
 *
 * @param {Object} options
 * @param {string} options.job レジストリのジョブ名
 * @param {(collector: {onChanged: (date: string, raceId: string) => void}) => Function} options.createHandleSlot
 * @param {(args: Object) => Promise<unknown>} [options.refresh] mainRefresh（テスト用の差し替え）
 * @param {() => Promise<import("@supabase/supabase-js").SupabaseClient|null>} [options.getClient]
 */
export function createRefreshingCronHandler({
  job,
  createHandleSlot,
  refresh = defaultRefresh,
  getClient = async () => (await import("../supabaseClient.js")).supabase,
}) {
  return async function handler(req, res) {
    if (!isAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }
    const client = await getClient();
    if (!client) {
      return res
        .status(500)
        .json({ success: false, job, error: "Supabase が設定されていません" });
    }
    const { status, body } = await runSlotsWithRefresh({
      job,
      createHandleSlot,
      refresh,
      client,
      query: req.query ?? {},
    });
    return res.status(status).json(body);
  };
}

/** HTTPに依存しない本体（テストはこれを直接呼ぶ） */
export async function runSlotsWithRefresh({
  job,
  createHandleSlot,
  refresh,
  client,
  query = {},
  runJob = runScrapeJob,
  store = createSupabaseStore(client),
  env = process.env,
}) {
  /** @type {Map<string, Set<string>>} 日付 → 変更を書いたレース */
  const changed = new Map();
  const collector = {
    onChanged: (date, raceId) => {
      if (!changed.has(date)) changed.set(date, new Set());
      changed.get(date).add(raceId);
    },
  };
  const { status, body } = await runJob({
    job,
    definition: SCRAPE_JOBS[job],
    store,
    handleSlot: createHandleSlot(collector),
    modeGated: true,
    client,
    query,
  });
  if (changed.size === 0) return { status, body };

  const refreshes = [];
  for (const [date, raceIds] of changed) {
    refreshes.push({
      date,
      ...(await refreshAfterChange({
        result: { changedRaceIds: [...raceIds] },
        date,
        refresh,
        env,
      })),
    });
  }
  return { status, body: { ...body, refresh: refreshes } };
}

// ---------------------------------------------------------------------------
// 展示: mode（off・shadow・live）による、従来の経路とスロットの経路の切り替え
// ---------------------------------------------------------------------------

/**
 * 従来の経路（cron-job.org 起点。waitUntil でバックグラウンド処理。予定表・ジョブ状態を使わない）。
 * 本番の展示は、2026-09-16からこの経路で動いている（scrape_job_state に exhibition の行は無い）。
 * REFRESH_ON_VERCEL=true のとき、展示・気象を書いたレースの予測を再計算する（案1）。
 *
 * @returns {Promise<{status: number, body: Record<string, unknown>}>}
 */
export async function runLegacyExhibition({
  date,
  getSchedule = (d) => getRaceSchedule(d, { throwOnError: false }),
  run = runExhibitionLegacy,
  refresh = defaultRefresh,
  defer = waitUntil,
  env = process.env,
}) {
  try {
    const schedule = await getSchedule(date);
    if (schedule.length === 0) {
      return {
        status: 200,
        body: {
          success: true,
          accepted: false,
          message: "no schedule for today",
          date,
        },
      };
    }
    // cron-job.orgへは即座に応答を返し、実際のスクレイピング・書き込みはバックグラウンドで継続する
    defer(
      run(schedule, date)
        .then((result) =>
          refreshAfterChange({
            result,
            date,
            refresh: async (args) => refresh(args),
            env,
          }),
        )
        .catch((error) => {
          console.error(
            "❌ 展示データ取得エラー（バックグラウンド処理）:",
            error,
          );
        }),
    );
    return {
      status: 202,
      body: {
        success: true,
        accepted: true,
        date,
        message: "processing in background",
      },
    };
  } catch (error) {
    console.error("❌ スケジュール取得エラー（Vercel Function）:", error);
    return { status: 500, body: { success: false, error: error.message } };
  }
}

/** Vercel Cron 自身からの起動か（User-Agent が vercel-cron/1.0。cron-job.org からの起動と区別する） */
export function isVercelCronRequest(req) {
  return String(req.headers?.["user-agent"] ?? "")
    .toLowerCase()
    .startsWith("vercel-cron");
}

/**
 * 展示のジョブ状態（scrape_job_state.mode の job='exhibition'）を読む。行が無い・テーブルが未適用・読み取りに失敗
 * したときは "off"（従来の経路）にする。従来の展示は、この行を使わずに動いていたため、状態が読めないことで、
 * 展示が止まってはならない（フェイルセーフ）。
 */
export async function readExhibitionMode(store) {
  try {
    const state = await store.readState("exhibition");
    if (!state.available || !state.row) return { mode: "off", known: false };
    const mode = state.row.mode;
    if (mode === "live" || mode === "shadow") return { mode, known: true };
    return { mode: "off", known: true };
  } catch (error) {
    console.error(
      `⚠️ 展示: ジョブ状態を読めないため、従来の経路で動きます: ${error.message}`,
    );
    return { mode: "off", known: false };
  }
}

/**
 * api/cron/exhibition.js のハンドラー。
 *
 *   mode      従来の経路（cron-job.org 起点）   スロットの経路
 *   off       動く                              動かない
 *   shadow    動く                              取得・解析のみ（データへは書かない。予定表に result_digest）
 *   live      動かない                          動く（展示データ・気象を書く。案1の再計算も）
 *   （行なし・テーブル未適用・読み取り失敗は off）
 *
 * Vercel Cron（vercel.json）からの起動は、live・shadow ではスロットの経路を動かす（処理の完了後に 200/500）。cron-job.org の
 * 起動も同じ経路に入る（リースと取得済みのスキップで無害）が、cron-job.org のタイムアウト（30秒）に、スロットの処理
 * （約60〜70秒）が掛からないよう、こちらはバックグラウンド（waitUntil）で処理して 202 を即座に返す。off のときは、従来の経路が
 * cron-job.org から動いているため、Vercel Cron の起動は何もしない（従来の経路を二重に動かして、取得先への負荷を増やさない）。
 * 切り替え・切り戻しは scrape_job_state.mode の更新のみ（再デプロイ不要）。verification-runbook.md Q。
 */
export function createExhibitionCronHandler({
  getClient = async () => (await import("../supabaseClient.js")).supabase,
  refresh = defaultRefresh,
  legacy = runLegacyExhibition,
  runSlots = runSlotsWithRefresh,
  defer = waitUntil,
  now = () => new Date(),
  env = process.env,
} = {}) {
  return async function handler(req, res) {
    if (!isAuthorized(req.headers.authorization, env.CRON_SECRET)) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }
    const client = await getClient();
    if (!client) {
      return res.status(500).json({
        success: false,
        job: "exhibition",
        error: "Supabase が設定されていません",
      });
    }
    const { mode, known } = await readExhibitionMode(
      createSupabaseStore(client),
    );
    const fromVercelCron = isVercelCronRequest(req);

    if (mode === "off") {
      if (fromVercelCron) {
        return res.status(200).json({
          success: true,
          job: "exhibition",
          mode,
          skipped: "legacy_path_is_triggered_by_external_cron",
        });
      }
      const date = toJstDateString(now());
      const { status, body } = await legacy({ date, refresh, env });
      return res.status(status).json({ ...body, mode, modeKnown: known });
    }

    // shadow: 従来の経路が、引き続きデータを書く（cron-job.org からの起動のとき）。スロットの経路は、取得・解析のみ
    let legacyResult = null;
    if (mode === "shadow" && !fromVercelCron) {
      const date = toJstDateString(now());
      legacyResult = await legacy({ date, refresh, env });
    }
    const runSlotsNow = () =>
      runSlots({
        job: "exhibition",
        createHandleSlot: (collector) =>
          createExhibitionSlotHandler({ onChanged: collector.onChanged }),
        refresh,
        client,
        query: req.query ?? {},
        env,
      });
    const legacyBody = legacyResult
      ? { legacy: { status: legacyResult.status, ...legacyResult.body } }
      : {};
    if (!fromVercelCron) {
      // 外部cron（cron-job.org）の起動は、スロットの処理を待たない（タイムアウト30秒。結果は予定表・関数ログで確認する）
      defer(
        runSlotsNow().catch((error) => {
          console.error(
            "❌ 展示スロット処理エラー（バックグラウンド処理）:",
            error,
          );
        }),
      );
      return res.status(202).json({
        success: true,
        job: "exhibition",
        mode,
        accepted: true,
        message: "processing in background",
        ...legacyBody,
      });
    }
    const { status, body } = await runSlotsNow();
    return res.status(status).json({ ...body, ...legacyBody });
  };
}
