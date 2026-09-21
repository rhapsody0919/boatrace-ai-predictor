/**
 * GitHub Actions 側の取得を止める判定（フェイルセーフ付きSKIP。自動フェイルオーバー）。
 *
 * 従来の SKIP_<JOB>_ON_GHA=true は静的な停止で、Vercel が止まっても、人間が変数を戻すまで取得が止まる
 * （無人の夜間は特に危険）。本モジュールは、変数が true のときだけ scrape_job_state を読み、Vercel が
 * 健全なときに限りスキップする。それ以外（Vercel が live でない・止まっている・読み取りに失敗・不正な値）は、
 * 従来どおり実行する（迷ったら実行する。上書き型のため、二重に取得してもデータは壊れない）。
 *
 *   変数が未設定・true 以外 → DB を読まず、常に「実行」（現行と完全に同じ）
 *   変数が true            → 下の判定。全ジョブが健全ならスキップ
 *
 * 健全の定義（ジョブの kind ごと。scripts/lib/scrapeJobs/registry.js）:
 *   共通   scrape_job_state.mode = 'live'（shadow は last_success_at を更新するため、mode の確認が必須）
 *   窓型   Vercel が起動し続けている（last_tick_at が新しい）・連続失敗が閾値未満・取得先のブレーカーが開いていない。
 *          last_success_at は使わない: 窓型の成功は「処理する予定があった実行」でしか更新されず、レースの無い
 *          時間帯（夜間・朝の最初の窓の前）に古く見え、GitHub が誤って二重に動くため。「起動している・失敗が
 *          続いていない・ブレーカーが閉じている」なら、成功が無いのは処理対象が無いだけ、と扱う
 *   日次   対象日（resolveTargetDate。指定時刻から解決）を Vercel が処理済み（last_target_date）。
 *          前日分が済んでいるだけでは、当日の Vercel の失敗を救えないため、当日分の処理済みを要求する
 *   日次（チャンク処理。racer_profiles）  上に加えて、処理中（対象日の指定時刻以降に成功があり、直近の成功が新しい）も健全
 *
 * 判定は純関数（evaluateJobHealth・decideFromRows）と、IO（createRestJobStateClient・shouldSkipOnGha）に分ける。
 * DB は supabase-js を使わず、REST（fetch）で該当ジョブの行だけを読む（GitHub Actions の判定ステップが npm ci なしで動く）。
 *
 * 対象外（現行のまま静的な変数）:
 *   SKIP_ODDS_REFRESH_ON_GHA  予測リフレッシュ。Vercel 側の REFRESH_ON_VERCEL（環境変数）と連動しており、DB の状態では判定できない
 *   SKIP_EXHIBITION_ON_GHA    展示。Vercel の api/cron/exhibition.js（BOA-313）は scrape_job_state を使わないため判定できない
 *                             （展示のスロット化 A2 で共通ラッパに移った後、GHA_SKIP_TARGETS に追加する）
 */
import { SCRAPE_JOBS, HOST_JOB_PREFIX } from "./scrapeJobs/registry.js";
import { resolveTargetDate } from "./scrapeJobs/dailyJob.js";
import { TICK_WRITE_INTERVAL_MS } from "./scrapeJobs/store.js";
import { THRESHOLDS } from "./scrapeJobs/monitor.js";

/** SKIP 変数 → Vercel 側のジョブ名（全て健全なときだけスキップする） */
export const GHA_SKIP_TARGETS = Object.freeze({
  SKIP_RESULTS_ON_GHA: Object.freeze(["result", "result_catchup"]),
  SKIP_KFILE_ON_GHA: Object.freeze(["kfile_sync"]),
  SKIP_ODDS_ON_GHA: Object.freeze(["odds"]),
  SKIP_POINT_RANK_ON_GHA: Object.freeze(["point_rank"]),
  SKIP_ENTRY_COURSE_ON_GHA: Object.freeze(["entry_course_stats"]),
  SKIP_MOTOR_STATS_ON_GHA: Object.freeze(["venue_motor_stats"]),
  SKIP_RACER_NEWS_ON_GHA: Object.freeze(["racer_news"]),
  SKIP_RACER_SEASON_ON_GHA: Object.freeze(["racer_profiles"]),
});

/** チャンク処理（1回の呼び出しで終わらず、複数回の起動で対象日を完了する）の日次ジョブ */
const CHUNKED_JOBS = Object.freeze(["racer_profiles"]);

