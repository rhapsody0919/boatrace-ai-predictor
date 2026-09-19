/**
 * verify-scraped-timestamps.js - 取得時刻の列（created_at・updated_at、マイグレーション071、WS2）を
 * 使う書き込みと計測の検証。DBには接続しない（Supabaseクライアント・fetchを差し替える）。
 *
 * 確認すること:
 *   (a) updated_at・created_at は「変更の有無」の比較に含めない。値が同じ行は、列の適用前後どちらでも
 *       書き込まれない（0件）。変更のある行・新規の行だけに updated_at を設定し、created_at は
 *       書き込み内容に含めない（INSERT時のDBのDEFAULTに任せる）
 *   (b) マイグレーション未適用（列が無いエラー: PGRST204・42703）でも、その列だけを除いて書き直し、
 *       他の列・他のマイグレーションの列は書き続ける
 *   (c) data-health-report の取得時刻の指標は、列が無くても失敗せず「未適用のため計測不能」と出す。
 *       列があれば分布・累積割合を出し、計測に失敗しても他の指標を止めない
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isColumnMissingError } from "../lib/optionalColumns.js";
import {
  diffRows,
  filterUnchangedRows,
  upsertChangedRows,
  NUMERIC_SCALES,
} from "../lib/unchangedRows.js";
import {
  collectScrapedTimestamps,
  main as runHealthReport,
} from "../analysis/data-health-report.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = new Date("2026-09-20T03:00:00.000Z");

// ---------------------------------------------------------------------------
// フィクスチャ（本番の行の形。DBが返す形: numericは数値、timestamptzはISO文字列）
// ---------------------------------------------------------------------------
const RACE = "2026-09-18-04-05";
const exhibitionRow = (boat, overrides = {}) => ({
  race_id: RACE,
  boat_number: boat,
  exhibition_time: 6.7 + boat / 100,
  start_timing: null,
  tilt: -0.5,
  propeller_change: null,
  parts_changed: null,
  adjustment_weight: 0,
  today_weight: 52.5,
  prev_race_no: 3,
  prev_entry_course: 2,
  prev_start_timing: 0.15,
  prev_finish_rank: 4,
  ...overrides,
});
const dbRows = (make, extra = {}) =>
  [1, 2, 3, 4, 5, 6].map((boat) => ({ ...make(boat), ...extra }));

/**
 * Supabaseクライアントの差し替え。missingColumns に列名を入れると、その列を含む書き込み・その列を含む
 * selectが、PostgRESTと同じ形のエラーで失敗する（列が未適用のDBの再現）。
 * errorStyle: "postgrest"=PGRST204（書き込み）、"pg"=42703（column ... does not exist）
 */
function fakeClient({
  existingByTable = {},
  missingColumns = [],
  errorStyle = "postgrest",
  writeError = null,
} = {}) {
  const calls = { selects: [], upserts: [] };
  const missingError = (table, column) =>
    errorStyle === "pg"
      ? {
          code: "42703",
          message: `column "${column}" of relation "${table}" does not exist`,
        }
      : {
          code: "PGRST204",
          message: `Could not find the '${column}' column of '${table}' in the schema cache`,
        };
  return {
    calls,
    from(table) {
      return {
        select(columns) {
          return {
            async in(column, ids) {
              calls.selects.push({ table, columns, column, ids });
              const missing = missingColumns.find((c) =>
                columns.split(",").includes(c),
              );
              if (missing) {
                return {
                  data: null,
                  error: {
                    code: "42703",
                    message: `column ${table}.${missing} does not exist`,
                  },
                };
              }
              const rows = (existingByTable[table] ?? []).filter((row) =>
                ids.includes(row[column]),
              );
              // selectした列だけを返す（PostgRESTと同じ）
              const wanted = columns.split(",");
              return {
                data: clone(rows).map((row) =>
                  Object.fromEntries(
                    wanted.filter((c) => c in row).map((c) => [c, row[c]]),
                  ),
                ),
                error: null,
              };
            },
          };
        },
        async upsert(batch, options) {
          calls.upserts.push({ table, batch: clone(batch), options });
          if (writeError) return { error: writeError };
          for (const row of batch) {
            const missing = missingColumns.find((c) => c in row);
            if (missing) return { error: missingError(table, missing) };
          }
          return { error: null };
        },
      };
    },
  };
}

