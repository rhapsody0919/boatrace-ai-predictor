/**
 * ルーティングミドルウェア。以下2つの関心事を1ファイルで扱う（Vercelはmiddleware.jsを
 * 1つしか置けない制約のため、matcherで対象パスを絞りつつパスで分岐する）。
 *
 * 1. 管理画面（/admin/sns-hub・/admin/rules）用のBasic認証
 *    認証情報は環境変数（SNS_HUB_BASIC_AUTH_USER / SNS_HUB_BASIC_AUTH_PASSWORD）で管理する。
 *    /admin/rules も同じ認証情報・realmを使う（BOA-555。1回のログインで両方開ける）。
 *    判定は管理APIの関数側と同じ requireAdminAuth（api/_lib/adminAuth.js）を使う。
 *    環境変数が未設定・空なら常に拒否（fail-closed）、一定時間比較、パスワードは最初の ":" で分割。
 *
 *    ⚠️ ここで守れるのはURLを直接開いたときだけ。画面のJSとデータ取得（Supabaseのanonキー）は
 *    公開バンドルに含まれるため、データそのものの保護にはならない
 *
 * 2. AIクローラー・SNSシェアボット向け静的スナップショット配信（ADR 0032）
 *    対象ボットのリクエストのみ、ビルド時生成済みの静的HTML（dist/ai-snapshots/）へ
 *    rewriteする。通常ユーザー・Googlebotの挙動には影響しない。
 */
import { rewrite } from "@vercel/functions";
import { resolveSnapshotPath } from "./src/config/aiCrawlerBots.js";
import { requireAdminAuth } from "./api/_lib/adminAuth.js";

export const config = {
  matcher: [
    "/admin/sns-hub",
    "/admin/sns-hub/:path*",
    "/api/admin/sns-hub/:path*",
    "/admin/rules",
    "/admin/rules/:path*",
    "/blog/:path*",
    "/winning-technique",
    // resolveSnapshotPath に対象を足すだけでは配信されない。Vercel は
    // matcher に一致したパスでしか middleware を起動しないため、必ず両方に足す
    "/today",
  ],
};

const ADMIN_PATH_PREFIXES = ["/admin/sns-hub", "/api/admin/sns-hub", "/admin/rules"];

const isAdminPath = (pathname) =>
  ADMIN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

// 認証が通れば undefined（素通り）、通らなければ 401。
// 401 の realm・Cache-Control: no-store（モバイルChromeが401をキャッシュする不具合への対策、
// 2026-08-29）は requireAdminAuth 側で付ける
async function handleAdminAuth(request) {
  return (await requireAdminAuth(request)) ?? undefined;
}

export default function middleware(request) {
  const url = new URL(request.url);

  if (isAdminPath(url.pathname)) {
    return handleAdminAuth(request);
  }

  const snapshotPath = resolveSnapshotPath(
    url.pathname,
    request.headers.get("user-agent"),
  );
  if (snapshotPath) {
    return rewrite(new URL(snapshotPath, request.url));
  }
}
