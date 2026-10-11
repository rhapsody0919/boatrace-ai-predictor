// 本番 DB の読み取り（SELECT のみ）: 表示中の版と、その版の全国の寄与度プロファイル・若松の行
import fs from "fs";
import { supabase } from "../master-src/scripts/lib/supabaseClient.js";
const { data: mv, error: e1 } = await supabase.from("analogy_models")
  .select("model_version,is_active,trained_at,feature_columns,themes,metrics").eq("is_active", true);
if (e1) throw new Error(e1.message);
fs.writeFileSync("db_analogy_models_active.json", JSON.stringify(mv, null, 1));
const v = mv[0].model_version;
const { data: nat, error: e2 } = await supabase.from("analogy_contribution_profiles").select("*")
  .eq("model_version", v).eq("venue_code", 0).eq("grade", "all").eq("round", "all").eq("boat_number", 0)
  .order("finish_target");
if (e2) throw new Error(e2.message);
fs.writeFileSync("db_profiles_national.json", JSON.stringify(nat, null, 1));
const { data: w, error: e3 } = await supabase.from("analogy_contribution_profiles").select("*")
  .eq("model_version", v).eq("venue_code", 20).eq("boat_number", 0).order("finish_target");
if (e3) throw new Error(e3.message);
fs.writeFileSync("db_profiles_venue20.json", JSON.stringify(w, null, 1));
console.log(v, nat.length, w.length);
