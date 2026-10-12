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

// 日替わりページ（/ と /venue/1〜24）のボット向け HTML を出す UA（ADR 0089 決定1）。
// 今は AI_CRAWLER_USER_AGENTS と同じ。検索ボット（bingbot・Applebot・DuckDuckBot）だけ止めるときは、
// ここから外す（ブログ等のスナップショットには残る）
export const BOT_PAGE_USER_AGENTS = [...AI_CRAWLER_USER_AGENTS];

const includesAny = (userAgent, list) =>
  Boolean(userAgent) && list.some((ua) => userAgent.includes(ua));

export function isTargetBot(userAgent) {
  return includesAny(userAgent, AI_CRAWLER_USER_AGENTS);
}

// 人の URL と同じ 1〜24（0埋めなし）。api/_lib/botPage.js の VENUE_CODE と同じ範囲
const BOT_PAGE_VENUE_PATH = /^\/venue\/([1-9]|1\d|2[0-4])$/;

// 言語版を出す言語（BOA-848 第2段）。api/_lib/botPage.js の BOT_PAGE_PREFIXED_LANGS と同じ
// （middleware から読むので languages.js は import しない。一致は verify-middleware-routing.js で固定）
export const BOT_PAGE_PREFIXED_LANGS = ["en", "zh-TW", "ko"];
const BOT_PAGE_LANG_TOP_PATH = /^\/(en|zh-TW|ko)\/?$/;
const BOT_PAGE_LANG_VENUE_PATH = /^\/(en|zh-TW|ko)\/venue\/([1-9]|1\d|2[0-4])$/;

// / と /venue/1〜24（ADR 0089 決定2）と、その言語版 /{en|zh-TW|ko}/・/{lang}/venue/1〜24（BOA-848 第2段）。
// /venue/01・範囲外・ほかの言語・ほかのパスは null。言語版は言語ごとに rewrite 先を分ける（CDN のキーを言語で分ける）
function resolveBotPagePath(pathname, userAgent) {
  if (!includesAny(userAgent, BOT_PAGE_USER_AGENTS)) return null;
  if (pathname === "/") return "/api/bot-page/top";
  const venueMatch = pathname.match(BOT_PAGE_VENUE_PATH);
  if (venueMatch) return `/api/bot-page/venue/${venueMatch[1]}`;
  const langTop = pathname.match(BOT_PAGE_LANG_TOP_PATH);
  if (langTop) return `/api/bot-page/${langTop[1]}/top`;
  const langVenue = pathname.match(BOT_PAGE_LANG_VENUE_PATH);
  if (langVenue) return `/api/bot-page/${langVenue[1]}/venue/${langVenue[2]}`;
  return null;
}

// 選手ページ（/racer/:racerId、BOA-848）。登録番号は4桁（sitemap の選手 URL はすべて4桁）。
// 言語の接頭辞は付けない（選手ページは ja 専用）。スナップショットは sitemap に載る選手だけ作るので、
// 作っていない番号はファイルが無く、vercel.json の catch-all で SPA の外枠に戻る（ブログと同じ）
const RACER_PATH = /^\/racer\/(\d{4})$/;

// pathname + User-Agentから、配信すべきスナップショット（または ADR 0089 の関数）の相対パスを返す（配らないときはnull）
// 返すパスにクエリ文字列は付けない（middleware は rewrite 先に元のクエリを持ち込まない）
// ⚠️ ここに対象を足したら middleware.js の config.matcher にも同じパスを足すこと。
//    Vercel は matcher に一致したパスでしか middleware を起動しないため、片方だけでは配信されない
export function resolveSnapshotPath(pathname, userAgent) {
  const botPagePath = resolveBotPagePath(pathname, userAgent);
  if (botPagePath) return botPagePath;

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

  const racerMatch = pathname.match(RACER_PATH);
  if (racerMatch) {
    return `/ai-snapshots/racer/${racerMatch[1]}.html`;
  }

  const blogMatch = pathname.match(/^\/blog\/([^/]+)$/);
  if (blogMatch) {
    return `/ai-snapshots/blog/${blogMatch[1]}.html`;
  }

  return null;
}
