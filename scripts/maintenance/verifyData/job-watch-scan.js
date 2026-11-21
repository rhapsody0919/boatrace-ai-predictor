/**
 * job-watch-scan.js - scripts/watch/job-watch.js の scan（定期の job の見回り）を、偽の GitHub API で1回回して確かめる（verify の部品）。
 * 本文の字は読まず、scan が GitHub に問い合わせた道（どの一覧・どの run の job・どの YAML）と、Issue に書いた項目（印）で見る。
 *
 * globalThis.fetch を偽（下の github）に差し替える。偽は api.github.com の道ごとに場面の値を返し、知らない道は 404 にする
 * （scan はそこで fail＝process.exit(1) するので、process.exit も差し替えて例外にする）。本物の GitHub には繋がない。
 * check は呼ぶ verify の check(label, pass, detail)。
 */
const REPO = "o/r";
const WATCHED = ".github/workflows/e2e-live.yml";
const NOW = Date.now();
const iso = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();
const YAML = "jobs:\n  e2e-live:\n    timeout-minutes: 60\n";
const MARK = (id, kind) => `<!-- job-watch:${kind}:${id}:1 -->`;

/** run の行（GitHub の workflow_runs の形） */
const run = (id, conclusion, extra = {}) => ({
  id,
  name: "E2E Live",
  run_number: id,
  run_attempt: 1,
  path: WATCHED,
  head_branch: "master",
  head_sha: `sha${id}`,
  head_repository: { full_name: REPO },
  event: "schedule",
  status: "completed",
  conclusion,
  created_at: iso(120 - id),
  html_url: `https://example.invalid/runs/${id}`,
  ...extra,
});
/** job の行（started_at から minutes 分で終わった） */
const job = (id, conclusion, minutes) => ({
  id,
  name: "e2e-live",
  conclusion,
  started_at: iso(200),
  completed_at: iso(200 - minutes),
});

/** 場面: 時間切れの cancelled・置き換えの cancelled・push の失敗・PR の失敗・閉じた Issue に印のある失敗・毎晩の表が古い */
function scene() {
  return {
    runs: [
      run(1, "cancelled"),
      run(2, "cancelled"),
      run(3, "failure", { event: "push" }),
      run(4, "failure", { event: "pull_request" }),
      run(5, "failure"),
      run(6, "success", { path: ".github/workflows/key-canary.yml" }),
    ],
    jobs: {
      1: [job(11, "cancelled", 60.3)],
      2: [job(21, "cancelled", 2.8)],
      3: [job(31, "failure", 4)],
      5: [job(51, "failure", 4)],
    },
    closed: {
      "job-watch-failure": [{ number: 90, body: "閉じた" }],
    },
    comments: { 90: [{ body: `- 前に書いた\n${MARK(5, "failure")}` }] },
    workflows: [
      {
        path: ".github/workflows/e2e-nightly.yml",
        created_at: iso(60 * 24 * 30),
      },
    ],
  };
}

const respond = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () =>
    typeof body === "string" ? body : body == null ? "" : JSON.stringify(body),
});

