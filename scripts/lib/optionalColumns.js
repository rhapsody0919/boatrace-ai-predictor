/**
 * 「マイグレーション未適用のDBでも壊れない」書き込みの共通処理
 *
 * 背景: 新しい列を使うコードを先にデプロイすると、列が未適用のDBへの書き込みは、その行の他の列まで
 * 含めて失敗する。列が無いことを示すエラーを受けたら、その列だけを除いて書き直す。
 * 適用の前後どちらでも、書き込み元のスクリプトが止まらないようにするための共通処理
 * （BOA-358 の weather_observed_at、WS2 の updated_at・展示の追加列で共用する）。
 *
 * 列が無い場合の判定: PostgRESTは、UPSERTの本文に未知の列があると
 * 「Could not find the 'x' column of 'y' in the schema cache」（PGRST204）を、SELECTに未知の列が
 * あると「column y.x does not exist」（42703）を返す。両方に対応する。
 */

const MISSING_COLUMN_MESSAGE =
  /does not exist|Could not find the .* column|schema cache/i;
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * DBのエラーが「指定した列のいずれかが存在しない」を示すか。
 * エラーメッセージに列名が含まれていることを必須にする（無関係な列の不在や、
 * 別の原因の書き込みエラーを、この列の不在と取り違えて列を落とさないため）。
 *
 * @param {{message?: string, code?: string}|string|null|undefined} errorOrMessage
 * @param {string[]} columns
 */
export function isColumnMissingError(errorOrMessage, columns) {
  if (!errorOrMessage) return false;
  const message =
    typeof errorOrMessage === "string"
      ? errorOrMessage
      : (errorOrMessage.message ?? "");
  const code = typeof errorOrMessage === "string" ? "" : errorOrMessage.code;
  if (!message) return false;
  const mentionsColumn = columns.some((column) =>
    new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(column)}(?![A-Za-z0-9_])`).test(
      message,
    ),
  );
  if (!mentionsColumn) return false;
  return MISSING_COLUMN_CODES.has(code) || MISSING_COLUMN_MESSAGE.test(message);
}

/** 行から指定した列を除く（元の配列・行は変更しない） */
export function stripColumns(rows, columns) {
  if (columns.length === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const column of columns) delete copy[column];
    return copy;
  });
}

/**
 * 列が無いと判明したグループの記録。同じ書き込み元の以降のバッチに引き継ぎ、
 * 同じエラーへの再試行を毎バッチ繰り返さない。
 */
export function createOptionalColumnState() {
  return { missingGroups: new Set() };
}

/**
 * upsert を1回行う。optionalColumnGroups（{グループ名: 列名の配列}）の列が原因の「列が無い」エラーは、
 * そのグループの列を除いて書き直す（グループ単位。1つの列不在で、同じマイグレーションの他の未適用の列も
 * 巻き添えで除く）。別のグループのマイグレーションが適用済みなら、その列は引き続き書く。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} table
 * @param {Object[]} rows
 * @param {{onConflict: string, optionalColumnGroups?: Record<string, string[]>}} options
 *   グループ名は警告表示に使う（例: 「マイグレーション071（取得時刻列）」）
 * @param {ReturnType<typeof createOptionalColumnState>} [state]
 * @returns {Promise<{error: {message: string, code?: string}|null}>}
 */
export async function upsertWithOptionalColumns(
  client,
  table,
  rows,
  { onConflict, optionalColumnGroups = {} },
  state = createOptionalColumnState(),
) {
  const groupNames = Object.keys(optionalColumnGroups);
  // グループ数+1回で必ず終わる（毎回、未除外のグループを1つ以上除くため）
  for (;;) {
    const skipped = groupNames
      .filter((name) => state.missingGroups.has(name))
      .flatMap((name) => optionalColumnGroups[name]);
    const { error } = await client
      .from(table)
      .upsert(stripColumns(rows, skipped), { onConflict });
    if (!error) return { error: null };
    const missing = groupNames.find(
      (name) =>
        !state.missingGroups.has(name) &&
        isColumnMissingError(error, optionalColumnGroups[name]),
    );
    if (missing === undefined) return { error };
    state.missingGroups.add(missing);
    console.warn(
      `⚠️ ${table}: ${missing}が未適用のため、その列（${optionalColumnGroups[missing].join(", ")}）を除いて書き直します: ${error.message}`,
    );
  }
}
