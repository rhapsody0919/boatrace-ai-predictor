// AIクローラー・SNSシェアボット向け静的スナップショット配信の対象ボット定義（ADR 0032）
// middleware.js（配信判定）とscripts/verification/verify-ai-snapshots.js（検証）の両方から読み込む

// Googlebot は入れない（JS を描画して人間と同じ画面を見るため。UA で出し分けない）
export const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "facebookexternalhit",
  "Twitterbot",
  // 検索の出典・ユーザーの質問時の取得に使う UA（docs/proposal/ai-agent-era-strategy.md Phase 0）。
  // ChatGPT 検索の出典に出るには OAI-SearchBot が要る（OpenAI の bots ドキュメント）
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "Perplexity-User",
  "bingbot",
  "Applebot",
  "DuckDuckBot",
];

export function isTargetBot(userAgent) {
  if (!userAgent) return false;
  return AI_CRAWLER_USER_AGENTS.some((ua) => userAgent.includes(ua));
}

// pathname + User-Agentから、配信すべきスナップショットの相対パスを返す（対象外はnull）
// ⚠️ ここに対象を足したら middleware.js の config.matcher にも同じパスを足すこと。
//    Vercel は matcher に一致したパスでしか middleware を起動しないため、片方だけでは配信されない
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
