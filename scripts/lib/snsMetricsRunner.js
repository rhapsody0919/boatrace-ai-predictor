/**
 * SNS の 48h・7d の取り込み（sns-pdca-loop tasks 21、cron `sns_metrics`、plan §5）。
 * 5分ごとに、due_at を過ぎた pending の sns_metric_jobs（154 のトリガーが posted のときに2件作る）を処理する。
 *
 * - YouTube: videos.list(statistics) の累積値（views・likes・comments）。50件ずつまとめて1回で読む（クォータ1）
 * - X: GET /2/users/{id}/tweets（自分の投稿の読み取りは Owned Reads、1件 $0.001）を since_id・until_id で対象の1件に絞る。
 *   public_metrics・non_public_metrics を読む。読む前に reserve_sns_x_read で送信と同じ月の台帳に予約する
 * - 累積値は窓の終わりから15分以内に取れたものだけ値として保存する（SQL154）。observed_at は実際に応答を受けた時刻、
 *   data_through も同じ値。15分を過ぎてから処理する job は、外部を読まずに「取得が遅れた」の欠測で閉じる（費用をかけない）
 * - 失敗は attempts を増やして pending のまま次の実行でやり直す。3回目の失敗でその場で Slack に知らせる（spec C4）。
 *   15分を過ぎたら、最後の失敗の理由を欠測理由に入れて閉じる
 * - 投稿の行が足りない（draft が posted でない・外部 ID が無い）job は、やり直しても直らないので failed で閉じて知らせる
 * - shadow では外部を読まず、DB も変えない（対象の件数だけを返す）
 * - 継続監視: 毎回、直近5日に閉じた job のうち欠測・失敗の割合が2%を超えたら report.alerts に入れる（監視が再通知の間隔ごとに Slack へ）
 */
import {
  OBSERVATION_WINDOWS,
  observationPeriod,
  windowsFor,
  validateObservation,
  withinSnapshotTolerance,
} from "../../src/utils/snsObservations.js";
import { X_API_BASE } from "../../api/_lib/xApiAdapter.js";

export const SNS_METRICS_MAX_JOBS = 50;
export const SNS_METRICS_ALERT_ATTEMPTS = 3;
export const SNS_METRICS_MONITOR_DAYS = 5;
export const SNS_METRICS_MISSING_RATE_LIMIT = 0.02;
// X の読み取り1回の予約額（since_id・until_id で1件に絞る。Owned Reads $0.001/件）
export const X_READ_MICROUSD = 1000;
const YOUTUBE_BATCH = 50;
const TIMEOUT_MS = 30000;

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

// 指標の定義（定義の文字列が違う系列は比較で混ぜない。値を変えるときは末尾の版を上げる）
const YOUTUBE_METRICS = [
  [
    "views",
    "viewCount",
    "YouTube Data API videos.list statistics.viewCount の累積値・分母なし・v1",
  ],
  [
    "likes",
    "likeCount",
    "YouTube Data API videos.list statistics.likeCount の累積値・分母なし・v1",
  ],
  [
    "comments",
    "commentCount",
    "YouTube Data API videos.list statistics.commentCount の累積値・分母なし・v1",
  ],
];
const X_METRICS = [
  [
    "impressions",
    "non_public_metrics",
    "impression_count",
    "X API v2 non_public_metrics.impression_count の累積値・分母なし・v1",
  ],
  [
    "url_link_clicks",
    "non_public_metrics",
    "url_link_clicks",
    "X API v2 non_public_metrics.url_link_clicks の累積値（リンクのない投稿は返らない）・分母なし・v1",
  ],
  [
    "likes",
    "public_metrics",
    "like_count",
    "X API v2 public_metrics.like_count の累積値・分母なし・v1",
  ],
  [
    "shares",
    "public_metrics",
    "retweet_count",
    "X API v2 public_metrics.retweet_count の累積値（引用は含まない）・分母なし・v1",
  ],
  [
    "saves",
    "public_metrics",
    "bookmark_count",
    "X API v2 public_metrics.bookmark_count の累積値・分母なし・v1",
  ],
];
const METRICS_BY_CHANNEL = {
  youtube: YOUTUBE_METRICS.map(([name, , definition]) => ({
    name,
    definition,
  })),
  x: X_METRICS.map(([name, , , definition]) => ({ name, definition })),
};
const SOURCE_BY_CHANNEL = { youtube: "youtube-data", x: "x-api" };