const exhibitionOptions = {
  onConflict: "race_id,boat_number",
  keyColumns: ["race_id", "boat_number"],
  stampUpdatedAt: true,
  now: NOW,
};

// ---------------------------------------------------------------------------
// (a) 比較・書き込み
// ---------------------------------------------------------------------------
{
  // updated_at・created_at だけが違う行は変更なし（列が「取得のたびに変わる値」でも比較に含めない）
  const existing = dbRows(exhibitionRow, {
    created_at: "2026-09-18T05:00:00+00:00",
    updated_at: "2026-09-18T05:01:00+00:00",
  });
  const incoming = dbRows(exhibitionRow, { updated_at: NOW.toISOString() });
  const r = diffRows(existing, incoming, {
    keyColumns: ["race_id", "boat_number"],
    ignoreColumns: ["updated_at", "created_at"],
    scales: NUMERIC_SCALES.exhibition_data,
  });
  check(
    "diffRows: updated_at・created_atだけが違う行は変更なし（比較から外れている）",
    r.stats.unchanged === 6 && r.toWrite.length === 0,
    JSON.stringify(r.stats),
  );
}
{
  // 適用後（既存行に列がある）・適用前（既存行に列が無い）のどちらでも、同一値は0件書き込み
  for (const [label, extra] of [
    [
      "適用後（既存行にcreated_at・updated_atがある）",
      {
        created_at: "2026-09-18T05:00:00+00:00",
        updated_at: "2026-09-18T05:01:00+00:00",
      },
    ],
    ["適用前（既存行に列が無い）", {}],
    [
      "適用後・追加前に保存された行（列はあるがNULL）",
      { created_at: null, updated_at: null },
    ],
  ]) {
    const client = fakeClient({
      existingByTable: { exhibition_data: dbRows(exhibitionRow, extra) },
    });
    const r = await upsertChangedRows(
      client,
      "exhibition_data",
      dbRows(exhibitionRow),
      { ...exhibitionOptions, label: "exhibition_data" },
    );
    check(
      `変更のない行の書き込みは0件: ${label}`,
      client.calls.upserts.length === 0 && r.written === 0 && r.skipped === 6,
      JSON.stringify(client.calls.upserts.map((u) => u.batch.length)),
    );
    check(
      `既存行のselectに updated_at・created_at を含めない: ${label}`,
      client.calls.selects.every(
        (s) =>
          !s.columns.split(",").includes("updated_at") &&
          !s.columns.split(",").includes("created_at"),
      ),
      client.calls.selects[0]?.columns,
    );
  }
}
{
  // 変更のある1行と新規の1行だけを書き、その行にだけ updated_at を設定する。created_atは含めない
  const existing = dbRows(exhibitionRow, {
    created_at: "2026-09-18T05:00:00+00:00",
    updated_at: "2026-09-18T05:01:00+00:00",
  }).slice(0, 5); // 6号艇の既存行なし（新規）
  const client = fakeClient({ existingByTable: { exhibition_data: existing } });
  const incoming = dbRows(exhibitionRow);
  incoming[0].exhibition_time = 6.55; // 1号艇だけ変化
  const r = await upsertChangedRows(client, "exhibition_data", incoming, {
    ...exhibitionOptions,
    label: "exhibition_data",
  });
  const batch = client.calls.upserts[0]?.batch ?? [];
  check(
    "変更のある行と新規の行だけを書く（2件）",
    client.calls.upserts.length === 1 &&
      batch.length === 2 &&
      batch.map((row) => row.boat_number).join() === "1,6" &&
      r.written === 2 &&
      r.skipped === 4,
    JSON.stringify(batch.map((row) => row.boat_number)),
  );
  check(
    "書く行には updated_at=現在時刻 を設定する",
    batch.every((row) => row.updated_at === NOW.toISOString()),
  );
  check(
    "created_at は書き込み内容に含めない（INSERT時のDBのDEFAULTに任せる）",
    batch.every((row) => !("created_at" in row)),
  );
  check(
    "書き込むのは値の変化があった列を含む従来どおりの全列（1号艇の展示タイムが新しい値）",
    batch[0]?.exhibition_time === 6.55,
  );
}
{
  // dry-run: 書き込まず、書くはずの行数を返す
  const client = fakeClient({
    existingByTable: { exhibition_data: dbRows(exhibitionRow) },
  });
  const incoming = dbRows(exhibitionRow);
  incoming[2].tilt = 1.0;
  const r = await upsertChangedRows(client, "exhibition_data", incoming, {
    ...exhibitionOptions,
    dryRun: true,
  });
  check(
    "dry-runは書き込まず、書くはずの1件を返す",
    client.calls.upserts.length === 0 && r.stats.toWrite === 1,
  );
}
{
  // stampUpdatedAt を使わない呼び出し（他のテーブル）は、従来どおり updated_at を付けない
  const client = fakeClient();
  await upsertChangedRows(
    client,
    "race_entries",
    [{ race_id: RACE, boat_number: 1, win_rate: 5.5 }],
    {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
    },
  );
  check(
    "stampUpdatedAt未指定のテーブルにはupdated_atを付けない",
    client.calls.upserts.length === 1 &&
      !("updated_at" in client.calls.upserts[0].batch[0]),
  );
}
{
  // 既存行の取得に失敗したら全行を書く（変更なしにしない）。その全行にも updated_at を設定する
  const client = fakeClient({ missingColumns: ["tilt"] });
  const incoming = dbRows(exhibitionRow);
  const r = await filterUnchangedRows(client, "exhibition_data", incoming, {
    keyColumns: ["race_id", "boat_number"],
    ignoreColumns: ["updated_at"],
  });
  check(
    "既存行のselectに失敗したら全行を書く（比較できないものを変更なしにしない）",
    r.fallback === true && r.toWrite.length === 6,
  );
}

