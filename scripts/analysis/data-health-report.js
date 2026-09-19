#!/usr/bin/env node
/**
 * データ健全性の実測レポート（WS1、docs/design/scraping-vercel-consolidation/orchestration.md）
 *
 * 本番DBを読み取り専用で実測し、データ取得の「完了の定義」（.claude/rules/data-acquisition.md）の
 * A（存在充足率）・B（窓内取得率）を判定するための指標を出力する。
 *
 * 出力:
 *   - 標準出力: 日本語Markdownの要約（閾値を下回る項目を先頭に列挙）
 *   - data/analysis/data-health/YYYY-MM-DD.json: 機械可読な結果（同日再実行は上書き）
 *
 * 使い方:
 *   node scripts/analysis/data-health-report.js [--end-date YYYY-MM-DD] [--skip-gh]
 *        [--cache-file <path>] [--compare-dates YYYY-MM-DD,YYYY-MM-DD] [--out-dir <dir>]
 *
 *   --end-date       集計期間の最終日（既定: 昨日JST。当日は結果が未確定のため含めない）
 *   --cache-file     DBの生結果のキャッシュ（クエリごとにSQLのハッシュで照合。SQLや期間が変わったクエリは再実行する）
 *   --compare-dates  窓内取得率を、指定日だけで再集計して併記する（過去の実測値との突合用）
 *   --skip-gh        GitHub Actions（gh CLI）の鮮度確認を省略する
 *
 * SQLの実行方法: Supabase Management API の read-only エンドポイントを使う。
 * 理由: information_schema・pg_total_relation_size 等のカタログ参照が必要で supabase-js
 * （PostgREST）では発行できないこと、read-only エンドポイントにより書き込みが構造的に不可能に
 * なることの2点。環境変数: SUPABASE_URL, SUPABASE_ACCESS_TOKEN。
 *
 * Disk IO予算（BOA-357）への配慮: 全てサーバー側集計、クエリは逐次実行（並列にしない）、
 * 期間は日別14日・窓内7日・月別のみ全期間（GROUP BY 1本）。race_odds等の全件走査はしない。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  addDaysToDateString,
  getTodayDateJST,
  getYesterdayDateJST,
} from "../lib/dateUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "../..");
dotenv.config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });

// 完了の定義（.claude/rules/data-acquisition.md）に基づく閾値
const COVERAGE_THRESHOLD = 0.99;
const WINDOW_THRESHOLD = 0.98;
const COVERAGE_DAYS = 14;
const WINDOW_DAYS = 7;
const WINDOW_MINUTES = [60, 30, 15, 10, 5, 0];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 全券種オッズの各列。空オブジェクト・空配列・JSONのnullは「未取得」と扱う
const ALL_ODDS_COLUMNS = [
  "trifecta_all",
  "trio_all",
  "exacta_all",
  "quinella_all",
  "wide_all",
];

const COVERAGE_METRICS = [
  { key: "result", label: "結果(rank1)" },
  { key: "rank4_6", label: "rank4〜6" },
  { key: "actual_course", label: "実進入(actual_course_1)" },
  { key: "winning_technique", label: "決まり手" },
  { key: "race_stage", label: "レース種別" },
  { key: "st_row", label: "ST(行の有無)" },
  { key: "st_value", label: "ST(start_timing非NULL)" },
  { key: "exhibition_row", label: "展示(行の有無)" },
  { key: "exhibition_time", label: "展示(exhibition_time非NULL)" },
  { key: "odds", label: "オッズ(1件以上)" },
  { key: "odds_all", label: "全券種オッズ(5種すべて)" },
  ...ALL_ODDS_COLUMNS.map((c) => ({ key: c, label: `└ ${c}` })),
];

// 窓内取得率の「除外した値」に使う既知の障害期間（除外しない値も常に併記する）。
// 障害が発生したら追記する。集計期間外の障害は結果に影響しない。ISO 8601（オフセット付き）で書く
const KNOWN_INCIDENTS = [
  {
    label:
      "BOA-352 Supabase障害（statement timeout。オーケストレーターが早期終了）",
    start: "2026-09-16T18:04:00+09:00",
    end: "2026-09-16T21:58:00+09:00",
  },
];

// 取得時刻列の有無を確認する主要テーブル
const TIMING_TABLES = [
  "races",
  "race_entries",
  "race_conditions",
  "race_results",
  "race_start_timings",
  "exhibition_data",
  "race_odds",
  "predictions",
  "prediction_odds",
  "race_special_notes",
  "racer_series_points",
  "racer_profiles",
  "venue_entry_course_stats",
  "venue_motor_stats",
  "race_notices_health",
];
// 行が「最初に」保存された時刻を created_at が表すテーブル（マイグレーション071、WS2）。
// created_at は INSERT 時の DEFAULT now() で、UPSERTの更新では触られないため、初回の取得時刻になる。
// 他のテーブルの created_at は、この保証が無い（または別の意味の列）ため、従来どおり「弱い」列として扱う
const FIRST_SAVED_TIMING_TABLES = new Set([
  "exhibition_data",
  "race_entries",
  "race_start_timings",
]);
// 取得時刻の分布を出す対象。minutes は「発走m分前までに保存されたレースの割合」を出す基準時刻。
// exhibition_data は展示取得の窓（30/15/10分前）、race_entries は出走表更新の窓（60分前）。
// race_start_timings は発走後に保存されるため、基準時刻は無い（発走後に保存された割合のみ）
const SCRAPED_TIMESTAMP_TABLES = [
  { table: "exhibition_data", minutes: [30, 15, 10], hasValueFilled: true },
  { table: "race_entries", minutes: [60], hasValueFilled: false },
  { table: "race_start_timings", minutes: [], hasValueFilled: false },
];
// 実際の取得（スクレイピング・予測生成・確定）時刻を表す列
const STRONG_TIMING_COLUMN =
  /^(scraped_at|scraped_date|captured_at|predicted_at|result_at|last_checked_at|fetched_at)$/;
// 取得のたびに上書きされる列（初回の取得時刻ではなく、最終書き込み時刻を表す）
const OVERWRITTEN_ON_UPSERT = new Set(["result_at", "predicted_at"]);
// 行の作成・更新時刻。upsertで上書きされうる/初回挿入時刻のみのため、取得時刻としては弱い
const WEAK_TIMING_COLUMN = /^(created_at|updated_at)$/;

// ---------------------------------------------------------------------------
// 引数・SQL実行
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    endDate: getYesterdayDateJST(),
    defaultEndDate: getYesterdayDateJST(),
    skipGh: false,
    cacheFile: null,
    compareDates: [],
    outDir: path.join(REPO_ROOT, "data/analysis/data-health"),
  };
  const takeValue = (i, name) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} には値が必要です`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-gh") opts.skipGh = true;
    else if (arg === "--end-date") opts.endDate = takeValue(i++, arg);
    else if (arg === "--cache-file") opts.cacheFile = takeValue(i++, arg);
    else if (arg === "--out-dir") opts.outDir = takeValue(i++, arg);
    else if (arg === "--compare-dates")
      opts.compareDates = takeValue(i++, arg).split(",").filter(Boolean);
    else throw new Error(`未知の引数: ${arg}`);
  }
  for (const d of [opts.endDate, ...opts.compareDates]) {
    if (!DATE_PATTERN.test(d ?? ""))
      throw new Error(`日付はYYYY-MM-DD形式で指定してください: ${d}`);
  }
  return opts;
}

/** Management APIのread-onlyエンドポイントでSQLを1本実行する */
async function runSql(query) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!accessToken || !supabaseUrl) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN と SUPABASE_URL が必要です（.env.local を確認）",
    );
  }
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query/read-only`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `SQL実行に失敗 (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  return JSON.parse(body);
}