const shortError = (error) => String(error?.message ?? error).slice(0, 200);

/**
 * @param {{mode: string, now: () => Date, shouldStop: () => boolean}} ctx
 * @param {{store, readers: {x: () => Promise<{read: Function}>, youtube: () => Promise<{read: Function}>}, notify?, maxJobs?}} deps
 * readers.{channel}() は1回の実行でチャネルごとに1回だけ呼ぶ（トークンの取得）。read(targets) は
 * Map<external_post_id, {observedAt, values: {metric_name: number|null}}> を返す。応答に無い ID は Map に入れない
 */
export async function runSnsMetrics(
  ctx,
  { store, readers, notify = async () => {}, maxJobs = SNS_METRICS_MAX_JOBS },
) {
  const now = ctx.now();
  const jobs = await store.dueJobs(now, maxJobs);
  if (ctx.mode !== "live")
    return {
      rowsWritten: 0,
      report: { due: jobs.length, alerts: [] },
      body: { mode: ctx.mode, due: jobs.length },
    };

  const tell = async (text) => {
    try {
      await notify(text);
    } catch (error) {
      console.error(`Slack に通知できません（${text}）: ${error.message}`);
    }
  };
  const results = [];
  const alerts = [];
  let written = 0;
  const close = async (job, state, rows, lastError = null) => {
    for (const row of rows) await store.append(job.draft.id, row);
    written += rows.length;
    await store.finish(job.id, state, lastError);
    results.push({
      id: job.id,
      window: job.window,
      outcome: state,
      ...(lastError ? { reason: lastError } : {}),
    });
  };
  // quiet: 続いている状態（トークンを取れない）は report.alerts で知らせるので、job ごとの Slack は出さない
  const fail = async (job, error, { quiet = false } = {}) => {
    const attempts = job.attempts + 1;
    const reason = shortError(error);
    await store.retry(job.id, attempts, reason);
    results.push({ id: job.id, window: job.window, outcome: "retry", reason });
    if (!quiet && attempts === SNS_METRICS_ALERT_ATTEMPTS)
      await tell(
        `SNS の取り込みが${attempts}回続けて失敗: ${job.channel} ${job.window} job ${job.id}: ${reason}`,
      );
  };

  // 1. 投稿の行を確かめ、15分を過ぎた job は外部を読まずに欠測で閉じる
  const live = { x: [], youtube: [] };
  for (const job of jobs) {
    if (ctx.shouldStop()) break;
    try {
      const broken = brokenReason(job);
      if (broken) {
        await close(job, "failed", [], broken);
        await tell(
          `SNS の取り込みを閉じた（直らない不備）: job ${job.id} ${broken}`,
        );
        continue;
      }
      const period = observationPeriod(job.draft.posted_at, job.window);
      // due_at と posted_at がずれた行は次の実行で
      if (Date.parse(period.period_end) > now.getTime()) continue;
      if (withinSnapshotTolerance(now.toISOString(), period.period_end)) {
        live[job.channel].push({ job, period });
        continue;
      }
      // 値は保存できたが閉じる（finish）のに失敗した job は、欠測で上書きせずに閉じる（比較は最新の revision を使うため）
      if (
        await store.hasValues(
          job.draft.id,
          job.window,
          SOURCE_BY_CHANNEL[job.channel],
        )
      ) {
        await close(job, "done", []);
        continue;
      }
      const reason = `取得が遅れた（窓の終わりから15分を過ぎた）${job.last_error ? `。最後の失敗: ${job.last_error}` : ""}`;
      await close(job, "missing", missingRows(job, period, now, reason));
    } catch (error) {
      await fail(job, error);
    }
  }

  // 2. チャネルごとに読む。トークンを取れなければ、そのチャネルの job を全部やり直しに回す
  for (const channel of ["youtube", "x"]) {
    const targets = live[channel];
    if (!targets.length || ctx.shouldStop()) continue;
    let reader;
    try {
      reader = await readers[channel]();
    } catch (error) {
      for (const { job } of targets) await fail(job, error, { quiet: true });
      alerts.push({
        key: `token:${channel}`,
        text: `${channel} のトークンを取れないので取り込みを止めている: ${shortError(error)}`,
      });
      continue;
    }
    for (const chunk of chunks(
      targets,
      channel === "youtube" ? YOUTUBE_BATCH : 1,
    )) {
      if (ctx.shouldStop()) break;
      let read;
      try {
        if (channel === "x" && !(await store.reserveXRead(X_READ_MICROUSD)))
          throw new Error(
            "x_read_budget: 月の残りが送信の分を割るので読まない",
          );
        read = await reader.read(chunk.map(({ job }) => job.external_post_id));
      } catch (error) {
        for (const { job } of chunk) await fail(job, error);
        continue;
      }
      for (const { job, period } of chunk) {
        const found = read.get(job.external_post_id);
        if (!found) {
          await fail(
            job,
            new Error("対象の投稿が応答に無い（削除・非公開の可能性）"),
          );
          continue;
        }
        try {
          await close(job, "done", valueRows(job, period, found));
        } catch (error) {
          await fail(job, error);
        }
      }
    }
  }

  const rate = await store.recentOutcomes(now, SNS_METRICS_MONITOR_DAYS);
  const bad = rate.missing + rate.failed;
  const closed = bad + rate.done;
  if (closed > 0 && bad / closed > SNS_METRICS_MISSING_RATE_LIMIT)
    alerts.push({
      key: "missing_rate",
      text: `SNS の取り込みの欠測が多い: 直近${SNS_METRICS_MONITOR_DAYS}日で ${bad}/${closed} 件（欠測 ${rate.missing}・失敗 ${rate.failed}、上限 ${SNS_METRICS_MISSING_RATE_LIMIT * 100}%）`,
    });

  return {
    rowsWritten: written,
    report: { jobs: results, recent: rate, alerts },
    body: { jobs: results },
  };
}

