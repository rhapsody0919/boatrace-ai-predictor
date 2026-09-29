/**
 * 管理API（api/admin/ 配下）の関数側Basic認証。
 *
 * middleware.js も同じBasic認証をかけているが、middleware は config.matcher に
 * 一致したときしか起動せず、matcher はデコード前のパスで照合される。
 * 2026-09-29、本番で `/api/admin/sns-h%75b/drafts`（u を %75 にしたもの）が
 * middleware を通らずに関数へ届き、認証なしで 200 を返すことを確認した。
 * そのため各ハンドラの先頭でもこの関数を呼び、関数自身で認証を完結させる（多層防御）。
 *
 * middleware.js（/admin/sns-hub・/admin/rules・/api/admin/sns-hub の入口）もこの関数で判定する。
 * 判定ロジックを1か所に置き、入口と関数側で食い違わないようにするため。
 * 認証情報は SNS_HUB_BASIC_AUTH_USER / SNS_HUB_BASIC_AUTH_PASSWORD。
 * どちらかが未設定・空なら常に拒否する（fail-closed）。
 * Edge ランタイムで動かすため、Node の crypto.timingSafeEqual ではなく Web Crypto を使う。
 */

export const ADMIN_AUTH_REALM = "SNS Marketing Hub";

function unauthorizedResponse() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${ADMIN_AUTH_REALM}"`,
      // 無いと、モバイルChromeがアドレスバー入力時のプリフェッチで受けた401をキャッシュし、
      // 実際のナビゲーションで認証ダイアログを出さずに401を表示する（2026-08-29確認）
      "Cache-Control": "no-store",
    },
  });
}

/**
 * 長さに依存しない一定時間比較。両方を SHA-256 にかけて固定長32バイトにしてから
 * 全バイトを XOR で比べるので、入力の長さや一致した位置で処理時間が変わらない。
 */
async function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

/**
 * Authorization ヘッダーから user / password を取り出す。
 * パスワードに ":" が含まれても壊れないよう、最初の ":" だけで分割する（RFC 7617）。
 * 取り出せなければ null。
 */
function parseBasicAuth(authHeader) {
  const match = /^Basic\s+(\S+)\s*$/i.exec(authHeader ?? "");
  if (!match) return null;

  let decoded;
  try {
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return {
    user: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

/**
 * 認証が通れば null、通らなければ返すべき 401 の Response を返す。
 * 呼び出し側: `const denied = await requireAdminAuth(req); if (denied) return denied;`
 */
export async function requireAdminAuth(request) {
  const expectedUser = process.env.SNS_HUB_BASIC_AUTH_USER;
  const expectedPassword = process.env.SNS_HUB_BASIC_AUTH_PASSWORD;
  if (!expectedUser || !expectedPassword) return unauthorizedResponse();

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  if (!credentials) return unauthorizedResponse();

  // 片方が不一致でも両方を比較し、どちらで落ちたかを時間差で漏らさない
  const [userOk, passwordOk] = await Promise.all([
    constantTimeEqual(credentials.user, expectedUser),
    constantTimeEqual(credentials.password, expectedPassword),
  ]);
  return userOk && passwordOk ? null : unauthorizedResponse();
}
