/** live-odds-wiring.js の写し: scripts/lib/scrapeJobs/store.js をそのまま再 export し、createSupabaseStore だけ「渡した client と戻りを記録して本物を呼ぶ」物にする */
import * as real from "../../lib/scrapeJobs/store.js";
import { WIRING_KEY } from "./live-odds-wiring.js";

export * from "../../lib/scrapeJobs/store.js";

export function createSupabaseStore(client) {
  const store = real.createSupabaseStore(client);
  globalThis[WIRING_KEY].stores.push({ client, store });
  return store;
}
