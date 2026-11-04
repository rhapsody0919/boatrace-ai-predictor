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
 *
 * 3. /api の関門（BOA-1110 段階3、ADR-0103、docs/design/public-api-lockdown/plan.md §2.2）
 *    /api/* を api/_lib/apiGate.js の decideApiGate で判定し、1行の JSON ログ（{"api_gate":reason,…}）を出す。
 *    API_GATE_MODE が未設定・observe の間は通す（would_deny もログだけ）。デコード後に「.」「..」のセグメント・
 *    「//」・「\」を含むパスだけは段階に依らず 400。enforce（段階4）は環境変数と Redeploy だけで入る。
 *    除外（/api/cron・/api/admin・/api/bot-page）はログも出さず、既存の守り（下の Basic 認証等）へ進む
 */
import { ipAddress, rewrite } from "@vercel/functions";
import { resolveSnapshotPath } from "./src/config/aiCrawlerBots.js";
import { requireAdminAuth } from "./api/_lib/adminAuth.js";
import {
  compileIpRanges,
  decideApiGate,
  gateKeysFromEnv,
  gateLogRecord,
  gateRejectResponse,
  normalizeGateMode,
} from "./api/_lib/apiGate.js";
import searchBotIpRanges from "./api/_lib/searchBotIpRanges.js";

export const config = {
  matcher: [
    // BOA-1110 段階3: /api の関門。matcher はデコード前のパスで照合するので、除外の判定は関門の中でデコードして行う
    "/api/:path*",
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
    "/x/today",
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
    // BOA-848 第2段: 本日のレース詳細とその言語版（id の形と「本日」の判定は resolveSnapshotPath 側）
    "/race/:path*",
    "/en/race/:path*",
    "/zh-TW/race/:path*",
    "/ko/race/:path*",
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

// 範囲の表は1回だけ読む。読めなければ検索ボットの経路が無いだけにする（middleware 全体を落とさない。
// 表は verify-api-gate.js が CI で読めることを固定している）
let compiledIpRanges = null;
function ipRanges() {
  if (compiledIpRanges) return compiledIpRanges;
  try {
    compiledIpRanges = compileIpRanges(searchBotIpRanges);
  } catch (error) {
    console.error(
      JSON.stringify({ api_gate: "error", message: `IP の範囲の表: ${error.message}` }),
    );
    compiledIpRanges = [];
  }
  return compiledIpRanges;
}

/**
 * /api の関門。通すなら undefined（次の分岐へ）、拒むなら 400・403 の Response。
 * @param {Request} request
 * @param {Record<string, string|undefined>} [env] 既定は process.env（試験で差し替える）
 */
export async function handleApiGate(request, env = process.env) {
  const mode = normalizeGateMode(env.API_GATE_MODE);
  const keys = gateKeysFromEnv(env);
  const decision = await decideApiGate({
    url: request.url,
    headers: request.headers,
    ip: ipAddress(request) ?? null, // Vercel が付ける接続元 IP（x-real-ip）
    mode,
    keys,
    ipRanges: ipRanges(),
  });
  const record = gateLogRecord(decision, {
    mode,
    method: request.method,
    keys,
  });
  if (record) console.log(JSON.stringify(record));
  return decision.outcome === "reject"
    ? gateRejectResponse(decision.status)
    : undefined;
}

const isApiPath = (pathname) =>
  pathname.toLowerCase() === "/api" || pathname.toLowerCase().startsWith("/api/");

export default async function middleware(request) {
  const url = new URL(request.url);

  if (isApiPath(url.pathname)) {
    const rejected = await handleApiGate(request);
    if (rejected) return rejected;
  }

  if (isAdminPath(url.pathname)) {
    return handleAdminAuth(request);
  }

  if (url.pathname === "/x/today") {
    const target = new URL("/today", url);
    target.searchParams.set("utm_source", "x");
    target.searchParams.set("utm_medium", "social");
    target.searchParams.set("utm_campaign", "today_digest");
    const content = url.searchParams.get("d");
    // 札は型 a・b と、今の型 v3 の c（BOA-1314）
    if (/^\d{4}-\d{2}-\d{2}-[abc]$/.test(content ?? "")) {
      target.searchParams.set("utm_content", content);
    }
    return Response.redirect(target, 302);
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
