/**
 * GitHub Actions 側の取得を止める判定（フェイルセーフ付きSKIP。自動フェイルオーバー）。
 *
 * 従来の SKIP_<JOB>_ON_GHA=true は静的な停止で、Vercel が止まっても、人間が変数を戻すまで取得が止まる
 * （無人の夜間は特に危険）。本モジュールは、変数が true のときだけ scrape_job_state を読み、**Vercel が起動していないと
 * 確かめられ、かつ取得先が拒否・過負荷でないと確かめられたときだけ**、GitHub Actions に肩代わりさせる。
 *
 *   変数が未設定・true 以外 → DB を読まず、常に「実行」（現行と完全に同じ。人が GitHub を主に選んだ状態）
 *   変数が true            → 下の判定。全ジョブで「肩代わりしない」ならスキップ
 *
 * 肩代わりの条件（docs/design/scraping-load-budget/spec.md §0・§8 の P0。BOA-1145 の後）:
 *   GitHub Actions の取得は politeFetch・DB のブレーカー・403 の扱いを通らない素の fetch で、別の IP から公式を叩く。
 *   公式が 403 や接続の失敗を返し続けるときに肩代わりすると、守りを回り込むことになる。そこで、肩代わりは次の全てを
 *   満たすときだけにする。どれかを確かめられない（行なし・読み取りの失敗・不正な値）ときも肩代わりしない。
 *     1. scrape_job_state.mode = 'live'（off・shadow は「どこからも取らない」。人が止めた間に GitHub が取らない）
 *     2. Vercel が起動していない
 *          窓型: last_tick_at が tickMaxAgeMin 分以上古い（tick_stale）
 *          日次: 対象日が未処理で、対象日の指定時刻以降に Vercel の起動（last_tick_at）が無い
 *        Vercel が起動しているなら、連続失敗があっても肩代わりしない（失敗の多くは取得先の拒否・接続の失敗で、
 *        別の IP から叩き直すのは回り込みになる。それ以外の失敗は監視の通知で人が見る）
 *     3. 取得先のブレーカー（ホスト・パス）が閉じている
 *     4. 直近の失敗（last_error）が、取得先の拒否・過負荷・接続の失敗（403・429・503・ネットワーク）ではない
 *     （同じ変数の別のジョブが 3・4 で止まっているときも、変数ごと肩代わりしない）
 *   日次だけの例外: 指定時刻以降に起動していても、取得先と関係ない失敗（コード・DB）が閾値以上続いていれば肩代わりする
 *
 * 判定は純関数（evaluateJobHealth・decideFromRows）と、IO（createRestJobStateClient・shouldSkipOnGha）に分ける。
 * 戻り値の healthy は「肩代わりしない（GitHub はスキップする）」の意味（名前は従来のまま）。
 * DB は supabase-js を使わず、REST（fetch）で該当ジョブの行だけを読む（GitHub Actions の判定ステップが npm ci なしで動く）。
 *
 * 対象外（現行のまま静的な変数）:
 *   SKIP_ODDS_REFRESH_ON_GHA  予測リフレッシュ。Vercel 側の REFRESH_ON_VERCEL（環境変数）と連動しており、DB の状態では判定できない
 */
import { SCRAPE_JOBS, HOST_JOB_PREFIX } from "./scrapeJobs/registry.js";
import { resolveTargetDate } from "./scrapeJobs/dailyJob.js";
import { TICK_WRITE_INTERVAL_MS } from "./scrapeJobs/store.js";
import { THRESHOLDS } from "./scrapeJobs/monitor.js";
import { hostKeyOf, pathKeyOf } from "./scrapeJobs/politeFetch.js";

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

/** 開いているブレーカーのキーを返す（開いていなければ null）。キーは politeFetch と同じ関数で作る */
function openBreakerKey(keys, rowsByJob, nowMs) {
  for (const key of keys) {
    const row = rowsByJob.get(key);
    const until = parseTime(row?.breaker_open_until);
    if (until !== null && until > nowMs) return key;
  }
  return null;
}
const hostKeysOf = (def) =>
  (def?.hosts ?? []).map((host) => hostKeyOf(`https://${host}/`));
