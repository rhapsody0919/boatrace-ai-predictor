/**
 * 「変更の無い行は書かない」ための共通ライブラリ（WS8(b)、BOA-349）
 *
 * 背景: 取得・更新のたびに、値が変わっていない行までUPSERT/UPDATEしていたため、
 * WAL・dead tuple・Disk IOが増え、Supabaseの Disk IO Budget を圧迫していた
 * （.claude/rules/data-acquisition.md「変更の無い行は書かない」、
 *  docs/design/scraping-vercel-consolidation/orchestration.md WS8）。
 *
 * 方針: アプリ側で比較する（DB関数・マイグレーションは使わない）。対象race_idの既存行を
 * 主キー先頭列のIN句（インデックスが効く小さな範囲）で1回だけ取得し、書き込む値と比較して、
 * 差分のある行（と既存行が無い行）だけを書く。
 *
 * 安全側の原則: 「変更なし」と誤判定すると値が更新されずデータが古くなる（実害）。
 * 「変更あり」と誤判定しても従来どおり書くだけ（実害なし）。そのため比較は常に
 * 「迷ったら変更あり」に倒す。
 *   - 既存行の取得に失敗したら全行を書く（従来どおり）
 *   - 既存行にその列が無い（selectに含まれていない等）場合は変更ありとみなす
 *   - 数値列は、DBの numeric(p,s) が書き込み時に scale へ丸める（四捨五入、0から遠い側へ）
 *     挙動を再現してから比較する（丸め前の値で比較すると、scale以上の桁を持つ値が
 *     永久に「変更あり」になり、スキップが効かない）
 */

import {
  createOptionalColumnState,
  upsertWithOptionalColumns,
} from "./optionalColumns.js";
import {
  NUMERIC_SCALES,
  TIMESTAMP_COLUMNS,
  normalizeTimestamp,
  normalizeValue,
} from "./unchangedRowsNormalize.js";

/**
 * 「変更のある行を書くときに updated_at を設定する」テーブル（WS2、マイグレーション071）の
 * updated_at 列と、その列が未適用のDBでの書き直しに使うグループ名。
 * created_at は設定しない（INSERT時にDBの DEFAULT now() が入り、UPSERTの更新側では触られない）
 */
export const UPDATED_AT_COLUMN = "updated_at";
export const UPDATED_AT_GROUP = "マイグレーション071（updated_at）";

function buildKey(row, keyColumns) {
  return keyColumns.map((c) => String(row[c])).join("|");
}

/**
 * 書き込み予定の行と既存行を比較し、書くべき行だけを返す（純粋関数）。
 *
 * - 比較するのは、書き込み予定の行が持つ列（値が undefined の列は書かれないので除く）のみ。
 *   ignoreColumns（updated_at・取得時刻等、値が毎回変わるが情報を持たない列）は比較から外す。
 *   変更ありと判定された行は、ignoreColumns も含めて従来どおりそのまま書く。
 * - 既存行が無い行は「新規」。writeMissing=true（upsert）なら書き、false（update）なら
 *   対象行が存在せず UPDATE しても0件のため書かない。
 * - **書き込む行は、書き込み予定の行全体で現れる列の集合にそろえる**（欠けている列は既存値で補う）。
 *   PostgREST のバルク upsert は、1回のリクエストの行でカラムを揃える必要があるため、キーの集合が
 *   異なる行を混ぜると、**持っていない行の当該列に NULL が書き込まれる**。呼び出し元が「この行の
 *   この列は触らない」つもりで列を省いても、同じバッチの別の行がその列を持っていれば消える。
 *   2026-09-27、N19（racelist-backfill の buildFillRow は「既存値がNULLの列だけ」を行に入れる）で
 *   実際に起き、race_entries の branch・hometown が 1,729行でNULLに上書きされた。
 *
 *
 * @param {Array<Object>} existingRows
 * @param {Array<Object>} incomingRows
 * @param {{keyColumns: string[], ignoreColumns?: string[], scales?: Record<string, number>, timestampColumns?: string[], writeMissing?: boolean}} options
 * @returns {{toWrite: Object[], stats: {total: number, unchanged: number, changed: number, missing: number, toWrite: number}}}
 */