function brokenReason(job) {
  if (!job.draft) return "draft_missing";
  if (job.draft.status !== "posted" || !job.draft.posted_at)
    return "draft_not_posted";
  if (!job.external_post_id) return "external_post_id_missing";
  if (!METRICS_BY_CHANNEL[job.channel]) return "unknown_channel";
  if (!Object.hasOwn(OBSERVATION_WINDOWS, job.window)) return "unknown_window";
  // 型が測らない窓（SQL167 の前に古いトリガーが全貌に作った 48h・7d など）は、やり直しても入れられないので閉じる
  if (!windowsFor(job.draft).includes(job.window)) return "window_not_measured";
  return null;
}

function* chunks(list, size) {
  for (let i = 0; i < list.length; i += size) yield list.slice(i, i + size);
}

const baseRow = (job, period, observedAt) => ({
  window: job.window,
  ...period,
  observed_at: observedAt,
  source: SOURCE_BY_CHANNEL[job.channel],
  measurement_kind: "snapshot",
  duration_seconds: null,
  external_post_id: job.external_post_id,
  curve: [],
});

function missingRows(job, period, now, reason) {
  return METRICS_BY_CHANNEL[job.channel].map(({ name, definition }) =>
    validateObservation(
      {
        ...baseRow(job, period, now.toISOString()),
        metric_name: name,
        metric_value: null,
        missing_reason: reason,
        data_through: null,
        definition,
      },
      job.draft,
    ),
  );
}

