/**
 * SNSマーケティングハブ管理画面（/admin/sns-hub）用のBasic認証。
 * 対象パスのみをmatcherで限定し、他ページ・他APIには一切影響しない。
 * 認証情報は環境変数（SNS_HUB_BASIC_AUTH_USER / SNS_HUB_BASIC_AUTH_PASSWORD）で管理する。
 * 未設定の場合、比較対象がundefinedになり常に認証失敗する（fail-closed、意図した挙動）。
 */

export const config = {
  matcher: [
    "/admin/sns-hub",
    "/admin/sns-hub/:path*",
    "/api/admin/sns-hub/:path*",
  ],
};

const UNAUTHORIZED_RESPONSE = () =>
  new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="SNS Marketing Hub"',
    },
  });

export default function middleware(request) {
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