export function diffRows(existingRows, incomingRows, options) {
  const {
    keyColumns,
    ignoreColumns = [],
    scales = {},
    timestampColumns = [],
    writeMissing = true,
  } = options;
  const timestampSet = new Set(timestampColumns);
  const normalizeColumn = (column, value) =>
    timestampSet.has(column)
      ? normalizeTimestamp(value)
      : normalizeValue(value, scales[column]);
  const skipColumns = new Set([...keyColumns, ...ignoreColumns]);
  const existingByKey = new Map(
    existingRows.map((row) => [buildKey(row, keyColumns), row]),
  );

  // 書き込み予定の行全体に現れる列（PostgREST が1リクエスト内でそろえる必要がある集合）
  const payloadColumns = [
    ...new Set(
      incomingRows.flatMap((row) =>
        Object.keys(row).filter((c) => row[c] !== undefined),
      ),
    ),
  ];
  /** 行に無い列を、既存値で補ってそろえる（既存値が分からない新規行はそのまま） */
  const alignToPayloadColumns = (row, existing) => {
    if (!existing) return row;
    let aligned = null;
    for (const column of payloadColumns) {
      if (row[column] !== undefined) continue;
      if (!(column in existing)) continue;
      aligned ??= { ...row };
      aligned[column] = existing[column];
    }
    return aligned ?? row;
  };

  const toWrite = [];
  let unchanged = 0;
  let changed = 0;
  let missing = 0;
  const changedColumns = {};

  for (const incoming of incomingRows) {
    const existing = existingByKey.get(buildKey(incoming, keyColumns));
    if (!existing) {
      missing++;
      if (writeMissing) toWrite.push(incoming);
      continue;
    }
    const differingColumns = Object.keys(incoming).filter((column) => {
      if (skipColumns.has(column) || incoming[column] === undefined) {
        return false;
      }
      if (!(column in existing)) return true; // 既存側に無い＝比較不能＝変更ありに倒す
      return (
        normalizeColumn(column, incoming[column]) !==
        normalizeColumn(column, existing[column])
      );
    });
    if (differingColumns.length > 0) {
      changed++;
      toWrite.push(alignToPayloadColumns(incoming, existing));
      // どの列の変化で書き込みが発生しているかを集計する（効果の確認・想定外の列による
      // 常時「変更あり」の検知用）
      for (const column of differingColumns) {
        changedColumns[column] = (changedColumns[column] ?? 0) + 1;
      }
    } else {
      unchanged++;
    }
  }

  return {
    toWrite,
    stats: {
      total: incomingRows.length,
      unchanged,
      changed,
      missing,
      toWrite: toWrite.length,
      changedColumns,
    },
  };
}

/**
 * 「比較せず全行を書く」場合の書き込み計画（既存行を取得できない場合や、
 * 呼び出し側が意図的に全行を書く場合に使う）。filterUnchangedRows の戻り値と同じ形にする。
 */
export function planWriteAll(rows) {
  return {
    toWrite: rows,
    fallback: false,
    stats: {
      total: rows.length,
      unchanged: 0,
      changed: 0,
      missing: 0,
      toWrite: rows.length,
      changedColumns: {},
    },
  };
}

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
 * 書き込み予定の行から、変更のある行だけを絞り込む（既存行の取得を含む）。
 * 既存行の取得に失敗した場合は、従来どおり全行を書く（fallback: true）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} table
 * @param {Object[]} incomingRows
 * @param {{keyColumns: string[], ignoreColumns?: string[], chunkColumn?: string, chunkSize?: number, writeMissing?: boolean}} options
 *   chunkSize: 既存行を取得する1リクエストあたりのID数（既定100。1IDあたりの行数が多いテーブルは小さくする）
 */