export const GHA_SKIP_POLICY = Object.freeze({
  /**
   * last_tick_at がこの分数以上更新されていなければ、Vercel の起動が止まっているとみなす。
   * tick は5分に1回しか書かれない（TICK_WRITE_INTERVAL_MS）ため、正常でも最大約6分古い。書き込み2回分+2分の余裕
   */
  tickMaxAgeMin: (TICK_WRITE_INTERVAL_MS / 60000) * 2 + 2,
  /** 連続失敗がこの回数以上なら不健全（monitor の通知閾値と同じ） */
  maxConsecutiveFailures: THRESHOLDS.consecutiveFailures,
  /** チャンク処理中とみなす、直近の成功の鮮度（cron は10分間隔、1チャンク最大約13分のため、成功は最大約20分おき） */
  chunkProgressMaxAgeMin: 40,
  /** 日次ジョブの指定時刻からこの分数までは、Vercel の処理の完了を待つ価値がある（判定ステップの待機の上限） */
  dailyWaitGraceMin: 10,
  /** DB の読み取りのタイムアウト（超えたら「実行」） */
  readTimeoutMs: 5000,
});

const isTrue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase() === "true";

/** SKIP 変数が有効か（GitHub の式 vars.X == 'true' と同じく、大文字小文字を区別しない） */
export const isSkipFlagTrue = isTrue;

const parseTime = (value) => {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

const minutesSince = (ms, nowMs) => Math.floor((nowMs - ms) / 60000);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 取得先ホストのブレーカーが開いているジョブ名（開いていれば host:xxx）を返す（開いていなければ null） */
function openBreakerHost(hosts, rowsByJob, nowMs) {
  for (const host of hosts ?? []) {
    const row = rowsByJob.get(`${HOST_JOB_PREFIX}${host}`);
    const until = parseTime(row?.breaker_open_until);
    if (until !== null && until > nowMs) return host;
  }
  return null;
}

/**
 * 1ジョブの健全性（純関数）。
 *
 * @param {Object} params
 * @param {string} params.job レジストリのジョブ名
 * @param {Map<string, Object>} params.rowsByJob scrape_job_state の行（ジョブ名 → 行。host:xxx を含む）
 * @param {Date} params.now
 * @param {typeof GHA_SKIP_POLICY} [params.policy]
 * @param {typeof SCRAPE_JOBS} [params.registry]
 * @returns {{job: string, healthy: boolean, reason: string, detail: string, retryable: boolean}}
 *   retryable: 今は不健全だが、Vercel の処理の完了を少し待てば健全になりうる（日次ジョブの指定時刻の直後）
 */
export function evaluateJobHealth({
  job,
  rowsByJob,
  now,
  policy = GHA_SKIP_POLICY,
  registry = SCRAPE_JOBS,
}) {
  const bad = (reason, detail, retryable = false) => ({
    job,
    healthy: false,
    reason,
    detail,
    retryable,
  });
  const good = (reason, detail) => ({
    job,
    healthy: true,
    reason,
    detail,
    retryable: false,
  });

  const def = registry[job];
  if (!def) return bad("unknown_job", `${job}: レジストリに無いジョブ`);
  const row = rowsByJob.get(job);
  if (!row) return bad("no_row", `${job}: ジョブ状態の行なし`);
  if (row.mode !== "live") {
    return bad(
      "mode_not_live",
      `${job}: mode=${String(row.mode)}（liveではない）`,
    );
  }
  const nowMs = now.getTime();
  const failures = row.consecutive_failures;
  if (!Number.isInteger(failures) || failures < 0) {
    return bad(
      "invalid_value",
      `${job}: consecutive_failures が不正: ${String(failures)}`,
    );
  }
  if (failures >= policy.maxConsecutiveFailures) {
    return bad("consecutive_failures", `${job}: 連続失敗${failures}回`);
  }

  if (def.kind === "window") {
    const tick = parseTime(row.last_tick_at);
    if (tick === null)
      return bad("tick_missing", `${job}: last_tick_at が無い・不正`);
    const tickAge = minutesSince(tick, nowMs);
    if (tickAge < -1 || tickAge >= policy.tickMaxAgeMin) {
      return bad(
        "tick_stale",
        `${job}: 最終起動${tickAge}分前（${policy.tickMaxAgeMin}分以上更新なし・時計の異常を含む）`,
      );
    }
    const host = openBreakerHost(def.hosts, rowsByJob, nowMs);
    if (host)
      return bad(
        "breaker_open",
        `${job}: 取得先 ${host} のブレーカーが開いている`,
      );
    const success = parseTime(row.last_success_at);
    const successNote =
      success === null
        ? "成功の記録なし"
        : `最終成功${minutesSince(success, nowMs)}分前`;
    return good(
      "window_alive",
      `${job}: live・最終起動${tickAge}分前・${successNote}`,
    );
  }

  if (def.kind === "daily") {
    const target = resolveTargetDate(now, def.targetTimeJst);
    const done = row.last_target_date;
    if (done !== null && done !== undefined && !DATE_RE.test(String(done))) {
      return bad(
        "invalid_value",
        `${job}: last_target_date が不正: ${String(done)}`,
      );
    }
    if (done && done >= target) {
      return good(
        "daily_done",
        `${job}: live・対象日${target}は処理済み（${done}）`,
      );
    }
    const targetInstant = parseTime(`${target}T${def.targetTimeJst}:00+09:00`);
    const sinceTargetMin =
      targetInstant === null ? null : minutesSince(targetInstant, nowMs);
    const host = openBreakerHost(def.hosts, rowsByJob, nowMs);
    if (host)
      return bad(
        "breaker_open",
        `${job}: 取得先 ${host} のブレーカーが開いている`,
      );

    if (CHUNKED_JOBS.includes(job)) {
      const success = parseTime(row.last_success_at);
      if (
        success !== null &&
        targetInstant !== null &&
        success >= targetInstant &&
        minutesSince(success, nowMs) < policy.chunkProgressMaxAgeMin
      ) {
        return good(
          "chunk_in_progress",
          `${job}: live・対象日${target}を処理中（最終成功${minutesSince(success, nowMs)}分前）`,
        );
      }
    }
    const retryable =
      sinceTargetMin !== null &&
      sinceTargetMin >= 0 &&
      sinceTargetMin < policy.dailyWaitGraceMin;
    return bad(
      "target_pending",
      `${job}: 対象日${target}が未処理（最終処理済み ${done ?? "なし"}）`,
      retryable,
    );
  }

  // continuous・monitor は SKIP 変数の対象ではない
  return bad("unsupported_kind", `${job}: kind=${def.kind} は判定対象外`);
}

/**
 * SKIP 変数に対応する全ジョブの健全性から、スキップするかを決める（純関数）。全て健全のときだけスキップ。
 *
 * @param {Object} params
 * @param {string} params.varName
 * @param {Array<Object>} params.rows scrape_job_state の行
 * @param {Date} params.now
 */
export function decideFromRows({
  varName,
  rows,
  now,
  policy = GHA_SKIP_POLICY,
  registry = SCRAPE_JOBS,
}) {
  const jobs = GHA_SKIP_TARGETS[varName];
  if (!jobs) {
    return {
      skip: false,
      reason: "unsupported_var",
      message: `実行: ${varName} は判定の対象外（従来どおり実行）`,
      retryable: false,
      results: [],
    };
  }
  const rowsByJob = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r.job === "string")
      .map((r) => [r.job, r]),
  );
  const results = jobs.map((job) =>
    evaluateJobHealth({ job, rowsByJob, now, policy, registry }),
  );
  const unhealthy = results.filter((r) => !r.healthy);
  if (unhealthy.length === 0) {
    return {
      skip: true,
      reason: results.length === 1 ? results[0].reason : "all_healthy",
      message: `スキップ: Vercelが健全（${results.map((r) => r.detail).join(" / ")}）`,
      retryable: false,
      results,
    };
  }
  return {
    skip: false,
    reason: unhealthy[0].reason,
    message: `実行: ${unhealthy.map((r) => r.detail).join(" / ")}`,
    retryable: unhealthy.every((r) => r.retryable),
    results,
  };
}

