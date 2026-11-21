/** live-odds-wiring.js の写し: scripts/lib/scrapeJobs/store.js をそのまま再 export し、createSupabaseStore だけ「渡した client と戻りを記録して本物を呼ぶ」物にする */
import * as real from "../../lib/scrapeJobs/store.js";
const WIRING_KEY = Symbol.for("verify-odds-live-api.live-odds-wiring"); // live-odds-wiring.js と同じ鍵（循環 import を避ける）

export * from "../../lib/scrapeJobs/store.js";

export function createSupabaseStore(client) {
  const store = real.createSupabaseStore(client);
  globalThis[WIRING_KEY].stores.push({ client, store });
  return store;
}