export async function filterUnchangedRows(
  client,
  table,
  incomingRows,
  options,
) {
  const {
    keyColumns,
    ignoreColumns = [],
    chunkColumn = "race_id",
    chunkSize = 100,
    writeMissing = true,
    fullPageRows = null,
    failOnFetchError = false,
  } = options;

  if (incomingRows.length === 0)
    return { ...planWriteAll([]), fallback: false };

  const columns = [
    ...new Set([
      ...keyColumns,
      ...incomingRows.flatMap((row) =>
        Object.keys(row).filter(
          (c) => row[c] !== undefined && !ignoreColumns.includes(c),
        ),
      ),
    ]),
  ];
  const ids = [...new Set(incomingRows.map((row) => row[chunkColumn]))];
  const fetched = await fetchExistingRows(client, table, {
    columns,
    chunkColumn,
    ids,
    chunkSize,
    fullPageRows,
  });
  if (fetched.error && failOnFetchError) {
    return { ...planWriteAll([]), fallback: false, error: fetched.error };
  }
  if (fetched.error) {
    // 既存行が分からない場合は従来どおり全行を書く（比較できないものを「変更なし」にしない）
    console.warn(`  ⚠️ ${fetched.error.message}（今回は全行を書き込みます）`);
    return { ...planWriteAll(incomingRows), fallback: true };
  }
  const existing = fetched.rows;

  const { toWrite, stats } = diffRows(existing, incomingRows, {
    keyColumns,
    ignoreColumns,
    scales: NUMERIC_SCALES[table] ?? {},
    timestampColumns: TIMESTAMP_COLUMNS[table] ?? [],
    writeMissing,
  });
  return { toWrite, fallback: false, stats };
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

/** 変わった行を batchSize ごとに書く（dryRun なら書かない）。一度「列が無い」と分かったグループは、以降のバッチでも最初から除く */
async function writeChangedBatches(
  client,
  table,
  toWrite,
  { onConflict, groups, batchSize, dryRun },
) {
  const columnState = createOptionalColumnState();
  let error = null;
  let written = 0;
  if (!dryRun) {
    for (let i = 0; i < toWrite.length; i += batchSize) {
      const batch = toWrite.slice(i, i + batchSize);
      const { error: batchError } = await upsertWithOptionalColumns(
        client,
        table,
        batch,
        { onConflict, optionalColumnGroups: groups },
        columnState,
      );
      if (batchError) {
        error = new Error(`${table}書き込みエラー: ${batchError.message}`);
        // 包み直しでPostgRESTのコードを落とさない（呼び出し元が「列が無い」等を判定できるように）。
        // 2026-09-27、raceConditionsWriter が message だけを見ていたため、コードでの判定に
        // 切り替えた際に weather_observed_at のフォールバックが効かなくなりかけた
        error.code = batchError.code;
        error.cause = batchError;
        console.error(`❌ ${error.message}`);
      } else {
        written += batch.length;
      }
    }
  }
  return { written, error, droppedGroups: [...columnState.missingGroups] };
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

export async function upsertChangedRows(client, table, incomingRows, options) {
  const o = resolveUpsertOptions(table, options);
  const {
    toWrite: changedRows,
    stats,
    fallback,
    error: fetchError,
  } = await filterUnchangedRows(client, table, incomingRows, {
    keyColumns: o.keyColumns,
    chunkColumn: o.chunkColumn,
    chunkSize: o.chunkSize,
    fullPageRows: o.fullPageRows,
    failOnFetchError: o.failOnFetchError,
    ignoreColumns: o.ignoreColumns,
  });
  // failOnFetchError: 既存行が読めなければ全行を書かずに止める（読みの上限で切れたまま書かない）
  if (fetchError) {
    return {
      written: 0,
      skipped: 0,
      error: fetchError,
      stats,
      toWrite: [],
      droppedGroups: [],
    };
  }
  // 時刻は、既存行の取得が済んだ「書き込みの直前」に取る（created_at のDBの now() との差を小さくする）
  const updatedAt = (o.now ?? new Date()).toISOString();
  const toWrite = o.stampUpdatedAt
    ? changedRows.map((row) => ({ ...row, [UPDATED_AT_COLUMN]: updatedAt }))
    : changedRows;
  const { written, error, droppedGroups } = await writeChangedBatches(
    client,
    table,
    toWrite,
    o,
  );
  reportUpsertResult({
    table,
    label: o.label,
    stats,
    fallback,
    dryRun: o.dryRun,
    written,
    total: toWrite.length,
    groups: o.groups,
    droppedGroups,
  });
  return {
    written,
    skipped: stats.unchanged,
    error,
    stats,
    toWrite,
    droppedGroups,
  };
}

export {
  NUMERIC_SCALES,
  TIMESTAMP_COLUMNS,
  normalizeTimestamp,
  roundToScale,
  normalizeValue,
} from "./unchangedRowsNormalize.js";
