/**
 * SNS の 48h・7d の取り込みの DB 操作（PostgREST）。snsMetricsRunner.js から、createSnsMetricsStore・joinDueJobs を移し、store を割った（振る舞いは同じ）。
 */
import { dailySendMicrousd } from "./snsMetricsRunnerReaders.js";

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

/** PostgREST の呼び出し（service_role）。count を付けると Content-Range から件数を返す */
function createCall({ url, key, fetchImpl }) {
  return async function call(path, { method = "GET", body, count = false } = {}) {
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
  };
}

/** 期限を過ぎた pending の job に、draft と送信の外部 ID をつなげて返す */
async function readDueJobs(call, now, limit) {
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
}

/** 直近 days 日に閉じた job の状態ごとの件数 */
async function readRecentOutcomes(call, now, days) {
  const since = encodeURIComponent(
    new Date(now.getTime() - days * 86400000).toISOString(),
  );
  const entries = await Promise.all(
    ["done", "missing", "failed"].map(async (state) => [
      state,
      await call(
        // 消した投稿（197 の mark_sns_x_post_deleted が post_deleted で閉じる）は欠測の率に数えない（BOA-1279）
        `sns_metric_jobs?state=eq.${state}&done_at=gte.${since}&select=id&limit=1&or=(last_error.is.null,last_error.neq.post_deleted)`,
        { count: true },
      ),
    ]),
  );
  return Object.fromEntries(entries);
}

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createSnsMetricsStore({ url, key, fetchImpl = fetch }) {
  const call = createCall({ url, key, fetchImpl });
  return {
    dueJobs: (now, limit) => readDueJobs(call, now, limit),
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
    recentOutcomes: (now, days) => readRecentOutcomes(call, now, days),
  };
}
