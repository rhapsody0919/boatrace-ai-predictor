/**
 * 本番のデプロイをまとめて出す（ADR-0106、オーナー 2026-11-06 決定）。Vercel Cron（api/cron/release-dispatch.js）が
 * 1日3回の定時（JST 05:45・11:45・17:45）と、その20分後の拾い直し（UTC の分が30より前の起動。isFollowupTick）に呼ぶ。
 *
 * 1. master の先（GET /commits/master）と、今の本番の版（この関数が動いているデプロイの VERCEL_GIT_COMMIT_SHA）を
 *    compare API で比べる（比べる先は読んだ master の sha に固定する。比べている間に master が進んでもずれない）
 * 2. 差分が無い・サイトに関係ないものだけ（scripts/lib/vercelIgnoreBuild.js の isSiteIrrelevant）なら何もしない
 * 3. master の検査（Post-merge Checks・Quality Gates）を、出す範囲（本番の版の次〜master の先）のコミットの run で見る。
 *    範囲の中で走っている run（skipped を除く）が1本でもある・master の先が10分以内のコミットなら「待つ」
 *    （20分後の拾い直しでもう一度見る）。範囲の中で落ちた run は、落ちた step が後の run で走って通っていれば直ったとみる
 *    （summarizeGates）。直っていない step が残れば出さずに失敗（Slack）
 * 4. それ以外なら Deploy Hook（Vercel の環境変数 RELEASE_DEPLOY_HOOK_URL、master に結び付けたもの）を叩く
 *
 * 見張り（scrape_job_state.last_report に持つ。成功の記録のときだけ置き換わり、失敗の間は前の値が残る）:
 * - 前回の起動で叩いたのに本番の版がそのときのまま（ビルドの失敗か、出た後の Instant Rollback。区別できない）→ 叩かずに失敗。本番の版が動けば戻る
 * - 本番の版が、前に出した版（lastReleasedSha）より古い（Instant Rollback）→ 出さずに失敗。master を直して手で出すか、
 *   mode を off にするまで続ける（巻き戻した本番に、壊れた master を黙って出し直さない）
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
// compare API は files を300件まで返す。300件に達したら全部を見ていないのでビルドする側に倒す
export const COMPARE_FILES_CAP = 300;
// master の先がこれより新しいと、検査の run がまだ作られていないことがある
export const FRESH_HEAD_MS = 10 * 60 * 1000;
// 検査の run を読む本数。1日約59本の push で、2つの定時の間（最大12時間）を覆う
export const GATE_RUNS_PER_PAGE = 50;
export const REQUEST_TIMEOUT_MS = 15 * 1000;
// 出す範囲の一番古いコミットがこれより前なら、出すべき差分が出ないまま残っている（定時の間は最大約12時間）。
// shadow のまま live にし忘れた・待つが続く等を、mode に関わらず last_report.alerts で知らせる（monitor.js）
export const STALE_RELEASE_MS = 13 * 3600 * 1000;

/** 20分後の拾い直しの起動か（定時は UTC の45分、拾い直しは5分。vercel.json の cron は同じパス） */
export const isFollowupTick = (now) => now.getUTCMinutes() < 30;

/** 出すべき差分が長く残っているときの last_report.alerts（無ければ空） */
export function staleReleaseAlerts({ action, mode, oldestCommittedAt, now }) {
  const pendingRelease =
    action === "deferred" || (action === "release" && mode !== "live");
  const oldest = Date.parse(oldestCommittedAt ?? "");
  if (!pendingRelease || !Number.isFinite(oldest)) return [];
  const hours = (now.getTime() - oldest) / 3600000;
  if (now.getTime() - oldest < STALE_RELEASE_MS) return [];
  return [
    {
      key: "stale_release",
      text: `本番に出ていないサイトの差分が ${Math.floor(hours)} 時間残っている（${action}、mode=${mode}）。mode が live か、master の検査が終わるかを確かめる`,
    },
  ];
}

const API = `https://api.github.com/repos/${GITHUB_REPO}`;
const GREEN = new Set(["success", "neutral"]);

const BAD_STEP = new Set(["failure", "cancelled", "timed_out"]);

/**
 * 失敗した run の、失敗した（job・step）の組。step が分からない失敗は step を null にする
 * @param {{name: string, conclusion: string|null, steps?: {name: string, conclusion: string|null}[]}[]} jobs
 */
