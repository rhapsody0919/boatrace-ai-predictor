/** live-odds-wiring.js の写し: scripts/lib/scrapeJobs/politeFetch.js をそのまま再 export し、createPoliteFetch だけ「引数を記録し、fetchImpl を偽物に差して本物を呼ぶ」物にする */
import * as real from "../../lib/scrapeJobs/politeFetch.js";
const WIRING_KEY = Symbol.for("verify-odds-live-api.live-odds-wiring"); // live-odds-wiring.js と同じ鍵（循環 import を避ける）

export * from "../../lib/scrapeJobs/politeFetch.js";

export function createPoliteFetch(options) {
  const record = globalThis[WIRING_KEY];
  record.politeFetchOptions.push(options);
  return real.createPoliteFetch({ ...options, fetchImpl: record.fetchImpl });
}
