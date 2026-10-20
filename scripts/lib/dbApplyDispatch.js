/**
 * db-apply の定期の突き合わせ（db-apply.yml の mode=reconcile）を Vercel Cron から起動する（ADR-0097、
 * docs/design/db-apply-automation-finish/plan.md §2）。起動は scripts/lib/analogyDispatch.js の部品を使う。
 *
 * 見張りの空振り（plan §2「見張りの空振り」）: dispatch は 204 を返すだけで、run が本当に動いたかは分からない
 * （REVIEWER_BOT_USER_ID が空で reconcile が skipped・queued のまま・承認待ちで run が in_progress のまま 等）。
 * そこで live の起動のたびに、起動の前に db-apply の直近の run と、その jobs を見て、
 * 「live の最初の起動から3時間を過ぎ、直近3時間に reconcile の job が success で終わった run が無い」なら
 * outcome:"error" を返す（起動はする）。run の結論ではなく job で数える（reconcile が skipped の run も success になり、
 * 承認待ちの run は reconcile が終わっていても in_progress のままのため）。
 *
 * 「live の最初の起動」は scrape_job_state.last_report.liveSince に持つ（成功の記録のときだけ保存される。
 * 失敗の間は前の値が残る）。shadow の記録には持たせず、off から戻したとき（前の起動から2.5時間より空いた）も数え直す。トークンは dispatch と同じ GITHUB_ACTIONS_DISPATCH_TOKEN（Actions: Read で runs・jobs を読める）。
 */
import {
  GITHUB_REPO,
  createAnalogyDispatchRun,
  githubHeaders,
} from "./analogyDispatch.js";

export const DB_APPLY_WORKFLOW = "db-apply.yml";
export const STALE_AFTER_MS = 3 * 3600 * 1000;
// 毎時の起動で、これより前の起動が空いていたら止まっていたとみなす（Vercel Cron の1回の抜けは許す）
export const RESTART_AFTER_MS = 2.5 * 3600 * 1000;
// 3時間の run は dispatch 3本＋予備の schedule 3本＋手での起動で、普段は10本に届かない
const RUNS_PER_PAGE = 30;

const ghGet = async ({ fetchImpl, token, url }) => {
  const res = await fetchImpl(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${url} が HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
};

/**
 * 直近の窓（since 以降）に、reconcile の job が success で終わった db-apply の run があるか
 * @returns {Promise<{found: boolean, runsChecked: number}>}
 */
export async function findRecentReconcileSuccess({ fetchImpl, token, since }) {
  const base = `https://api.github.com/repos/${GITHUB_REPO}/actions`;
  const sinceIso = since.toISOString();
  const { workflow_runs: runs = [] } = await ghGet({
    fetchImpl,
    token,
    url: `${base}/workflows/${DB_APPLY_WORKFLOW}/runs?created=${encodeURIComponent(`>=${sinceIso}`)}&per_page=${RUNS_PER_PAGE}`,
  });
  let runsChecked = 0;
  for (const run of runs) {
    runsChecked++;
    const { jobs = [] } = await ghGet({
      fetchImpl,
      token,
      url: `${base}/runs/${run.id}/jobs?per_page=100`,
    });
    const ok = jobs.some(
      (j) =>
        j.name === "reconcile" &&
        j.conclusion === "success" &&
        j.completed_at &&
        new Date(j.completed_at) >= since,
    );
    if (ok) return { found: true, runsChecked };
  }
  return { found: false, runsChecked };
}

/**
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [deps]
 */
export function createDbApplyDispatchRun({
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const dispatch = createAnalogyDispatchRun("db_apply_reconcile", {
    fetchImpl,
    env,
  });
  return async (ctx) => {
    if (ctx.mode !== "live") return dispatch(ctx);
    const now = ctx.now();
    // off の間は起動の記録（last_tick_at）も last_report も更新されない。前の起動から RESTART_AFTER_MS より空いたら
    // （off から戻した等）live の最初の起動を今にして、3時間を数え直す。失敗が続く間も毎時の起動で last_tick_at は進む
    const prevSince = Date.parse(ctx.state?.last_report?.liveSince ?? "");
    const prevTick = Date.parse(ctx.state?.last_tick_at ?? "");
    const resumed =
      !Number.isFinite(prevTick) || now.getTime() - prevTick > RESTART_AFTER_MS;
    const liveSince =
      Number.isFinite(prevSince) && !resumed ? new Date(prevSince) : now;

    // 見張り。起動の前に見る（今回の起動の run はまだ数えない）。読めなくても起動は続け、失敗として返す
    let watch;
    if (now.getTime() - liveSince.getTime() < STALE_AFTER_MS) {
      watch = { checked: false, reason: "live の最初の起動から3時間以内" };
    } else if (!env.GITHUB_ACTIONS_DISPATCH_TOKEN) {
      watch = { checked: false };
    } else {
      try {
        const r = await findRecentReconcileSuccess({
          fetchImpl,
          token: env.GITHUB_ACTIONS_DISPATCH_TOKEN,
          since: new Date(now.getTime() - STALE_AFTER_MS),
        });
        watch = { checked: true, ...r };
      } catch (error) {
        watch = { checked: false, error: error.message };
      }
    }

    const result = await dispatch(ctx);
    if (result.outcome === "error") return result;

    if (watch.error) {
      return {
        outcome: "error",
        error: `起動はしたが、db-apply の run を読めず見張れなかった: ${watch.error}`,
      };
    }
    if (watch.checked && !watch.found) {
      return {
        outcome: "error",
        error:
          "起動はしたが、直近3時間に db-apply の reconcile の job が success で終わった run が無い" +
          `（${watch.runsChecked} 本を確認）。skipped（REVIEWER_BOT_USER_ID）・queued のまま・起動の失敗を疑う`,
      };
    }
    const report = {
      ...result.report,
      liveSince: liveSince.toISOString(),
      watch,
    };
    return { ...result, report, body: { ...result.body, watch } };
  };
}
