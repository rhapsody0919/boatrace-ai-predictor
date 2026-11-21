/** live-odds-wiring.js の写し: scripts/lib/supabaseClient.js をそのまま再 export し、supabase だけ記録する偽物（live-odds-wiring.js の record）へ転送する（DB には繋がない） */
const WIRING_KEY = Symbol.for("verify-odds-live-api.live-odds-wiring"); // live-odds-wiring.js と同じ鍵（循環 import を避ける）

export * from "../../lib/supabaseClient.js";

const fake = () => {
  const record = globalThis[WIRING_KEY];
  if (!record) throw new Error("live-odds-wiring-supabase.js: loadLiveOddsApi の前に supabase が使われた");
  return record.supabase;
};
export const supabase = {
  from: (...args) => fake().from(...args),
  rpc: (...args) => fake().rpc(...args),
};
export const isSupabaseEnabled = () => true;
