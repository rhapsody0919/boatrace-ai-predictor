import { internalApiHeaders } from "../api/_lib/internalApiHeaders.js";

/**
 * E2E Live（本番データ・実時刻）で /api/ を呼ぶ要求にだけ、関門（BOA-1110）の合言葉を足す。
 * replay・record と、/api/ 以外（/rest/v1・外部の host）には付けない。
 * ヘッダの名前・鍵の整え方は internalApiHeaders に任せる。鍵の値は例外の文に入れない。
 *
 * @param {string} url 取り先の URL
 * @param {Record<string, string>} headers 元のヘッダ
 * @param {{ mode: string, env?: Record<string, string|undefined> }} ctx
 * @returns {Record<string, string>}
 */
export function liveApiHeaders(url, headers, { mode, env = process.env }) {
  if (mode !== "live") return headers;
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return headers;
  }
  if (!pathname.startsWith("/api/")) return headers;
  const added = internalApiHeaders("e2e-live", env);
  if (!added["x-ryujin-internal-key"]) {
    throw new Error(
      "E2E Live は INTERNAL_API_KEY（prod-jobs の secret）が要る。e2e-live.yml の Run E2E の env に渡す",
    );
  }
  return { ...headers, ...added };
}
