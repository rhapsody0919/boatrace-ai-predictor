/**
 * 必須チェック。ruleset「master-checks」の必須チェックと同じ集合（どちらかを変えたらもう片方も変える）。
 * onFailure: 終わって成功以外のときの判定。e2e は録画に無い通信を本番へ素通しするため DB の状態で
 * 落ちることがあり（ADR-0077）、止めずに確認を挟む。
 */
const REQUIRED_CHECKS = [
  {
    name: "verify",
    onFailure: "deny",
    duration: "実測で1分半程度",
    failureNote:
      "verify は verify-registry.json の tier=ci をまとめて実行しており、マイグレーション番号の重複・" +
      "ADR番号の重複・sitemap登録漏れ等を検知します。内容を確認して直してからマージしてください",
  },
  {
    name: "ml-tests",
    onFailure: "deny",
    duration: "scripts/ml/ を変えていなければ数十秒",
    failureNote:
      "ml-tests は scripts/ml/analogy/tests の pytest です。内容を確認して直してからマージしてください",
  },
  {
    name: "e2e",
    onFailure: "ask",
    duration:
      "e2e/shards.json の組が並行で走る（記事だけの PR は軽い組、docs だけの PR は0件）。止まって終わらないときは " +
      "node scripts/maintenance/e2e-rerun.js で再実行を判定できます",
    failureNote:
      "e2eは録画（HAR）の再生で決定的に実行するが、録画に無い通信は本番へ素通しするため、" +
      "DBの状態で落ちることがあります（ADR-0077）。自動では止めませんが、コードの退行でないことを確認してから" +
      "マージしてください（再実行の判定: node scripts/maintenance/e2e-rerun.js）",
  },
];
export const REQUIRED_CHECK_NAMES = REQUIRED_CHECKS.map((c) => c.name);
/** まだ結果が出ていない状態。落ちたのではないので「待て」に倒す。 */
const RUNNING_STATES = new Set([
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "WAITING",
  "REQUESTED",
]);

/** 1つの必須チェックの判定。問題が無ければ null。 */
function judgeOneCheck(pr, spec, check) {
  if (!check) {
    return {
      decision: "ask",
      reason:
        `PR #${pr} に必須チェック（${spec.name}）の結果がまだありません。` +
        `ワークフローが走り終わるのを待つか、待たない理由を述べてからマージしてください（gh pr checks ${pr}）。`,
    };
  }
  // BOA-769 D（2026-10-12〜）: e2e の実行中も待たせる。以前は素通しにしていたため、走り終わる前に
  // マージできてしまった。手元のE2E全件実行をやめ、CIとこのガードだけでデグレを検知する運用のため
  if (RUNNING_STATES.has(check.state)) {
    return {
      decision: "ask",
      reason:
        `PR #${pr} の ${spec.name} はまだ実行中です（${check.state}）。` +
        `結果が出てからマージしてください（${spec.duration}）。`,
    };
  }
  if (check.state !== "SUCCESS") {
    return {
      decision: spec.onFailure,
      reason:
        `PR #${pr} の ${spec.name} が ${check.state} です。${spec.failureNote}` +
        `（gh pr checks ${pr}）。`,
    };
  }
  return null;
}

/**
 * チェック一覧から判定する。止まる側も検証できるよう、ghの呼び出しとは分けてある
 * （「素通しだけ確かめて、止まることを一度も確かめていない」ゲートにしないため）。
 * 必須チェックを全部見て、deny が1つでもあれば deny、無ければ最初の ask を返す。止める必要が無ければ null。
 */
export function judgeChecks(pr, checks) {
  if (!Array.isArray(checks)) return null;
  const results = REQUIRED_CHECKS.map((spec) =>
    judgeOneCheck(
      pr,
      spec,
      checks.find((c) => c.name === spec.name),
    ),
  ).filter(Boolean);
  return results.find((r) => r.decision === "deny") ?? results[0] ?? null;
}

/**
 * `gh api repos/{owner}/{repo}/rules/branches/master` の結果に、REQUIRED_CHECKS が全部
 * 必須チェックとして入っているか。入っていれば --auto のマージは GitHub がチェックを待つ。
 * 配列でない（API の失敗等）・足りないときは false（ローカルで検査する側に倒す）。
 */
export function rulesetEnforcesChecks(rules) {
  if (!Array.isArray(rules)) return false;
  const contexts = new Set(
    rules
      .filter((r) => r?.type === "required_status_checks")
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c?.context),
  );
  return REQUIRED_CHECK_NAMES.every((name) => contexts.has(name));
}