const pathKeysOf = (def) => (def?.breakerUrls ?? []).map(pathKeyOf);

/**
 * 直近の失敗が、取得先の拒否・過負荷・接続の失敗か（last_error の文字列）。各ジョブが投げる形をすべて拾う:
 *   htmlFetch `HTTP 403 for <url>`、scrape-results の ResultHttpError `…: HTTP 403 (<url>)`、race_info・odds_final・
 *   point_rank `HTTP 403`、kfileParser `Kファイル取得失敗: HTTP 403 (<url>)`、racer_news `…に失敗しました(403): <url>`、
 *   会場のジョブ `http_403`、racerProfileSync `HTTP 503`（429・503 も同じ）。politeFetch の FetchError
 *   `取得に失敗しました（N回試行）`（タイムアウト・ネットワークエラーを含む）、BreakerOpenError、Node の fetch の
 *   ネットワークエラー（fetch failed・ECONN*・ETIMEDOUT・ENOTFOUND・EAI_AGAIN・UND_ERR_*）。
 * store.js の DB の失敗（timeout・network・aborted の語）は含めない。広すぎて拾っても肩代わりしない側に倒れるだけ
 */
export const FETCH_FAILURE_RE =
  /\bHTTP[ _]?(403|429|503)\b|http_(403|429|503)\b|\((403|429|503)\)|取得に失敗しました（\d+回試行）|サーキットブレーカーが開いています（|fetch failed|ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_/;

export const isFetchFailureError = (lastError) =>
  typeof lastError === "string" && FETCH_FAILURE_RE.test(lastError);

/**
 * last_error が「Vercel の直近の起動」の失敗か。recordFailure は updated_at を書き、touchTick は書かない。
 * 失敗の後も起動（tick）が TICK_WRITE_INTERVAL_MS を超えて続いていれば、その失敗は古い（その後の起動は処理対象が
 * 無かっただけ）とみなし、肩代わりを止める理由にしない（前夜の1回の失敗で翌朝の予備まで止めない）。
 * floorMs より前の失敗（日次は当日の指定時刻より前、窓型は24時間より前）も数えない。
 * 時刻を読めないときは直近とみなす（肩代わりしない側）
 */
function isRecentFailure(row, floorMs) {
  const failedAt = parseTime(row.updated_at);
  if (failedAt === null) return true;
  if (failedAt < floorMs) return false;
  const tick = parseTime(row.last_tick_at);
  if (tick === null) return true;
  return failedAt >= tick - TICK_WRITE_INTERVAL_MS;
}

/** 窓型で last_error を数える期間（1運用日。窓型の cron は JST 07:00〜24:00 のため、前日の失敗を今日に持ち越さない） */
const WINDOW_FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

/**
 * 肩代わりしない変数（spec §8 G2「展示は肩代わりしない」）。beforeinfo の 403 は BreakerOpenError でジョブの
 * last_error に跡が残らず、パスのブレーカーが閉じると拒否の理由が消えるため、展示は条件によらず GitHub で取らない
 */
export const NEVER_TAKEOVER_VARS = Object.freeze(["SKIP_EXHIBITION_ON_GHA"]);

/** 取得先の都合（拒否・過負荷・接続の失敗）で肩代わりしない理由。1つの変数のどれかのジョブに出たら、変数ごと止める */
const REMOTE_VETO_REASONS = new Set([
  "fetch_stop_no_takeover",
  "breaker_open_no_takeover",
  "fetch_failure_no_takeover",
]);

