import fs from "fs"; import path from "path";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const [prefix, outDir] = process.argv.slice(2);
const { data: dirs, error } = await sb.storage.from("analogy-v16").list(prefix, { limit: 1000 });
if (error) throw error;
const keys = [];
for (const d of dirs) {
  for (let off = 0; ; off += 1000) {
    const { data, error: e } = await sb.storage.from("analogy-v16").list(`${prefix}/${d.name}`, { limit: 1000, offset: off });
    if (e) throw e;
    keys.push(...data.filter(f => f.id).map(f => `${prefix}/${d.name}/${f.name}`));
    if (data.length < 1000) break;
  }
}
console.log("files", keys.length);
let i = 0, fail = 0;
async function worker() { while (i < keys.length) { const k = keys[i++];
  for (let a = 1; ; a++) { const { data, error: e } = await sb.storage.from("analogy-v16").download(k);
    if (!e) { const p = path.join(outDir, k.slice(prefix.length + 1)); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(await data.arrayBuffer())); break; }
    if (a >= 4) { fail++; console.error("fail", k, e.message); break; } await new Promise(r => setTimeout(r, 1000 * a)); } } }
await Promise.all(Array.from({ length: 8 }, worker));
console.log("done fail", fail, "methods", [...new Set(globalThis.__netlog)]);
