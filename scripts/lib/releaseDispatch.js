/**
 * 本番のデプロイをまとめて出す（ADR-0106、オーナー 2026-11-06 決定）。Vercel Cron（api/cron/release-dispatch.js）が
 * 1日3回（JST 05:45・11:45・17:45）呼ぶ。
 *
 * 1. 今の本番の版（この関数が動いているデプロイの VERCEL_GIT_COMMIT_SHA）と master の先を GitHub の compare API で比べる
 * 2. 差分が無い・サイトに関係ないものだけ（scripts/lib/vercelIgnoreBuild.js の isSiteIrrelevant）なら何もしない
 * 3. master の検査（Post-merge Checks・Quality Gates の最後に終わった run）が失敗していたら出さず、失敗を返す（赤い master を出さない）
 * 4. それ以外なら Deploy Hook（Vercel の環境変数 RELEASE_DEPLOY_HOOK_URL、master に結び付けたもの）を叩く。
 *    vercel.json の git.deploymentEnabled で master の push ごとのデプロイを止めた後は、これが本番を出す唯一の定時の経路
 *
 * 見張り: 前回の起動で Deploy Hook を叩いたのに、今の本番の版がそのときの版のまま（ビルドの失敗・Instant Rollback で自動の
 * 昇格が止まっている 等）なら、もう一度叩いた上で失敗を返す（failureAlertAfter 1 で Slack に出る）。前回の起動の記録は
 * scrape_job_state.last_report（成功の記録のときだけ置き換わる）に持つ。
 *
 * GitHub の読み取りは公開リポジトリの API を GITHUB_ACTIONS_DISPATCH_TOKEN（fine-grained PAT、Actions: Read and write）で読む。
 * fine-grained PAT は公開リポジトリを読めるので新しい鍵は作らない。
 */
import { GITHUB_REPO, githubHeaders } from "./analogyDispatch.js";
import { isSiteIrrelevant } from "./vercelIgnoreBuild.js";

export const RELEASE_HOOK_ENV = "RELEASE_DEPLOY_HOOK_URL";
// master への push で走り、失敗が「本番に出す前に止めるべき壊れ」を示す検査（ADR-0079・ADR-0072）
export const RELEASE_GATE_WORKFLOWS = Object.freeze([
  "post-merge-checks.yml",
  "quality-gates.yml",
]);
// compare API は1回に files を300件まで返す。300件に達したら全部を見ていないのでビルドする側に倒す
export const COMPARE_FILES_CAP = 300;
export const REQUEST_TIMEOUT_MS = 15 * 1000;

const API = `https://api.github.com/repos/${GITHUB_REPO}`;

/**
 * 出すかどうか（純関数）
 * @param {{
 *   deployedSha: string,
 *   compare: {status: string, files: {filename: string, previous_filename?: string}[], headSha: string},
 *   gates: {workflow: string, conclusion: string|null, headSha?: string}[],
 *   previous: {released?: boolean, fromSha?: string} | null,
 * }} input
 * @returns {{action: "none"|"release"|"blocked"|"error", reason: string, stuck?: boolean}}
 */
export function decideRelease({ deployedSha, compare, gates, previous }) {
  // 前回叩いたのに本番の版が動いていない。差分の有無に関わらず知らせる
  const stuck = Boolean(
    previous?.released && previous.fromSha && previous.fromSha === deployedSha,
  );
  if (compare.status === "identical") {
    return { action: "none", reason: "本番は master の先と同じ", stuck };
  }
  if (compare.status !== "ahead") {
    // behind・diverged: 本番の版が master に無い（force push・別の枝から出した 等）。黙って上書きしない
    return {
      action: "error",
      reason: `本番の版 ${deployedSha.slice(0, 9)} が master の祖先ではない（compare の status: ${compare.status}）`,
      stuck,
    };
  }
  const paths = compare.files.flatMap((f) =>
    f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
  );
  const capped = compare.files.length >= COMPARE_FILES_CAP;
  if (!capped && paths.length > 0 && paths.every(isSiteIrrelevant)) {
    return {
      action: "none",
      reason: `サイトに関係ない差分だけ（${paths.length}件）`,
      stuck,
    };
  }
  const red = gates.filter(
    (g) =>
      g.conclusion && !["success", "skipped", "neutral"].includes(g.conclusion),
  );
  if (red.length > 0) {
    return {
      action: "blocked",
      reason: `master の検査が通っていない: ${red.map((g) => `${g.workflow}=${g.conclusion}`).join(", ")}`,
      stuck,
    };
  }
  return {
    action: "release",
    reason: capped
      ? `差分が ${COMPARE_FILES_CAP} 件以上（全部は見ていない）`
      : `サイトに関わる差分がある（${paths.length}件）`,
    stuck,
  };
}

