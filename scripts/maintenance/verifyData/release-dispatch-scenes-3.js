/**
 * verify-release-dispatch.js の後半の場面（3/3）。verify ではない。
 * 範囲の赤を解く全件の検査（scripts/lib/releaseFullCheck.js、ADR-0106 の 2026-11-24 の追記）。偽の fetch で GitHub には繋がない。
 */
import {
  RELEASE_HOOK_ENV,
  createReleaseDispatchRun,
} from "../../lib/releaseDispatch.js";
import { fullRunTitle } from "../../lib/releaseFullCheck.js";

const QG = "quality-gates.yml";
const PMC = "post-merge-checks.yml";
const OTHER = "e".repeat(40);
const HOOK = "https://hook.example/deploy";
let check, DEPLOYED, HEAD, MID, NOW, OLD_HEAD;

const pushRun = (sha, conclusion = "success", status = "completed") => ({
  id: 1,
  head_sha: sha,
  status,
  conclusion,
});
/** 全件の run。base は quality-gates だけ表示名に入る */
const fullRun = (workflow, sha, status, conclusion, over = {}) => ({
  id: 7,
  event: "workflow_dispatch",
  head_branch: "master",
  head_sha: sha,
  status,
  conclusion,
  display_title: workflow === QG ? fullRunTitle(DEPLOYED) : "Post-merge Checks",
  html_url: `https://github.com/runs/${workflow}`,
  ...over,
});

/** push の run（pushRuns）と全件の run（fullRuns）を workflow ごとに返す偽の GitHub。起動の POST は記録する */
function fake({ pushRuns, fullRuns = {}, fullStatus = 200 }) {
  const calls = [];
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/commits/master"))
      return reply(200, {
        sha: HEAD,
        commit: { committer: { date: OLD_HEAD.committedAt } },
      });
    if (url.includes("/compare/"))
      return reply(200, {
        status: "ahead",
        files: [{ filename: "src/App.jsx" }],
        commits: [MID, HEAD].map((sha) => ({
          sha,
          commit: { committer: { date: "2026-11-06T09:00:00+09:00" } },
        })),
      });
    if (url.endsWith("/dispatches")) return reply(204, {});
    if (url === HOOK) return reply(201, {});
    const workflow = [QG, PMC].find((w) => url.includes(`/workflows/${w}/`));
    if (workflow && url.includes("event=workflow_dispatch")) {
      return reply(fullStatus, { workflow_runs: fullRuns[workflow] ?? [] });
    }
    if (workflow) return reply(200, { workflow_runs: pushRuns[workflow] });
    return reply(404, {});
  };
  f.calls = calls;
  return f;
}
const posts = (f) =>
  f.calls
    .filter((c) => c.url.endsWith("/dispatches"))
    .map((c) => [
      c.url.split("/workflows/")[1].split("/")[0],
      JSON.parse(c.init.body),
    ]);
const hooks = (f) => f.calls.filter((c) => c.url === HOOK).length;
const run = (f, mode = "live", previous = null) =>
  createReleaseDispatchRun({
    fetchImpl: f,
    env: {
      VERCEL_GIT_COMMIT_SHA: DEPLOYED,
      GITHUB_ACTIONS_DISPATCH_TOKEN: "test-token",
      [RELEASE_HOOK_ENV]: HOOK,
    },
  })({ mode, state: { last_report: previous }, now: () => NOW });

// 範囲は [MID, HEAD]。quality-gates は MID で失敗、HEAD で成功（範囲が赤）
const red = () => ({
  [QG]: [pushRun(HEAD), pushRun(MID, "failure")],
  [PMC]: [pushRun(HEAD), pushRun(MID)],
});
const j = (x) => JSON.stringify(x);
const bothSuccess = (sha) => ({
  [QG]: [fullRun(QG, sha, "completed", "success")],
  [PMC]: [fullRun(PMC, sha, "completed", "success")],
});