// 応答を受けた時刻が15分を過ぎていたら、値は捨てて欠測にする（遅い累積値を過去の窓に入れない）
function valueRows(job, period, { observedAt, values }) {
  const late = !withinSnapshotTolerance(observedAt, period.period_end);
  return METRICS_BY_CHANNEL[job.channel].map(({ name, definition }) => {
    const value = values[name];
    const ok = !late && Number.isFinite(value) && value >= 0;
    return validateObservation(
      {
        ...baseRow(job, period, observedAt),
        metric_name: name,
        metric_value: ok ? value : null,
        missing_reason: ok
          ? null
          : late
            ? "取得が遅れた（応答が窓の終わりから15分を過ぎた）"
            : "API が値を返さない",
        data_through: ok ? observedAt : null,
        definition,
      },
      job.draft,
    );
  });
}

async function getJson(fetchImpl, url, headers, label) {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} の応答を解釈できません: HTTP ${response.status}`);
  }
  if (!response.ok) {
    // 応答の本文（API の詳細）は DB に残さない。状態コードとエラーの種類だけ
    const kind = body?.title || body?.error?.errors?.[0]?.reason || "";
    throw new Error(
      `${label} が失敗: HTTP ${response.status}${kind ? ` ${kind}` : ""}`,
    );
  }
  return body;
}

const toNumber = (value) =>
  value === undefined || value === null || value === "" ? null : Number(value);

/** YouTube の読み取り。ids は50件まで */
export function createYoutubeMetricsReader({
  accessToken,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  if (!accessToken) throw new Error("YouTube の access token がありません");
  return {
    async read(ids) {
      const url = `${YOUTUBE_API_BASE}/videos?part=statistics&id=${ids.map(encodeURIComponent).join(",")}&maxResults=${YOUTUBE_BATCH}`;
      const body = await getJson(
        fetchImpl,
        url,
        { Authorization: `Bearer ${accessToken}` },
        "YouTube videos.list",
      );
      const observedAt = now().toISOString();
      if (!Array.isArray(body.items))
        throw new Error("YouTube videos.list の応答に items が無い");
      return new Map(
        body.items.map((item) => [
          item.id,
          {
            observedAt,
            values: Object.fromEntries(
              YOUTUBE_METRICS.map(([name, field]) => [
                name,
                toNumber(item.statistics?.[field]),
              ]),
            ),
          },
        ]),
      );
    },
  };
}

/** X の読み取り。ids は1件（since_id=ID−1・until_id=ID+1 で、その投稿だけを返させる） */
export function createXMetricsReader({
  accessToken,
  accountId,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  if (!accessToken) throw new Error("X の access token がありません");
  if (!/^[0-9]{1,19}$/.test(accountId ?? ""))
    throw new Error("X のアカウント ID がありません");
  return {
    async read([id]) {
      if (!/^[0-9]{1,19}$/.test(id ?? ""))
        throw new Error("X の投稿 ID が不正です");
      const params = new URLSearchParams({
        since_id: String(BigInt(id) - 1n),
        until_id: String(BigInt(id) + 1n),
        max_results: "5",
        "tweet.fields": "public_metrics,non_public_metrics",
      });
      const body = await getJson(
        fetchImpl,
        `${X_API_BASE}/2/users/${accountId}/tweets?${params}`,
        { Authorization: `Bearer ${accessToken}` },
        "X GET /2/users/{id}/tweets",
      );
      const observedAt = now().toISOString();
      const tweet = (body.data ?? []).find((t) => t.id === id);
      if (!tweet) return new Map();
      return new Map([
        [
          id,
          {
            observedAt,
            values: Object.fromEntries(
              X_METRICS.map(([name, group, field]) => [
                name,
                toNumber(tweet[group]?.[field]),
              ]),
            ),
          },
        ],
      ]);
    },
  };
}

/** 1日の送信の予約額の見込み（reserve_sns_x_read に渡す。スレッドの親1件＋子）。上限額が未設定なら0 */
export function dailySendMicrousd(control) {
  const limit = control.daily_limit_x ?? control.daily_limit ?? 1;
  const url =
    control.ceiling_x_url_microusd ?? control.attempt_ceiling_microusd ?? 0;
  const plain =
    control.ceiling_x_plain_microusd ?? control.attempt_ceiling_microusd ?? 0;
  return Number(url) + Math.max(0, limit - 1) * Number(plain);
}

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createSnsMetricsStore({ url, key, fetchImpl = fetch }) {
  async function call(path, { method = "GET", body, count = false } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(count ? { Prefer: "count=exact" } : {}),
        ...(body
          ? {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok)
      throw new Error(
        `取り込みの DB 操作に失敗: HTTP ${response.status} ${method} ${path.split("?")[0]}`,
      );
    if (count) {
      // 行は1件だけ読み、件数は Content-Range（0-0/N）から取る（PostgREST の max-rows で数え漏れないため）
      const total = Number(
        response.headers.get("content-range")?.split("/")[1],
      );
      if (!Number.isInteger(total))
        throw new Error(`件数を読めない: ${path.split("?")[0]}`);
      return total;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    async dueJobs(now, limit) {
      const jobs = await call(
        `sns_metric_jobs?state=eq.pending&due_at=lte.${encodeURIComponent(now.toISOString())}&order=due_at.asc,id.asc&limit=${limit}&select=id,draft_id,window,source,due_at,attempts,last_error`,
      );
      if (!jobs.length) return [];
      const ids = [...new Set(jobs.map((j) => j.draft_id))].join(",");
      const [drafts, sends] = await Promise.all([
        call(`sns_drafts?id=in.(${ids})&select=id,status,posted_at,platform,format`),
        call(
          `sns_x_send_jobs?draft_id=in.(${ids})&state=eq.posted&select=draft_id,channel,external_post_id`,
        ),
      ]);
      return joinDueJobs(jobs, drafts, sends);
    },
    append: (draftId, observation) =>
      call("rpc/append_sns_metric_observation", {
        method: "POST",
        body: { p_draft_id: draftId, p_observation: observation },
      }),
    async finish(id, state, lastError) {
      const rows = await call(`sns_metric_jobs?id=eq.${id}&state=eq.pending`, {
        method: "PATCH",
        body: {
          state,
          done_at: new Date().toISOString(),
          last_error: lastError,
        },
      });
      if (rows?.length !== 1)
        throw new Error(
          `取り込みの job を閉じられない（pending でない）: ${id}`,
        );
    },
    async retry(id, attempts, lastError) {
      await call(`sns_metric_jobs?id=eq.${id}&state=eq.pending`, {
        method: "PATCH",
        body: { attempts, last_error: lastError },
      });
    },
    async reserveXRead(microusd) {
      const [control] = await call("sns_x_send_control?id=eq.true&select=*");
      if (!control) throw new Error("sns_x_send_control が無い");
      return call("rpc/reserve_sns_x_read", {
        method: "POST",
        body: {
          p_microusd: microusd,
          p_daily_send_microusd: dailySendMicrousd(control),
        },
      });
    },
    async hasValues(draftId, window, source) {
      const rows = await call(
        `sns_metric_observations?draft_id=eq.${draftId}&window=eq.${window}&source=eq.${source}&metric_value=not.is.null&select=id&limit=1`,
      );
      return rows.length > 0;
    },
    async recentOutcomes(now, days) {
      const since = encodeURIComponent(
        new Date(now.getTime() - days * 86400000).toISOString(),
      );
      const entries = await Promise.all(
        ["done", "missing", "failed"].map(async (state) => [
          state,
          await call(
            `sns_metric_jobs?state=eq.${state}&done_at=gte.${since}&select=id&limit=1`,
            { count: true },
          ),
        ]),
      );
      return Object.fromEntries(entries);
    },
  };
}

/** job に draft と送信の外部 ID・チャネルをつなぐ。送信の行が無ければ external_post_id は null（failed で閉じる） */
export function joinDueJobs(jobs, drafts, sends) {
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const sendByDraft = new Map(sends.map((s) => [s.draft_id, s]));
  return jobs.map((job) => ({
    ...job,
    channel: job.source === "youtube-data" ? "youtube" : "x",
    draft: draftById.get(job.draft_id) ?? null,
    external_post_id: sendByDraft.get(job.draft_id)?.external_post_id ?? null,
  }));
}
