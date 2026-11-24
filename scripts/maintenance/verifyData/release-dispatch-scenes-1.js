/**
 * verify-release-dispatch.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-release-dispatch.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  summarizeGates,
  RELEASE_HOOK_ENV,
  createReleaseDispatchRun,
  RELEASE_GATE_WORKFLOWS,
} from "../../lib/releaseDispatch.js";

let check, DEPLOYED, HEAD, MID, NOW, OLD_HEAD;
export let ENV, FOLLOWUP_NOW;

// ---------------------------------------------------------------- (c)
export function fakeGitHub({
  compare = {
    status: "ahead",
    files: [{ filename: "src/App.jsx" }],
    commits: [
      {
        sha: MID,
        commit: { committer: { date: "2026-11-06T09:00:00+09:00" } },
      },
      {
        sha: HEAD,
        commit: { committer: { date: "2026-11-06T10:00:00+09:00" } },
      },
    ],
  },
  gateConclusion = "success",
  hookStatus = 201,
  compareStatus = 200,
} = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const reply = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (url.endsWith("/commits/master"))
      return reply(200, {
        sha: HEAD,
        commit: { committer: { date: OLD_HEAD.committedAt } },
      });
    if (url.includes("/compare/")) return reply(compareStatus, compare);
    // 範囲の赤を解く全件の run（releaseFullCheck.js）。検査が赤の場面は、全件の run も同じ版で失敗している
    // （無いと release-dispatch が全件の検査を起こして「待つ」になる。起こす場面は scenes-3）
    if (
      url.includes("/actions/workflows/") &&
      url.includes("event=workflow_dispatch")
    )
      return reply(200, {
        workflow_runs: [
          {
            id: 98,
            event: "workflow_dispatch",
            head_branch: "master",
            head_sha: HEAD,
            status: "completed",
            conclusion: gateConclusion,
            display_title: `Quality Gates 全件 base=${DEPLOYED}`,
            html_url: "https://github.com/runs/98",
          },
        ],
      });
    if (url.includes("/actions/workflows/"))
      return reply(200, {
        workflow_runs: [
          {
            id: 99,
            head_sha: HEAD,
            status: "completed",
            conclusion: gateConclusion,
          },
        ],
      });
    if (url.includes("/actions/runs/99/jobs"))
      return reply(200, {
        jobs: [
          {
            name: "verify",
            conclusion: gateConclusion,
            steps: [
              { name: "Run CI-tier verifications", conclusion: gateConclusion },
            ],
          },
        ],
      });
    if (url === "https://hook.example/deploy") return reply(hookStatus, {});
    return reply(404, { message: "Not Found" });
  };
  f.calls = calls;
  return f;
}

export const ctx = (mode, last_report = null, now = NOW) => ({
  mode,
  state: { last_report },
  now: () => now,
});

export const hookCalls = (f) =>
  f.calls.filter((c) => c.url === "https://hook.example/deploy");

export const runWith = (f, c, env = ENV) =>
  createReleaseDispatchRun({ fetchImpl: f, env })(c);

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
  const range = [MID, HEAD];
  const ids = { [MID]: 1, [HEAD]: 2, [DEPLOYED]: 3 };
  const run = (head_sha, status, conclusion) => ({
    id: ids[head_sha],
    head_sha,
    status,
    conclusion,
  });
  const job = (name, conclusion, steps) => ({
    name,
    conclusion,
    steps: Object.entries(steps).map(([n, c]) => ({ name: n, conclusion: c })),
  });
  // quality-gates の MID で pytest が落ち、HEAD では ml-tests の pytest が push の差分で飛ばされた（Codex の P1）
  const mlFailed = new Map([
    [
      1,
      [
        job("verify", "success", { "Run CI-tier verifications": "success" }),
        job("ml-tests", "failure", {
          "pytest (scripts/ml/analogy/tests)": "failure",
        }),
      ],
    ],
    [
      2,
      [
        job("verify", "success", { "Run CI-tier verifications": "success" }),
        job("ml-tests", "success", {
          "pytest (scripts/ml/analogy/tests)": "skipped",
        }),
      ],
    ],
  ]);
  const [mlStill] = summarizeGates(
    range,
    [
      {
        workflow: "quality-gates.yml",
        runs: [
          run(HEAD, "completed", "success"),
          run(MID, "completed", "failure"),
        ],
      },
    ],
    mlFailed,
  );
  check(
    mlStill.state === "red" &&
      mlStill.headSha === MID,
    "(b) 後の run が成功でも、範囲の前の方の失敗（ml-tests の pytest）は解かない",
    JSON.stringify(mlStill),
  );
  const mlFixed = new Map(mlFailed);
  mlFixed.set(2, [
    job("verify", "success", { "Run CI-tier verifications": "success" }),
    job("ml-tests", "success", {
      "pytest (scripts/ml/analogy/tests)": "success",
    }),
  ]);
  const [mlOk] = summarizeGates(
    range,
    [
      {
        workflow: "quality-gates.yml",
        runs: [
          run(HEAD, "completed", "success"),
          run(MID, "completed", "failure"),
        ],
      },
    ],
    mlFixed,
  );
  check(
    mlOk.state === "red" && mlOk.headSha === MID,
    "(b) 落ちた step が後の run で通っていても解かない（前処理だけが通って pytest が走らない組み合わせがある。Codex の P1）",
    JSON.stringify(mlOk),
  );
  return { range, run, job };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ range, run, job }) {
  const [qg] = summarizeGates(range, [
    {
      workflow: "quality-gates.yml",
      runs: [
        run(HEAD, "completed", "skipped"),
        run(MID, "completed", "failure"),
      ],
    },
  ]);
  check(
    qg.state === "red" && qg.headSha === MID,
    "(b) [automated] の skipped の run が後に来ても、その前の PR の失敗を見る",
    JSON.stringify(qg),
  );
  const pmc = (c) => [job("check", c, { Build: c })];
  const [fixed] = summarizeGates(
    range,
    [
      {
        workflow: "post-merge-checks.yml",
        runs: [
          run(HEAD, "completed", "success"),
          run(MID, "completed", "failure"),
        ],
      },
    ],
    new Map([
      [1, pmc("failure")],
      [2, pmc("success")],
    ]),
  );
  check(
    fixed.state === "red",
    "(b) 範囲の中に失敗した run が1本でもあれば red（解けるのは再実行で通したときか、手で出したとき）",
    JSON.stringify(fixed),
  );
  const [noJobs] = summarizeGates(range, [
    {
      workflow: "post-merge-checks.yml",
      runs: [
        run(HEAD, "completed", "success"),
        run(MID, "completed", "failure"),
      ],
    },
  ]);
  check(
    noJobs.state === "red",
    "(b) 失敗した run があれば jobs を読まずに red",
    JSON.stringify(noJobs),
  );
  const [running] = summarizeGates(range, [
    {
      workflow: "post-merge-checks.yml",
      runs: [run(HEAD, "in_progress", null), run(MID, "completed", "success")],
    },
  ]);
  const [uncovered] = summarizeGates(range, [
    {
      workflow: "quality-gates.yml",
      runs: [run(HEAD, "completed", "success")],
      covered: false,
    },
  ]);
  check(
    uncovered.state === "red",
    "(b) 読んだ run が範囲の一番古いコミットまで届いていなければ red（止まっている間に push が溜まった。Codex の P1）",
    JSON.stringify(uncovered),
  );
  const [olderRunning] = summarizeGates(range, [
    {
      workflow: "quality-gates.yml",
      runs: [run(HEAD, "completed", "success"), run(MID, "in_progress", null)],
    },
  ]);
  return { range, run, running, olderRunning };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ range, run, running, olderRunning }) {
  check(
    olderRunning.state === "pending" && olderRunning.headSha === MID,
    "(b) 範囲の前の方の run が走っていれば、後の run が成功でも pending（push の差分で走る pytest は代わらない。Codex の P1）",
    JSON.stringify(olderRunning),
  );
  check(
    running.state === "pending",
    "(b) 一番新しいコミットの run が走っていれば pending",
    JSON.stringify(running),
  );
  const [outside] = summarizeGates(range, [
    {
      workflow: "quality-gates.yml",
      runs: [run(DEPLOYED, "completed", "failure")],
    },
  ]);
  check(
    outside.state === "none",
    "(b) 出す範囲の外（今の本番の版以前）の run は見ない",
    JSON.stringify(outside),
  );
  const [cancelled] = summarizeGates(range, [
    {
      workflow: "post-merge-checks.yml",
      runs: [run(HEAD, "completed", "cancelled")],
    },
  ]);
  check(
    cancelled.state === "red",
    "(b) cancelled・timed_out も通っていないとみる（出さない）",
  );
}

async function scene4() {
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
  ENV = {
    VERCEL_GIT_COMMIT_SHA: DEPLOYED,
    GITHUB_ACTIONS_DISPATCH_TOKEN: "test-token",
    [RELEASE_HOOK_ENV]: "https://hook.example/deploy",
  };
  // 拾い直しの起動（UTC 03:05 = JST 12:05）。定時の NOW は UTC 02:45
  FOLLOWUP_NOW = new Date("2026-11-06T12:05:00+09:00");
  {
    const f = fakeGitHub();
    const r = await runWith(f, ctx("live"));
    const compareCall = f.calls.find((c) => c.url.includes("/compare/"));
    check(
      r.report?.released === true &&
        r.report.fromSha === DEPLOYED &&
        r.report.masterSha === HEAD &&
        r.report.lastReleasedSha === HEAD &&
        hookCalls(f).length === 1 &&
        hookCalls(f)[0].init.method === "POST" &&
        compareCall.url.endsWith(`/compare/${DEPLOYED}...${HEAD}`) &&
        compareCall.init.headers.Authorization === "Bearer test-token",
      "(c) live: 本番の版...読んだ master の sha を比べ、Deploy Hook を POST し、出した記録（released・fromSha・lastReleasedSha）を返す",
      JSON.stringify(r),
    );
    const gateUrls = f.calls
      .filter((c) => c.url.includes("/actions/workflows/"))
      .map((c) => c.url);
    check(
      RELEASE_GATE_WORKFLOWS.every((w) =>
        gateUrls.some(
          (u) =>
            u.includes(`/actions/workflows/${w}/runs`) &&
            u.includes("branch=master") &&
            !u.includes("status=completed"),
        ),
      ),
      "(c) 検査は各 workflow の master の直近の run を、走っているものも含めて読む",
      JSON.stringify(gateUrls),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・DEPLOYED・HEAD・MID・NOW・OLD_HEAD） */
export async function runReleaseDispatchScenes1(env) {
  ({ check, DEPLOYED, HEAD, MID, NOW, OLD_HEAD } = env);
  await scene4();
}