// ---------------------------------------------------------------------------
// (b) マイグレーション未適用の書き直し
// ---------------------------------------------------------------------------
for (const errorStyle of ["postgrest", "pg"]) {
  const style = errorStyle === "pg" ? "42703" : "PGRST204";
  const client = fakeClient({ missingColumns: ["updated_at"], errorStyle });
  const incoming = dbRows(exhibitionRow);
  const r = await upsertChangedRows(client, "race_entries", incoming, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    stampUpdatedAt: true,
    now: NOW,
  });
  const [first, retry] = client.calls.upserts;
  check(
    `updated_at未適用(${style}): updated_atを除いて1回だけ書き直し、他の列は書く`,
    client.calls.upserts.length === 2 &&
      "updated_at" in first.batch[0] &&
      !("updated_at" in retry.batch[0]) &&
      retry.batch.length === 6 &&
      retry.batch[0].exhibition_time === incoming[0].exhibition_time &&
      r.error === null &&
      r.written === 6,
    JSON.stringify(r.error?.message),
  );
}
{
  // 2バッチ目以降は、最初から updated_at を除く（同じエラーを毎バッチ繰り返さない）
  const client = fakeClient({ missingColumns: ["updated_at"] });
  const r = await upsertChangedRows(
    client,
    "race_entries",
    dbRows(exhibitionRow),
    {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
      stampUpdatedAt: true,
      batchSize: 2,
      now: NOW,
    },
  );
  check(
    "2バッチ目以降は最初から updated_at を除く（失敗1回+成功3バッチ=4回のupsert）",
    client.calls.upserts.length === 4 &&
      client.calls.upserts
        .slice(1)
        .every((u) => !("updated_at" in u.batch[0])) &&
      r.written === 6 &&
      r.error === null,
    String(client.calls.upserts.length),
  );
}
{
  // 展示の列は、グループ単位で除く。059だけ未適用なら、056の列(tilt等)とupdated_atは書き続ける
  const groups = {
    "マイグレーション056（BOA-221）": [
      "tilt",
      "propeller_change",
      "parts_changed",
      "adjustment_weight",
    ],
    "マイグレーション059（BOA-289）": [
      "today_weight",
      "prev_race_no",
      "prev_entry_course",
      "prev_start_timing",
      "prev_finish_rank",
    ],
  };
  const run = async (missingColumns) => {
    const client = fakeClient({ missingColumns });
    const r = await upsertChangedRows(
      client,
      "exhibition_data",
      dbRows(exhibitionRow),
      {
        ...exhibitionOptions,
        optionalColumnGroups: groups,
      },
    );
    return { client, r, last: client.calls.upserts.at(-1)?.batch[0] ?? {} };
  };
  {
    const { r, last } = await run(["today_weight"]);
    check(
      "059だけ未適用: 059の列だけ除き、056の列とupdated_atは書き続ける",
      r.error === null &&
        !("today_weight" in last) &&
        !("prev_finish_rank" in last) &&
        "tilt" in last &&
        "adjustment_weight" in last &&
        last.updated_at === NOW.toISOString(),
      JSON.stringify(Object.keys(last)),
    );
  }
  {
    const { r, last } = await run(["tilt", "today_weight"]);
    check(
      "056・059とも未適用: 両グループを除き、updated_atは書き続ける",
      r.error === null &&
        !("tilt" in last) &&
        !("today_weight" in last) &&
        last.updated_at === NOW.toISOString() &&
        "exhibition_time" in last,
      JSON.stringify(Object.keys(last)),
    );
  }
  {
    const { r, last } = await run(["tilt", "today_weight", "updated_at"]);
    check(
      "056・059・071とも未適用: 全て除いて、従来の列だけで書き込める",
      r.error === null &&
        !("tilt" in last) &&
        !("today_weight" in last) &&
        !("updated_at" in last) &&
        "exhibition_time" in last &&
        r.written === 6,
      JSON.stringify(Object.keys(last)),
    );
  }
}
{
  // 列不在と無関係なエラー（権限・接続等）は、列を落として再試行せずエラーにする
  const client = fakeClient({
    writeError: {
      code: "42501",
      message: "permission denied for table race_entries",
    },
  });
  const r = await upsertChangedRows(
    client,
    "race_entries",
    dbRows(exhibitionRow),
    {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
      stampUpdatedAt: true,
      now: NOW,
    },
  );
  check(
    "列不在と無関係なエラーは再試行せず、エラーを返す",
    client.calls.upserts.length === 1 && r.error !== null && r.written === 0,
  );
}
{
  // 別の列の不在は、updated_atの不在と取り違えない
  const client = fakeClient({ missingColumns: ["foo_column"] });
  const rows = dbRows((b) => ({
    race_id: RACE,
    boat_number: b,
    foo_column: 1,
  }));
  const r = await upsertChangedRows(client, "race_entries", rows, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    stampUpdatedAt: true,
    now: NOW,
  });
  check(
    "updated_at以外の列の不在では、updated_atを除いて再試行しない（エラーを返す）",
    client.calls.upserts.length === 1 && r.error !== null,
  );
}
{
  check(
    "isColumnMissingError: PGRST204/42703のメッセージ・コードを判定し、列名の部分一致では誤判定しない",
    isColumnMissingError(
      "Could not find the 'updated_at' column of 'race_entries' in the schema cache",
      ["updated_at"],
    ) === true &&
      isColumnMissingError(
        {
          code: "42703",
          message: 'column "updated_at" of relation "x" does not exist',
        },
        ["updated_at"],
      ) === true &&
      isColumnMissingError(
        "Could not find the 'prev_updated_at' column of 'x' in the schema cache",
        ["updated_at"],
      ) === false &&
      isColumnMissingError("duplicate key value violates unique constraint", [
        "updated_at",
      ]) === false &&
      isColumnMissingError(null, ["updated_at"]) === false,
  );
}

