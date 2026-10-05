/**
 * BOA-271 アナロジー・ファインダー: GitHub Actions の workflow_dispatch を Vercel Cron から起動する（学習側 T10-7）。
 * GitHub Actions の schedule は遅れ・欠落が常態なので使わない（ADR-0080）。
 *
 * - train: 週次の学習（train-analogy.yml）。日曜 JST 4:00
 * v16 の朝のバッチ（v16_morning.yml）の起動は、その PR で DISPATCH_WORKFLOWS に足す（2026-10-05 オーケストレーター判断）。
 * レースごとの寄与度の日次の特徴量ジョブは廃止した（Q2、#1242）ので起動しない。
 *
 * 失敗（トークン未設定・dispatch の HTTP 失敗）は outcome:"error" で返す。レジストリの failureAlertAfter: 1 により、
 * scrape-monitor が1回目の失敗から Slack に出す。shadow は起動せず、起動するはずだったかだけを返す。
 */
export const GITHUB_REPO = "rhapsody0919/boatrace-ai-predictor";

export const DISPATCH_WORKFLOWS = Object.freeze({
  // inputs は workflow の on.workflow_dispatch.inputs に無いキーを入れると 422 になる
  train: { workflow: "train-analogy.yml", inputs: {} },
});

export async function dispatchWorkflow({ fetchImpl, token, workflow, inputs }) {
  const res = await fetchImpl(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "master", inputs }),
    },
  );
  // 成功は 204（本文なし）。2xx 以外は失敗
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${workflow} の dispatch が HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * @param {keyof typeof DISPATCH_WORKFLOWS} target
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [deps]
 */
export function createAnalogyDispatchRun(
  target,
  { fetchImpl = fetch, env = process.env } = {},
) {
  const def = DISPATCH_WORKFLOWS[target];
  if (!def) throw new Error(`不明な dispatch の対象: ${target}`);
  return async (ctx) => {
    const report = { target, workflow: def.workflow };
    if (ctx.mode !== "live") {
      return {
        rowsWritten: 0,
        report: { ...report, dispatched: false, wouldDispatch: true },
        body: { ...report, wouldDispatch: true },
      };
    }
    const token = env.GITHUB_ACTIONS_DISPATCH_TOKEN;
    if (!token) {
      return {
        outcome: "error",
        error: "GITHUB_ACTIONS_DISPATCH_TOKEN が未設定（Vercel の環境変数）",
      };
    }
    try {
      await dispatchWorkflow({
        fetchImpl,
        token,
        workflow: def.workflow,
        inputs: def.inputs,
      });
    } catch (error) {
      return { outcome: "error", error: error.message };
    }
    return {
      rowsWritten: 0,
      report: { ...report, dispatched: true },
      body: { ...report, dispatched: true },
    };
  };
}
