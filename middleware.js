/**
 * ルーティングミドルウェア。以下2つの関心事を1ファイルで扱う（Vercelはmiddleware.jsを
 * 1つしか置けない制約のため、matcherで対象パスを絞りつつパスで分岐する）。
 *
 * 1. SNSマーケティングハブ管理画面（/admin/sns-hub）用のBasic認証
 *    認証情報は環境変数（SNS_HUB_BASIC_AUTH_USER / SNS_HUB_BASIC_AUTH_PASSWORD）で管理する。
 *    未設定の場合、比較対象がundefinedになり常に認証失敗する（fail-closed、意図した挙動）。
 *
 * 2. AIクローラー・SNSシェアボット向け静的スナップショット配信（ADR 0032）
 *    対象ボットのリクエストのみ、ビルド時生成済みの静的HTML（dist/ai-snapshots/）へ
 *    rewriteする。通常ユーザー・Googlebotの挙動には影響しない。
 */
import { rewrite } from "@vercel/functions";
import { resolveSnapshotPath } from "./src/config/aiCrawlerBots.js";

export const config = {
  matcher: [
    "/admin/sns-hub",
    "/admin/sns-hub/:path*",
    "/api/admin/sns-hub/:path*",
    "/blog/:path*",
    "/winning-technique",
  ],
};

// Cache-Control: no-storeが無いと、モバイルChromeがアドレスバー入力時の
// プリフェッチで送るリクエストへの401レスポンスをキャッシュしてしまい、
// 実際のナビゲーション時に認証ダイアログを経由せずキャッシュ済み401が
// そのまま表示される不具合が発生する（2026-08-29、モバイルChromeで確認）
const UNAUTHORIZED_RESPONSE = () =>
  new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="SNS Marketing Hub"',
      "Cache-Control": "no-store",
    },
  });

function handleSnsHubAuth(request) {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Basic ")) {
    const encoded = authHeader.slice("Basic ".length);
    const [user, password] = atob(encoded).split(":");

    if (
      user === process.env.SNS_HUB_BASIC_AUTH_USER &&
      password === process.env.SNS_HUB_BASIC_AUTH_PASSWORD
    ) {
      return;
    }
  }

  return UNAUTHORIZED_RESPONSE();
}

export default function middleware(request) {
  const url = new URL(request.url);

  if (
    url.pathname.startsWith("/admin/sns-hub") ||
    url.pathname.startsWith("/api/admin/sns-hub")
  ) {
    return handleSnsHubAuth(request);
  }

  const snapshotPath = resolveSnapshotPath(
    url.pathname,
    request.headers.get("user-agent"),
  );
  if (snapshotPath) {
    return rewrite(new URL(snapshotPath, request.url));
  }
}
