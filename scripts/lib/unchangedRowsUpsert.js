/**
 * 「変更のある行を書くときに updated_at を設定する」テーブル（WS2、マイグレーション071）の
 * updated_at 列と、その列が未適用のDBでの書き直しに使うグループ名。
 * created_at は設定しない（INSERT時にDBの DEFAULT now() が入り、UPSERTの更新側では触られない）
 */
export const UPDATED_AT_COLUMN = "updated_at";
export const UPDATED_AT_GROUP = "マイグレーション071（updated_at）";

/**
 * 対象行の既存値を、chunkColumn（主キー先頭列）のIN句で取得する。
 * 1リクエストあたり chunkSize 件のIDに分割し、PostgRESTの上限（1000行）を超えない範囲にする
 * （race_entries/exhibition_data は1レース6行のため、100レース=600行）。
 *
 * @returns {Promise<{rows: Object[], error: Error|null}>}
 */
export async function fetchExistingRows(
  client,
  table,
  {
    columns,
    chunkColumn = "race_id",
    ids,
    chunkSize = 100,
    fullPageRows = null,
  },
) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  // チャンクは互いに独立した読み取りのため並列に取得する
  const results = await Promise.all(
    chunks.map((chunk) =>
      client.from(table).select(columns.join(",")).in(chunkColumn, chunk),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed) {
    // code を残す（呼び出し側が「表が無い」等をコードで判定できるように）
    const error = new Error(
      `${table}既存行取得エラー: ${failed.error.message}`,
    );
    error.code = failed.error.code;
    error.cause = failed.error;
    return { rows: [], error };
  }
  // fullPageRows（PostgREST の上限の 1000 等）ちょうどで返ったチャンクは、黙って切れた可能性がある
  if (
    fullPageRows &&
    results.some((r) => (r.data ?? []).length >= fullPageRows)
  ) {
    return {
      rows: [],
      error: new Error(
        `${table}既存行取得エラー: 1回の読みが ${fullPageRows} 行で返った（上限で切れた可能性。chunkSize を小さくする）`,
      ),
    };
  }
  const rows = results.flatMap((result) => result.data ?? []);
  return { rows, error: null };
}

/**
 * ログ用の1行表記（効果を後から実測できるよう、スキップ件数と書き込み件数を必ず出す）
 */
export function formatSkipSummary(label, stats, { fallback = false } = {}) {
  const skipped = stats.unchanged;
  const suffix = fallback ? "（既存行を取得できず全件書き込み）" : "";
  const columns = Object.entries(stats.changedColumns ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([column, count]) => `${column}×${count}`)
    .join(", ");
  const detail = columns ? `（変更のあった列: ${columns}）` : "";
  return `${label}: 変更なし${skipped}件スキップ / 書き込み${stats.toWrite}件${detail}${suffix}`;
}

/**
 * 変更のある行だけを upsert する（バッチ分割つき）。
 *
 * stampUpdatedAt=true の場合、書き込む（＝変更のあった、または新規の）行に updated_at=現在時刻を
 * 設定する。updated_at は比較から自動的に外す（毎回変わる値を比較に含めると、常に「変更あり」になり
 * 変更の無い行を書かない効果が無くなる）。updated_at 列が未適用のDBでは、その列を除いて書き直す。
 * optionalColumnGroups は、同様に「未適用なら除いて書き直す」列（{グループ名: 列名の配列}）。
 * 既知の限界: 既存行の取得に失敗して全行を書く場合（fallback）は、変更の有無が分からないまま
 * 全行に updated_at を設定する（「書き込んだ時刻」になる）。取得失敗は例外的な状態のため許容する
 * （stats・ログに fallback が出る）。
 *
 * @returns {Promise<{written: number, skipped: number, error: Error|null, stats: Object, toWrite: Object[], droppedGroups: string[]}>}
 *   toWrite は書き込み対象（dry-runでも「書くはずの行」を返す）。呼び出し側が後続処理を絞る用途に使う。
 *   droppedGroups は「列が無い」と判定して除いたまま書いた optionalColumnGroups の名前。空でなければ、
 *   その列は今回の実行で書き込まれていない（error は null のまま＝成功扱いになるため、呼び出し元が
 *   完了を判定するときはこちらも見る）
 */
/** upsertChangedRows の選択肢に既定値を入れ、updated_at を押すときの ignoreColumns と列のグループを組む */
function resolveUpsertOptions(
  table,
  {
    onConflict,
    keyColumns,
    ignoreColumns = [],
    chunkColumn = "race_id",
    chunkSize = 100,
    label = table,
    batchSize = 1000,
    dryRun = false,
    stampUpdatedAt = false,
    optionalColumnGroups = {},
    now = null,
    fullPageRows = null,
    failOnFetchError = false,
  },
) {
  return {
    onConflict,
    keyColumns,
    chunkColumn,
    chunkSize,
    label,
    batchSize,
    dryRun,
    stampUpdatedAt,
    now,
    fullPageRows,
    failOnFetchError,
    ignoreColumns: stampUpdatedAt
      ? [...new Set([...ignoreColumns, UPDATED_AT_COLUMN])]
      : ignoreColumns,
    groups: stampUpdatedAt
      ? { ...optionalColumnGroups, [UPDATED_AT_GROUP]: [UPDATED_AT_COLUMN] }
      : optionalColumnGroups,
  };
}

/**
 * 書き込みの要約を出す。列を落としたまま「成功」として終わらせない。落としたグループは、呼び出し元が戻り値を
 * 見ていなくても必ず目に入るよう、書き込みの要約と同じ行に出す
 * （2026-09-27、N19のloadで race_entries の6列が一斉に書かれないまま成功扱いになった）
 */
function reportUpsertResult({
  table,
  label,
  stats,
  fallback,
  dryRun,
  written,
  total,
  groups,
  droppedGroups,
}) {
  const droppedNote =
    droppedGroups.length === 0
      ? ""
      : ` / ⚠️ 列を除いて書いたグループ: ${droppedGroups
          .map((name) => `${name}（${(groups[name] ?? []).join(", ")}）`)
          .join(" / ")}`;
  // 書き込みの成否が分かってから出力する（失敗した行を「書き込んだ」と誤読させない）
  console.log(
    `  ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary(label, stats, { fallback })}` +
      (dryRun || written === total
        ? ""
        : ` / 実際に書き込めたのは${written}件`) +
      droppedNote,
  );
  if (droppedGroups.length > 0) {
    console.warn(
      `⚠️ ${table}: 上記の列は今回の実行で書き込まれていません。` +
        `マイグレーションが未適用なら適用し、適用済みならエラーの原因を確認してから書き直してください`,
    );
  }
}

export { resolveUpsertOptions, reportUpsertResult };