/** 偽の api.github.com。道と query で場面の値を返し、呼ばれた道と書いた本文を requests に積む */
function fakeGithub(s, requests) {
  return async function github(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const q = u.searchParams;
    const p = u.pathname.replace(`/repos/${REPO}`, "");
    requests.push({
      method,
      path: p,
      query: u.search,
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (method !== "GET") return respond(201, { number: 100 });
    if (p === "/actions/runs")
      return respond(200, {
        workflow_runs: q.get("page") === "1" ? s.runs : [],
      });
    if (p === "/issues" && q.get("state") === "open") return respond(200, []);
    if (p === "/issues" && q.get("state") === "closed")
      return respond(200, s.closed[q.get("labels")] ?? []);
    let m = /^\/issues\/(\d+)\/comments$/.exec(p);
    if (m)
      return respond(
        200,
        q.get("page") === "1" ? (s.comments[m[1]] ?? []) : [],
      );
    m = /^\/actions\/runs\/(\d+)\/jobs$/.exec(p);
    if (m) return respond(200, { jobs: s.jobs[m[1]] ?? [] });
    if (/^\/actions\/jobs\/\d+\/logs$/.test(p))
      return respond(200, "Error: something broke");
    if (p.startsWith("/contents/")) return respond(200, YAML);
    if (p === "/actions/workflows")
      return respond(200, { workflows: s.workflows });
    if (p === "/actions/workflows/e2e-nightly.yml/runs")
      return respond(200, { workflow_runs: [] });
    return respond(404, { message: "Not Found" });
  };
}

/** scan を場面 s で1回回し、{ requests, posts（Issue・コメントの本文）, error } を返す */
async function runScan(s) {
  const requests = [];
  const saved = {
    fetch: globalThis.fetch,
    exit: process.exit,
    log: console.log,
    error: console.error,
    env: { ...process.env },
  };
  Object.assign(process.env, {
    GITHUB_TOKEN: "fake-token",
    GITHUB_REPOSITORY: REPO,
  });
  delete process.env.GITHUB_OUTPUT;
  globalThis.fetch = fakeGithub(s, requests);
  const errors = [];
  console.log = () => {};
  console.error = (...a) => errors.push(a.map(String).join(" "));
  process.exit = (code) => {
    throw new Error(`process.exit(${code}): ${errors.join(" / ")}`);
  };
  let error = null;
  try {
    const { scan } = await import("../../watch/job-watch.js");
    await scan();
  } catch (e) {
    error = e.message;
  } finally {
    globalThis.fetch = saved.fetch;
    process.exit = saved.exit;
    console.log = saved.log;
    console.error = saved.error;
    for (const k of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_OUTPUT"]) {
      if (saved.env[k] === undefined) delete process.env[k];
      else process.env[k] = saved.env[k];
    }
  }
  const posts = requests
    .filter((r) => r.method === "POST")
    .map((r) => r.body?.body ?? "")
    .join("\n");
  return { requests, posts, error };
}

export async function checkJobWatchScan({ check }) {
  // job-watch.js は GITHUB_TOKEN・GITHUB_REPOSITORY を import のときに読むので、最初の import は runScan の中で
  const r = await runScan(scene());
  const { CANARY_PATH } = await import("../../watch/job-watch.js");
  check(
    "job-watch.js のカナリアの path（CANARY_PATH）は .github/workflows/key-canary.yml",
    CANARY_PATH === ".github/workflows/key-canary.yml",
    CANARY_PATH,
  );
  const got = (path) => r.requests.filter((q) => q.path === path);
  const runsList = got("/actions/runs");
  check(
    "scan は偽の GitHub で最後まで回る（知らない道に問い合わせない）",
    r.error === null,
    r.error ?? "",
  );
  check(
    "見回りは master の run だけを一覧で取る（branch=master と、窓の始まり created>=）",
    runsList.length > 0 &&
      runsList.every(
        (q) =>
          new URLSearchParams(q.query).get("branch") === "master" &&
          /^>=\d{4}-\d{2}-\d{2}T/.test(
            new URLSearchParams(q.query).get("created"),
          ),
      ),
    JSON.stringify(runsList),
  );
  check(
    "scan が cancelled を候補に入れ、その run の SHA の YAML の上限（cancelledByTimeout）で時間切れだけを拾う（置き換えの cancelled は書かない）",
    r.posts.includes(MARK(1, "failure")) &&
      !r.posts.includes(":2:1 -->") &&
      got("/contents/.github/workflows/e2e-live.yml")
        .map((q) => q.query)
        .sort()
        .join(",") === "?ref=sha1,?ref=sha2",
    r.posts,
  );
  check(
    "見回りは push で動く見張りの対象も数え、PR（pull_request）の run は数えない",
    r.posts.includes(MARK(3, "failure")) &&
      !r.posts.includes(":4:1 -->") &&
      got("/actions/runs/4/jobs").length === 0,
    r.posts,
  );
  check(
    "scan は閉じた Issue（state=closed・since）の本文・コメントの印も数え、既に書いた run は書き直さず、その job も読み直さない",
    r.requests.some(
      (q) =>
        q.path === "/issues" &&
        new URLSearchParams(q.query).get("state") === "closed" &&
        new URLSearchParams(q.query).get("since"),
    ) &&
      got("/issues/90/comments").length > 0 &&
      !r.posts.includes(MARK(5, "failure")) &&
      got("/actions/runs/5/jobs").length === 0,
    JSON.stringify(r.requests.map((q) => q.path + q.query)),
  );
  check(
    "scan は毎晩の網羅の表が古いときの項目（印 stale）を job-watch-failure に足す",
    r.requests.some(
      (q) =>
        q.method === "POST" &&
        q.body?.labels?.[0] === "job-watch-failure" &&
        q.body.body.includes("<!-- job-watch:stale:0:1 -->"),
    ),
    r.posts,
  );
}