/**
 * 1ジョブについて、GitHub Actions が肩代わりしてよいか（純関数）。healthy=true は「肩代わりしない」。
 *
 * @param {Object} params
 * @param {string} params.job レジストリのジョブ名
 * @param {Map<string, Object>} params.rowsByJob scrape_job_state の行（ジョブ名 → 行。host:xxx を含む）
 * @param {Date} params.now
 * @param {typeof GHA_SKIP_POLICY} [params.policy]
 * @param {typeof SCRAPE_JOBS} [params.registry]
 * @returns {{job: string, healthy: boolean, reason: string, detail: string, retryable: boolean}}
 *   retryable: 今は肩代わりの条件を満たすが、Vercel の起動を少し待てば満たさなくなりうる（日次ジョブの指定時刻の直後）
 */
export function evaluateJobHealth({
  job,
  rowsByJob,
  now,
  policy = GHA_SKIP_POLICY,
  registry = SCRAPE_JOBS,
}) {
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

  const def = registry[job];
  if (!def) {
    return noTakeover(
      "unknown_job",
      `${job}: レジストリに無いジョブ（確かめられないため肩代わりしない）`,
    );
  }
  const row = rowsByJob.get(job);
  if (!row) {
    return noTakeover(
      "no_row",
      `${job}: ジョブ状態の行なし（mode を確かめられないため肩代わりしない）`,
    );
  }
  if (row.mode !== "live") {
    return noTakeover(
      "mode_not_live",
      `${job}: mode=${String(row.mode)}（live ではない。どこからも取らない）`,
    );
  }
  const nowMs = now.getTime();
  // 取得の非常停止（scrape_job_state.fetch_stop、マイグレーション178。人が host の行で立てる）の間は肩代わりしない
  const stoppedKey = [...pathKeysOf(def), ...hostKeysOf(def)].find(
    (key) => rowsByJob.get(key)?.fetch_stop === true,
  );
  if (stoppedKey) {
    return noTakeover(
      "fetch_stop_no_takeover",
      `${job}: 取得先 ${stoppedKey} の非常停止（fetch_stop）が立っている（肩代わりしない）`,
    );
  }
  // 取得先のブレーカー（403 のパス・429/503 のホスト）が開いている間は、Vercel が止まっていても肩代わりしない
  const openKey =
    openBreakerKey(pathKeysOf(def), rowsByJob, nowMs) ??
    openBreakerKey(hostKeysOf(def), rowsByJob, nowMs);
  if (openKey) {
    return noTakeover(
      "breaker_open_no_takeover",
      `${job}: 取得先 ${openKey} のブレーカーが開いている（肩代わりしない）`,
    );
  }
  const targetInstant =
    def.kind === "daily"
      ? parseTime(
          `${resolveTargetDate(now, def.targetTimeJst)}T${def.targetTimeJst}:00+09:00`,
        )
      : null;
  const failureFloorMs =
    def.kind === "daily"
      ? (targetInstant ?? nowMs)
      : nowMs - WINDOW_FAILURE_MEMORY_MS;
  if (
    isFetchFailureError(row.last_error) &&
    isRecentFailure(row, failureFloorMs)
  ) {
    return noTakeover(
      "fetch_failure_no_takeover",
      `${job}: 直近の失敗が取得先の拒否・接続の失敗（${String(row.last_error).slice(0, 120)}。肩代わりしない）`,
    );
  }

  const tick = parseTime(row.last_tick_at);
  const tickAge = tick === null ? null : minutesSince(tick, nowMs);
  if (tickAge !== null && tickAge < -1) {
    return noTakeover(
      "clock_skew",
      `${job}: 最終起動が${-tickAge}分先（時計のずれ。確かめられないため肩代わりしない）`,
    );
  }
  const tickFresh = tickAge !== null && tickAge < policy.tickMaxAgeMin;

  if (def.kind === "window") {
    if (tickFresh) {
      return noTakeover(
        "vercel_running",
        `${job}: live・最終起動${tickAge}分前（Vercel が起動している。連続失敗${String(row.consecutive_failures)}回でも肩代わりしない）`,
      );
    }
    return takeover(
      tick === null ? "tick_missing" : "tick_stale",
      tick === null
        ? `${job}: last_tick_at が無い・不正（Vercel が起動していない）`
        : `${job}: 最終起動${tickAge}分前（${policy.tickMaxAgeMin}分以上更新なし・時計の異常を含む）`,
    );
  }

  if (def.kind === "daily") {
    const target = resolveTargetDate(now, def.targetTimeJst);
    const done = row.last_target_date;
    if (done !== null && done !== undefined && !DATE_RE.test(String(done))) {
      return noTakeover(
        "invalid_value",
        `${job}: last_target_date が不正: ${String(done)}（確かめられないため肩代わりしない）`,
      );
    }
    if (done && done >= target) {
      return noTakeover(
        "daily_done",
        `${job}: live・対象日${target}は処理済み（${done}）`,
      );
    }
    const startedSinceTarget =
      tick !== null &&
      targetInstant !== null &&
      tick >= targetInstant - policy.dailyStartSkewMin * 60000;
    // 日次は Vercel の cron が指定時刻の後も数回起動する（races_init は終日2分おき）ため、起動していることだけでは
    // 「Vercel が当日を処理できない」を判定できない。指定時刻以降に起動があり、取得先と関係ない失敗（上で 403・接続の
    // 失敗は除いた。コード・DB の失敗）が閾値以上続いているときだけ肩代わりする。races が無いと当日の取得が全て止まる
    // races_init の安全装置を、Vercel の不具合の日に生かすため
    const failures = row.consecutive_failures;
    const failedAt = parseTime(row.updated_at);
    if (
      startedSinceTarget &&
      failedAt !== null &&
      targetInstant !== null &&
      failedAt >= targetInstant &&
      Number.isInteger(failures) &&
      failures >= policy.maxDailyFailures
    ) {
      return takeover(
        "daily_failures",
        `${job}: 対象日${target}が未処理で、Vercel が取得先と関係ない失敗を${failures}回続けている（${String(row.last_error ?? "").slice(0, 120)}）`,
      );
    }
    if (tickFresh || startedSinceTarget) {
      return noTakeover(
        "vercel_running",
        `${job}: 対象日${target}は未処理だが、Vercel が起動している（最終起動${tickAge}分前。肩代わりしない）`,
      );
    }
    const sinceTargetMin =
      targetInstant === null ? null : minutesSince(targetInstant, nowMs);
    const retryable =
      sinceTargetMin !== null &&
      sinceTargetMin >= 0 &&
      sinceTargetMin < policy.dailyWaitGraceMin;
    return takeover(
      "target_pending",
      `${job}: 対象日${target}が未処理で、指定時刻以降に Vercel の起動が無い（最終処理済み ${done ?? "なし"}）`,
      retryable,
    );
  }

  // continuous・monitor は SKIP 変数の対象ではない
  return noTakeover(
    "unsupported_kind",
    `${job}: kind=${def.kind} は判定対象外（肩代わりしない）`,
  );
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
      skip: true,
      reason: "unsupported_var",
      message: `スキップ: ${varName} は判定の対象外（肩代わりの条件を確かめられない）`,
      retryable: false,
      results: [],
    };
  }
  const rowsByJob = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r.job === "string")
      .map((r) => [r.job, r]),
  );
  if (NEVER_TAKEOVER_VARS.includes(varName)) {
    return {
      skip: true,
      reason: "never_takeover",
      message: `スキップ: ${varName} は肩代わりしない（展示は GitHub で取らない。spec §8 G2）`,
      retryable: false,
      results: [],
    };
  }
  const results = jobs.map((job) =>
    evaluateJobHealth({ job, rowsByJob, now, policy, registry }),
  );
  const unhealthy = results.filter((r) => !r.healthy);
  // 同じ変数の別のジョブが、取得先の拒否・過負荷・接続の失敗で止まっているなら、変数ごと肩代わりしない
  // （例: SKIP_RESULTS_ON_GHA の result が 403 なのに、result_catchup の未処理で GitHub が raceresult を叩く）
  const veto = results.find((r) => REMOTE_VETO_REASONS.has(r.reason));
  if (veto && unhealthy.length > 0) {
    return {
      skip: true,
      reason: veto.reason,
      message: `スキップ: 肩代わりしない（${veto.detail}。同じ変数の他のジョブも肩代わりしない）`,
      retryable: false,
      results,
    };
  }
  if (unhealthy.length === 0) {
    return {
      skip: true,
      reason: results.length === 1 ? results[0].reason : "all_healthy",
      message: `スキップ: 肩代わりしない（${results.map((r) => r.detail).join(" / ")}）`,
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
    for (const key of [
      ...hostKeysOf(registry[job]),
      ...pathKeysOf(registry[job]),
    ])
      keys.add(key);
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
 * GitHub Actions 側の取得を、スキップするか判定する（IO込み）。変数が true のとき、失敗・不正・未確認は、すべて
 * 「スキップ」（肩代わりの条件を確かめられないときに、守りを通らない取得をしない。P0）。
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
  const skipUnconfirmed = (reason, message) =>
    finish({
      skip: true,
      reason,
      message: `スキップ: ${message}（肩代わりの条件を確かめられない）`,
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
    return skipUnconfirmed("unsupported_var", `${varName} は判定の対象外`);
  }
  let stateClient = client;
  if (!stateClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return skipUnconfirmed(
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
      return skipUnconfirmed(
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
    return skipUnconfirmed(
      "read_failed",
      `Vercelの状態を読み取れない（${describeError(error)}）`,
    );
  }
  let decision;
  try {
    decision = decideFromRows({ varName, rows, now, policy });
  } catch (error) {
    return skipUnconfirmed(
      "evaluate_failed",
      `判定に失敗（${describeError(error)}）`,
    );
  }
  return finish(decision);
}

const describeError = (error) =>
  error instanceof Error ? error.message : String(error);

/** GitHub Actions の取得が叩くホスト（scrape-scheduled・morning-init の素の fetch の取得先） */
export const GHA_FETCH_HOSTS = Object.freeze(["boatrace.jp"]);

/**
 * 取得先のホストに非常停止（fetch_stop、マイグレーション178）が立っているか（IO込み）。SKIP 変数に関係なく、GitHub Actions の
 * 取得（scrape-scheduled・morning-init）の最初に呼ぶ（変数が true でない＝人が GitHub を主に選んだ状態でも、非常停止は効かせる。
 * ADR-0101 決定6「Vercel・ライブ・GitHub Actions のすべての取得が止まる」）。
 * 読めないとき（鍵が無い・読み取りの失敗）は止めない側（stopped=false）。理由: 変数が true のジョブは shouldSkipOnGha が
 * 読めなければスキップする（止める側）ので、ここで止めない側に倒れるのは人が GitHub を主に選んだジョブだけ。そこを DB の一時の
 * 障害で止めない（Vercel の circuitBreaker の読み取りの失敗と同じ扱い）。理由はログに出す
 * @returns {Promise<{stopped: boolean, reason: string, keys: string[]}>}
 */
export async function isGhaFetchStopped({
  env = process.env,
  client,
  hosts = GHA_FETCH_HOSTS,
  logger = console,
  policy = GHA_SKIP_POLICY,
} = {}) {
  const keys = hosts.map((host) => hostKeyOf(`https://${host}/`));
  const result = (stopped, reason) => {
    logger?.log(`[gha-fetch-stop] ${stopped ? "止める" : "続ける"}: ${reason}`);
    return { stopped, reason, keys };
  };
  let stateClient = client;
  if (!stateClient) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return result(false, "SUPABASE_URL・SUPABASE_SERVICE_KEY が未設定で非常停止を確かめられない");
    }
    stateClient = createRestJobStateClient({
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

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * shouldSkipOnGha に、日次ジョブの指定時刻の直後の待機を足したもの。Vercel と GitHub は同じ時刻に起動するため、
 * 「Vercel がまだ処理中」で二重に取得しないよう、retryable の間だけ、上限（dailyWaitGraceMin）まで待って再判定する。
 * 待機の上限を過ぎても Vercel の起動が無ければ「実行」（フェイルオーバー。上の肩代わりの条件を満たすときだけ）。
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
