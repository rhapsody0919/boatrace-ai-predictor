/**
 * ピットレポートの保存先（マイグレーション085: race_pit_reports・race_pit_comments）が、接続先のDBに
 * 適用済みかの判定。
 *
 * 目的: 085の適用前にコードをデプロイ・有効化しても、壊れない・意味の違う書き込みをしない。テーブルが無いDBでは、
 * 書き込まずに、その理由をスロットの error として残す（「成功」にしない）。判定は、行を取らない読み取り
 * （limit(0)）を1回ずつ行い、クライアントごとに一定時間キャッシュする（scripts/lib/raceResultSchema.js と同じ方式）。
 * 確認自体が失敗した（通信エラー等）場合は、適用済みとは扱わず、キャッシュもしない。
 */
import { isScrapeSchemaMissingError } from "./scrapeJobs/schemaErrors.js";

export const PIT_REPORT_TABLES = Object.freeze([
  "race_pit_reports",
  "race_pit_comments",
]);

export const PIT_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {WeakMap<object, {at: number, value: boolean}>} */
const cache = new WeakMap();

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @returns {Promise<boolean>} 両テーブルが存在するか（確認に失敗した場合は false）
 */
export async function detectPitReportSchema(
  client,
  {
    now = () => Date.now(),
    ttlMs = PIT_SCHEMA_CACHE_TTL_MS,
    warn = (m) => console.warn(m),
  } = {},
) {
  const cached = cache.get(client);
  if (cached && now() - cached.at < ttlMs) return cached.value;

  let value = true;
  let definite = true;
  for (const table of PIT_REPORT_TABLES) {
    const { error } = await client.from(table).select("race_id").limit(0);
    if (!error) continue;
    value = false;
    if (!isScrapeSchemaMissingError(error, [table])) {
      // 通信エラー等。適用状況が分からないため、書かない（安全側）。キャッシュしない
      definite = false;
      warn(
        `⚠️ マイグレーション085の適用状況を確認できません（書き込みません）: ${error.message}`,
      );
    }
  }
  if (definite) cache.set(client, { at: now(), value });
  return value;
}

/** テスト用: キャッシュを捨てる */
export function clearPitReportSchemaCache(client) {
  cache.delete(client);
}
