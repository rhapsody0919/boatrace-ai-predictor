// 本番 DB 読み取り（anon・SELECT のみ）: 対象レースの実際の進入と ST
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const s = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const db = {}; for (const f of ["races.json", "even1.json", "even2.json"]) if (fs.existsSync(f)) Object.assign(db, JSON.parse(fs.readFileSync(f, "utf8")));
const ids = Object.keys(db);
(async () => {
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await s.from("race_start_timings").select("race_id,boat_number,start_timing,is_flying,is_late_start,entry_course,finish_rank").in("race_id", ids.slice(i, i + 100)).limit(1000);
    if (error) throw new Error(`race_start_timings: ${error.message}`);
    for (const r of data) (out[r.race_id] ??= []).push(r);
  }
  fs.writeFileSync("actual.json", JSON.stringify(out));
  console.log("races", ids.length, "with rows", Object.keys(out).length);
})().catch((e) => { console.error(e); process.exit(1); });
