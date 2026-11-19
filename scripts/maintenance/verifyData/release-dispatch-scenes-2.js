/**
 * verify-release-dispatch.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-release-dispatch.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  RELEASE_HOOK_ENV,
  STALE_RELEASE_MS,
  staleReleaseAlerts,
  fetchGateRuns,
  fetchCompare,
  GATE_RUNS_PER_PAGE,
} from "../../lib/releaseDispatch.js";
import { evaluateJobStates } from "../../lib/scrapeJobs/monitor.js";
import { fakeGitHub, runWith, ctx, hookCalls, ENV, FOLLOWUP_NOW } from "./release-dispatch-scenes-1.js";

let check, DEPLOYED, HEAD, MID, NOW;

async function scene1() {
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
}

async function scene2() {
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
}

function scene3() {
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
}

async function scene4() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・DEPLOYED・HEAD・MID・NOW） */
export async function runReleaseDispatchScenes2(env) {
  ({ check, DEPLOYED, HEAD, MID, NOW } = env);
  await scene1();
  await scene2();
  scene3();
  await scene4();
}