export function failedSteps(jobs) {
  return jobs
    .filter(
      (j) =>
        j.conclusion && !GREEN.has(j.conclusion) && j.conclusion !== "skipped",
    )
    .flatMap((j) => {
      const steps = (j.steps ?? []).filter((s) => BAD_STEP.has(s.conclusion));
      return steps.length > 0
        ? steps.map((s) => ({ job: j.name, step: s.name }))
        : [{ job: j.name, step: null }];
    });
}

/** 後の run の jobs で、その（job・step）が成功しているか（その step が実際に走って通った） */
const passedLater = (jobs, { job, step }) =>
  jobs.some(
    (j) =>
      j.name === job &&
      (step === null
        ? j.conclusion === "success"
        : (j.steps ?? []).some(
            (s) => s.name === step && s.conclusion === "success",
          )),
  );

/**
 * 検査の workflow ごとの、出す範囲の状態。
 * - 範囲の中で一番新しいコミットの run（skipped を除く）が走っている → pending
 * - 範囲の中の失敗した run の、失敗した step ごとに、後の run で同じ step が走って通っていれば直ったとみる。
 *   通っていない step が1つでも残れば red。後の run で step が飛ばされた（quality-gates の ml-tests は push の差分で
 *   走るかを決める）だけでは直ったとみない。失敗した run の jobs が読めていなければ red（安全側）
 * @param {string[]} rangeShas 本番の版の次〜master の先（古い順）
 * @param {{workflow: string, runs: {id: number, head_sha: string, status: string, conclusion: string|null}[]}[]} gateRuns
 * @param {Map<number, {name: string, conclusion: string|null, steps?: {name: string, conclusion: string|null}[]}[]>} jobsByRun
 * @returns {{workflow: string, state: "none"|"pending"|"green"|"red", conclusion?: string|null, headSha?: string, unresolved?: string[]}[]}
 */
export function summarizeGates(rangeShas, gateRuns, jobsByRun = new Map()) {
  const pos = new Map(rangeShas.map((sha, i) => [sha, i]));
  return gateRuns.map(({ workflow, runs }) => {
    const inRange = runs
      .filter((r) => pos.has(r.head_sha))
      .filter((r) => !(r.status === "completed" && r.conclusion === "skipped"))
      .sort((a, b) => pos.get(a.head_sha) - pos.get(b.head_sha));
    if (inRange.length === 0) return { workflow, state: "none" };
    const newest = inRange[inRange.length - 1];
    const newestSha = newest.head_sha;
    // 範囲の中で走っている run が1本でもあれば待つ（push の差分で走る step は、後の run の成功では代わらない。Codex の P1）
    const running = inRange.find((r) => r.status !== "completed");
    if (running) {
      return { workflow, state: "pending", headSha: running.head_sha };
    }
    for (const [i, run] of inRange.entries()) {
      if (run.status !== "completed" || GREEN.has(run.conclusion)) continue;
      const jobs = jobsByRun.get(run.id);
      if (!jobs) {
        return {
          workflow,
          state: "red",
          conclusion: run.conclusion,
          headSha: run.head_sha,
          unresolved: ["jobs を読めていない"],
        };
      }
      const later = inRange
        .slice(i + 1)
        .filter((r) => r.status === "completed");
      const unresolved = failedSteps(jobs).filter(
        (f) => !later.some((r) => passedLater(jobsByRun.get(r.id) ?? [], f)),
      );
      if (unresolved.length > 0) {
        return {
          workflow,
          state: "red",
          conclusion: run.conclusion,
          headSha: run.head_sha,
          unresolved: unresolved.map((f) =>
            f.step ? `${f.job} / ${f.step}` : f.job,
          ),
        };
      }
    }
    return { workflow, state: "green", headSha: newestSha };
  });
}

/** jobs を読む run（範囲の中で最初の失敗の run とその後の completed の run）。多すぎるときは読まない（red に倒れる） */
export const GATE_JOBS_READ_CAP = 20;
export function runsNeedingJobs(rangeShas, gateRuns) {
  const pos = new Map(rangeShas.map((sha, i) => [sha, i]));
  return gateRuns.flatMap(({ runs }) => {
    const inRange = runs
      .filter(
        (r) =>
          pos.has(r.head_sha) &&
          r.status === "completed" &&
          r.conclusion !== "skipped",
      )
      .sort((a, b) => pos.get(a.head_sha) - pos.get(b.head_sha));
    const firstBad = inRange.findIndex((r) => !GREEN.has(r.conclusion));
    return firstBad < 0 ? [] : inRange.slice(firstBad).map((r) => r.id);
  });
}

