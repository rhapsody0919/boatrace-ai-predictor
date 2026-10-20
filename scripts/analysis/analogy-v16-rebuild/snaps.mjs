import fs from "fs";
import { createClient } from "/Users/terukina/boatrace-ai-predictor/node_modules/@supabase/supabase-js/dist/index.mjs";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.from("analogy_v16_snapshots").select("race_id,run_id,computed_at,racecard_hash,n_layer,status").eq("stage", "racecard").like("race_id", "2026-10-14%");
if (error) throw error;
fs.writeFileSync(process.argv[2], JSON.stringify(data));
console.log(data.length, data[0].computed_at, [...new Set(globalThis.__netlog)]);
