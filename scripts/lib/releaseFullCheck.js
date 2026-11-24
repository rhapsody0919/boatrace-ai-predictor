/**
 * 範囲の赤を解く全件の検査（ADR-0106 の 2026-11-24 の追記）。releaseDispatch.js が、出す範囲に失敗した run がある・
 * 読み切れないときに呼ぶ。quality-gates.yml（inputs.base=今の本番の版）と post-merge-checks.yml を master に workflow_dispatch し、
 * 範囲の中のコミット S でどちらも success なら、範囲の始め〜S の失敗・読み切れていないを解く（S より後は push の run のまま）。
 * 純関数は applyFullRuns、GitHub への読み書きはほかの関数。本体の releaseDispatch.js は400行の線のためここに分ける
 */
import {
  GITHUB_REPO,
  dispatchWorkflow,
  githubHeaders,
} from "./analogyDispatch.js";

const API = `https://api.github.com/repos/${GITHUB_REPO}`;
const QUALITY_GATES = "quality-gates.yml";
const FULL_WORKFLOWS = Object.freeze([QUALITY_GATES, "post-merge-checks.yml"]);
// quality-gates の全件の run の表示名（quality-gates.yml の run-name と同じ。run の API は inputs を返さない）
export const fullRunTitle = (base) => `Quality Gates 全件 base=${base}`;
const NEUTRAL = new Set(["skipped", "cancelled"]);

/**
 * @param {{rangeShas: string[], deployedSha: string, gateRuns: object[], fullRuns: {workflow: string, runs: object[]}[],
 *   summarize: Function, complete?: boolean}} input summarize は releaseDispatch.js の summarizeGates（循環の import を避ける）
 * @returns {{gates: object[], needDispatch: boolean, toDispatch: string[]}} toDispatch は needDispatch のときだけ空でない
 */
export function applyFullRuns({
  rangeShas,
  deployedSha,
  gateRuns,
  fullRuns,
  summarize,
  complete = true,
}) {
  const pos = new Map(rangeShas.map((sha, i) => [sha, i]));
  const tip = rangeShas[rangeShas.length - 1];
  const info = new Map(
    gateRuns.map(({ workflow }) => {
      const runs = (fullRuns.find((f) => f.workflow === workflow)?.runs ?? [])
        .filter(
          (r) =>
            r.event === "workflow_dispatch" &&
            r.head_branch === "master" &&
            pos.has(r.head_sha) &&
            (workflow !== QUALITY_GATES ||
              r.display_title === fullRunTitle(deployedSha)),
        )
        .sort((a, b) => pos.get(a.head_sha) - pos.get(b.head_sha));
      const done = runs.filter(
        (r) => r.status === "completed" && !NEUTRAL.has(r.conclusion),
      );
      const ok = done.filter((r) => r.conclusion === "success");
      return [
        workflow,
        {
          running: runs.find((r) => r.status !== "completed"),
          success: ok[ok.length - 1],
          failedAtTip: done.find(
            (r) => r.conclusion !== "success" && r.head_sha === tip,
          ),
        },
      ];
    }),
  );
  // 範囲の中でいちばん新しい success の S まで、push の run の失敗・読み切れていないを解く
  const cleared = gateRuns.map((g) => {
    const s = info.get(g.workflow).success;
    if (!s || !complete) return g;
    return {
      ...g,
      covered: true,
      runs: g.runs.filter((r) => pos.get(r.head_sha) > pos.get(s.head_sha)),
    };
  });
  let blockedByFull = false;
  const gates = summarize(rangeShas, cleared).map((g) => {
    const { running, failedAtTip } = info.get(g.workflow);
    if (g.state !== "red") return g;
    // 解く手が無い赤: 全件の run が同じ版で失敗した・S の後の push の run が赤（S より後は push の run のまま）
    if (!running && (failedAtTip || info.get(g.workflow).success)) {
      blockedByFull = true;
    }
    if (running) {
      return {
        workflow: g.workflow,
        state: "pending",
        headSha: running.head_sha,
      };
    }
    if (failedAtTip) {
      return {
        workflow: g.workflow,
        state: "red",
        conclusion: failedAtTip.conclusion,
        headSha: failedAtTip.head_sha,
        unresolved: [
          `全件の run が失敗（${failedAtTip.html_url}）。直すまで同じ版では起こし直さない`,
        ],
      };
    }
    return g;
  });
  const needDispatch = !blockedByFull && gates.some((g) => g.state === "red");
  const toDispatch = needDispatch
    ? FULL_WORKFLOWS.filter((w) => {
        const i = info.get(w);
        return i && !i.running && !i.failedAtTip && !i.success;
      })
    : [];
  return { gates, needDispatch: toDispatch.length > 0, toDispatch };
}

/** 全件の run（workflow_dispatch・master）の直近20本を workflow ごとに読む */
export async function fetchFullRuns({ fetchImpl, token }) {
  return Promise.all(
    FULL_WORKFLOWS.map(async (workflow) => {
      const url = `${API}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=master&per_page=20`;
      const res = await fetchImpl(url, {
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(15 * 1000),
      });
      if (!res.ok) throw new Error(`GET ${url} が HTTP ${res.status}`);
      const { workflow_runs: runs = [] } = await res.json();
      return {
        workflow,
        runs: runs.map((r) => ({
          id: r.id,
          event: r.event,
          head_branch: r.head_branch,
          head_sha: r.head_sha,
          status: r.status,
          conclusion: r.conclusion,
          display_title: r.display_title,
          html_url: r.html_url,
        })),
      };
    }),
  );
}

/** 赤か読み切れない検査があるときだけ全件の run を読み、gates を直す。読めなければ error の答え */
export async function readFullChecks(io, compare, gateRuns, summarize) {
  const { fetchImpl, token, deployedSha } = io;
  const gates = summarize(compare.commitShas, gateRuns);
  if (!gates.some((g) => g.state === "red")) {
    return { gates, needDispatch: false, toDispatch: [] };
  }
  try {
    return applyFullRuns({
      rangeShas: compare.commitShas,
      deployedSha,
      gateRuns,
      fullRuns: await fetchFullRuns({ fetchImpl, token }),
      summarize,
      complete: compare.complete,
    });
  } catch (error) {
    return {
      error: {
        outcome: "error",
        error: `GitHub を読めない（全件の run）: ${error.message}`,
      },
    };
  }
}

/** 全件の検査を起こす。live は起こして「待つ」の答え、shadow は起こさず理由に書く。起こせなければ error の答え */
export async function startFullChecks(io, mode, { toDispatch }, decision) {
  const { fetchImpl, token, deployedSha } = io;
  const names = toDispatch.join("・");
  if (mode !== "live") {
    const reason = `${decision.reason}（shadow: 全件の検査 ${names} を起こすはずだった）`;
    return { decision: { ...decision, reason } };
  }
  try {
    for (const workflow of toDispatch) {
      const inputs = workflow === QUALITY_GATES ? { base: deployedSha } : {};
      await dispatchWorkflow({ fetchImpl, token, workflow, inputs });
    }
  } catch (error) {
    return {
      error: {
        outcome: "error",
        error: `全件の検査を起こせない: ${error.message}`,
      },
    };
  }
  const reason = `範囲の赤を解く全件の検査を起こした（${names}）。次の拾い直しで見る`;
  return { decision: { ...decision, action: "deferred", reason } };
}