/** 読み取る scrape_job_state の行のキー（対象ジョブ＋そのジョブの取得先ホストのブレーカー） */
export function jobKeysFor(varName, registry = SCRAPE_JOBS) {
  const jobs = GHA_SKIP_TARGETS[varName] ?? [];
  const keys = new Set(jobs);
  for (const job of jobs) {
    for (const host of registry[job]?.hosts ?? [])
      keys.add(`${HOST_JOB_PREFIX}${host}`);
  }
  return [...keys];
}

const STATE_COLUMNS = [
  "job",
  "mode",
  "last_tick_at",
  "last_success_at",
  "consecutive_failures",
  "last_target_date",
  "breaker_open_until",
].join(",");

/**
 * scrape_job_state を REST（PostgREST）で読むクライアント。service_role のキーで、該当ジョブの行だけを読む。
 * @param {Object} params
 * @param {string} params.url SUPABASE_URL
 * @param {string} params.key SUPABASE_SERVICE_KEY
 * @param {typeof fetch} [params.fetchImpl]
 * @param {number} [params.timeoutMs]
 * @returns {{readJobStates: (keys: string[]) => Promise<Array<Object>>}}
 */
export function createRestJobStateClient({
  url,
  key,
  fetchImpl = fetch,
  timeoutMs = GHA_SKIP_POLICY.readTimeoutMs,
}) {
  return {
    async readJobStates(keys) {
      const endpoint = new URL("/rest/v1/scrape_job_state", url);
      endpoint.searchParams.set("select", STATE_COLUMNS);
      endpoint.searchParams.set(
        "job",
        `in.(${keys.map((k) => `"${k}"`).join(",")})`,
      );
      const response = await fetchImpl(endpoint, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(
          `scrape_job_state の読み取りが HTTP ${response.status}`,
        );
      }
      const body = await response.json();
      if (!Array.isArray(body)) {
        throw new Error("scrape_job_state の応答が配列ではありません");
      }
      return body;
    },
  };
}

