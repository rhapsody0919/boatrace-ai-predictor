// Storage の一覧（読み取りのみ）: node list_storage.mjs <prefix>
import { supabase } from "../master-src/scripts/lib/supabaseClient.js";
const prefix = process.argv[2] || "";
const { data, error } = await supabase.storage.from("analogy").list(prefix, { limit: 1000 });
if (error) throw new Error(error.message);
for (const e of data) console.log(e.name, e.updated_at || "", e.created_at || "", e.metadata?.size ?? "");
