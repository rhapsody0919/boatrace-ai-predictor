#!/usr/bin/env node
/**
 * anon（匿名）ロールのアクセス権の確認（読み取りのみ。書き込み試験は一切しない）。
 * マイグレーション076（RLS有効化・権限剥奪、BOA-370）の適用前後、および定期確認に使う。
 *
 * 確認内容:
 *   1. RLS無効のテーブル数、anon/authenticatedの非SELECT権限の数（要 SUPABASE_ACCESS_TOKEN。Management API経由の読み取りSQL）
 *   2. 画面が使うテーブル・RPCを、anonキーで読めること（要 VITE_SUPABASE_ANON_KEY）
 *   3. 読ませない設計のテーブルが、anonから見えないこと（適用後のみ判定）
 *   4. anonがEXECUTEできる関数が画面の呼ぶRPCだけであること、シーケンス権限が無いこと
 *      （要 SUPABASE_ACCESS_TOKEN。マイグレーション113、BOA-575。適用後のみ判定）
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/check-anon-access.js
 *   node --env-file=.env.local scripts/maintenance/check-anon-access.js --expect-applied   # 076・113適用後: 不可視テーブル・権限の残りも失敗にする
 *
 * 終了コード: 0=すべてOK、2=失敗あり
 */

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const expectApplied = process.argv.includes("--expect-applied");

if (!url || !anonKey) {
  console.error(
    "SUPABASE_URL（または VITE_SUPABASE_URL）と VITE_SUPABASE_ANON_KEY が必要です",
  );
  process.exit(1);
}

const projectRef = new URL(url).hostname.split(".")[0];
let failed = false;
const report = (ok, ...args) => {
  if (!ok) failed = true;
  console.log(ok ? "OK  " : "FAIL", ...args);
};

async function managementQuery(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Management API ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  return response.json();
}

async function anonSelect(table) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status,
    rows: Array.isArray(body) ? body.length : null,
  };
}

async function anonRpc(name, args) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, length: text.length };
}

// 画面・分析ツールが直接読むテーブル（076の監査結果。docs/db-migration/076_enable_rls_on_public_tables.sql）
const MUST_READ = [
  "races",
  "race_entries",
  "race_results",
  "venues",
  "racer_profiles",
  "predictions",
  "exhibition_data",
  "race_conditions",
  "race_start_timings",
  "race_odds",
  "racer_aggregated_stats",
  "racer_series_points",
  "venue_motor_stats",
  "model_performance_daily",
];
// 画面・api/ が匿名キーで呼ぶRPC（マイグレーション113の監査結果。これ以外は anon から EXECUTE できない設計）
const ANON_RPCS = [
  "get_predictions_by_date",
  "get_predictions_by_date_light",
  "get_race_exhibition_trend",
  "get_race_return_rate",
  "get_race_st_predictability",
  "get_race_technique_profile",
  "get_today_races",
  // 類似レース（BOA-271 FR-2、マイグレーション120）。画面の RPC と、その中で呼ぶ読み取りだけの関数
  // （SECURITY INVOKER なので呼び出し側にも EXECUTE が要る）
  "get_analogy_similar",
  "get_analogy_similar_races",
  "analogy_resolve_race",
  "analogy_gap_band",
  "analogy_race_conditions",
  "analogy_layer_counts",
  "analogy_auto_depth",
  "analogy_layer_distribution",
  // 任意の条件（Q6「ほかのテーマでも絞る」）
  "analogy_round_from_stage",
  "analogy_grade_of",
  "analogy_motor_band",
  "analogy_race_extras",
  "analogy_optional_counts",
];
// 読ませない設計のテーブル（RLS有効・ポリシー無し・権限なし）
const MUST_BE_HIDDEN = [
  "venue_rules",
  "rule_applications",
  "bet_filters",
  "daily_bet_summary",
  "model_experiments",
  "race_notices_health",
  "race_special_notes",
  "venue_entry_course_stats",
  "scrape_slots",
  "scrape_job_state",
  "sns_drafts",
];

if (accessToken) {
  const rlsOff = await managementQuery(
    `select count(*)::int as n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`,
  );
  const grants = await managementQuery(
    `select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type <> 'SELECT'`,
  );
  console.log(
    `RLS無効のテーブル数=${rlsOff[0].n}、anon/authenticatedの非SELECT権限=${grants[0].n}`,
  );
  const anonFuncs = (
    await managementQuery(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`,
    )
  ).map((r) => r.proname);
  const unexpectedFuncs = anonFuncs.filter((f) => !ANON_RPCS.includes(f));
  // relkind の絞り込みより先に has_sequence_privilege が評価されるとシーケンス以外で失敗するため CASE で守る
  const seqGrants = await managementQuery(
    `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S' and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') or has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE') else false end`,
  );
  console.log(
    `anonがEXECUTEできる関数=${anonFuncs.length}本（想定外: ${unexpectedFuncs.join(",") || "なし"}）、anon/authenticatedのシーケンス権限=${seqGrants[0].n}`,
  );
  if (expectApplied) {
    report(rlsOff[0].n === 0, "RLS無効のテーブルが0件");
    report(grants[0].n === 0, "anon/authenticatedの書き込み系権限が0件");
    report(
      unexpectedFuncs.length === 0,
      "anonがEXECUTEできる関数は画面が呼ぶRPCだけ",
    );
    report(seqGrants[0].n === 0, "anon/authenticatedのシーケンス権限が0件");
  }
} else {
  console.log("SUPABASE_ACCESS_TOKEN が無いため、RLS・権限の確認はスキップ");
}

for (const table of MUST_READ) {
  const result = await anonSelect(table);
  report(
    result.status === 200 && (result.rows ?? 0) >= 1,
    `anon読み取り ${table} status=${result.status} rows=${result.rows}`,
  );
}

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
for (const [name, args] of [
  ["get_today_races", {}],
  ["get_predictions_by_date_light", { target_date: today }],
]) {
  const result = await anonRpc(name, args);
  // 当日のレースが未初期化の朝の時間帯は、'[]'（長さ2）でも正常
  report(
    result.status === 200,
    `anon RPC ${name} status=${result.status} length=${result.length}`,
  );
}

for (const table of MUST_BE_HIDDEN) {
  const result = await anonSelect(table);
  const hidden = result.status !== 200 || (result.rows ?? 0) === 0;
  if (expectApplied) {
    report(
      hidden,
      `anon不可視 ${table} status=${result.status} rows=${result.rows}`,
    );
  } else {
    console.log(
      `INFO ${hidden ? "不可視" : "可視"} ${table} status=${result.status} rows=${result.rows}`,
    );
  }
}

console.log(failed ? "RESULT: FAIL" : "RESULT: ALL OK");
process.exit(failed ? 2 : 0);
