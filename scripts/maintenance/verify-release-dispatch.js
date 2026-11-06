/**
 * 本番のデプロイをまとめて出す定時の起動（scripts/lib/releaseDispatch.js、ADR-0106）の検証。GitHub・Vercel・DB には繋がない（偽の fetch）。
 *
 *   (a) 判定（decideRelease）: 同じ・サイトに関係ない差分だけ・files が空なら何もしない（リネームは旧パスも見る）／
 *       300件以上は全部見ていないので出す／master の先が10分以内なら待つ／検査が赤なら止める・走っていれば待つ／
 *       本番の版が master の祖先でなければ失敗／前に出した版より本番が古い（Instant Rollback）なら失敗／
 *       前回叩いたのに本番の版が動いていなければ stuck
 *   (b) 検査の読み方（summarizeGates）: 出す範囲の run（skipped を除く）を見る。[automated] の skipped の run が後に来ても、
 *       その前の PR の失敗を素通しにしない。落ちた step が後の run で走って通っていれば直ったとみ、飛ばされただけ
 *       （ml-tests の pytest）では直ったとみない。jobs を読めなければ red。範囲の外の run は見ない
 *   (c) 起動（createReleaseDispatchRun）: shadow は叩かない、live は Deploy Hook を POST、鍵・版・Hook が無い・HTTP 失敗は失敗、
 *       stuck は叩かずに失敗（巻き戻しと区別できない）、出した記録（released・fromSha・lastReleasedSha）を返す、比べる先は読んだ master の sha、
 *       拾い直し（UTC の分が30より前の起動）は前が「待つ」のときだけ動き、それ以外は前の記録を残す、出すべき差分が13時間残れば alerts
 *   (d) 死活（monitor.js）: livenessStaleMin のある monitor のジョブは shadow・live の間だけ last_tick_at を見る
 *   (e) 配線: レジストリ、api/cron の maxDuration とモードのゲート、vercel.json の cron（定時と20分後の拾い直し）
 *
 * 使い方: node scripts/maintenance/verify-release-dispatch.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPARE_FILES_CAP,
  RELEASE_GATE_WORKFLOWS,
  RELEASE_HOOK_ENV,
  STALE_RELEASE_MS,
  GATE_RUNS_PER_PAGE,
  createReleaseDispatchRun,
  decideRelease,
  fetchCompare,
  fetchGateRuns,
  staleReleaseAlerts,
  summarizeGates,
} from "../lib/releaseDispatch.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { evaluateJobStates } from "../lib/scrapeJobs/monitor.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DEPLOYED = "a".repeat(40);
const HEAD = "b".repeat(40);
const MID = "c".repeat(40);
const NOW = new Date("2026-11-06T11:45:00+09:00");
const OLD_HEAD = { sha: HEAD, committedAt: "2026-11-06T10:00:00+09:00" };
const green = RELEASE_GATE_WORKFLOWS.map((workflow) => ({
  workflow,
  state: "green",
  headSha: HEAD,
}));
const ahead = (files, commitShas = [MID, HEAD]) => ({
  status: "ahead",
  files: files.map((f) => (typeof f === "string" ? { filename: f } : f)),
  commitShas,
});

// ---------------------------------------------------------------- (a)
{
  const base = {
    deployedSha: DEPLOYED,
    head: OLD_HEAD,
    gates: green,
    previous: null,
    now: NOW,
  };
  const d = (over) => decideRelease({ ...base, ...over });

  check(
    d({ compare: { status: "identical", files: [], commitShas: [] } })
      .action === "none",
    "(a) 本番が master の先と同じなら何もしない",
  );
  check(
    d({ compare: ahead(["docs/a.md", "data/analysis/x.json", "README.md"]) })
      .action === "none",
    "(a) サイトに関係ない差分（docs・data/analysis・ルートの .md）だけなら何もしない",
  );
  check(
    d({ compare: ahead([]) }).action === "none",
    "(a) ahead でも files が空（変更と戻しが打ち消し合った）なら何もしない",
  );
  check(
    d({ compare: ahead(["docs/a.md", "src/App.jsx"]) }).action === "release",
    "(a) サイトに関わる差分（src/）が1つでもあれば出す",
  );
  check(
    d({
      compare: ahead([
        { filename: "docs/moved.js", previous_filename: "src/moved.js" },
      ]),
    }).action === "release",
    "(a) サイトのファイルを除外の場所へ移すだけのリネームは旧パスで出す",
  );
  check(
    d({
      compare: ahead(
        Array.from({ length: COMPARE_FILES_CAP }, (_, i) => `docs/${i}.md`),
      ),
    }).action === "release",
    `(a) 差分が ${COMPARE_FILES_CAP} 件以上なら全部は見ていないので出す`,
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      head: { sha: HEAD, committedAt: "2026-11-06T11:40:00+09:00" },
    }).action === "deferred",
    "(a) master の先が10分以内のコミットなら待つ（検査の run がまだ無いことがある）",
  );
  const blocked = d({
    compare: ahead(["src/App.jsx"]),
    gates: [
      {
        workflow: "post-merge-checks.yml",
        state: "red",
        conclusion: "failure",
        headSha: MID,
      },
      { workflow: "quality-gates.yml", state: "green", headSha: HEAD },
    ],
  });
  check(
    blocked.action === "blocked" &&
      blocked.reason.includes("post-merge-checks.yml=failure"),
    "(a) master の検査が赤なら出さない（理由に workflow と結論）",
    JSON.stringify(blocked),
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      gates: [
        { workflow: "post-merge-checks.yml", state: "pending", headSha: HEAD },
        { workflow: "quality-gates.yml", state: "none" },
      ],
    }).action === "deferred",
    "(a) 検査が走っていれば待つ。範囲に run が無い検査では止めない",
  );
  check(
    d({ compare: { status: "diverged", files: [], commitShas: [] } }).action ===
      "error" &&
      d({ compare: { status: "behind", files: [], commitShas: [] } }).action ===
        "error",
    "(a) 本番の版が master の祖先でない（diverged・behind）なら失敗",
  );
  const rolled = d({
    compare: ahead(["src/App.jsx"]),
    previous: { released: false, fromSha: MID, lastReleasedSha: MID },
  });
  check(
    rolled.action === "error" && rolled.reason.includes("Instant Rollback"),
    "(a) 本番の版が前に出した版より古い（前に出した版が出す範囲に入っている）なら出さずに失敗",
    JSON.stringify(rolled),
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      previous: { released: false, fromSha: MID, lastReleasedSha: DEPLOYED },
    }).action === "release",
    "(a) 前に出した版が本番そのもの（範囲の外）なら巻き戻しと見ない",
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      previous: { released: true, fromSha: DEPLOYED, lastReleasedSha: HEAD },
    }).stuck === true &&
      d({
        compare: ahead(["src/App.jsx"]),
        previous: { released: true, fromSha: MID },
      }).stuck === false &&
      d({
        compare: ahead(["src/App.jsx"]),
        previous: { released: false, fromSha: DEPLOYED },
      }).stuck === false,
    "(a) 前回叩いて本番の版がそのときのままなら stuck（巻き戻しより先に判定）。版が動いた・前回叩いていないなら stuck でない",
  );
}

// ---------------------------------------------------------------- (b)
{
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
      mlStill.headSha === MID &&
      mlStill.unresolved?.[0]?.includes("pytest"),
    "(b) 後の run が成功でも、落ちた step（ml-tests の pytest）が後で走って通っていなければ直ったとみない",
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
    mlOk.state === "green",
    "(b) 落ちた step が後の run で走って通っていれば直ったとみる",
    JSON.stringify(mlOk),
  );
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
    fixed.state === "green",
    "(b) 落ちた step（木の全体を見るビルド）が後の run で通っていれば、前の失敗は直っているとみる",
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
    "(b) 失敗した run の jobs を読めていなければ red（安全側）",
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

// ---------------------------------------------------------------- (c)
function fakeGitHub({
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
const ENV = {
  VERCEL_GIT_COMMIT_SHA: DEPLOYED,
  GITHUB_ACTIONS_DISPATCH_TOKEN: "test-token",
  [RELEASE_HOOK_ENV]: "https://hook.example/deploy",
};
// 拾い直しの起動（UTC 03:05 = JST 12:05）。定時の NOW は UTC 02:45
const FOLLOWUP_NOW = new Date("2026-11-06T12:05:00+09:00");
const ctx = (mode, last_report = null, now = NOW) => ({
  mode,
  state: { last_report },
  now: () => now,
});
const hookCalls = (f) =>
  f.calls.filter((c) => c.url === "https://hook.example/deploy");
const runWith = (f, c, env = ENV) =>
  createReleaseDispatchRun({ fetchImpl: f, env })(c);

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
{
  const f = fakeGitHub();
  const r = await runWith(f, ctx("shadow"));
  check(
    r.report?.wouldRelease === true && hookCalls(f).length === 0,
    "(c) shadow: 叩かず、叩くはずだったことだけ返す",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({
    compare: { status: "identical", files: [], commits: [] },
  });
  const r = await runWith(f, ctx("live"));
  check(
    r.report?.action === "none" &&
      r.report.released === false &&
      hookCalls(f).length === 0,
    "(c) 差分が無ければ叩かず、成功（released=false）で返す",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({ gateConclusion: "failure" });
  const r = await runWith(f, ctx("live"));
  check(
    r.outcome === "error" &&
      r.error.includes("master の検査が通っていない") &&
      hookCalls(f).length === 0,
    "(c) master の検査が赤なら叩かず失敗（Slack に出る）",
    JSON.stringify(r),
  );
}
for (const [label, env, expect] of [
  [
    "版が無い",
    { ...ENV, VERCEL_GIT_COMMIT_SHA: undefined },
    "VERCEL_GIT_COMMIT_SHA",
  ],
  [
    "トークンが無い",
    { ...ENV, GITHUB_ACTIONS_DISPATCH_TOKEN: undefined },
    "GITHUB_ACTIONS_DISPATCH_TOKEN",
  ],
  ["Hook が無い", { ...ENV, [RELEASE_HOOK_ENV]: undefined }, RELEASE_HOOK_ENV],
]) {
  const f = fakeGitHub();
  const r = await runWith(f, ctx("live"), env);
  check(
    r.outcome === "error" &&
      r.error.includes(expect) &&
      hookCalls(f).length === 0,
    `(c) ${label}なら失敗`,
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({ hookStatus: 500 });
  const r = await runWith(f, ctx("live"));
  check(
    r.outcome === "error" && r.error.includes("Deploy Hook を叩けない"),
    "(c) Deploy Hook が HTTP 失敗なら失敗",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({ compareStatus: 401 });
  const r = await runWith(f, ctx("live"));
  check(
    r.outcome === "error" &&
      r.error.includes("GitHub を読めない") &&
      hookCalls(f).length === 0,
    "(c) GitHub を読めなければ叩かず失敗",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub();
  const r = await runWith(
    f,
    ctx("live", { released: true, fromSha: DEPLOYED, masterSha: HEAD }),
  );
  check(
    r.outcome === "error" &&
      r.error.includes("本番に出ていない") &&
      hookCalls(f).length === 0,
    "(c) 前回叩いたのに本番の版が動いていなければ、叩かずに失敗（ビルドの失敗と出た後の Instant Rollback を区別できない。Codex の P1）",
    JSON.stringify(r),
  );
  // A→B を出した後に A へ Instant Rollback した状態（released・fromSha=A・lastReleasedSha=B）でも、B を出し直さない
  const f2 = fakeGitHub();
  const r2 = await runWith(
    f2,
    ctx("live", {
      released: true,
      fromSha: DEPLOYED,
      masterSha: HEAD,
      lastReleasedSha: HEAD,
    }),
  );
  check(
    r2.outcome === "error" && hookCalls(f2).length === 0,
    "(c) 出した直後の版から前の版へ巻き戻した状態でも、自動では出し直さない",
    JSON.stringify(r2),
  );
}
{
  const prev = { action: "release", released: true, fromSha: MID };
  const f = fakeGitHub();
  const r = await runWith(f, ctx("live", prev, FOLLOWUP_NOW));
  check(
    f.calls.length === 0 &&
      r.report?.released === true &&
      r.report.fromSha === MID &&
      r.report.followupSkipped === true,
    "(c) 拾い直しは、前が「待つ」でなければ何も読まず、前の記録（叩いた記録）を残す",
    JSON.stringify(r),
  );
  const f2 = fakeGitHub();
  const r2 = await runWith(
    f2,
    ctx("live", { action: "deferred" }, FOLLOWUP_NOW),
  );
  check(
    r2.report?.released === true && hookCalls(f2).length === 1,
    "(c) 拾い直しは、前が「待つ」なら判定し直して出す",
    JSON.stringify(r2),
  );
}
{
  const oldest = new Date(
    NOW.getTime() - STALE_RELEASE_MS - 60000,
  ).toISOString();
  const fresh = new Date(
    NOW.getTime() - STALE_RELEASE_MS + 60000,
  ).toISOString();
  check(
    staleReleaseAlerts({
      action: "release",
      mode: "shadow",
      oldestCommittedAt: oldest,
      now: NOW,
    }).length === 1 &&
      staleReleaseAlerts({
        action: "deferred",
        mode: "live",
        oldestCommittedAt: oldest,
        now: NOW,
      }).length === 1 &&
      staleReleaseAlerts({
        action: "release",
        mode: "live",
        oldestCommittedAt: oldest,
        now: NOW,
      }).length === 0 &&
      staleReleaseAlerts({
        action: "release",
        mode: "shadow",
        oldestCommittedAt: fresh,
        now: NOW,
      }).length === 0 &&
      staleReleaseAlerts({
        action: "none",
        mode: "shadow",
        oldestCommittedAt: oldest,
        now: NOW,
      }).length === 0,
    "(c) 出すべき差分が13時間を過ぎて残る（shadow のまま・待つが続く）なら alerts、live で出した・差分なし・13時間以内なら出さない",
  );
}

// 範囲の外の run に届くまでページをめくる。届かなければ covered=false。compare の commits が足りなければ complete=false
{
  const range = Array.from({ length: 250 }, (_, i) => `r${i}`.padEnd(40, "0"));
  const pages = [];
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  const page = (from, n) =>
    Array.from({ length: n }, (_, i) => ({
      id: from + i,
      head_sha: range[range.length - 1 - from - i] ?? "z".repeat(40),
      status: "completed",
      conclusion: "success",
    }));
  const f = async (url) => {
    pages.push(url);
    const p = Number(new URL(url).searchParams.get("page"));
    return reply({
      workflow_runs: page((p - 1) * GATE_RUNS_PER_PAGE, GATE_RUNS_PER_PAGE),
    });
  };
  const got = await fetchGateRuns({
    fetchImpl: f,
    token: "t",
    rangeShas: range,
  });
  check(
    got.every((g) => g.covered === true) &&
      pages.filter((u) => u.includes("quality-gates")).length === 3,
    "(b) 範囲の外の run に届くまでページをめくり、届けば covered",
    JSON.stringify(got.map((g) => [g.workflow, g.covered, g.runs.length])),
  );
  const short = await fetchGateRuns({
    fetchImpl: async () =>
      reply({ workflow_runs: page(0, GATE_RUNS_PER_PAGE) }),
    token: "t",
    rangeShas: range,
  });
  check(
    short.every((g) => g.covered === false),
    "(b) ページの上限まで読んでも範囲の外に届かなければ covered=false",
  );
  const cmp = await fetchCompare({
    fetchImpl: async () =>
      reply({
        status: "ahead",
        ahead_by: 300,
        files: [],
        commits: [{ sha: HEAD }],
      }),
    token: "t",
    deployedSha: DEPLOYED,
    headSha: HEAD,
  });
  const notComplete = await fetchGateRuns({
    fetchImpl: async () => reply({ workflow_runs: [] }),
    token: "t",
    rangeShas: cmp.commitShas,
    complete: cmp.complete,
  });
  check(
    cmp.complete === false && notComplete.every((g) => g.covered === false),
    "(b) compare の commits が ahead_by より少なければ範囲を全部見ていないとみる",
  );
}

// ---------------------------------------------------------------- (d)
{
  const at = new Date("2026-11-06T19:00:00+09:00");
  const row = (mode, hoursAgo) => ({
    job: "release_dispatch",
    mode,
    consecutive_failures: 0,
    last_tick_at:
      hoursAgo === null
        ? null
        : new Date(at.getTime() - hoursAgo * 3600000).toISOString(),
    last_report: null,
  });
  const liveness = (r) =>
    evaluateJobStates([r], at).filter?.((a) => a.kind === "liveness") ??
    evaluateJobStates([r], at).alerts.filter((a) => a.kind === "liveness");
  check(
    liveness(row("live", 14)).length === 1 &&
      liveness(row("shadow", 14)).length === 1 &&
      liveness(row("live", 2)).length === 0 &&
      liveness(row("off", null)).length === 0,
    "(d) release_dispatch の死活: shadow・live で last_tick_at が13時間より前なら通知、off（設定の前）は見ない",
    JSON.stringify(liveness(row("live", 14))),
  );
}

// ---------------------------------------------------------------- (e)
{
  const def = SCRAPE_JOBS.release_dispatch;
  check(
    def?.kind === "monitor" &&
      def?.failureAlertAfter === 1 &&
      def?.livenessStaleMin === 13 * 60 &&
      validateRegistry().length === 0,
    "(e) レジストリ: release_dispatch は monitor・failureAlertAfter 1・livenessStaleMin 13時間",
    JSON.stringify(def),
  );
  const src = fs.readFileSync(
    path.join(ROOT, "api/cron/release-dispatch.js"),
    "utf8",
  );
  check(
    Number(/maxDuration:\s*(\d+)/.exec(src)?.[1]) === def?.maxDurationSec &&
      /modeGated:\s*true/.test(src) &&
      src.includes('job: "release_dispatch"') &&
      src.includes("createReleaseDispatchRun()"),
    "(e) api/cron/release-dispatch.js: maxDuration がレジストリと一致し、モードのゲートを掛ける",
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons
    .filter((c) => c.path.startsWith("/api/cron/release-dispatch"))
    .map((c) => [c.path, c.schedule]);
  check(
    same(crons, [
      ["/api/cron/release-dispatch", "45 2,8,20 * * *"],
      ["/api/cron/release-dispatch", "5 3,9,21 * * *"],
    ]),
    "(e) vercel.json: 定時 UTC 02:45・08:45・20:45（JST 11:45・17:45・05:45）と、20分後の拾い直し",
    JSON.stringify(crons),
  );
}

if (failures > 0) {
  console.error(`\nverify-release-dispatch: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-release-dispatch: すべて通った");
