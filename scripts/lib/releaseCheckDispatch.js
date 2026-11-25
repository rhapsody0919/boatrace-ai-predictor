/**
 * release-dispatch が Deploy Hook を叩いた後に、出した master の先の sha で e2e-release.yml（本番の URL の読むだけの確かめ）を
 * 起こす（設計 docs/design/harness-migration/design.md §2.3）。前は hq（Mac）の deploy-guard が配備を見つけて起こしていた。
 *
 * - 鍵は release-dispatch と同じ GITHUB_ACTIONS_DISPATCH_TOKEN（Actions: Read and write。releaseFullCheck も dispatch に使う）
 * - 起こせなくても release は失敗にしない（Hook は叩けている）。記録の releaseCheck に残し、alerts で知らせる
 *   （e2e-release の schedule が30分後に最新の配備を確かめるので、確かめそのものは抜けない）
 * - Hook の後に master が進むと Vercel は進んだ先を出すことがある。e2e-release は sha の子孫の配備も受ける（workflow の側）
 */
import { dispatchWorkflow } from "./analogyDispatch.js";

export const RELEASE_CHECK_WORKFLOW = "e2e-release.yml";
// release-dispatch の maxDuration（60秒）の内に収める。前の読み取り（各15秒）で時間を使った後でも、
// 関数が殺されて出した記録（released・lastReleasedSha）を失わないよう、残りから余白を引いた分だけ待つ
export const RELEASE_CHECK_TIMEOUT_MS = 15 * 1000;
export const RUN_BUDGET_MS = 60 * 1000;
export const BUDGET_MARGIN_MS = 8 * 1000;
export const MIN_TIMEOUT_MS = 2 * 1000;

/** 起こすのに使ってよい時間（ミリ秒）。startedAt が無ければ上限のまま */
export function releaseCheckTimeout(startedAt, now = Date.now()) {
  if (!Number.isFinite(startedAt)) return RELEASE_CHECK_TIMEOUT_MS;
  const left = RUN_BUDGET_MS - BUDGET_MARGIN_MS - (now - startedAt);
  return Math.min(RELEASE_CHECK_TIMEOUT_MS, left);
}

/**
 * @param {{fetchImpl: typeof fetch, token: string, sha: string, startedAt?: number}} io
 * @returns {Promise<{workflow: string, sha: string, dispatched: boolean, error?: string}>}
 */
export async function dispatchReleaseCheck({
  fetchImpl,
  token,
  sha,
  startedAt,
}) {
  const timeoutMs = releaseCheckTimeout(startedAt);
  if (timeoutMs < MIN_TIMEOUT_MS) {
    const error = "関数の時間の残りが少ないので起こさなかった";
    return { workflow: RELEASE_CHECK_WORKFLOW, sha, dispatched: false, error };
  }
  const timed = (url, init) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  try {
    await dispatchWorkflow({
      fetchImpl: timed,
      token,
      workflow: RELEASE_CHECK_WORKFLOW,
      inputs: { sha },
    });
    return { workflow: RELEASE_CHECK_WORKFLOW, sha, dispatched: true };
  } catch (error) {
    return {
      workflow: RELEASE_CHECK_WORKFLOW,
      sha,
      dispatched: false,
      error: error.message,
    };
  }
}

/** 起こせなかったときの last_report.alerts（起こせた・起こしていないなら空） */
export function releaseCheckAlerts(releaseCheck) {
  if (!releaseCheck || releaseCheck.dispatched) return [];
  return [
    {
      key: "release_check_dispatch",
      text: `本番の確かめ（${RELEASE_CHECK_WORKFLOW}）を ${releaseCheck.sha.slice(0, 8)} で起こせなかった: ${releaseCheck.error}。30分後の schedule の確かめを待つか、Actions から手で起こす`,
    },
  ];
}

/**
 * Deploy Hook を叩けた後の記録（release-dispatch の last_report と応答の本文）。確かめを起こし、結果と alerts を足す
 * @param {{fetchImpl: typeof fetch, token: string, startedAt?: number}} io
 * @param {{alerts: object[]}} report
 * @param {string} sha 出した master の先
 */
export async function releasedReport(
  { fetchImpl, token, startedAt },
  report,
  sha,
) {
  const releaseCheck = await dispatchReleaseCheck({
    fetchImpl,
    token,
    sha,
    startedAt,
  });
  return {
    ...report,
    released: true,
    lastReleasedSha: sha,
    releaseCheck,
    alerts: [...report.alerts, ...releaseCheckAlerts(releaseCheck)],
  };
}