// ---------------------------------------------------------------------------
// (c) data-health-report
// ---------------------------------------------------------------------------
{
  // 列が無い（未適用）: クエリを発行せず、全テーブルが「計測不能」
  let fetched = 0;
  const result = await collectScrapedTimestamps({
    timingColumns: [
      { table_name: "race_conditions", column_name: "created_at" },
    ],
    windowStart: "2026-09-13",
    endDate: "2026-09-19",
    fetch: async () => {
      fetched++;
      return {};
    },
  });
  check(
    "collectScrapedTimestamps: 未適用ならクエリを発行せず、3テーブルとも計測不能",
    fetched === 0 &&
      result.error === null &&
      result.tables.length === 3 &&
      result.tables.every((t) => t.applied === false),
  );
}
{
  // 一部のテーブルだけ適用済み: 適用済みのテーブルだけ計測する
  const queries = [];
  const result = await collectScrapedTimestamps({
    timingColumns: ["created_at", "updated_at"].map((column_name) => ({
      table_name: "race_entries",
      column_name,
    })),
    windowStart: "2026-09-13",
    endDate: "2026-09-19",
    fetch: async (q) => {
      queries.push(...Object.keys(q));
      return {
        scraped_race_entries: [
          {
            races_in_period: "100",
            races_with_rows: "100",
            races_with_created_at: "50",
            saved_after_start: "0",
            lead_min_p10: "55.2",
            lead_min_p50: "60.1",
            lead_min_p90: "63.0",
            hit_60: "30",
          },
        ],
      };
    },
  });
  const entries = result.tables.find((t) => t.table === "race_entries");
  check(
    "collectScrapedTimestamps: 適用済みのテーブルだけ計測し、分母はcreated_at非NULLのレース",
    queries.join() === "scraped_race_entries" &&
      entries.applied === true &&
      entries.racesWithCreatedAt === 50 &&
      entries.savedBy[0].rate === 0.6 &&
      entries.leadMinutes.p50 === 60.1 &&
      result.tables.find((t) => t.table === "exhibition_data").applied ===
        false,
    JSON.stringify(entries),
  );
}
{
  // 計測に失敗しても例外にしない（他の指標を止めない）
  const result = await collectScrapedTimestamps({
    timingColumns: ["created_at", "updated_at"].map((column_name) => ({
      table_name: "exhibition_data",
      column_name,
    })),
    windowStart: "2026-09-13",
    endDate: "2026-09-19",
    fetch: async () => {
      throw new Error("SQL実行に失敗 (HTTP 500): statement timeout");
    },
  });
  check(
    "collectScrapedTimestamps: 計測に失敗してもレポートを止めず、エラーを結果に残す",
    typeof result.error === "string" &&
      result.error.includes("statement timeout") &&
      result.tables.every((t) => t.applied === false),
  );
}

