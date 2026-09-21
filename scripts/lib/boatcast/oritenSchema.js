/**
 * オリジナル展示・モーター使用開始日の保存先（マイグレーション091）が、接続先のDBに適用済みかの判定。
 *
 * 目的: 091の適用前にコードをデプロイ・有効化しても、壊れない・意味の違う書き込みをしない。テーブルが無いDBでは、
 * 書き込まずに、その理由をスロット・ジョブの error として残す（「成功」にしない）。判定は、行を取らない読み取り
 * （limit(0)）を1回ずつ行い、クライアントごとに一定時間キャッシュする（scripts/lib/pitReportSchema.js と同じ方式）。
 * 確認自体が失敗した（通信エラー等）場合は、適用済みとは扱わず、キャッシュもしない。
 */
import { isScrapeSchemaMissingError } from "../scrapeJobs/schemaErrors.js";

export const ORITEN_TABLES = Object.freeze([
  "race_original_exhibition",
  "race_original_exhibition_values",
]);
export const MOTOR_START_TABLES = Object.freeze(["venue_motor_start_dates"]);

export const BOATCAST_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {WeakMap<object, Map<string, {at: number, value: boolean}>>} */
const cache = new WeakMap();

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {readonly string[]} tables
 * @returns {Promise<boolean>} 全テーブルが存在するか（確認に失敗した場合は false）
 */
export async function detectBoatcastSchema(
  client,
  tables,
  {
    now = () => Date.now(),
    ttlMs = BOATCAST_SCHEMA_CACHE_TTL_MS,
    warn = (m) => console.warn(m),
  } = {},
) {
  const key = tables.join(",");
  let byKey = cache.get(client);
  if (!byKey) {
    byKey = new Map();
    cache.set(client, byKey);
  }
  const cached = byKey.get(key);
  if (cached && now() - cached.at < ttlMs) return cached.value;

  let value = true;
  let definite = true;
  for (const table of tables) {
    // race_original_exhibition_values の主キー列（race_id）と、venue_motor_start_dates の venue_code は列名が違うため、
    // 列を指定せず select("*") の limit(0) で存在だけを見る
    const { error } = await client.from(table).select("*").limit(0);
    if (!error) continue;
    value = false;
    if (!isScrapeSchemaMissingError(error, [table])) {
      // 通信エラー等。適用状況が分からないため、書かない（安全側）。キャッシュしない
      definite = false;
      warn(
        `⚠️ マイグレーション091の適用状況を確認できません（書き込みません）: ${error.message}`,
      );
    }
  }
  if (definite) byKey.set(key, { at: now(), value });
  return value;
}

/** テスト用: キャッシュを捨てる */
export function clearBoatcastSchemaCache(client) {
  cache.delete(client);
}
