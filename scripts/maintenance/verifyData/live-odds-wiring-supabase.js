/** live-odds-wiring.js の写し: scripts/lib/supabaseClient.js をそのまま再 export し、supabase だけ記録する偽物にする（DB には繋がない） */
import { WIRING_KEY } from "./live-odds-wiring.js";

export * from "../../lib/supabaseClient.js";

export const supabase = globalThis[WIRING_KEY].supabase;
export const isSupabaseEnabled = () => true;
