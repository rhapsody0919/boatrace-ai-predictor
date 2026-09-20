/**
 * 「予定表のテーブル・関数がDBに無い」エラーの判定。
 *
 * マイグレーション072（scrape_slots・scrape_job_state・RPC）の適用前にコードをデプロイしても、
 * 共通ラッパ・監視が誤報や例外を出さず、何もしないで終わるようにするための共通処理
 * （scripts/lib/optionalColumns.js の「列が無い」判定と同じ考え方）。
 *
 * PostgREST は、未知のテーブルに PGRST205（"Could not find the table 'public.x' in the schema cache"）、
 * 未知の関数に PGRST202（"Could not find the function public.f(...) in the schema cache"）を返す。
 * PostgreSQL への直接の接続では 42P01（relation ... does not exist）・42883（function ... does not exist）。
 */

export const SCRAPE_SCHEMA_OBJECTS = Object.freeze([
  "scrape_slots",
  "scrape_job_state",
  "ensure_scrape_slots",
  "claim_scrape_slots",
]);

const MISSING_OBJECT_CODES = new Set([
  "PGRST205",
  "PGRST202",
  "42P01",
  "42883",
]);

/**
 * DBのエラーが「予定表のテーブル・関数が存在しない」を示すか。
 * エラーメッセージに対象の名前が含まれていることを必須にする（無関係なテーブル・関数の不在を、
 * 予定表の未適用と取り違えて、実際のDB障害を握りつぶさないため）。
 *
 * @param {{message?: string, code?: string}|null|undefined} error
 * @param {readonly string[]} [names]
 */
export function isScrapeSchemaMissingError(
  error,
  names = SCRAPE_SCHEMA_OBJECTS,
) {
  if (!error) return false;
  if (!MISSING_OBJECT_CODES.has(error.code ?? "")) return false;
  const message = error.message ?? "";
  return names.some((name) =>
    new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(message),
  );
}
