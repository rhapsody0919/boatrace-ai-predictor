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

/**
 * 「変更のある行を書くときに updated_at を設定する」テーブル（WS2、マイグレーション071）の
 * updated_at 列と、その列が未適用のDBでの書き直しに使うグループ名。
 * created_at は設定しない（INSERT時にDBの DEFAULT now() が入り、UPSERTの更新側では触られない）
 */
export const UPDATED_AT_COLUMN = "updated_at";
export const UPDATED_AT_GROUP = "マイグレーション071（updated_at）";

/**
 * numeric(p,s) 列の scale（2026-09-19時点の本番スキーマ information_schema.columns の実測値）。
 * 列が numeric 型でも、ここに無い列は文字列・数値を区別する厳密比較になる（＝変更ありに倒れる）。
 */
export const NUMERIC_SCALES = {
  races: {
    first_boat_avg_st: 3,
    first_boat_motor_2rate: 2,
    first_boat_win_rate: 3,
    motor_2rate_stddev: 2,
    win_rate_avg: 3,
    win_rate_stddev: 3,
  },
  race_entries: {
    boat_2rate: 2,
    boat_3rate: 2,
    global_2rate: 2,
    global_3rate: 2,
    local_2rate: 2,
    local_3rate: 2,
    local_win_rate: 3,
    motor_2rate: 2,
    motor_3rate: 2,
    win_rate: 3,
  },
  race_conditions: {
    temperature: 1,
    water_temperature: 1,
    wind_speed: 1,
  },
  exhibition_data: {
    adjustment_weight: 1,
    exhibition_time: 2,
    prev_start_timing: 2,
    start_timing: 2,
    tilt: 1,
    today_weight: 1,
  },
  race_start_timings: {
    start_timing: 3,
  },
};

/**
 * timestamptz 列（比較時に時刻として正規化する列）。DBは「2026-09-19T01:34:00+00:00」形式で返し、
 * 書き込み側は「2026-09-19T01:34:00.000Z」等の形式で持つため、文字列のまま比較すると
 * 同じ時刻でも永久に「変更あり」になる。ここに無い timestamptz 列は厳密比較（＝変更ありに倒れる）。
 */
export const TIMESTAMP_COLUMNS = {
  race_conditions: ["weather_observed_at"],
};

/**
 * timestamptz の比較用正規化。同じ瞬間なら表記（タイムゾーン・桁数）に依らず同じ値になる。
 * 時刻として解釈できない値は、文字列のまま返して厳密比較に任せる（＝変更ありに倒れる）。
 *
 * @param {unknown} value
 */
export function normalizeTimestamp(value) {
  if (value === undefined || value === null) return null;
  const ms = Date.parse(
    value instanceof Date ? value.toISOString() : String(value),
  );
  return Number.isFinite(ms) ? ms : value;
}

/**
 * PostgreSQL の numeric 丸め（0から遠い側への四捨五入）を再現する。
 * PostgREST へ送られる JSON 数値は String(x) と同じ10進表現のため、その文字列に
 * 指数を足して桁シフトすることで、2進浮動小数の誤差（1.005 → 1.00 になる等）を避ける。
 */
export function roundToScale(value, scale) {
  const abs = Math.abs(value);
  const text = String(abs);
  // 指数表記（1e-7, 1e21等）は文字列シフトができないため toFixed に委ねる
  // （本スキーマの値域では現れない。万一現れても判定が変更ありに倒れるだけ）
  if (/e/i.test(text)) return Number(value.toFixed(scale));
  const shifted = Math.round(Number(`${text}e${scale}`));
  const rounded = Number(`${shifted}e-${scale}`);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonicalize(value[k])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/**
 * 比較用の正規化。undefined/null/NaN/Infinity は null に揃える（JSON化すると null になるため、
 * DBへ書かれる値と一致させる）。numeric 列（scale 指定あり）は数値化して丸める。
 * jsonb/配列は、キー順に依存しない正準形（JSON文字列）にする。
 *
 * @param {unknown} value
 * @param {number|undefined} scale numeric列のscale。undefinedなら数値の丸めをしない
 */
export function normalizeValue(value, scale) {
  if (value === undefined || value === null) return null;
  if (scale !== undefined) {
    if (typeof value === "string") {
      if (value.trim() === "") return value; // 数値化できない文字列は厳密比較に任せる
      const n = Number(value);
      return Number.isFinite(n) ? roundToScale(n, scale) : value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? roundToScale(value, scale) : null;
    }
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") return JSON.stringify(canonicalize(value));
  return value;
}

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
      toWrite.push(incoming);
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
  { columns, chunkColumn = "race_id", ids, chunkSize = 100 },
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
    return {
      rows: [],
      error: new Error(`${table}既存行取得エラー: ${failed.error.message}`),
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
 * @param {{keyColumns: string[], ignoreColumns?: string[], chunkColumn?: string, writeMissing?: boolean}} options
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
    writeMissing = true,
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
  });
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
 *
 * @returns {Promise<{written: number, skipped: number, error: Error|null, stats: Object, toWrite: Object[]}>}
 *   toWrite は書き込み対象（dry-runでも「書くはずの行」を返す）。呼び出し側が後続処理を絞る用途に使う
 */
export async function upsertChangedRows(
  client,
  table,
  incomingRows,
  {
    onConflict,
    keyColumns,
    ignoreColumns = [],
    label = table,
    batchSize = 1000,
    dryRun = false,
    stampUpdatedAt = false,
    optionalColumnGroups = {},
    now = new Date(),
  },
) {
  const {
    toWrite: changedRows,
    stats,
    fallback,
  } = await filterUnchangedRows(client, table, incomingRows, {
    keyColumns,
    ignoreColumns: stampUpdatedAt
      ? [...new Set([...ignoreColumns, UPDATED_AT_COLUMN])]
      : ignoreColumns,
  });
  const updatedAt = now.toISOString();
  const toWrite = stampUpdatedAt
    ? changedRows.map((row) => ({ ...row, [UPDATED_AT_COLUMN]: updatedAt }))
    : changedRows;
  const groups = stampUpdatedAt
    ? { ...optionalColumnGroups, [UPDATED_AT_GROUP]: [UPDATED_AT_COLUMN] }
    : optionalColumnGroups;
  // 一度「列が無い」と分かったグループは、以降のバッチでも最初から除く
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
        console.error(`❌ ${error.message}`);
      } else {
        written += batch.length;
      }
    }
  }
  // 書き込みの成否が分かってから出力する（失敗した行を「書き込んだ」と誤読させない）
  console.log(
    `  ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary(label, stats, { fallback })}` +
      (dryRun || written === toWrite.length
        ? ""
        : ` / 実際に書き込めたのは${written}件`),
  );
  return { written, skipped: stats.unchanged, error, stats, toWrite };
}
