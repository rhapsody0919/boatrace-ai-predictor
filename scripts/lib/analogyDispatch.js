/**
 * BOA-271 アナロジー・ファインダー: GitHub Actions の workflow_dispatch を Vercel Cron から起動する（学習側 T10-7）。
 * GitHub Actions の schedule は遅れ・欠落が常態なので使わない（train-analogy.yml の冒頭と同じ判断）。
 *
 * - train: 週次の学習（train-analogy.yml）。日曜 JST 4:00
 * - v16_morning: v16 の朝のバッチ（analogy-v16-morning.yml、BOA-271 T2-5b）。JST 7:10・9:40・13:40 に起動し、
 *   7:40 は出走表の段（racecard の snapshot）が無い今日のレースがあるときだけ起動する（拾い直し。plan「朝のバッチ」）
 * レースごとの寄与度の日次の特徴量ジョブは廃止した（Q2、#1242）ので起動しない。
 *
 * 失敗（トークン未設定・dispatch の HTTP 失敗）は outcome:"error" で返す。レジストリの failureAlertAfter: 1 により、
 * scrape-monitor が1回目の失敗から Slack に出す。shadow は起動せず、起動するはずだったかだけを返す。
 */
export const GITHUB_REPO = "rhapsody0919/boatrace-ai-predictor";

export const DISPATCH_WORKFLOWS = Object.freeze({
  // inputs は workflow の on.workflow_dispatch.inputs に無いキーを入れると 422 になる
  train: { workflow: "train-analogy.yml", inputs: {} },
  v16_morning: { workflow: "analogy-v16-morning.yml", inputs: {} },
});

const MIN_MINUTES_BEFORE_DEADLINE = 10; // v16_morning.py の select_targets と同じ

/** JST の分（0〜1439） */
const jstMinutes = (d) => {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
};

/**
 * 朝のバッチの拾い直しが要るか（純粋関数）: 締切まで10分以上ある中止でない今日のレースのうち、racecard の snapshot が
 * 無いものがあるか
 * @param {{race_id:string, race_date:string, start_time:string|null, cancellation_status:string|null}[]} races
 * @param {Set<string>} withRacecard racecard の snapshot があるレース
 */
export function morningRetryNeeded(races, withRacecard, now) {
  return races.some((r) => {
    if (r.cancellation_status || !r.start_time) return false;
    const deadline = new Date(`${r.race_date}T${r.start_time}+09:00`);
    return (
      deadline.getTime() - now.getTime() >=
        MIN_MINUTES_BEFORE_DEADLINE * 60000 && !withRacecard.has(r.race_id)
    );
  });
}

/**
 * v16 の朝のバッチを起動するか。7:30〜7:50 の起動（7:40 の拾い直し）だけ、出走表の段が無いレースがあるか DB を見る。
 * ほかの起動は常に起動する（朝のバッチ自身が、作り直すレースを選ぶ）
 * @returns {Promise<{dispatch:boolean, reason:string}>}
 */
export async function morningShouldDispatch(ctx) {
  const now = ctx.now();
  const m = jstMinutes(now);
  if (m < 7 * 60 + 30 || m >= 7 * 60 + 50)
    return { dispatch: true, reason: "定時" };
  const date = new Date(now.getTime() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data: races } = await ctx.client
    .from("races")
    .select("race_id,race_date,start_time,cancellation_status")
    .eq("race_date", date)
    .throwOnError();
  const { data: snaps } = await ctx.client
    .from("analogy_v16_snapshots")
    .select("race_id")
    .eq("stage", "racecard")
    .like("race_id", `${date}-%`)
    .throwOnError();
  const need = morningRetryNeeded(
    races ?? [],
    new Set((snaps ?? []).map((s) => s.race_id)),
    now,
  );
  return {
    dispatch: need,
    reason: need ? "出走表の段が無いレースがある" : "全レース作成済み",
  };
}

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
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>,
 *   shouldDispatch?: (ctx: object) => Promise<{dispatch: boolean, reason: string}>}} [deps]
 *   shouldDispatch を渡すと、起動の前に起動するかを決める（v16 の朝のバッチの 7:40 の拾い直し）
 */
export function createAnalogyDispatchRun(
  target,
  { fetchImpl = fetch, env = process.env, shouldDispatch = null } = {},
) {
  const def = DISPATCH_WORKFLOWS[target];
  if (!def) throw new Error(`不明な dispatch の対象: ${target}`);
  return async (ctx) => {
    const report = { target, workflow: def.workflow };
    if (shouldDispatch) {
      const decision = await shouldDispatch(ctx);
      report.reason = decision.reason;
      if (!decision.dispatch)
        return {
          rowsWritten: 0,
          report: { ...report, dispatched: false },
          body: { ...report, dispatched: false },
        };
    }
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
