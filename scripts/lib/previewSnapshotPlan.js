/**
 * ブログ記事・翻訳記事・ブログ一覧のボット向けスナップショットを、このビルドで作るか（Vercel の費用、2026-11-05、ADR 0032 追記）。
 *
 * - 本番・手元のビルド（VERCEL_ENV が preview 以外）: 今までどおり作る
 * - Preview: 既定では作らない（Preview 1本の CPU の約4割）。Preview でボット向け HTML を確かめたい PR だけ、
 *   最新のコミットのメッセージに `[bot-html]` を入れる（空のコミットでよい）か、
 *   その枝の Preview の環境変数 BOT_SNAPSHOTS_ON_PREVIEW=1 で作る
 *
 * 選手ページは別の判定（racerSnapshotPlan.js。Preview では RACER_SNAPSHOT_LIMIT のときだけ）。図の PNG（ADR 0099）は常に作る。
 */
export const PREVIEW_BOT_HTML_MARKER = "[bot-html]";

/**
 * @param {{ vercelEnv?: string, commitMessage?: string, optIn?: string }} input
 * @returns {{ build: boolean, reason: string }}
 */
export function planBlogSnapshots({ vercelEnv, commitMessage, optIn }) {
  if (vercelEnv !== "preview") {
    return { build: true, reason: `作る（VERCEL_ENV=${vercelEnv ?? "なし"}）` };
  }
  if (optIn === "1" || optIn === "true") {
    return { build: true, reason: "作る（Preview、BOT_SNAPSHOTS_ON_PREVIEW）" };
  }
  if ((commitMessage ?? "").includes(PREVIEW_BOT_HTML_MARKER)) {
    return {
      build: true,
      reason: `作る（Preview、コミットのメッセージに ${PREVIEW_BOT_HTML_MARKER}）`,
    };
  }
  return {
    build: false,
    reason: `Preview の既定では作らない。確かめるときは最新のコミットのメッセージに ${PREVIEW_BOT_HTML_MARKER} を入れる`,
  };
}