/**
 * 出すかどうか（純関数）
 * @param {{
 *   deployedSha: string,
 *   head: {sha: string, committedAt: string},
 *   compare: {status: string, files: {filename: string, previous_filename?: string}[], commitShas: string[]},
 *   gates: ReturnType<typeof summarizeGates>,
 *   previous: {released?: boolean, fromSha?: string, lastReleasedSha?: string} | null,
 *   now: Date,
 * }} input
 * @returns {{action: "none"|"release"|"deferred"|"blocked"|"error", reason: string, stuck: boolean}}
 */
export function decideRelease({
  deployedSha,
  head,
  compare,
  gates,
  previous,
  now,
}) {
  // 前回叩いたのに本番の版が動いていない
  const stuck = Boolean(
    previous?.released && previous.fromSha && previous.fromSha === deployedSha,
  );
  const result = (action, reason) => ({ action, reason, stuck });

  if (compare.status === "identical") {
    return result("none", "本番は master の先と同じ");
  }
  if (compare.status !== "ahead") {
    // behind・diverged: 本番の版が master に無い（force push・別の枝から出した 等）。黙って上書きしない
    return result(
      "error",
      `本番の版 ${deployedSha.slice(0, 9)} が master の祖先ではない（compare の status: ${compare.status}）`,
    );
  }
  if (stuck) {
    // ビルドの失敗と、出た後の Instant Rollback（A→B を出した後に A へ戻した）は、本番の版だけでは区別できない。
    // 戻した本番に壊れた版を出し直さないよう、自動では叩かない。本番の版が動けば（手で出す等）自動に戻る
    return result(
      "error",
      `前回叩いた版（${previous.masterSha?.slice(0, 9) ?? "?"}）が本番に出ていない（本番の版は ${deployedSha.slice(0, 9)} のまま）。` +
        "ビルドの失敗か、出た後の Instant Rollback。自動では出し直さない。Vercel で確かめ、直したら手で出す（ADR-0106「手で出す」）",
    );
  }
  if (
    previous?.lastReleasedSha &&
    compare.commitShas.includes(previous.lastReleasedSha)
  ) {
    return result(
      "error",
      `本番の版 ${deployedSha.slice(0, 9)} が前に出した版 ${previous.lastReleasedSha.slice(0, 9)} より古い（Instant Rollback？）。` +
        "巻き戻した本番に master を出し直さない。master を直して手で出すか、release_dispatch の mode を off にする",
    );
  }
  const paths = compare.files.flatMap((f) =>
    f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
  );
  const capped = compare.files.length >= COMPARE_FILES_CAP;
  if (!capped && paths.every(isSiteIrrelevant)) {
    // 変更が打ち消し合って files が空のときも含む（中身が同じ木を出し直さない）
    return result(
      "none",
      paths.length === 0
        ? "差分のファイルが無い（変更と戻しが打ち消し合った 等）"
        : `サイトに関係ない差分だけ（${paths.length}件）`,
    );
  }
  if (now.getTime() - Date.parse(head.committedAt) < FRESH_HEAD_MS) {
    return result(
      "deferred",
      `master の先 ${head.sha.slice(0, 9)} が10分以内のコミット（検査の run がまだ無いことがある）`,
    );
  }
  const red = gates.filter((g) => g.state === "red");
  if (red.length > 0) {
    return result(
      "blocked",
      `master の検査が通っていない: ${red.map((g) => `${g.workflow}=${g.conclusion}（${g.headSha.slice(0, 9)}${g.unresolved?.length ? `、${g.unresolved.join("・")}` : ""}）`).join(", ")}`,
    );
  }
  const pending = gates.filter((g) => g.state === "pending");
  if (pending.length > 0) {
    return result(
      "deferred",
      `master の検査が走っている: ${pending.map((g) => `${g.workflow}（${g.headSha.slice(0, 9)}）`).join(", ")}`,
    );
  }
  return result(
    "release",
    capped
      ? `差分が ${COMPARE_FILES_CAP} 件以上（全部は見ていない）`
      : `サイトに関わる差分がある（${paths.length}件）`,
  );
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

/** master の先の sha とコミットの時刻 */
export async function fetchMasterHead({ fetchImpl, token }) {
  const body = await ghGet({ fetchImpl, token, url: `${API}/commits/master` });
  return {
    sha: body.sha,
    committedAt: body.commit?.committer?.date ?? body.commit?.author?.date,
  };
}

/** 本番の版から master の先までの差分（commits は既定で250件まで。files は300件まで） */
export async function fetchCompare({ fetchImpl, token, deployedSha, headSha }) {
  const body = await ghGet({
    fetchImpl,
    token,
    url: `${API}/compare/${deployedSha}...${headSha}`,
  });
  return {
    status: body.status,
    files: body.files ?? [],
    commitShas: (body.commits ?? []).map((c) => c.sha),
    oldestCommittedAt: body.commits?.[0]?.commit?.committer?.date ?? null,
  };
}

/** 検査の workflow ごとの、master の push の直近の run（走っているものを含む） */
export async function fetchGateRuns({ fetchImpl, token }) {
  return Promise.all(
    RELEASE_GATE_WORKFLOWS.map(async (workflow) => {
      const { workflow_runs: runs = [] } = await ghGet({
        fetchImpl,
        token,
        url: `${API}/actions/workflows/${workflow}/runs?branch=master&event=push&per_page=${GATE_RUNS_PER_PAGE}`,
      });
      return {
        workflow,
        runs: runs.map((r) => ({
          id: r.id,
          head_sha: r.head_sha,
          status: r.status,
          conclusion: r.conclusion,
        })),
      };
    }),
  );
}

/** 失敗を含む範囲の run の jobs（step の結論つき）。GATE_JOBS_READ_CAP を超える分は読まない（summarizeGates で red に倒れる） */
export async function fetchGateJobs({ fetchImpl, token, runIds }) {
  const ids = [...new Set(runIds)].slice(0, GATE_JOBS_READ_CAP);
  const entries = await Promise.all(
    ids.map(async (id) => {
      const { jobs = [] } = await ghGet({
        fetchImpl,
        token,
        url: `${API}/actions/runs/${id}/jobs?per_page=100`,
      });
      return [
        id,
        jobs.map((j) => ({
          name: j.name,
          conclusion: j.conclusion,
          steps: (j.steps ?? []).map((s) => ({
            name: s.name,
            conclusion: s.conclusion,
          })),
        })),
      ];
    }),
  );
  return new Map(entries);
}

/**
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [deps]
 */
export function createReleaseDispatchRun({
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  return async (ctx) => {
    const previous = ctx.state?.last_report ?? null;
    // 20分後の拾い直しは、定時が「待つ」で終わったときだけ動く。それ以外は前の記録をそのまま残す
    // （置き換えると、定時で叩いた記録が消えて次の定時で「出ていない」を見張れなくなる）
    if (isFollowupTick(ctx.now()) && previous?.action !== "deferred") {
      const report = { ...(previous ?? {}), followupSkipped: true };
      return {
        rowsWritten: 0,
        report,
        body: {
          followupSkipped: true,
          previousAction: previous?.action ?? null,
        },
      };
    }

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

    let head;
    let compare;
    let gateRuns;
    let jobsByRun;
    try {
      head = await fetchMasterHead({ fetchImpl, token });
      [compare, gateRuns] = await Promise.all([
        fetchCompare({ fetchImpl, token, deployedSha, headSha: head.sha }),
        fetchGateRuns({ fetchImpl, token }),
      ]);
      jobsByRun = await fetchGateJobs({
        fetchImpl,
        token,
        runIds: runsNeedingJobs(compare.commitShas, gateRuns),
      });
    } catch (error) {
      return { outcome: "error", error: `GitHub を読めない: ${error.message}` };
    }

    const gates = summarizeGates(compare.commitShas, gateRuns, jobsByRun);
    const decision = decideRelease({
      deployedSha,
      head,
      compare,
      gates,
      previous,
      now: ctx.now(),
    });
    const report = {
      deployedSha,
      masterSha: head.sha,
      status: compare.status,
      files: compare.files.length,
      gates,
      action: decision.action,
      reason: decision.reason,
      released: false,
      fromSha: deployedSha,
      lastReleasedSha: previous?.lastReleasedSha ?? null,
      alerts: staleReleaseAlerts({
        action: decision.action,
        mode: ctx.mode,
        oldestCommittedAt: compare.oldestCommittedAt,
        now: ctx.now(),
      }),
    };
    if (decision.action !== "release") {
      if (decision.action === "error" || decision.action === "blocked") {
        return { outcome: "error", error: decision.reason };
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
    const body = { ...report, released: true, lastReleasedSha: head.sha };
    return { rowsWritten: 0, report: body, body };
  };
}
