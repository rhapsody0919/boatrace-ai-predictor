import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const date = process.argv[2] || "2026-10-14";
const { data: snaps, error: e1 } = await sb.from("analogy_v16_snapshots").select("race_id,stage,run_id,computed_at,pool_cutoff,model_version,n_layer,status").like("race_id", `${date}%`).limit(5000);
if (e1) throw e1;
const agg = {};
for (const s of snaps) { const k = `${s.stage}|${s.run_id}|${s.model_version}|${s.pool_cutoff}`; agg[k] = (agg[k] || 0) + 1; }
console.log("snapshots", snaps.length, agg);
const { data: models, error: e2 } = await sb.from("analogy_models").select("model_version,is_active,created_at").order("model_version");
if (e2) throw e2; console.log("models", models.map(m => `${m.model_version}${m.is_active ? "*" : ""}`).join(" "));
const { data: top } = await sb.storage.from("analogy").list("", { limit: 1000 });
console.log("analogy bucket top", top.map(e => e.name).join(" "));
const { data: runs } = await sb.storage.from("analogy-v16").list(date, { limit: 1000 });
console.log("analogy-v16", date, runs?.map(e => e.name).join(" "));
for (const r of runs || []) { const { data: sub } = await sb.storage.from("analogy-v16").list(`${date}/${r.name}`, { limit: 100 }); console.log(" ", r.name, sub.map(e => e.name).join(",")); }
const { data: dates } = await sb.storage.from("analogy-v16").list("", { limit: 1000 });
console.log("dates", dates.map(e => e.name).join(" "));
console.log("net methods", [...new Set(globalThis.__netlog)]);
