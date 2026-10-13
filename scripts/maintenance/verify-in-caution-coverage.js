/**
 * BOA-822 イン崩れ注意度の本番の確認（読み取りのみ、service_role）。判定は api/cron/in-caution-health.js と同じ
 * scripts/lib/inCautionHealth.js の純関数。
 *
 *   --table          夜の表（in_caution_gap_band_daily）: 最初の日・最後の日（前日）・合計の件数
 *   --today [日付]   その日の unified: inCaution がある割合（中止・1号艇の欠場・2艇以上の欠場・件数の少ないセルを除いて
 *                    99% 以上）、出さない理由の内訳、through が前日か
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/verify-in-caution-coverage.js --table
 *   node --env-file=.env.local scripts/maintenance/verify-in-caution-coverage.js --today 2026-10-20
 */
import { supabase } from "../lib/supabaseClient.js";
import { addDaysToDateString, getTodayDateJST } from "../lib/dateUtils.js";
import {
  evaluateInCautionTable,
  evaluateInCautionToday,
  readInCautionTable,
  readInCautionToday,
} from "../lib/inCautionHealth.js";

const args = process.argv.slice(2);
const date =
  args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? getTodayDateJST();
const previousDay = addDaysToDateString(date, -1);
if (!supabase)
  throw new Error("SUPABASE_URL・SUPABASE_SERVICE_KEY が未設定（.env.local）");

const results = [];
if (args.includes("--table") || !args.includes("--today"))
  results.push([
    "夜の表",
    evaluateInCautionTable(
      await readInCautionTable(supabase, previousDay),
      previousDay,
    ),
  ]);
if (args.includes("--today"))
  results.push([
    `${date} の unified`,
    evaluateInCautionToday(
      await readInCautionToday(supabase, date),
      previousDay,
    ),
  ]);

let failed = false;
for (const [label, r] of results) {
  console.log(`${r.ok ? "✅" : "❌"} ${label}: ${JSON.stringify(r.summary)}`);
  for (const issue of r.issues) console.log(`   - ${issue}`);
  failed ||= !r.ok;
}
process.exit(failed ? 1 : 0);