async function startScenes() {
  const f = fake({ pushRuns: red() });
  const r = await run(f);
  check(
    r.report?.action === "deferred" &&
      r.report.released === false &&
      hooks(f) === 0 &&
      j(posts(f)) ===
        j([
          [QG, { ref: "master", inputs: { base: DEPLOYED } }],
          [PMC, { ref: "master", inputs: {} }],
        ]),
    "(f) 範囲が赤で全件の run が無ければ、2本を master に起動（quality-gates は base=本番の版、post-merge は inputs 無し）して待つ。Hook は叩かない",
    j([r, posts(f)]),
  );
  const g = fake({ pushRuns: red(), fullRuns: bothSuccess(HEAD) });
  const r2 = await run(g);
  check(
    r2.report?.released === true && hooks(g) === 1 && posts(g).length === 0,
    "(f) 拾い直しで両方の全件の run が tip で success なら、範囲の赤を解いて出す（起こし直さない）",
    j([r2, posts(g)]),
  );
  const h = fake({ pushRuns: red(), fullRuns: bothSuccess(MID) });
  const r3 = await run(h);
  check(
    r3.report?.released === true && hooks(h) === 1,
    "(f) S（MID）で success なら範囲の始め〜S の失敗を解き、S より後（HEAD）の push の run が緑なら出す",
    j(r3),
  );
  const k = fake({
    pushRuns: {
      ...red(),
      [QG]: [pushRun(HEAD, "failure"), pushRun(MID, "failure")],
    },
    fullRuns: bothSuccess(MID),
  });
  const r4 = await run(k);
  check(
    r4.report?.action === "deferred" && hooks(k) === 0 && posts(k).length === 2,
    "(f) S の後に新しい赤が入り、tip が S より新しく (tip, base) の全件の run が無ければ、tip で起こし直して待つ",
    j([r4, posts(k)]),
  );
  const m = fake({
    pushRuns: {
      ...red(),
      [QG]: [pushRun(HEAD, "failure"), pushRun(MID, "failure")],
    },
    fullRuns: {
      ...bothSuccess(MID),
      [QG]: [
        fullRun(QG, HEAD, "completed", "failure"),
        fullRun(QG, MID, "completed", "success"),
      ],
    },
  });
  const r5 = await run(m);
  check(
    r5.outcome === "error" &&
      r5.error.includes("quality-gates.yml=failure") &&
      hooks(m) === 0 &&
      posts(m).length === 0,
    "(f) 同じ (tip, base) の全件の run が失敗なら、S に success があっても止めて起こし直さない",
    j([r5, posts(m)]),
  );
}

async function acceptScenes() {
  const f = fake({
    pushRuns: red(),
    fullRuns: {
      [QG]: [
        fullRun(QG, HEAD, "completed", "success", {
          display_title: fullRunTitle(OTHER),
        }),
      ],
      [PMC]: [
        fullRun(PMC, HEAD, "completed", "success", {
          head_branch: "claude/x",
        }),
      ],
    },
  });
  const r = await run(f);
  check(
    r.report?.action === "deferred" && hooks(f) === 0 && posts(f).length === 2,
    "(f) base が本番の版と違う quality-gates の run・head_branch が master でない run は認めず、起こす",
    j([r, posts(f)]),
  );
  const g = fake({
    pushRuns: red(),
    fullRuns: {
      [QG]: [fullRun(QG, HEAD, "completed", "success", { event: "push" })],
      [PMC]: [fullRun(PMC, "f".repeat(40), "completed", "success")],
    },
  });
  const r2 = await run(g);
  check(
    r2.report?.action === "deferred" && hooks(g) === 0 && posts(g).length === 2,
    "(f) event が workflow_dispatch でない run・範囲の外の sha の run も認めない",
    j([r2, posts(g)]),
  );
  const h = fake({
    pushRuns: red(),
    fullRuns: {
      [QG]: [
        fullRun(QG, HEAD, "completed", "success", {
          display_title: fullRunTitle(OTHER),
        }),
      ],
      [PMC]: [
        fullRun(PMC, HEAD, "completed", "success", {
          display_title: "どんな表示名でも",
        }),
      ],
    },
  });
  const r3 = await run(h);
  check(
    r3.report?.action === "deferred" && j(posts(h).map(([w]) => w)) === j([QG]),
    "(f) post-merge-checks は base を問わず success を認める。認められない側（base が違う quality-gates）だけ起こす",
    j([r3, posts(h)]),
  );
}

