/**
 * facts の表（race_facts・run_facts、ADR-0113）の1つの窓を書く（kb 層の CLI scripts/maintenance/race-facts-backfill.js と
 * main 層の Cron scripts/lib/raceFactsMainJob.js が共有する）。変わった行だけを upsertChangedRows で書き（built_at は比べない）、
 * 窓の中で組み立て直した行に無い行を消す。dryRun は書かず、書く予定の数だけを返す。
 */
import { upsertChangedRows } from "./unchangedRows.js";

/**
 * @param {object} client Supabase のクライアント（service_role）
 * @param {{ raceRows: object[], runRows: object[], staleRace: string[], staleRun: string[] }} plan staleRun は "race_id|boat_number"
 * @param {{ dryRun: boolean, upsert?: typeof upsertChangedRows }} options
 * @returns {Promise<{ written: number }>}
 */
export async function writeFactsWindow(client, { raceRows, runRows, staleRace, staleRun }, { dryRun, upsert = upsertChangedRows }) {
  let written = 0;
  for (const [table, rows, keyColumns] of [
    ["race_facts", raceRows, ["race_id"]],
    ["run_facts", runRows, ["race_id", "boat_number"]],
  ]) {
    const res = await upsert(client, table, rows, {
      keyColumns, onConflict: keyColumns.join(","), dryRun, failOnFetchError: true, ignoreColumns: ["built_at"],
    });
    if (res.error) throw res.error;
    written += dryRun ? res.toWrite.length : res.written;
  }
  if (dryRun) return { written };
  for (const key of staleRun) {
    const [raceId, boat] = key.split("|");
    const { error } = await client.from("run_facts").delete().eq("race_id", raceId).eq("boat_number", Number(boat));
    if (error) throw new Error(`run_facts の消去エラー（${key}）: ${error.message}`);
  }
  if (staleRace.length > 0) {
    const { error } = await client.from("race_facts").delete().in("race_id", staleRace);
    if (error) throw new Error(`race_facts の消去エラー: ${error.message}`);
  }
  return { written };
}
