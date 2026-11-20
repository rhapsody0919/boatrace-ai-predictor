// scripts/lib/ghaSkipGate.js から移した小さな純関数（フラグ・時刻・ブレーカーのキー・判定の戻りの組み立て・REST の読み取りクライアント）。
// ghaSkipGate.js の変異検証（verify-gha-skip-gate.js）が本体の字を読むため、判定の枝そのものは本体に残し、字を読まれない部品だけをここへ置く。
import { SCRAPE_JOBS } from "./registry.js";
import { resolveTargetDate } from "./dailyJob.js";
import { TICK_WRITE_INTERVAL_MS } from "./store.js";
import { THRESHOLDS } from "./monitor.js";
import { hostKeyOf, pathKeyOf } from "./politeFetch.js";

export const isTrue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase() === "true";

export const parseTime = (value) => {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

export const minutesSince = (ms, nowMs) => Math.floor((nowMs - ms) / 60000);

/** 開いているブレーカーのキーを返す（開いていなければ null）。キーは politeFetch と同じ関数で作る */
export function openBreakerKey(keys, rowsByJob, nowMs) {
  for (const key of keys) {
    const row = rowsByJob.get(key);
    const until = parseTime(row?.breaker_open_until);
    if (until !== null && until > nowMs) return key;
  }
  return null;
}
export const hostKeysOf = (def) =>
  (def?.hosts ?? []).map((host) => hostKeyOf(`https://${host}/`));
export const pathKeysOf = (def) => (def?.breakerUrls ?? []).map(pathKeyOf);

/** evaluateJobHealth の戻りの組み立て（takeover=肩代わりする、noTakeover=しない） */
export function resultMakers(job) {
  const takeover = (reason, detail, retryable = false) => ({
    job,
    healthy: false,
    reason,
    detail,
    retryable,
  });
  const noTakeover = (reason, detail) => ({
    job,
    healthy: true,
    reason,
    detail,
    retryable: false,
  });
  return { takeover, noTakeover };
}

/** 日次の指定時刻の時点（ms）。日次でなければ null */
export function dailyTargetInstant(def, now) {
  return def.kind === "daily"
    ? parseTime(
        `${resolveTargetDate(now, def.targetTimeJst)}T${def.targetTimeJst}:00+09:00`,
      )
    : null;
}

const STATE_COLUMNS = [
  "job",
  "mode",
  "last_tick_at",
  "last_success_at",
  "consecutive_failures",
  "last_target_date",
  "breaker_open_until",
  "fetch_stop",
  "last_error",
  "updated_at",
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
export function buildRestJobStateClient({
  url,
  key,
  fetchImpl = fetch,
  timeoutMs,
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

/** SKIP 変数 → Vercel 側のジョブ名（どのジョブも肩代わりの条件を満たさないときスキップする） */
export const GHA_SKIP_TARGETS = Object.freeze({
  SKIP_RESULTS_ON_GHA: Object.freeze(["result", "result_catchup"]),
  SKIP_KFILE_ON_GHA: Object.freeze(["kfile_sync"]),
  SKIP_ODDS_ON_GHA: Object.freeze(["odds"]),
  SKIP_POINT_RANK_ON_GHA: Object.freeze(["point_rank"]),
  SKIP_ENTRY_COURSE_ON_GHA: Object.freeze(["entry_course_stats"]),
  SKIP_MOTOR_STATS_ON_GHA: Object.freeze(["venue_motor_stats"]),
  SKIP_RACER_NEWS_ON_GHA: Object.freeze(["racer_news"]),
  SKIP_RACER_SEASON_ON_GHA: Object.freeze(["racer_profiles"]),
  SKIP_RACE_INFO_ON_GHA: Object.freeze(["race_info"]),
  SKIP_EXHIBITION_ON_GHA: Object.freeze(["exhibition"]),
  // 朝の初期化の安全装置（scripts/daily/morning-init.js）。races が無い日でも、上の条件を満たすときだけ GitHub が初期化する
  SKIP_MORNING_INIT_ON_GHA: Object.freeze(["races_init"]),
});

export const GHA_SKIP_POLICY = Object.freeze({
  /**
   * last_tick_at がこの分数以上更新されていなければ、Vercel の起動が止まっているとみなす。
   * tick は5分に1回しか書かれない（TICK_WRITE_INTERVAL_MS）ため、正常でも最大約6分古い。書き込み2回分+2分の余裕
   */
  tickMaxAgeMin: (TICK_WRITE_INTERVAL_MS / 60000) * 2 + 2,
  /** 日次ジョブで、Vercel が起動したまま取得先と関係ない失敗がこの回数以上続いたら肩代わりする（monitor の通知閾値と同じ） */
  maxDailyFailures: THRESHOLDS.consecutiveFailures,
  /** 日次ジョブで「対象日の指定時刻以降に起動した」とみなす、指定時刻の前の許容（Vercel と時計のずれ） */
  dailyStartSkewMin: 1,
  /** 日次ジョブの指定時刻からこの分数までは、Vercel の処理の完了を待つ価値がある（判定ステップの待機の上限） */
  dailyWaitGraceMin: 10,
  /** DB の読み取りのタイムアウト（超えたら確かめられないため「スキップ」） */
  readTimeoutMs: 5000,
});

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 窓型で last_error を数える期間（1運用日。窓型の cron は JST 07:00〜24:00 のため、前日の失敗を今日に持ち越さない） */
export const WINDOW_FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

/**
 * 肩代わりしない変数（spec §8 G2「展示は肩代わりしない」）。beforeinfo の 403 は BreakerOpenError でジョブの
 * last_error に跡が残らず、パスのブレーカーが閉じると拒否の理由が消えるため、展示は条件によらず GitHub で取らない
 */
export const NEVER_TAKEOVER_VARS = Object.freeze(["SKIP_EXHIBITION_ON_GHA"]);

/** 取得先の都合（拒否・過負荷・接続の失敗）で肩代わりしない理由。1つの変数のどれかのジョブに出たら、変数ごと止める */
export const REMOTE_VETO_REASONS = new Set([
  "fetch_stop_no_takeover",
  "breaker_open_no_takeover",
  "fetch_failure_no_takeover",
]);

/** 読み取る scrape_job_state の行のキー（対象ジョブ＋そのジョブの取得先ホストのブレーカー） */
export function jobKeysFor(varName, registry = SCRAPE_JOBS) {
  const jobs = GHA_SKIP_TARGETS[varName] ?? [];
  const keys = new Set(jobs);
  for (const job of jobs) {
    for (const key of [
      ...hostKeysOf(registry[job]),
      ...pathKeysOf(registry[job]),
    ])
      keys.add(key);
  }
  return [...keys];
}

export const describeError = (error) =>
  error instanceof Error ? error.message : String(error);

/** GitHub Actions の取得が叩くホスト（scrape-scheduled・morning-init の素の fetch の取得先） */
export const GHA_FETCH_HOSTS = Object.freeze(["boatrace.jp"]);

export async function checkGhaFetchStopped(
  {
    env = process.env,
    client,
    hosts = GHA_FETCH_HOSTS,
    logger = console,
    policy = GHA_SKIP_POLICY,
  } = {},
  withTimeout,
) {
  const keys = hosts.map((host) => hostKeyOf(`https://${host}/`));
  const result = (stopped, reason) => {
    logger?.log(`[gha-fetch-stop] ${stopped ? "止める" : "続ける"}: ${reason}`);
    return { stopped, reason, keys };
  };
  let stateClient = client;
  if (!stateClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return result(
        false,
        "SUPABASE_URL・SUPABASE_SERVICE_KEY が未設定で非常停止を確かめられない",
      );
    }
    stateClient = buildRestJobStateClient({
      url: env.SUPABASE_URL,
      key: env.SUPABASE_SERVICE_KEY,
      timeoutMs: policy.readTimeoutMs,
    });
  }
  let rows;
  try {
    rows = await withTimeout(
      Promise.resolve().then(() => stateClient.readJobStates(keys)),
      policy.readTimeoutMs,
    );
  } catch (error) {
    return result(false, `非常停止を読み取れない（${describeError(error)}）`);
  }
  const stopped = (Array.isArray(rows) ? rows : []).filter(
    (row) => row?.fetch_stop === true && keys.includes(row.job),
  );
  if (stopped.length > 0) {
    return result(
      true,
      `${stopped.map((r) => r.job).join("・")} の非常停止（fetch_stop）が立っている`,
    );
  }
  return result(false, "非常停止は立っていない");
}

/** スキップ（肩代わりしない）の判定の戻り。キーの順は skip・reason・message・retryable・results */
export const skipDecision = (reason, message, results) => ({
  skip: true,
  reason,
  message,
  retryable: false,
  results,
});

/** scrape_job_state の行の配列を、ジョブ名 → 行の Map にする（配列でない・job が文字列でない行は除く） */
export const rowsByJobOf = (rows) =>
  new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r.job === "string")
      .map((r) => [r.job, r]),
  );
