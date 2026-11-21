/**
 * 本番のデプロイをまとめて出すかどうかの判定（純関数、ADR-0106）。起動と GitHub の読み取りは releaseDispatch.js。
 * 本番の版と master の比べ（同じ・祖先でない・前回が出ていない・巻き戻し）→ 差分の中身（サイトに関係ないだけか）→
 * 先の新しさ → master の検査（赤・走っている）の順に見る
 */
import { isSiteIrrelevant } from "./vercelIgnoreBuild.js";

// compare API は files を300件まで返す。300件に達したら全部を見ていないのでビルドする側に倒す
export const COMPARE_FILES_CAP = 300;
// master の先がこれより新しいと、検査の run がまだ作られていないことがある
export const FRESH_HEAD_MS = 10 * 60 * 1000;
// 自動 docs 再生成などの機械の commit の印（ADR-0078）。regenerate-generated-docs.yml は author・committer を
// action@github.com にして題を「… [automated]」で終える。題だけ・メールだけでは除かない（両方そろったものだけ）。
// 人の merge は committer が GitHub（noreply@github.com）になるので、題だけ偽っても当たらない
export const AUTOMATED_COMMIT_EMAIL = "action@github.com";
export const isAutomatedCommit = (c) =>
  c?.authorEmail === AUTOMATED_COMMIT_EMAIL &&
  c?.committerEmail === AUTOMATED_COMMIT_EMAIL &&
  /\[automated\]\s*$/.test((c?.message ?? "").split("\n")[0]);

/**
 * 先の新しさの判定に使う時刻。先から自動 commit を除いた、最後の人・作り手の commit の時刻。
 * 範囲（compare の commits、古い順）が読めない・全部が自動のときは先の時刻（今までどおり）。
 * FRESH_HEAD_MS の目的（検査の run がまだ無い版を出さない）は、人の commit が新しければ今までどおり働く。
 * 自動 commit の run は quality-gates・post-merge-checks で skipped になる（ADR-0106）ので待つ理由にならない
 */
export function freshnessBasis(head, commits) {
  const list = Array.isArray(commits) ? commits : [];
  if (list.length === 0 || list[list.length - 1]?.sha !== head.sha) {
    return head.committedAt;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (!isAutomatedCommit(list[i])) return list[i].committedAt;
  }
  return head.committedAt;
}

/** 本番の版と master の比べだけで決まる答え（同じ・祖先でない・前回が出ていない・巻き戻し）。無ければ null */
function lineageDecision({ deployedSha, compare, previous, stuck }) {
  if (compare.status === "identical") {
    return ["none", "本番は master の先と同じ"];
  }
  if (compare.status !== "ahead") {
    // behind・diverged: 本番の版が master に無い（force push・別の枝から出した 等）。黙って上書きしない
    return [
      "error",
      `本番の版 ${deployedSha.slice(0, 9)} が master の祖先ではない（compare の status: ${compare.status}）`,
    ];
  }
  if (stuck) {
    // ビルドの失敗と、出た後の Instant Rollback（A→B を出した後に A へ戻した）は、本番の版だけでは区別できない。
    // 戻した本番に壊れた版を出し直さないよう、自動では叩かない。本番の版が動けば（手で出す等）自動に戻る
    return [
      "error",
      `前回叩いた版（${previous.masterSha?.slice(0, 9) ?? "?"}）が本番に出ていない（本番の版は ${deployedSha.slice(0, 9)} のまま）。` +
        "ビルドの失敗か、出た後の Instant Rollback。自動では出し直さない。Vercel で確かめ、直したら手で出す（ADR-0106「手で出す」）",
    ];
  }
  if (
    previous?.lastReleasedSha &&
    compare.commitShas.includes(previous.lastReleasedSha)
  ) {
    return [
      "error",
      `本番の版 ${deployedSha.slice(0, 9)} が前に出した版 ${previous.lastReleasedSha.slice(0, 9)} より古い（Instant Rollback？）。` +
        "巻き戻した本番に master を出し直さない。master を直して手で出すか、release_dispatch の mode を off にする",
    ];
  }
  return null;
}

/** 落ちた検査の1件の書き方（workflow=結論（sha、解けていない物）） */
const redGateText = (g) =>
  `${g.workflow}=${g.conclusion}（${g.headSha.slice(0, 9)}${g.unresolved?.length ? `、${g.unresolved.join("・")}` : ""}）`;

/** 差分の中身と master の検査で決まる答え（出す・待つ・止める・何もしない） */
function contentDecision({ head, compare, gates, now }) {
  const paths = compare.files.flatMap((f) =>
    f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
  );
  const capped = compare.files.length >= COMPARE_FILES_CAP;
  if (!capped && paths.every(isSiteIrrelevant)) {
    // 変更が打ち消し合って files が空のときも含む（中身が同じ木を出し直さない）
    return [
      "none",
      paths.length === 0
        ? "差分のファイルが無い（変更と戻しが打ち消し合った 等）"
        : `サイトに関係ない差分だけ（${paths.length}件）`,
    ];
  }
  if (
    now.getTime() - Date.parse(freshnessBasis(head, compare.commits)) <
    FRESH_HEAD_MS
  ) {
    return [
      "deferred",
      `master の先 ${head.sha.slice(0, 9)}（自動 commit を除く）が10分以内のコミット（検査の run がまだ無いことがある）`,
    ];
  }
  const red = gates.filter((g) => g.state === "red");
  if (red.length > 0) {
    return [
      "blocked",
      `master の検査が通っていない: ${red.map(redGateText).join(", ")}`,
    ];
  }
  const pending = gates.filter((g) => g.state === "pending");
  if (pending.length > 0) {
    return [
      "deferred",
      `master の検査が走っている: ${pending.map((g) => `${g.workflow}（${g.headSha.slice(0, 9)}）`).join(", ")}`,
    ];
  }
  return [
    "release",
    capped
      ? `差分が ${COMPARE_FILES_CAP} 件以上（全部は見ていない）`
      : `サイトに関わる差分がある（${paths.length}件）`,
  ];
}

/**
 * 出すかどうか（純関数）
 * @param {{
 *   deployedSha: string,
 *   head: {sha: string, committedAt: string},
 *   compare: {status: string, files: {filename: string, previous_filename?: string}[], commitShas: string[]},
 *   gates: ReturnType<typeof import("./releaseDispatch.js").summarizeGates>,
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
  const [action, reason] =
    lineageDecision({
      deployedSha,
      compare,
      previous,
      stuck,
    }) ?? contentDecision({ head, compare, gates, now });
  return { action, reason, stuck };
}