async function ghGet({ fetchImpl, token, url }) {
  const res = await fetchImpl(url, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${url} が HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** 本番の版から master の先までの差分 */
export async function fetchCompare({ fetchImpl, token, deployedSha }) {
  const body = await ghGet({
    fetchImpl,
    token,
    url: `${API}/compare/${deployedSha}...master?per_page=${COMPARE_FILES_CAP}`,
  });
  const commits = body.commits ?? [];
  return {
    status: body.status,
    files: body.files ?? [],
    headSha: commits.length > 0 ? commits[commits.length - 1].sha : deployedSha,
  };
}

/** 各検査の workflow の、master で最後に終わった run の結論 */
export async function fetchGates({ fetchImpl, token }) {
  return Promise.all(
    RELEASE_GATE_WORKFLOWS.map(async (workflow) => {
      const { workflow_runs: runs = [] } = await ghGet({
        fetchImpl,
        token,
        url: `${API}/actions/workflows/${workflow}/runs?branch=master&event=push&status=completed&per_page=1`,
      });
      return {
        workflow,
        conclusion: runs[0]?.conclusion ?? null,
        headSha: runs[0]?.head_sha,
      };
    }),
  );
}

/**
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [deps]
 */
export function createReleaseDispatchRun({
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  return async (ctx) => {
    const deployedSha = env.VERCEL_GIT_COMMIT_SHA;
    if (!deployedSha) {
      return {
        outcome: "error",
        error: "VERCEL_GIT_COMMIT_SHA が無い（今の本番の版が分からない）",
      };
    }
    const token = env.GITHUB_ACTIONS_DISPATCH_TOKEN;
    if (!token) {
      return {
        outcome: "error",
        error: "GITHUB_ACTIONS_DISPATCH_TOKEN が未設定（Vercel の環境変数）",
      };
    }

    let compare;
    let gates;
    try {
      [compare, gates] = await Promise.all([
        fetchCompare({ fetchImpl, token, deployedSha }),
        fetchGates({ fetchImpl, token }),
      ]);
    } catch (error) {
      return { outcome: "error", error: `GitHub を読めない: ${error.message}` };
    }

    const previous = ctx.state?.last_report ?? null;
    const decision = decideRelease({ deployedSha, compare, gates, previous });
    const report = {
      deployedSha,
      masterSha: compare.headSha,
      status: compare.status,
      files: compare.files.length,
      gates,
      action: decision.action,
      reason: decision.reason,
      released: false,
      fromSha: deployedSha,
    };
    const stuckMessage = `前回のリリース（${previous?.masterSha?.slice(0, 9) ?? "?"}）が本番に出ていない（本番の版は ${deployedSha.slice(0, 9)} のまま）。Vercel のビルドの失敗・Instant Rollback を疑う`;

    if (decision.action === "error" || decision.action === "blocked") {
      return {
        outcome: "error",
        error: decision.stuck
          ? `${decision.reason}。${stuckMessage}`
          : decision.reason,
      };
    }
    if (decision.action === "none") {
      if (decision.stuck && compare.status !== "identical") {
        // ここには来ない想定（叩いた後に差分がサイトに関係ないものだけに減ることは無い）が、念のため知らせる
        return { outcome: "error", error: stuckMessage };
      }
      return { rowsWritten: 0, report, body: report };
    }

    if (ctx.mode !== "live") {
      const body = { ...report, wouldRelease: true };
      return { rowsWritten: 0, report: body, body };
    }
    const hook = env[RELEASE_HOOK_ENV];
    if (!hook) {
      return {
        outcome: "error",
        error: `${RELEASE_HOOK_ENV} が未設定（Vercel の環境変数）。出すべき差分があるのに出せない`,
      };
    }
    try {
      const res = await fetchImpl(hook, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (error) {
      return {
        outcome: "error",
        error: `Deploy Hook を叩けない: ${error.message}`,
      };
    }
    if (decision.stuck) {
      // 叩き直した上で、前回が出なかったことを知らせる（成功の記録にしないので last_report は前回のまま残る）
      return {
        outcome: "error",
        error: `${stuckMessage}。もう一度 Deploy Hook を叩いた`,
      };
    }
    const body = { ...report, released: true };
    return { rowsWritten: 0, report: body, body };
  };
}