async function runningAndFailedScenes() {
  const f = fake({
    pushRuns: red(),
    fullRuns: {
      [QG]: [fullRun(QG, HEAD, "in_progress", null)],
      [PMC]: [fullRun(PMC, HEAD, "queued", null)],
    },
  });
  const r = await run(f);
  check(
    r.report?.action === "deferred" && hooks(f) === 0 && posts(f).length === 0,
    "(f) 全件の run が走っていれば待つ。起こし直さない",
    j([r, posts(f)]),
  );
  const g = fake({
    pushRuns: red(),
    fullRuns: {
      [QG]: [fullRun(QG, HEAD, "completed", "failure")],
      [PMC]: [fullRun(PMC, HEAD, "completed", "success")],
    },
  });
  const r2 = await run(g);
  check(
    r2.outcome === "error" &&
      r2.error.includes("https://github.com/runs/quality-gates.yml") &&
      hooks(g) === 0 &&
      posts(g).length === 0,
    "(f) 全件の run が失敗なら出さずに失敗（run の URL を添える）。同じ版（S と base）では起こし直さない",
    j([r2, posts(g)]),
  );
  const h = fake({
    pushRuns: red(),
    fullRuns: { [QG]: [fullRun(QG, MID, "completed", "failure")] },
  });
  await run(h);
  check(
    posts(h).length === 2,
    "(f) 失敗した全件の run が tip より前の版なら、新しい tip では起こし直す",
    j(posts(h)),
  );
}

async function guardScenes() {
  const f = fake({ pushRuns: red() });
  const r = await run(f, "shadow");
  check(
    r.outcome === "error" &&
      r.error.includes("起こすはずだった") &&
      r.error.includes(QG) &&
      posts(f).length === 0 &&
      hooks(f) === 0,
    "(f) shadow は起こさず、起こすはずだったことを理由に残す",
    j([r, posts(f)]),
  );
  const stuck = fake({ pushRuns: red() });
  const r1 = await run(stuck, "live", {
    released: true,
    fromSha: DEPLOYED,
    masterSha: HEAD,
  });
  const roll = fake({ pushRuns: red() });
  const r2 = await run(roll, "live", {
    released: false,
    fromSha: MID,
    lastReleasedSha: MID,
  });
  check(
    r1.outcome === "error" &&
      r2.outcome === "error" &&
      r2.error.includes("Instant Rollback") &&
      posts(stuck).length === 0 &&
      posts(roll).length === 0,
    "(f) stuck・Instant Rollback は先に止まり、全件の検査は起こさない",
    j([r1, r2]),
  );
}

async function coverageScenes() {
  // 100本×3ページ全部が範囲の中 → 範囲の一番古いコミットまで届かず covered=false
  const long = Array.from({ length: 100 }, (_, i) =>
    pushRun(i % 2 ? MID : HEAD),
  );
  const f = fake({
    pushRuns: { [QG]: long, [PMC]: long },
    fullRuns: bothSuccess(HEAD),
  });
  const r = await run(f);
  check(
    r.report?.released === true && posts(f).length === 0,
    "(f) run を読み切れていなく（covered=false）ても、tip の全件が緑なら出す",
    j(r),
  );
  const g = fake({ pushRuns: { [QG]: long, [PMC]: long } });
  const r2 = await run(g);
  check(
    r2.report?.action === "deferred" && posts(g).length === 2,
    "(f) 読み切れていなく、全件の run も無ければ起こす",
    j([r2, posts(g)]),
  );
  const green = {
    [QG]: [pushRun(HEAD), pushRun(MID)],
    [PMC]: [pushRun(HEAD), pushRun(MID)],
  };
  const h = fake({ pushRuns: green, fullStatus: 500 });
  const r3 = await run(h);
  check(
    r3.report?.released === true &&
      hooks(h) === 1 &&
      !h.calls.some((c) => c.url.includes("event=workflow_dispatch")),
    "(f) 赤の無い範囲は、全件の run を読まず、その取得に左右されずに出す",
    j(r3),
  );
  const k = fake({ pushRuns: red(), fullStatus: 500 });
  const r4 = await run(k);
  check(
    r4.outcome === "error" &&
      r4.error.includes("全件の run") &&
      posts(k).length === 0,
    "(f) 赤があるのに全件の run を読めなければ、起こさず失敗",
    j(r4),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・DEPLOYED・HEAD・MID・NOW・OLD_HEAD） */
export async function runReleaseDispatchScenes3(env) {
  ({ check, DEPLOYED, HEAD, MID, NOW, OLD_HEAD } = env);
  await startScenes();
  await acceptScenes();
  await runningAndFailedScenes();
  await guardScenes();
  await coverageScenes();
}
