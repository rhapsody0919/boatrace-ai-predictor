import { internalApiHeaders } from "../api/_lib/internalApiHeaders.js";

/**
 * 本番の /api/ に出る E2E の要求にだけ、関門（BOA-1110）の合言葉を足す。
 * 付けるのは live（本番データ・実時刻）と record（撮り直し、BOA-1436）。どちらも route.fetch で
 * 本番へ出るため、鍵が無いと関門が 403 を返す（record は 11/6 から 403 を待って毎回90分で打ち切れていた）。
 * replay（再生・素通し）と、/api/ 以外（/rest/v1）、本番以外の host には付けない。
 * 付けてよい host は、本番（boat-ai.jp）と、本番へ転送するローカルの配信（vite の proxy、localhost）だけ。
 * ヘッダの名前・鍵の整え方は internalApiHeaders に任せる。鍵の値は例外の文に入れない。
 *
 * @param {string} url 取り先の URL
 * @param {Record<string, string>} headers 元のヘッダ
 * @param {{ mode: string, env?: Record<string, string|undefined> }} ctx
 * @returns {Record<string, string>}
 */
const KEY_MODES = new Set(["live", "record"]);
const KEY_HOSTS = new Set(["localhost", "127.0.0.1", "boat-ai.jp", "www.boat-ai.jp"]);

export function liveApiHeaders(url, headers, { mode, env = process.env }) {
  if (!KEY_MODES.has(mode)) return headers;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return headers;
  }
  if (!KEY_HOSTS.has(parsed.hostname)) return headers;
  if (!parsed.pathname.startsWith("/api/")) return headers;
  const added = internalApiHeaders("e2e-live", env);
  if (!added["x-ryujin-internal-key"]) {
    throw new Error(
      `E2E の ${mode} は INTERNAL_API_KEY（prod-jobs の secret）が要る。e2e-live.yml の Run E2E・e2e-rerecord.yml の録画の env に渡す`,
    );
  }
  return { ...headers, ...added };
}