/** promise を、ms 以内に終わらなければ失敗にする（クライアントがタイムアウトを実装していなくても、判定を止めない） */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${ms}ms 以内に応答がありませんでした`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GitHub Actions 側の取得を、スキップするか判定する（IO込み）。失敗・不正・未確認は、すべて「実行」。
 *
 * @param {Object} params
 * @param {string} params.varName SKIP 変数名（GHA_SKIP_TARGETS のキー）
 * @param {Record<string, string|undefined>} [params.env]
 * @param {{readJobStates: (keys: string[]) => Promise<Array<Object>>}} [params.client] 既定は env の SUPABASE_URL・SUPABASE_SERVICE_KEY から作る REST クライアント
 * @param {Date} [params.now]
 * @param {Pick<Console, "log">|null} [params.logger] 判定結果と理由の出力先（null なら出さない）
 * @returns {Promise<{skip: boolean, reason: string, message: string, retryable: boolean, results: Array<Object>}>}
 */
export async function shouldSkipOnGha({
  varName,
  env = process.env,
  client,
  now = new Date(),
  logger = console,
  policy = GHA_SKIP_POLICY,
}) {
  const finish = (decision) => {
    logger?.log(`[gha-skip] ${varName}: ${decision.message}`);
    return decision;
  };
  const run = (reason, message) =>
    finish({
      skip: false,
      reason,
      message: `実行: ${message}`,
      retryable: false,
      results: [],
    });

  if (!isTrue(env[varName])) {
    // 既定（未設定・false）。DB を読まない。現行と完全に同じ動作
    return {
      skip: false,
      reason: "flag_off",
      message: `実行: ${varName} が true ではない`,
      retryable: false,
      results: [],
    };
  }
  if (!GHA_SKIP_TARGETS[varName]) {
    return run(
      "unsupported_var",
      `${varName} は判定の対象外（従来どおり実行）`,
    );
  }
  let stateClient = client;
  if (!stateClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return run(
        "no_credentials",
        "SUPABASE_URL・SUPABASE_SERVICE_KEY が未設定で、Vercelの状態を確認できない",
      );
    }
    try {
      stateClient = createRestJobStateClient({
        url: env.SUPABASE_URL,
        key: env.SUPABASE_SERVICE_KEY,
        timeoutMs: policy.readTimeoutMs,
      });
    } catch (error) {
      return run(
        "read_failed",
        `DB クライアントを作れない（${describeError(error)}）`,
      );
    }
  }
  let rows;
  try {
    rows = await withTimeout(
      Promise.resolve().then(() =>
        stateClient.readJobStates(jobKeysFor(varName)),
      ),
      policy.readTimeoutMs,
    );
  } catch (error) {
    return run(
      "read_failed",
      `Vercelの状態を読み取れない（${describeError(error)}）`,
    );
  }
  let decision;
  try {
    decision = decideFromRows({ varName, rows, now, policy });
  } catch (error) {
    return run("evaluate_failed", `判定に失敗（${describeError(error)}）`);
  }
  return finish(decision);
}

const describeError = (error) =>
  error instanceof Error ? error.message : String(error);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * shouldSkipOnGha に、日次ジョブの指定時刻の直後の待機を足したもの。Vercel と GitHub は同じ時刻に起動するため、
 * 「Vercel がまだ処理中」で二重に取得しないよう、retryable の間だけ、上限（dailyWaitGraceMin）まで待って再判定する。
 * 待機の上限を過ぎても未処理なら「実行」（フェイルオーバー）。
 */
export async function shouldSkipOnGhaWaiting(
  params,
  {
    pollSec = 30,
    maxPolls = 40,
    sleep = defaultSleep,
    nowFn = () => new Date(),
  } = {},
) {
  let decision = await shouldSkipOnGha({ ...params, now: nowFn() });
  for (let i = 0; i < maxPolls && !decision.skip && decision.retryable; i++) {
    await sleep(pollSec * 1000);
    decision = await shouldSkipOnGha({ ...params, now: nowFn() });
  }
  return decision;
}