const RETRY_LIMIT = 2;
const RETRY_WAIT_MS = 20000;

/** 接続タイムアウト等、クエリ実行前の一時的な失敗のみ待ってから再試行する。それ以外は即失敗 */
async function runSqlWithRetry(query) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runSql(query);
    } catch (error) {
      // 接続確立前の失敗のみ再試行する。statement timeout等はクエリ自体が重い/DBが逼迫している
      // 状態のため、同じクエリを再発行して負荷を上乗せしない
      const transient =
        /HTTP 5\d\d/.test(error.message) &&
        /connection timeout|ECONNRESET|fetch failed/i.test(error.message) &&
        !/statement timeout/i.test(error.message);
      if (!transient || attempt >= RETRY_LIMIT) throw error;
      console.error(
        `  一時的な失敗のため${RETRY_WAIT_MS / 1000}秒後に再試行: ${error.message.slice(0, 120)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
    }
  }
}

// ---------------------------------------------------------------------------
// SQL（日付はDATE_PATTERN検証済みの文字列のみ埋め込む）
// ---------------------------------------------------------------------------

const nonEmptyJson = (col) =>
  `(x.${col} is not null and x.${col} not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))`;

export function buildQueries({ coverageStart, windowStart, endDate }) {
  const incidentRanges =
    KNOWN_INCIDENTS.length === 0
      ? "select null::tstzrange as r where false"
      : `values ${KNOWN_INCIDENTS.map((i) => `(tstzrange('${i.start}'::timestamptz, '${i.end}'::timestamptz))`).join(",")}`;
  // race_idは「YYYY-MM-DD-会場-R」形式。期間の上端は翌日の文字列との大小比較で表す
  const endExclusive = addDaysToDateString(endDate, 1);
  // race_oddsは全券種のjsonbが大きいため、レースごとに1回だけ読んで集約する（レースごとの
  // 相関サブクエリを列数分繰り返すと読み取りが数倍になる。Disk IO予算への配慮）
  const oddsAggregates = ALL_ODDS_COLUMNS.map(
    (c) => `bool_or(${nonEmptyJson(c)}) as has_${c}`,
  ).join(",\n      ");
  const allOddsAll = ALL_ODDS_COLUMNS.map(nonEmptyJson).join(" and ");
  const perTypeCount = ALL_ODDS_COLUMNS.map(
    (c) =>
      `count(*) filter (where active and coalesce(has_${c}, false)) as ${c}`,
  ).join(",\n    ");

  return {
    // 指標1: 存在充足率（日別）。分母は開催中止(confirmed)を除いたレース
    coverage: `
with o as (
  select x.race_id,
      bool_or(${allOddsAll}) as has_odds_all,
      ${oddsAggregates}
  from race_odds x
  where x.race_id >= '${coverageStart}' and x.race_id < '${endExclusive}'
  group by x.race_id
), b as (
  select r.race_id, r.race_date,
      (r.cancellation_status is distinct from 'confirmed') as active,
      rr.rank1, rr.rank4, rr.rank5, rr.rank6, rr.actual_course_1, rr.winning_technique,
      rc.race_stage,
      exists(select 1 from race_start_timings x where x.race_id = r.race_id) as has_st_row,
      exists(select 1 from race_start_timings x where x.race_id = r.race_id and x.start_timing is not null) as has_st_value,
      exists(select 1 from exhibition_data x where x.race_id = r.race_id) as has_exhibition_row,
      -- check-exhibition-gap-rate.js（BOA-356）と同じ基準: 1艇でも展示タイムが入っていれば取得済み
      exists(select 1 from exhibition_data x where x.race_id = r.race_id and x.exhibition_time is not null) as has_exhibition_time,
      (o.race_id is not null) as has_odds,
      o.has_odds_all,
      ${ALL_ODDS_COLUMNS.map((c) => `o.has_${c}`).join(", ")}
  from races r
  left join race_results rr on rr.race_id = r.race_id
  left join race_conditions rc on rc.race_id = r.race_id
  left join o on o.race_id = r.race_id
  where r.race_date between '${coverageStart}' and '${endDate}'
)
select race_date::text as d,
    count(*) as total,
    count(*) filter (where not active) as excluded,
    count(*) filter (where active) as denom,
    count(*) filter (where active and rank1 is not null) as result,
    count(*) filter (where active and rank4 is not null and rank5 is not null and rank6 is not null) as rank4_6,
    count(*) filter (where active and actual_course_1 is not null) as actual_course,
    count(*) filter (where active and winning_technique is not null) as winning_technique,
    count(*) filter (where active and race_stage is not null) as race_stage,
    count(*) filter (where active and has_st_row) as st_row,
    count(*) filter (where active and has_st_value) as st_value,
    count(*) filter (where active and has_exhibition_row) as exhibition_row,
    count(*) filter (where active and has_exhibition_time) as exhibition_time,
    count(*) filter (where active and has_odds) as odds,
    count(*) filter (where active and coalesce(has_odds_all, false)) as odds_all,
    ${perTypeCount}
from b group by race_date order by race_date`,

    // 指標2: 窓内取得率（日別×窓）。締切=発走時刻(JST)。窓=中心±3分
    windows: `
with base as (
  select r.race_id, r.race_date,
      (r.race_date::timestamp + r.start_time) at time zone 'Asia/Tokyo' as dl
  from races r
  where r.race_date between '${windowStart}' and '${endDate}'
    and r.start_time is not null
    and r.cancellation_status is distinct from 'confirmed'
    and exists (select 1 from race_results rr where rr.race_id = r.race_id and rr.rank1 is not null)
), w(m) as (values ${WINDOW_MINUTES.map((m) => `(${m})`).join(",")}),
inc(r) as (${incidentRanges})
select b.race_date::text as d, w.m,
    count(*) as races,
    count(*) filter (where c.hit) as in_window,
    count(*) filter (where c.clean) as races_clean,
    count(*) filter (where c.clean and c.hit) as in_window_clean
from base b cross join w
cross join lateral (
  select exists (
      select 1 from race_odds o
      where o.race_id = b.race_id
        and o.captured_at between b.dl - make_interval(mins => w.m + 3)
                              and b.dl - make_interval(mins => w.m - 3)
    ) as hit,
    -- 窓の時間帯が既知の障害期間と重なる(レース,窓)は除外した集計に含めない
    not exists (
      select 1 from inc
      where inc.r && tstzrange(b.dl - make_interval(mins => w.m + 3),
                               b.dl - make_interval(mins => w.m - 3))
    ) as clean
) c
group by b.race_date, w.m order by b.race_date, w.m desc`,

    // 指標3: 取得時刻列の有無
    timingColumns: `
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (${TIMING_TABLES.map((t) => `'${t}'`).join(",")})
  and (data_type like 'timestamp%' or data_type = 'date')
  and column_name ~ '(scraped|captured|created|updated|predicted|result_at|checked|fetched)'
order by table_name, ordinal_position`,

    tableExistence: `
select table_name from information_schema.tables
where table_schema = 'public' and table_name in (${TIMING_TABLES.map((t) => `'${t}'`).join(",")})`,

    // 指標4: 月別の結果充足率（全期間、当日以降は結果未確定のため除く）。日単位の集計を経由して月に丸める
    monthly: `
with d as (
  select r.race_date,
      count(*) as total,
      count(*) filter (where r.cancellation_status = 'confirmed') as excluded,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed') as denom,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.rank1 is not null) as with_result,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.race_id is null) as no_result_row,
      count(*) filter (where r.cancellation_status is distinct from 'confirmed' and rr.race_id is not null and rr.rank1 is null) as row_without_rank1
  from races r left join race_results rr on rr.race_id = r.race_id
  where r.race_date <= '${endDate}'
  group by r.race_date
)
select to_char(race_date, 'YYYY-MM') as month,
    count(*) as days,
    sum(total)::int as total, sum(excluded)::int as excluded, sum(denom)::int as denom,
    sum(with_result)::int as with_result,
    sum(no_result_row)::int as no_result_row,
    sum(row_without_rank1)::int as row_without_rank1,
    count(*) filter (where denom > 0 and with_result = 0) as zero_result_days,
    count(*) filter (where with_result > 0 and with_result < denom) as partial_days
from d group by 1 order by 1`,

    // 指標5: 取得系の小規模テーブルの件数と鮮度
    freshness: `
select 'race_special_notes' as t, count(*)::int as n, max(scraped_at)::text as latest_time, max(race_date)::text as latest_date from race_special_notes
union all select 'racer_series_points', count(*)::int, max(scraped_at)::text, max(meet_start_date)::text from racer_series_points
union all select 'venue_entry_course_stats', count(*)::int, max(scraped_at)::text, max(stats_period_end)::text from venue_entry_course_stats
union all select 'venue_motor_stats', count(*)::int, max(scraped_date)::text, max(stats_period_end)::text from venue_motor_stats
union all select 'racer_profiles', count(*)::int, max(scraped_at)::text, max(official_updated_at)::text from racer_profiles
union all select 'racer_profiles.ability_index(非NULL)', count(ability_index)::int, null, null from racer_profiles
union all select 'race_notices_health', count(*)::int, max(last_checked_at)::text, max(check_date)::text from race_notices_health
union all select 'race_notices_health(had_success)', (count(*) filter (where had_success))::int, null, null from race_notices_health`,

    // 指標5補足: 主要テーブルの最新データ位置（PKのbtree末尾のみを読む軽量クエリ）
    latest: `
select 'races.race_date' as k, max(race_date)::text as v from races
union all select 'race_results.race_id', max(race_id) from race_results
union all select 'race_conditions.race_id', max(race_id) from race_conditions
union all select 'exhibition_data.race_id', max(race_id) from exhibition_data
union all select 'race_start_timings.race_id', max(race_id) from race_start_timings
union all select 'race_odds.race_id', max(race_id) from race_odds
union all select 'race_odds.captured_at(${endDate}以降)', max(captured_at)::text from race_odds where race_id >= '${endDate}'`,

    // 指標7: DBサイズ
    dbSize: `select pg_database_size(current_database())::bigint as bytes`,
    tableSizes: `
select c.relname as table_name, pg_total_relation_size(c.oid)::bigint as bytes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by 2 desc limit 10`,
  };
}

/**
 * 取得時刻（created_at）の分布のクエリ（テーブルごとに1本、サーバー側集計）。
 * 「発走時刻 − 行が最初に保存された時刻」（分。発走前に保存されていれば正、発走後なら負）を、
 * レースごとに1値（そのレースの行のうち最も早い created_at）で出し、created_at が非NULLのレースだけを
 * 分母にする（マイグレーション071より前に保存された行はNULLで、含めない）。
 * 期間は窓内取得率と同じ直近7日。主キー（race_id）の範囲検索のみ（Disk IO予算への配慮）。
 *
 * @param {{table: string, minutes: number[], hasValueFilled: boolean}} spec
 */
export function buildScrapedTimestampQuery(
  { table, minutes, hasValueFilled },
  { windowStart, endDate },
) {
  const endExclusive = addDaysToDateString(endDate, 1);
  const hits = minutes
    .map((m) => `count(*) filter (where lead_min >= ${m}) as hit_${m}`)
    .join(",\n    ");
  const percentiles = (col) =>
    [10, 50, 90]
      .map(
        (q) =>
          `percentile_cont(${q / 100}) within group (order by ${col}) as ${col}_p${q}`,
      )
      .join(",\n    ");
  return `
with base as (
  select r.race_id,
      (r.race_date::timestamp + r.start_time) at time zone 'Asia/Tokyo' as dl
  from races r
  where r.race_date between '${windowStart}' and '${endDate}'
    and r.start_time is not null
    and r.cancellation_status is distinct from 'confirmed'
), t as (
  select x.race_id, count(*) as rows_total, min(x.created_at) as first_created_at${
    hasValueFilled
      ? `,
      -- 展示タイムが入っている行の updated_at の最大値＝展示タイムが揃った時刻の近似（値が変わった最後の時刻）
      max(x.updated_at) filter (where x.exhibition_time is not null) as value_filled_at`
      : ""
  }
  from ${table} x
  where x.race_id >= '${windowStart}' and x.race_id < '${endExclusive}'
  group by x.race_id
), l as (
  select t.rows_total,
      (extract(epoch from (b.dl - t.first_created_at)) / 60.0)::float8 as lead_min${
        hasValueFilled
          ? `,
      (extract(epoch from (b.dl - t.value_filled_at)) / 60.0)::float8 as filled_lead_min`
          : ""
      }
  from base b left join t on t.race_id = b.race_id
)
select
    count(*) as races_in_period,
    count(rows_total) as races_with_rows,
    count(lead_min) as races_with_created_at,
    count(*) filter (where lead_min < 0) as saved_after_start,
    ${percentiles("lead_min")}${hits ? `,\n    ${hits}` : ""}${
      hasValueFilled
        ? `,
    count(filled_lead_min) as races_with_value_filled,
    ${percentiles("filled_lead_min")}`
        : ""
    }
from l`;
}

/** クエリを逐次実行する（並列化しない）。cacheFileがあれば再利用・保存する */
const hashSql = (sql) => createHash("sha256").update(sql).digest("hex");

/**
 * クエリを逐次実行する（並列化しない）。
 * キャッシュはクエリごとに「SQL文字列のハッシュ」で照合する。期間やSQLが変わったクエリは
 * 古い結果を再利用せず、再実行する（別期間のキャッシュで別期間のラベルを付ける事故を防ぐ）
 */
async function fetchRaw(queries, cacheFile) {
  const cache =
    cacheFile && fs.existsSync(cacheFile)
      ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
      : {};
  const raw = {};
  for (const [name, sql] of Object.entries(queries)) {
    const hash = hashSql(sql);
    if (cache[name]?.hash === hash) {
      const { savedAt } = cache[name];
      const age = savedAt
        ? `${Math.round((Date.now() - new Date(savedAt).getTime()) / 60000)}分経過`
        : "経過時間不明";
      console.error(`  query ${name}: キャッシュ使用（DB非接続、${age}）`);
      raw[name] = cache[name].rows;
      continue;
    }
    const startedAt = Date.now();
    const rows = await runSqlWithRetry(sql);
    raw[name] = rows;
    cache[name] = { hash, rows, savedAt: new Date().toISOString() };
    console.error(`  query ${name}: ${Date.now() - startedAt}ms`);
    // 途中で失敗しても取得済みの結果を再利用できるよう、1クエリごとに保存する
    if (cacheFile) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// 集計（純粋関数）
// ---------------------------------------------------------------------------

const rate = (numerator, denominator) =>
  denominator === 0 ? null : numerator / denominator;

const formatPct = (value) =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;

const weekdayOf = (dateStr) =>
  WEEKDAY_LABELS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];

const isWeekend = (dateStr) => ["土", "日"].includes(weekdayOf(dateStr));

const datesFrom = (start, days) =>
  Array.from({ length: days }, (_, i) => addDaysToDateString(start, i));

const sum = (rows, key) => rows.reduce((acc, r) => acc + Number(r[key]), 0);

function summarizeCoverage(perDay) {
  const excluded = sum(perDay, "excluded");
  const denominator = sum(perDay, "denom");
  return COVERAGE_METRICS.map(({ key, label }) => {
    const numerator = sum(perDay, key);
    const dayRates = perDay
      .filter((d) => Number(d.denom) > 0)
      .map((d) => ({ date: d.d, rate: Number(d[key]) / Number(d.denom) }));
    const worst = dayRates.reduce(
      (min, cur) => (min === null || cur.rate < min.rate ? cur : min),
      null,
    );
    const value = rate(numerator, denominator);
    return {
      metric: key,
      label,
      numerator,
      denominator,
      excluded,
      rate: value,
      // 分母0（データが1件も無い）は最悪の状態なので、達成扱いにせず未達として扱う
      belowThreshold: value === null || value < COVERAGE_THRESHOLD,
      daysBelowThreshold: dayRates.filter((d) => d.rate < COVERAGE_THRESHOLD)
        .length,
      worstDay: worst,
    };
  });
}

function summarizeWindows(
  rows,
  { onlyDates = null, weekendFilter = null } = {},
) {
  const filtered = rows.filter(
    (r) =>
      (onlyDates === null || onlyDates.includes(r.d)) &&
      (weekendFilter === null || isWeekend(r.d) === weekendFilter),
  );
  return WINDOW_MINUTES.map((m) => {
    const ofWindow = filtered.filter((r) => Number(r.m) === m);
    const races = sum(ofWindow, "races");
    const inWindow = sum(ofWindow, "in_window");
    const value = rate(inWindow, races);
    // 既知の障害期間と窓が重なる(レース,窓)を除いた値
    const racesClean = sum(ofWindow, "races_clean");
    const inWindowClean = sum(ofWindow, "in_window_clean");
    return {
      minutesBefore: m,
      races,
      inWindow,
      rate: value,
      belowThreshold: value === null || value < WINDOW_THRESHOLD,
      excludedRaces: races - racesClean,
      racesClean,
      inWindowClean,
      rateClean: rate(inWindowClean, racesClean),
    };
  });
}

/** 取得時刻列の有無を、テーブル別に「計測可 / 弱(created_at等のみ) / 計測不能」に分類する */
function classifyTimingColumns(columnRows, existingTables) {
  const existing = new Set(existingTables.map((r) => r.table_name));
  return TIMING_TABLES.map((table) => {
    if (!existing.has(table)) {
      return {
        table,
        exists: false,
        columns: [],
        quality: "table_missing",
        unmeasurable: true,
      };
    }
    const columns = columnRows
      .filter((r) => r.table_name === table)
      .map((r) => r.column_name);
    const strong = columns.filter(
      (c) =>
        STRONG_TIMING_COLUMN.test(c) ||
        (c === "created_at" && FIRST_SAVED_TIMING_TABLES.has(table)),
    );
    const weak = columns.filter((c) => WEAK_TIMING_COLUMN.test(c));
    const quality =
      strong.length > 0 ? "measurable" : weak.length > 0 ? "weak" : "none";
    return {
      table,
      exists: true,
      columns,
      strongColumns: strong,
      quality,
      // 取得時刻列が無い、または行の作成/更新時刻しか無い場合はタイミングを計測できない
      unmeasurable: quality !== "measurable",
    };
  });
}

function summarizeMonthly(rows) {
  return rows.map((r) => {
    const denom = Number(r.denom);
    const total = Number(r.total);
    const withResult = Number(r.with_result);
    return {
      month: r.month,
      days: Number(r.days),
      total,
      excluded: Number(r.excluded),
      denominator: denom,
      withResult,
      rateAll: rate(withResult, total),
      rateExcludingCancelled: rate(withResult, denom),
      noResultRow: Number(r.no_result_row),
      rowWithoutRank1: Number(r.row_without_rank1),
      zeroResultDays: Number(r.zero_result_days),
      partialDays: Number(r.partial_days),
      belowThreshold:
        rate(withResult, denom) === null ||
        rate(withResult, denom) < COVERAGE_THRESHOLD,
    };
  });
}

function summarizeFreshness(rows) {
  return rows.map((r) => ({
    table: r.t,
    count: Number(r.n),
    latestTime: r.latest_time,
    latestDate: r.latest_date,
    empty: Number(r.n) === 0,
  }));
}

const toNumberOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);
const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);

/**
 * 取得時刻の分布のクエリ結果を、レポート用の値にする（純粋関数）。
 * 分母は created_at が非NULLのレース（マイグレーション071より前の行はNULLで含まれない）
 */
export function summarizeScrapedTimestamp(spec, row) {
  const denominator = Number(row.races_with_created_at);
  const distribution = (key) => ({
    p10: round1(toNumberOrNull(row[`${key}_p10`])),
    p50: round1(toNumberOrNull(row[`${key}_p50`])),
    p90: round1(toNumberOrNull(row[`${key}_p90`])),
  });
  return {
    table: spec.table,
    applied: true,
    racesInPeriod: Number(row.races_in_period),
    racesWithRows: Number(row.races_with_rows),
    racesWithCreatedAt: denominator,
    savedAfterStart: Number(row.saved_after_start),
    // 発走の何分前に保存されたか（分。正=発走前、負=発走後）
    leadMinutes: distribution("lead_min"),
    // 発走m分前までに（窓の中心より前に）保存されていたレースの割合（累積）
    savedBy: spec.minutes.map((m) => ({
      minutesBefore: m,
      hit: Number(row[`hit_${m}`]),
      denominator,
      rate: rate(Number(row[`hit_${m}`]), denominator),
    })),
    valueFilled: spec.hasValueFilled
      ? {
          races: Number(row.races_with_value_filled),
          leadMinutes: distribution("filled_lead_min"),
        }
      : null,
  };
}

/**
 * 取得時刻（created_at・updated_at）の分布を集める。列が無い（マイグレーション071が未適用の）
 * テーブルは、クエリを発行せず「未適用のため計測不能」とする。
 * 計測に失敗しても、レポート全体は失敗させない（エラーを結果に残す）。
 *
 * @param {{timingColumns: Array<{table_name: string, column_name: string}>,
 *   windowStart: string, endDate: string,
 *   fetch: (queries: Record<string, string>) => Promise<Record<string, Object[]>>}} args
 */
export async function collectScrapedTimestamps({
  timingColumns,
  windowStart,
  endDate,
  fetch,
}) {
  const hasColumns = (table) =>
    ["created_at", "updated_at"].every((column) =>
      timingColumns.some(
        (r) => r.table_name === table && r.column_name === column,
      ),
    );
  const specs = SCRAPED_TIMESTAMP_TABLES.map((spec) => ({
    spec,
    applied: hasColumns(spec.table),
  }));
  const appliedSpecs = specs.filter((s) => s.applied).map((s) => s.spec);
  const unmeasured = (spec) => ({
    table: spec.table,
    applied: false,
    reason:
      "created_at・updated_at 列が無いため計測不能（マイグレーション071が未適用）",
  });
  if (appliedSpecs.length === 0) {
    return {
      period: { start: windowStart, end: endDate },
      error: null,
      tables: specs.map((s) => unmeasured(s.spec)),
    };
  }
  try {
    const queries = Object.fromEntries(
      appliedSpecs.map((spec) => [
        `scraped_${spec.table}`,
        buildScrapedTimestampQuery(spec, { windowStart, endDate }),
      ]),
    );
    const raw = await fetch(queries);
    return {
      period: { start: windowStart, end: endDate },
      error: null,
      tables: specs.map(({ spec, applied }) =>
        applied
          ? summarizeScrapedTimestamp(spec, raw[`scraped_${spec.table}`][0])
          : unmeasured(spec),
      ),
    };
  } catch (error) {
    return {
      period: { start: windowStart, end: endDate },
      error: `取得時刻の計測に失敗（他の指標は影響なし）: ${error.message}`,
      tables: specs.map((s) => unmeasured(s.spec)),
    };
  }
}

// ---------------------------------------------------------------------------
// GitHub Actions（gh CLI、任意）
// ---------------------------------------------------------------------------

function ghJson(args) {
  const out = execFileSync("gh", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

// ワークフローのcron式から、最終successの許容経過時間を推定する。
// 日(day-of-month)指定=月次相当(35日)、曜日指定=週次相当(8日)、分が「スラッシュN」形式で
// 1日に複数回実行=12時間、それ以外=日次相当(48時間)。複数のcronがある場合は最も厳しい値を採る。
// cronが無い（手動実行のみ）場合はnull（経過時間では判定しない）
function expectedMaxSuccessHours(workflowFile) {
  const yaml = fs.readFileSync(
    path.join(REPO_ROOT, ".github/workflows", workflowFile),
    "utf8",
  );
  const crons = [...yaml.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1].trim().split(/\s+/),
  );
  if (crons.length === 0) return null;
  const limitOf = ([minute, , dayOfMonth, , dayOfWeek]) => {
    if (dayOfMonth !== "*") return 24 * 35;
    if (dayOfWeek !== "*") return 24 * 8;
    return minute.startsWith("*/") ? 12 : 48;
  };
  return Math.min(...crons.map(limitOf));
}

const RECENT_RUNS_LIMIT = 30;

function collectWorkflowStatus(file, now) {
  try {
    const listArgs = (limit, extra = []) => [
      "run",
      "list",
      "--workflow",
      file,
      "--limit",
      String(limit),
      "--json",
      "createdAt,conclusion,status,url",
      ...extra,
    ];
    const recent = ghJson(listArgs(RECENT_RUNS_LIMIT));
    const last = recent[0];
    // `--status success` 単独では、実行頻度の高いワークフローで古い結果が返ることを実測で確認した
    // （同一ワークフローで呼び出しごとに最終successが数日単位でずれた）。
    // 直近N件の中のsuccessと突き合わせ、新しい方を採る
    const [filteredSuccess] = ghJson(listArgs(1, ["--status", "success"]));
    const recentSuccess = recent.find((r) => r.conclusion === "success");
    const lastSuccess = [filteredSuccess, recentSuccess]
      .filter(Boolean)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    const hoursSince = (iso) =>
      iso
        ? Math.round(((now - new Date(iso).getTime()) / 3600000) * 10) / 10
        : null;
    return {
      workflow: file,
      noRunHistory: last === undefined,
      lastRunAt: last?.createdAt ?? null,
      lastRunConclusion: last?.conclusion || last?.status || null,
      lastSuccessAt: lastSuccess?.createdAt ?? null,
      hoursSinceLastSuccess: hoursSince(lastSuccess?.createdAt),
      expectedMaxSuccessHours: expectedMaxSuccessHours(file),
    };
  } catch (error) {
    // 1ワークフローの取得失敗で、他のワークフローの結果まで捨てない
    return {
      workflow: file,
      error: String(error.message).split("\n")[0],
    };
  }
}

function collectWorkflowFreshness(now) {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
  } catch (error) {
    return {
      skipped: true,
      reason: `gh CLIが使えないためスキップ: ${String(error.message).split("\n")[0]}`,
      items: [],
    };
  }
  const items = fs
    .readdirSync(path.join(REPO_ROOT, ".github/workflows"))
    .filter((f) => /^scrape-.*\.ya?ml$/.test(f))
    .sort()
    .map((file) => collectWorkflowStatus(file, now));
  return { skipped: false, items };
}

// ---------------------------------------------------------------------------
// 閾値アラート・Markdown
// ---------------------------------------------------------------------------

function collectAlerts(report) {
  const alerts = [];
  for (const m of report.coverage.aggregate) {
    if (m.belowThreshold) {
      alerts.push({
        kind: "coverage",
        item: `存在充足率 ${m.label}`,
        value: m.rate,
        threshold: COVERAGE_THRESHOLD,
        detail: `${m.numerator}/${m.denominator}、閾値未満の日 ${m.daysBelowThreshold}日`,
      });
    }
  }
  for (const w of report.windows.aggregate) {
    if (w.belowThreshold) {
      alerts.push({
        kind: "window",
        item: `窓内取得率 ${w.minutesBefore}分前`,
        value: w.rate,
        threshold: WINDOW_THRESHOLD,
        detail: `${w.inWindow}/${w.races}`,
      });
    }
  }
  for (const m of report.monthlyResults) {
    if (m.belowThreshold) {
      alerts.push({
        kind: "monthly_result",
        item: `月別結果充足率 ${m.month}`,
        value: m.rateExcludingCancelled,
        threshold: COVERAGE_THRESHOLD,
        detail: `${m.withResult}/${m.denominator}（中止除外${m.excluded}件）`,
      });
    }
  }
  for (const f of report.freshness) {
    if (f.empty) {
      alerts.push({
        kind: "empty_table",
        item: `空: ${f.table}`,
        value: 0,
        threshold: null,
        detail: "0件",
      });
    }
  }
  for (const w of report.workflows.items) {
    const alert = (kind, item, detail) =>
      alerts.push({ kind, item, value: null, threshold: null, detail });
    if (w.error) {
      alert("workflow_check_failed", `取得失敗: ${w.workflow}`, w.error);
    } else if (w.noRunHistory) {
      alert("workflow_never_ran", `実行履歴0件: ${w.workflow}`, "");
    } else {
      if (
        ["failure", "cancelled", "timed_out", "startup_failure"].includes(
          w.lastRunConclusion,
        )
      ) {
        alert(
          "workflow_last_run_failed",
          `最終実行が失敗: ${w.workflow}`,
          `${w.lastRunConclusion}（${w.lastRunAt}）`,
        );
      }
      if (w.lastSuccessAt === null) {
        alert(
          "workflow_never_succeeded",
          `successの履歴なし: ${w.workflow}`,
          "",
        );
      } else if (
        w.expectedMaxSuccessHours !== null &&
        w.hoursSinceLastSuccess > w.expectedMaxSuccessHours
      ) {
        alert(
          "workflow_stale",
          `最終successが古い: ${w.workflow}`,
          `${w.hoursSinceLastSuccess}時間前（許容${w.expectedMaxSuccessHours}時間、cron式からの推定）`,
        );
      }
    }
  }
  const noDataDays = [
    ...report.coverage.missingDates.map((d) => `存在充足率: ${d}`),
    ...report.windows.missingDates.map((d) => `窓内取得率: ${d}`),
  ];
  if (noDataDays.length > 0) {
    alerts.push({
      kind: "no_data_days",
      item: "対象レースが0件の日",
      value: null,
      threshold: null,
      detail: noDataDays.join(", "),
    });
  }
  for (const t of report.timingColumns) {
    if (t.unmeasurable) {
      alerts.push({
        kind: "timing_unmeasurable",
        item: `タイミング計測不能: ${t.table}`,
        value: null,
        threshold: null,
        detail:
          t.quality === "table_missing"
            ? "テーブル不在"
            : t.quality === "weak"
              ? `取得時刻列なし（${t.columns.join("/")}のみ）`
              : "時刻列なし",
      });
    }
  }
  return alerts;
}

const tableRow = (cells) => `| ${cells.join(" | ")} |`;
const tableHeader = (cells) =>
  `${tableRow(cells)}\n${tableRow(cells.map(() => "---"))}`;

const formatBytes = (bytes) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

function renderMarkdown(report) {
  const { params } = report;
  const lines = [];
  lines.push(`# データ健全性レポート ${params.reportDate}`);
  lines.push("");
  lines.push(
    `- 存在充足率の期間: ${params.coverage.start}〜${params.coverage.end}（${COVERAGE_DAYS}日。当日は結果未確定のため含めない）`,
  );
  lines.push(
    `- 窓内取得率の期間: ${params.windows.start}〜${params.windows.end}（${WINDOW_DAYS}日、土日${params.windows.weekendDays}日を含む）`,
  );
  if (params.windows.weekendDays === 0) {
    lines.push(
      "- 警告: 窓内取得率の期間に土日が含まれていない。完了の定義Bの根拠にならない",
    );
  }
  lines.push(
    `- 分母: 開催中止(cancellation_status='confirmed')を除外。閾値: 存在充足率${COVERAGE_THRESHOLD * 100}%、窓内取得率${WINDOW_THRESHOLD * 100}%`,
  );
  lines.push("");

  lines.push("## 閾値未達・要注意項目");
  lines.push("");
  if (report.alerts.length === 0) {
    lines.push("なし");
  } else {
    lines.push(tableHeader(["区分", "項目", "値", "閾値", "詳細"]));
    for (const a of report.alerts) {
      lines.push(
        tableRow([
          a.kind,
          a.item,
          a.value === null ? "-" : formatPct(a.value),
          a.threshold === null ? "-" : formatPct(a.threshold),
          a.detail,
        ]),
      );
    }
  }
  lines.push("");

  lines.push(`## 1. 存在充足率（直近${COVERAGE_DAYS}日の合計）`);
  lines.push("");
  const agg = report.coverage.aggregate;
  lines.push(
    `分母（中止除外後）${agg[0].denominator}レース、除外（開催中止）${agg[0].excluded}レース`,
  );
  lines.push("");
  lines.push(
    tableHeader([
      "指標",
      "充足",
      "分母",
      "充足率",
      "閾値未満の日数",
      "最低の日",
    ]),
  );
  for (const m of agg) {
    lines.push(
      tableRow([
        m.label,
        m.numerator,
        m.denominator,
        `${formatPct(m.rate)}${m.belowThreshold ? " (未達)" : ""}`,
        m.daysBelowThreshold,
        m.worstDay ? `${m.worstDay.date} ${formatPct(m.worstDay.rate)}` : "-",
      ]),
    );
  }
  lines.push("");
  lines.push("### 日別の存在充足率");
  lines.push("");
  const dayMetrics = [
    "result",
    "rank4_6",
    "actual_course",
    "winning_technique",
    "race_stage",
    "st_row",
    "st_value",
    "exhibition_row",
    "exhibition_time",
    "odds",
    "odds_all",
  ];
  lines.push(
    tableHeader([
      "日付",
      "総数",
      "除外",
      "分母",
      ...dayMetrics.map((k) => COVERAGE_METRICS.find((m) => m.key === k).label),
    ]),
  );
  for (const d of report.coverage.perDay) {
    lines.push(
      tableRow([
        `${d.d}(${weekdayOf(d.d)})`,
        d.total,
        d.excluded,
        d.denom,
        ...dayMetrics.map((k) =>
          formatPct(rate(Number(d[k]), Number(d.denom))),
        ),
      ]),
    );
  }
  lines.push("");

  lines.push(
    `## 2. 窓内取得率（締切=発走時刻、窓の中心±3分、直近${WINDOW_DAYS}日）`,
  );
  lines.push("");
  lines.push(
    "障害期間の除外: " +
      (KNOWN_INCIDENTS.length === 0
        ? "なし"
        : KNOWN_INCIDENTS.map(
            (i) =>
              `${i.label} ${i.start}〜${i.end}（窓が重なる(レース,窓)を除外）`,
          ).join(" / ")),
  );
  lines.push("");
  lines.push(
    tableHeader([
      "窓",
      "全体(除外なし)",
      "全体(障害期間を除外)",
      "除外件数",
      "平日(除外なし)",
      "土日(除外なし)",
    ]),
  );
  for (const w of report.windows.aggregate) {
    const wd = report.windows.weekday.find(
      (x) => x.minutesBefore === w.minutesBefore,
    );
    const we = report.windows.weekend.find(
      (x) => x.minutesBefore === w.minutesBefore,
    );
    const cell = (x) => `${formatPct(x.rate)} (${x.inWindow}/${x.races})`;
    lines.push(
      tableRow([
        `${w.minutesBefore}分前`,
        `${cell(w)}${w.belowThreshold ? " (未達)" : ""}`,
        `${formatPct(w.rateClean)} (${w.inWindowClean}/${w.racesClean})`,
        w.excludedRaces,
        cell(wd),
        cell(we),
      ]),
    );
  }
  lines.push("");
  lines.push("### 日別の窓内取得率");
  lines.push("");
  lines.push(
    tableHeader([
      "日付",
      ...WINDOW_MINUTES.map((m) => `${m}分前`),
      "対象レース",
    ]),
  );
  for (const date of [...new Set(report.windows.perDay.map((r) => r.d))]) {
    const ofDay = report.windows.perDay.filter((r) => r.d === date);
    const cells = WINDOW_MINUTES.map((m) => {
      const row = ofDay.find((r) => Number(r.m) === m);
      return formatPct(
        row ? rate(Number(row.in_window), Number(row.races)) : null,
      );
    });
    lines.push(
      tableRow([`${date}(${weekdayOf(date)})`, ...cells, ofDay[0].races]),
    );
  }
  const excludedDays = [
    ...new Set(
      report.windows.perDay
        .filter((r) => Number(r.races) !== Number(r.races_clean))
        .map((r) => r.d),
    ),
  ];
  if (excludedDays.length > 0) {
    lines.push("");
    lines.push(
      "### 日別の窓内取得率（障害期間を除外した値。除外があった日のみ）",
    );
    lines.push("");
    lines.push(
      tableHeader([
        "日付",
        ...WINDOW_MINUTES.map((m) => `${m}分前`),
        "除外件数(窓別)",
      ]),
    );
    for (const date of excludedDays) {
      const ofDay = report.windows.perDay.filter((r) => r.d === date);
      const rowOf = (m) => ofDay.find((r) => Number(r.m) === m);
      lines.push(
        tableRow([
          `${date}(${weekdayOf(date)})`,
          ...WINDOW_MINUTES.map((m) =>
            formatPct(
              rate(
                Number(rowOf(m).in_window_clean),
                Number(rowOf(m).races_clean),
              ),
            ),
          ),
          WINDOW_MINUTES.map(
            (m) => Number(rowOf(m).races) - Number(rowOf(m).races_clean),
          ).join("/"),
        ]),
      );
    }
  }
  if (report.windows.compare) {
    lines.push("");
    lines.push(
      `参考（${report.windows.compare.dates.join("・")}のみで再集計）`,
    );
    lines.push("");
    lines.push(tableHeader(["窓", "取得率", "件数"]));
    for (const w of report.windows.compare.aggregate) {
      lines.push(
        tableRow([
          `${w.minutesBefore}分前`,
          formatPct(w.rate),
          `${w.inWindow}/${w.races}`,
        ]),
      );
    }
  }
  lines.push("");

  lines.push("## 3. 取得時刻列の有無");
  lines.push("");
  lines.push(tableHeader(["テーブル", "時刻系の列", "タイミング計測"]));
  for (const t of report.timingColumns) {
    const label =
      t.quality === "measurable"
        ? `可（${t.strongColumns
            .map((c) =>
              OVERWRITTEN_ON_UPSERT.has(c)
                ? `${c}=最終書き込み時刻`
                : c === "created_at"
                  ? "created_at=初回保存時刻。追加前の行はNULL"
                  : c,
            )
            .join("/")}）`
        : t.quality === "weak"
          ? "不能（作成/更新時刻のみ。取得時刻ではない）"
          : t.quality === "none"
            ? "不能（時刻列なし）"
            : "テーブル不在";
    lines.push(tableRow([t.table, t.columns.join(", ") || "-", label]));
  }
  lines.push("");

  lines.push(
    `### 3-2. 取得時刻（created_at）の分布（${report.scrapedTimestamps.period.start}〜${report.scrapedTimestamps.period.end}、created_at が非NULLのレースのみ）`,
  );
  lines.push("");
  if (report.scrapedTimestamps.error) {
    lines.push(`**${report.scrapedTimestamps.error}**`);
    lines.push("");
  }
  const scrapedTables = report.scrapedTimestamps.tables;
  if (scrapedTables.every((t) => !t.applied)) {
    lines.push(
      "未適用のため計測不能: created_at・updated_at 列が無い（マイグレーション071が未適用）。適用後、新規に保存された行から計測できる（既存の行はNULLで、分母に含めない）。",
    );
  } else {
    lines.push(
      "「発走の何分前に保存されたか」は、レースごとに最も早い created_at で測る（正=発走前、負=発走後）。" +
        "分母は created_at が非NULLのレース数（マイグレーション071より前の行はNULLで含めない）。累積割合は「発走m分前までに保存されていたレース」の割合。",
    );
    lines.push("");
    lines.push(
      tableHeader([
        "テーブル",
        "期間内のレース",
        "行あり",
        "created_at非NULL(分母)",
        "発走の何分前に保存 p10/p50/p90",
        "発走後に保存",
        "発走m分前までに保存(累積)",
      ]),
    );
    const fmtDist = (d) =>
      d.p50 === null ? "-" : `${d.p10} / ${d.p50} / ${d.p90}`;
    for (const t of scrapedTables) {
      if (!t.applied) {
        lines.push(
          tableRow([t.table, "-", "-", "-", "未適用のため計測不能", "-", "-"]),
        );
        continue;
      }
      lines.push(
        tableRow([
          t.table,
          t.racesInPeriod,
          t.racesWithRows,
          t.racesWithCreatedAt,
          fmtDist(t.leadMinutes),
          t.savedAfterStart,
          t.savedBy.length === 0
            ? "-"
            : t.savedBy
                .map(
                  (w) =>
                    `${w.minutesBefore}分前: ${formatPct(w.rate)} (${w.hit}/${w.denominator})`,
                )
                .join(" / "),
        ]),
      );
    }
    for (const t of scrapedTables.filter((x) => x.applied && x.valueFilled)) {
      lines.push("");
      lines.push(
        `${t.table} の値が揃った時刻（展示タイムが入っている行の updated_at の最大値。値が変わった最後の時刻）: 対象${t.valueFilled.races}レース、発走の何分前 p10/p50/p90 = ${fmtDist(t.valueFilled.leadMinutes)}`,
      );
    }
  }
  lines.push("");

  lines.push("## 4. 月別の結果充足率（races全期間）");
  lines.push("");
  lines.push(
    tableHeader([
      "月",
      "日数",
      "総数",
      "中止除外",
      "分母",
      "結果あり",
      "充足率(全体)",
      "充足率(中止除外)",
      "resultsに行なし",
      "行あり・rank1なし",
      "全滅日",
      "一部欠落日",
    ]),
  );
  for (const m of report.monthlyResults) {
    lines.push(
      tableRow([
        m.month,
        m.days,
        m.total,
        m.excluded,
        m.denominator,
        m.withResult,
        formatPct(m.rateAll),
        `${formatPct(m.rateExcludingCancelled)}${m.belowThreshold ? " (未達)" : ""}`,
        m.noResultRow,
        m.rowWithoutRank1,
        m.zeroResultDays,
        m.partialDays,
      ]),
    );
  }
  lines.push("");

  lines.push("## 5. 取得系テーブルの件数と鮮度");
  lines.push("");
  lines.push(tableHeader(["テーブル", "件数", "最新の取得時刻", "最新の日付"]));
  for (const f of report.freshness) {
    lines.push(
      tableRow([
        f.empty ? `**【空】${f.table}**` : f.table,
        f.count,
        f.latestTime ?? "-",
        f.latestDate ?? "-",
      ]),
    );
  }
  lines.push("");
  lines.push(tableHeader(["主要テーブルの最新位置", "値"]));
  for (const l of report.latest) lines.push(tableRow([l.key, l.value ?? "-"]));
  lines.push("");

  lines.push("## 6. 取得ジョブの鮮度（scrape-*ワークフロー）");
  lines.push("");
  if (report.workflows.skipped) {
    lines.push(`スキップ: ${report.workflows.reason}`);
  } else {
    lines.push(
      tableHeader([
        "ワークフロー",
        "最終実行",
        "最終実行の結果",
        "最終success",
        "successからの経過(時間)",
        "許容(時間)",
      ]),
    );
    for (const w of report.workflows.items) {
      if (w.error) {
        lines.push(
          tableRow([
            `**【取得失敗】${w.workflow}**`,
            w.error,
            "-",
            "-",
            "-",
            "-",
          ]),
        );
        continue;
      }
      lines.push(
        tableRow([
          w.noRunHistory ? `**【実行履歴0件】${w.workflow}**` : w.workflow,
          w.lastRunAt ?? "-",
          w.lastRunConclusion ?? "-",
          w.lastSuccessAt ?? "なし",
          w.hoursSinceLastSuccess ?? "-",
          w.expectedMaxSuccessHours ?? "-",
        ]),
      );
    }
  }
  lines.push("");

  lines.push("## 7. DBサイズ");
  lines.push("");
  lines.push(`データベース全体: ${formatBytes(report.dbSize.databaseBytes)}`);
  lines.push("");
  lines.push(tableHeader(["テーブル（総サイズ上位10）", "サイズ"]));
  for (const t of report.dbSize.topTables)
    lines.push(tableRow([t.table, formatBytes(t.bytes)]));
  lines.push("");
  lines.push("## 注記（解釈上の注意）");
  lines.push("");
  for (const note of [
    "rank4〜6は欠場・失格・落水等で6着まで揃わない正常なレースも含むため、100%にならない場合がある（分母は中止除外後の全レース）。",
    "開催中止の除外は races.cancellation_status='confirmed' のみ。中止検知の導入前の期間は除外できず、月別の未充足に中止レースが含まれうる。",
    "全券種オッズ・窓内取得率は、取得方式の変更（ADR-0057の窓構成・全券種の保存）の前後で値が大きく変わりうる。日別表で変化点を確認する。",
    "race_results.result_at は scrape-results の実行（upsert）ごとに更新される最終書き込み時刻。predictions.predicted_at も買い目オッズ更新で更新される。",
    "窓は隣り合うものが重なる（例: 10分前=7〜13分前、5分前=2〜8分前）ため、1回の取得が複数の窓を満たしうる。窓別の取得率は過大評価側に出る。",
    "取りこぼしの一因はGitHub Actionsのキャンセル起因（BOA-342/344の実測では、取りこぼしの81〜94%が、キャンセルされた実行が前後5分以内にあった）。この指標自体は原因を区別しない。",
    "展示・STは「行の有無」と「値の有無」を分けて出す。展示タイムより先にSTだけの行が書かれる会場があり、行の有無だけでは欠落を過小評価する（BOA-356）。展示の判定基準は check-exhibition-gap-rate.js に合わせ、1艇でも展示タイムが入っていれば取得済みとする。",
    "窓内取得率の分母は結果確定済み（rank1あり）・中止除外のレース。土日を含まない期間は完了の定義Bの根拠にならない。",
    "取得時刻の分布（3-2）は exhibition_data・race_entries・race_start_timings の created_at（行が最初に保存された時刻、マイグレーション071）を使う。追加前の行はNULLで分母に含まれないため、適用直後は対象レースが少ない（適用から数日で、土日を含む7日分が溜まるまで完了の定義Bの根拠にならない）。過去日のバックフィル（手動スクリプト）で作られた行は、バックフィル時刻が created_at になり「発走後に保存」に数えられる。",
  ]) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const coverageStart = addDaysToDateString(opts.endDate, -(COVERAGE_DAYS - 1));
  const windowStart = addDaysToDateString(opts.endDate, -(WINDOW_DAYS - 1));
  const windowDates = datesFrom(windowStart, WINDOW_DAYS);
  // 窓内取得率の対象期間外の日付を黙って無視しない（比較したつもりで比較されない事故を防ぐ）
  const outOfWindow = opts.compareDates.filter((d) => !windowDates.includes(d));
  if (outOfWindow.length > 0) {
    throw new Error(
      `--compare-dates は窓内取得率の期間(${windowStart}〜${opts.endDate})内で指定してください: ${outOfWindow.join(", ")}`,
    );
  }
  // 日付の決定は1回だけ行う（JST日付をまたぐ実行でrunDateがずれるのを防ぐ）
  const runDate = getTodayDateJST();

  const queries = buildQueries({
    coverageStart,
    windowStart,
    endDate: opts.endDate,
  });
  const raw = await fetchRaw(queries, opts.cacheFile);

  // 取得時刻（created_at）の分布。列が無い（マイグレーション071が未適用の）テーブルはクエリを発行しない
  const scrapedTimestamps = await collectScrapedTimestamps({
    timingColumns: raw.timingColumns,
    windowStart,
    endDate: opts.endDate,
    fetch: (queries) => fetchRaw(queries, opts.cacheFile),
  });

  const coverageDates = datesFrom(coverageStart, COVERAGE_DAYS);
  const compareRows = raw.windows.filter((r) =>
    opts.compareDates.includes(r.d),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    params: {
      reportDate: runDate,
      thresholds: { coverage: COVERAGE_THRESHOLD, window: WINDOW_THRESHOLD },
      coverage: {
        start: coverageStart,
        end: opts.endDate,
        days: COVERAGE_DAYS,
      },
      windows: {
        start: windowStart,
        end: opts.endDate,
        days: WINDOW_DAYS,
        weekendDays: windowDates.filter(isWeekend).length,
        minutesBefore: WINDOW_MINUTES,
      },
      denominatorRule: "races.cancellation_status='confirmed' を除外",
      knownIncidents: KNOWN_INCIDENTS,
    },
    coverage: {
      perDay: raw.coverage,
      aggregate: summarizeCoverage(raw.coverage),
      missingDates: coverageDates.filter(
        (d) => !raw.coverage.some((r) => r.d === d),
      ),
    },
    windows: {
      perDay: raw.windows,
      missingDates: windowDates.filter(
        (d) => !raw.windows.some((r) => r.d === d),
      ),
      aggregate: summarizeWindows(raw.windows),
      weekday: summarizeWindows(raw.windows, { weekendFilter: false }),
      weekend: summarizeWindows(raw.windows, { weekendFilter: true }),
      compare:
        compareRows.length > 0
          ? {
              dates: opts.compareDates,
              aggregate: summarizeWindows(raw.windows, {
                onlyDates: opts.compareDates,
              }),
            }
          : null,
    },
    timingColumns: classifyTimingColumns(raw.timingColumns, raw.tableExistence),
    scrapedTimestamps,
    monthlyResults: summarizeMonthly(raw.monthly),
    freshness: summarizeFreshness(raw.freshness),
    latest: raw.latest.map((r) => ({ key: r.k, value: r.v })),
    workflows: opts.skipGh
      ? { skipped: true, reason: "--skip-gh 指定", items: [] }
      : collectWorkflowFreshness(Date.now()),
    dbSize: {
      databaseBytes: Number(raw.dbSize[0].bytes),
      topTables: raw.tableSizes.map((r) => ({
        table: r.table_name,
        bytes: Number(r.bytes),
      })),
    },
  };
  report.alerts = collectAlerts(report);

  fs.mkdirSync(opts.outDir, { recursive: true });
  // 既定の集計期間（昨日まで）以外、またはGitHub Actions確認を省略した実行は、
  // 当日のベースラインJSONを上書きしない（内容が欠けた/別期間のJSONで置き換わるのを防ぐ）
  const fileSuffix = [
    opts.endDate === opts.defaultEndDate ? "" : `_end-${opts.endDate}`,
    opts.skipGh ? "_skip-gh" : "",
  ].join("");
  const jsonPath = path.join(opts.outDir, `${runDate}${fileSuffix}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(renderMarkdown(report));
  console.error(`JSONを保存: ${path.relative(REPO_ROOT, jsonPath)}`);
}

// importされた場合（クエリ検証等）は実行しない。DBへの意図しない実行を防ぐ
if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error("data-health-report 実行中にエラー:", error.message);
    process.exit(1);
  });
}