// レポート全体（main）を、DBの代わりに固定のSQL結果を返すfetchで実行する
async function runReport({ timingColumns, scrapedRows }) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-report-"));
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const env = {
    SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
  };
  const sqlLog = [];
  const output = [];
  process.env.SUPABASE_ACCESS_TOKEN = "dummy-token";
  process.env.SUPABASE_URL = "https://dummyref.supabase.co";
  globalThis.fetch = async (url, init) => {
    const { query } = JSON.parse(init.body);
    sqlLog.push(query);
    let rows = [];
    if (query.includes("information_schema.columns")) rows = timingColumns;
    else if (query.includes("information_schema.tables"))
      rows = [
        "exhibition_data",
        "race_entries",
        "race_start_timings",
        "races",
      ].map((table_name) => ({ table_name }));
    else if (query.includes("pg_database_size")) rows = [{ bytes: "1000" }];
    else if (query.includes("first_created_at")) {
      const table = /from (\w+) x/.exec(query)[1];
      rows = scrapedRows[table] ? [scrapedRows[table]] : [];
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
  };
  console.log = (...args) => output.push(args.join(" "));
  console.error = () => {};
  try {
    await runHealthReport([
      "--end-date",
      "2026-09-19",
      "--skip-gh",
      "--out-dir",
      outDir,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const jsonFile = fs.readdirSync(outDir).find((f) => f.endsWith(".json"));
  const json = JSON.parse(fs.readFileSync(path.join(outDir, jsonFile), "utf8"));
  fs.rmSync(outDir, { recursive: true, force: true });
  return { markdown: output.join("\n"), json, sqlLog };
}

{
  const { markdown, json, sqlLog } = await runReport({
    timingColumns: [],
    scrapedRows: {},
  });
  check(
    "data-health-report: 未適用でも失敗せず、「未適用のため計測不能」と出す",
    markdown.includes("3-2. 取得時刻（created_at）の分布") &&
      markdown.includes("未適用のため計測不能") &&
      json.scrapedTimestamps.tables.every((t) => t.applied === false),
  );
  check(
    "data-health-report: 未適用なら、created_atを参照するクエリを発行しない（列が無いSQLエラーにならない）",
    !sqlLog.some((q) => q.includes("first_created_at")),
  );
  check(
    "data-health-report: 未適用の3テーブルは、従来どおりタイミング計測不能のアラートに出る",
    ["exhibition_data", "race_entries", "race_start_timings"].every((t) =>
      json.alerts.some(
        (a) => a.kind === "timing_unmeasurable" && a.item.includes(t),
      ),
    ),
  );
}
{
  const timingColumns = [
    "exhibition_data",
    "race_entries",
    "race_start_timings",
  ].flatMap((table_name) =>
    ["created_at", "updated_at"].map((column_name) => ({
      table_name,
      column_name,
      data_type: "timestamp with time zone",
    })),
  );
  const exhibitionRowResult = {
    races_in_period: "1000",
    races_with_rows: "990",
    races_with_created_at: "200",
    saved_after_start: "3",
    lead_min_p10: "8.4",
    lead_min_p50: "17.26",
    lead_min_p90: "26.0",
    hit_30: "20",
    hit_15: "120",
    hit_10: "196",
    races_with_value_filled: "198",
    filled_lead_min_p10: "7.0",
    filled_lead_min_p50: "15.0",
    filled_lead_min_p90: "24.0",
  };
  const { markdown, json, sqlLog } = await runReport({
    timingColumns,
    scrapedRows: {
      exhibition_data: exhibitionRowResult,
      race_entries: {
        races_in_period: "1000",
        races_with_rows: "990",
        races_with_created_at: "200",
        saved_after_start: "0",
        lead_min_p10: "55",
        lead_min_p50: "60",
        lead_min_p90: "63",
        hit_60: "150",
      },
      race_start_timings: {
        races_in_period: "1000",
        races_with_rows: "900",
        races_with_created_at: "150",
        saved_after_start: "150",
        lead_min_p10: "-70",
        lead_min_p50: "-30",
        lead_min_p90: "-15",
      },
    },
  });
  const exhibition = json.scrapedTimestamps.tables.find(
    (t) => t.table === "exhibition_data",
  );
  check(
    "data-health-report: 適用後は、分布(p10/p50/p90)と発走m分前までの累積割合を、非NULLのレースを分母に出す",
    sqlLog.filter((q) => q.includes("first_created_at")).length === 3 &&
      exhibition.leadMinutes.p50 === 17.3 &&
      exhibition.savedBy
        .map((w) => `${w.minutesBefore}:${w.hit}/${w.denominator}`)
        .join() === "30:20/200,15:120/200,10:196/200" &&
      markdown.includes("10分前: 98.0% (196/200)") &&
      markdown.includes("8.4 / 17.3 / 26") &&
      markdown.includes("値が揃った時刻"),
    JSON.stringify(exhibition),
  );
  check(
    "data-health-report: 適用後の3テーブルは、タイミング計測不能のアラートに出ない",
    !json.alerts.some(
      (a) =>
        a.kind === "timing_unmeasurable" &&
        /exhibition_data|race_entries|race_start_timings/.test(a.item),
    ),
    JSON.stringify(
      json.alerts
        .filter((a) => a.kind === "timing_unmeasurable")
        .map((a) => a.item),
    ),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
