// AIクローラー・SNSシェアボット向け静的スナップショット配信の対象ボット定義（ADR 0032）
// middleware.js（配信判定）とscripts/verification/verify-ai-snapshots.js（検証）の両方から読み込む

export const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "facebookexternalhit",
  "Twitterbot",
];

export function isTargetBot(userAgent) {
  if (!userAgent) return false;
  return AI_CRAWLER_USER_AGENTS.some((ua) => userAgent.includes(ua));
}

// pathname + User-Agentから、配信すべきスナップショットの相対パスを返す（対象外はnull）
export function resolveSnapshotPath(pathname, userAgent) {
  if (!isTargetBot(userAgent)) return null;

  if (pathname === "/winning-technique") {
    return "/ai-snapshots/winning-technique.html";
  }

  // /today（BOA-402）。スナップショットはビルド時生成なので、日替わりの中身は入らず
  // ページの目的と各指標の定義だけ（plan.md §5）。?date= 付きは対象にしない
  // （canonicalが常に /today で、日付別URLを検索対象にしない設計と揃える）
  if (pathname === "/today") {
    return "/ai-snapshots/today.html";
  }

  const blogMatch = pathname.match(/^\/blog\/([^/]+)$/);
  if (blogMatch) {
    return `/ai-snapshots/blog/${blogMatch[1]}.html`;
  }

  return null;
}
