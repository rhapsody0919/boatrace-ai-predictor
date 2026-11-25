/**
 * 本番を相手にする E2E の赤を前の完了 run の赤（基準）と比べ、知らせるかを決める純関数（設計 docs/design/harness-migration/design.md §2）。
 * CLI（基準の取得・レポートの読み・GITHUB_OUTPUT）は次の PR の e2e-new-reds.js。
 *
 * 前は hq（Mac）の deploy-guard が同じ引き算をしていた。龍神の workflow は赤のたびに Slack を鳴らし、
 * 同じ赤（例: 2026-11-20〜21 の release の確かめ5回）が毎回届いて新しい赤が埋もれていた。
 * - 続いている赤も、前に知らせてから RENOTIFY_MS（24時間）たてば鳴らし直す（黙ったまま忘れられないように）
 * - 組が欠けた run（incomplete）は比べられないので鳴らす（その run の鍵を基準に残さないのは CLI の側）
 *
 * 検証: scripts/maintenance/verify-e2e-new-reds.js
 */
export const ARTIFACT = "e2e-red-keys";
export const BASELINE_SEARCH = 5;
export const RENOTIFY_MS = 24 * 3600 * 1000;
// Slack に並べる赤の上限（多いときは件数だけ書く）と文の上限（section の text は3000字まで。定型文の分を残す）
export const MAX_LISTED = 15;
export const MAX_TEXT = 2400;

const NONE = { fresh: [], renotify: [], kept: [], notifiedAt: {} };

/**
 * 知らせるか（純関数）。
 * @param {{failed: boolean, incomplete?: boolean, current: string[]|null,
 *   baseline: {keys: string[], notifiedAt?: Record<string, string>}|null, now: Date}} input
 *   failed＝試験の段か配備の確かめが成功しなかった。incomplete＝組の欠け・網羅の検査の落ち。
 *   current＝今の赤（null はレポートが無い）。baseline＝基準（null は基準なし）
 * @returns {{notify: boolean, reason: string, fresh: string[], renotify: string[], kept: string[],
 *   notifiedAt: Record<string, string>}} notifiedAt は次の基準に残す「最後に知らせた時刻」
 */
export function decideNotify({
  failed,
  incomplete = false,
  current,
  baseline,
  now,
}) {
  if (!failed) return { notify: false, reason: "green", ...NONE };
  if (current === null) return { notify: true, reason: "no_report", ...NONE };
  if (incomplete) return { notify: true, reason: "incomplete", ...NONE };
  if (current.length === 0) {
    // 試験は全部通ったのに失敗＝後の step の落ち。比べる物が無いので知らせる
    return { notify: true, reason: "other_failure", ...NONE };
  }
  const base = new Set(baseline?.keys ?? []);
  const lastAt = baseline?.notifiedAt ?? {};
  // 前に知らせた時刻が無い・読めない鍵は「24時間たった」と同じに扱う（鳴らす側）
  const due = (k) =>
    !(now.getTime() - Date.parse(lastAt[k] ?? "") < RENOTIFY_MS);
  const fresh = current.filter((k) => !base.has(k));
  const renotify = current.filter((k) => base.has(k) && due(k));
  const kept = current.filter((k) => base.has(k) && !due(k));
  const notify = fresh.length + renotify.length > 0;
  const stamp = now.toISOString();
  const notifiedAt = Object.fromEntries(
    current.map((k) => [k, kept.includes(k) ? lastAt[k] : stamp]),
  );
  const reason =
    baseline === null ? "no_baseline" : notify ? "new_red" : "same_red";
  return { notify, reason, fresh, renotify, kept, notifiedAt };
}

const HEADS = {
  green: "赤なし",
  no_report: "試験の前に落ちた（レポートが無い）。前の赤と比べられない",
  incomplete: "組が欠けたか網羅の検査が落ちた。前の赤と比べられない",
  other_failure: "試験は全部通ったが、後の検査か step が落ちた",
  no_baseline: "前の run の記録が無いので、今の赤を全部新しい赤として出す",
  new_red: "前の run に無かった赤か、24時間ぶりの続いている赤がある",
  same_red: "赤は全部、前に知らせた物と同じ（知らせない）",
};

const listOf = (title, keys) =>
  keys.length === 0
    ? []
    : [
        `${title}: ${keys.length} 件`,
        ...keys.slice(0, MAX_LISTED).map((k) => `• ${k}`),
        ...(keys.length > MAX_LISTED
          ? [`…ほか ${keys.length - MAX_LISTED} 件`]
          : []),
      ];

/** Slack に載せる文（決定の答えから。知らせないときも step summary に使う） */
export function noticeText({ reason, fresh, renotify, kept }) {
  const lines = [
    HEADS[reason],
    ...listOf("新しい赤", fresh),
    ...listOf("続いている赤（24時間ぶり）", renotify),
    ...(kept.length > 0
      ? [`続いている赤（前に知らせた）: ${kept.length} 件`]
      : []),
  ];
  const text = lines.join("\n");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** gh run list の答え（新しい順）から、基準を探す run の id（今の run を除く、master・完了だけ） */
export function baselineCandidates(runs, currentRunId) {
  return runs
    .filter((r) => String(r.databaseId) !== String(currentRunId))
    .filter((r) => r.headBranch === "master" && r.status === "completed")
    .slice(0, BASELINE_SEARCH)
    .map((r) => String(r.databaseId));
}
