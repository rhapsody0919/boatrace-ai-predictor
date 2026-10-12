/**
 * オリジナル展示（BOATCAST の一周・半周ラップ・まわり足・直線）の効き目の検証用データ書き出し（読み取りのみ）
 *
 * オリジナル展示と、同じレースの展示タイム・本番ST/進入/着順・結果・勝率・モーター2連率を取得して JSON に保存する。
 * 結合・特徴量化は build.py が行う。
 *
 * 出力: data/analysis/original-exhibition/work/raw.json（gitignore 対象。約12MB）
 * 使い方: node scripts/analysis/original-exhibition/fetch.mjs [出力パス]
 * 期間: 環境変数 OX_FROM（既定 2026-09-22、含む）〜 OX_TO（既定 2026-10-13、含まない）
 * 接続: scripts/lib/supabaseClient.js（.env.local の SUPABASE_URL / SUPABASE_SERVICE_KEY）。select のみで書き込みはしない
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK_DIR =
  process.env.OX_WORK_DIR ||
  path.join(__dirname, "../../../data/analysis/original-exhibition/work");
const OUT = process.argv[2] || path.join(WORK_DIR, "raw.json");
const LO = process.env.OX_FROM || "2026-09-22";
const HI = process.env.OX_TO || "2026-10-13";
const PAGE = 1000;

async function all(table, cols, build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(supabase.from(table).select(cols)).range(
      from,
      from + PAGE - 1,
    );
    if (error) throw new Error(`${table} の取得に失敗: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const byRaceId = (q) => q.gte("race_id", LO).lt("race_id", HI).order("race_id");
const byRaceBoat = (q) => byRaceId(q).order("boat_number");

const ox = await all(
  "race_original_exhibition",
  "race_id,measure_status,item_labels,created_at",
  byRaceId,
);
const oxv = await all(
  "race_original_exhibition_values",
  "race_id,boat_number,kind,value",
  (q) => byRaceBoat(q).order("kind"),
);
const races = await all(
  "races",
  "race_id,race_date,venue_code,race_number,race_grade,cancellation_status,start_time",
  (q) => q.gte("race_date", LO).lt("race_date", HI).order("race_id"),
);
const exh = await all(
  "exhibition_data",
  "race_id,boat_number,exhibition_time,start_timing,exhibition_course,is_absent",
  byRaceBoat,
);
const st = await all(
  "race_start_timings",
  "race_id,boat_number,start_timing,is_flying,is_late_start,finish_rank,entry_course",
  byRaceBoat,
);
const res = await all(
  "race_results",
  "race_id,rank1,rank2,rank3,winning_technique,is_cancelled,is_no_race,race_status,refund_boats,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6",
  byRaceId,
);
const ent = await all(
  "race_entries",
  "race_id,boat_number,grade,win_rate,motor_2rate",
  byRaceBoat,
);

const counts = {
  ox: ox.length,
  oxv: oxv.length,
  races: races.length,
  exh: exh.length,
  st: st.length,
  res: res.length,
  ent: ent.length,
};
console.log({ from: LO, to_exclusive: HI, ...counts });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({
    fetched_at: new Date().toISOString(),
    range: { from: LO, to_exclusive: HI },
    ox,
    oxv,
    races,
    exh,
    st,
    res,
    ent,
  }),
);
console.log(`保存: ${OUT}`);
