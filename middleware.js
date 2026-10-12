/**
 * ルーティングミドルウェア。以下2つの関心事を1ファイルで扱う（Vercelはmiddleware.jsを
 * 1つしか置けない制約のため、matcherで対象パスを絞りつつパスで分岐する）。
 *
 * 1. 管理画面（/admin/sns-hub・/admin/rules）と管理API（/api/admin/sns-hub・/api/admin/rules）用のBasic認証
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
 *    rewriteする（ブログ・翻訳記事・ブログ一覧・/winning-technique・選手ページ）。通常ユーザー・Googlebotの挙動には影響しない。
 *    / と /venue/1〜24 とその言語版（/en/ 等）と /today（?date= なし）は、同じ UA のときだけ関数（/api/bot-page/*）へ rewrite する（ADR 0089、BOA-848）
 */
import { rewrite } from "@vercel/functions";
import { resolveSnapshotPath } from "./src/config/aiCrawlerBots.js";
import { requireAdminAuth } from "./api/_lib/adminAuth.js";

export const config = {
  matcher: [
    "/admin/sns-hub",
    "/admin/sns-hub/:path*",
    "/api/admin/sns-hub/:path*",
    "/api/admin/rules/:path*",
    "/admin/rules",
    "/admin/rules/:path*",
    "/blog/:path*",
    "/winning-technique",
    // resolveSnapshotPath に対象を足すだけでは配信されない。Vercel は
    // matcher に一致したパスでしか middleware を起動しないため、必ず両方に足す
    "/today",
    // BOA-848 第2段: 翻訳記事とブログ一覧（/blog は上の "/blog/:path*" に含まれる）
    "/en/blog/:path*",
    "/zh-TW/blog/:path*",
    "/ko/blog/:path*",
    // BOA-848: 選手ページ（番号の形の判定は resolveSnapshotPath 側）
    "/racer/:path*",
    // ADR 0089: 日本語の / と /venue/1〜24（範囲の判定は resolveSnapshotPath 側）
    "/",
    "/venue/:path*",
    // BOA-848 第2段: 言語版の / と /venue/1〜24（範囲の判定は resolveSnapshotPath 側）
    "/en",
    "/en/",
    "/en/venue/:path*",
    "/zh-TW",
    "/zh-TW/",
    "/zh-TW/venue/:path*",
    "/ko",
    "/ko/",
    "/ko/venue/:path*",
  ],
};

const ADMIN_PATH_PREFIXES = [
  "/admin/sns-hub",
  "/api/admin/sns-hub",
  "/admin/rules",
  "/api/admin/rules",
];

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
    url.search,
  );
  if (snapshotPath) {
    // snapshotPath はパスだけなので、new URL で元のクエリ文字列は落ちる（rewrite 先に持ち込まない）。
    // /?x=1 と /?x=2 で関数の CDN キャッシュのキーを増やさないため（ADR 0089 決定6）
    return rewrite(new URL(snapshotPath, request.url));
  }
}
