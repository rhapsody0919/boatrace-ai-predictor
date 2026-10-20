import fs from "fs";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.from("analogy_v16_snapshots").select("race_id,run_id,computed_at,racecard_hash,n_layer,status").eq("stage", "racecard").like("race_id", `${process.argv[3]}%`);
if (error) throw error;
// 使い方: node snaps.mjs <出力.json> <YYYY-MM-DD>
fs.writeFileSync(process.argv[2], JSON.stringify(data));
console.log(data.length, data[0].computed_at, [...new Set(globalThis.__netlog)]);
