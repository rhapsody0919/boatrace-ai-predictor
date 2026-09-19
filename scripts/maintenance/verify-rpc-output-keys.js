/**
 * verify-rpc-output-keys.js - 本番RPC（get_predictions_by_date / _light / get_today_races）の
 * 出力に、フロントが参照するキーが含まれているかを検証する（BOA-363の再発防止）。
 *
 * 背景: RPCは `CREATE OR REPLACE FUNCTION` で関数全体を再定義するため、古い定義を土台に
 * 新しいマイグレーションを書くと、それ以前に足したフィールドが無言で消える
 * （048のcancellationStatusが051・062・066で上書きされ、本番で数日間欠落していた）。
 * ビルドやE2Eでは検知できない（フォールバック経路が同じキーを返すため画面は壊れない）ので、
 * RPCの実出力を直接検査する。RPCを変更するマイグレーションを本番へ適用した後に実行する。
 *
 * 使い方:
 *   npm run verify:rpc-output-keys                      # 直近の中止レースがある日で検証
 *   npm run verify:rpc-output-keys -- --date 2026-09-12 # 日付を指定
 *
 * 読み取り専用（RPC 3回と、日付決定用の races 1回の SELECT のみ）。接続は
 * scripts/lib/supabaseClient.js（SUPABASE_URL / SUPABASE_SERVICE_KEY）を使う。
 * 期待するキーは、フロント（src/services/supabaseDataService.js の transformEdgeResponse /
 * getRaces）の参照と、各マイグレーション（048・062・066）が足したフィールドに合わせている。
 * キーの値が null でも「キーが存在する」ことだけを検査する（json_build_object は
 * null値のキーも出力する）。
 */
import { supabase } from "../lib/supabaseClient.js";

// get_predictions_by_date / _light のレース要素が持つべきキー
const PREDICTION_RACE_KEYS = [
  "raceId",
  "venueCode",
  "raceNumber",
  "startTime",
  "raceGrade",
  "raceTitle",
  "seriesDay", // 038
  "isFinalDay", // 038
  "raceStage", // 062
  "weather", // 066
  "cancellationStatus", // 048（BOA-363で回帰）
];

// get_today_races の data[].races[] 要素が持つべきキー（weather は元々含めない仕様）
const TODAY_RACE_KEYS = [
  "raceNo",
  "startTime",
  "raceGrade",
  "raceTitle",
  "seriesDay",
  "isFinalDay",
  "raceStage",
  "cancellationStatus",
];

/**
 * レース配列のうち、期待キーを持たない要素の件数をキーごとに数える。
 * @param {Array<Record<string, unknown>>} races
 * @param {string[]} expectedKeys
 * @returns {Array<{ key: string, missingCount: number }>} 欠落のあったキーのみ
 */
function findMissingKeys(races, expectedKeys) {
  return expectedKeys
    .map((key) => ({
      key,
      missingCount: races.filter(
        (race) => race == null || typeof race !== "object" || !(key in race),
      ).length,
    }))
    .filter(({ missingCount }) => missingCount > 0);
}

function parseDateArg(argv) {
  const i = argv.indexOf("--date");
  if (i === -1) return null;
  const value = argv[i + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new Error(`--date は YYYY-MM-DD 形式で指定してください: ${value}`);
  }
  return value;
}

/** 直近の中止レースがある日。無ければ直近の開催日。 */
async function resolveTargetDate() {
  const latest = async (buildQuery) => {
    const { data, error } = await buildQuery(
      supabase.from("races").select("race_date"),
    )
      .order("race_date", { ascending: false })
      .limit(1);
    if (error) throw new Error(`races の日付取得に失敗: ${error.message}`);
    return data?.[0]?.race_date ?? null;
  };
  const withCancellation = await latest((q) =>
    q.not("cancellation_status", "is", null),
  );
  if (withCancellation)
    return { date: withCancellation, hasCancellation: true };
  const anyDate = await latest((q) => q);
  if (!anyDate) throw new Error("races にレースが1件もありません");
  return { date: anyDate, hasCancellation: false };
}

async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`RPC ${name} の呼び出しに失敗: ${error.message}`);
  return data;
}

function report(label, races, expectedKeys) {
  if (races.length === 0) {
    console.log(`  [SKIP] ${label}: レースが0件のため検証できません`);
    return { failed: false, skipped: true };
  }
  const missing = findMissingKeys(races, expectedKeys);
  if (missing.length === 0) {
    console.log(
      `  [OK]   ${label}: ${races.length}レース全てが期待キー${expectedKeys.length}個を含む`,
    );
    return { failed: false, skipped: false };
  }
  console.log(`  [FAIL] ${label}: ${races.length}レース中、キーが欠落`);
  for (const { key, missingCount } of missing) {
    console.log(`           - ${key}: ${missingCount}レースで欠落`);
  }
  return { failed: true, skipped: false };
}

async function main() {
  if (!supabase) {
    throw new Error(
      "Supabaseの接続情報がありません（.env.local の SUPABASE_URL / SUPABASE_SERVICE_KEY を確認）",
    );
  }
  const explicitDate = parseDateArg(process.argv.slice(2));
  const { date, hasCancellation } = explicitDate
    ? { date: explicitDate, hasCancellation: null }
    : await resolveTargetDate();
  console.log(
    `検証日: ${date}${hasCancellation === false ? "（中止レースが無いため直近の開催日）" : ""}`,
  );

  const results = [];
  for (const rpc of [
    "get_predictions_by_date",
    "get_predictions_by_date_light",
  ]) {
    const data = await callRpc(rpc, { target_date: date });
    results.push(report(rpc, data?.races ?? [], PREDICTION_RACE_KEYS));
  }

  // get_today_races は引数なしで「今日(JST)」のレースだけを返す。開催が無い日は検証できない
  const today = await callRpc("get_today_races", {});
  const todayRaces = (today?.data ?? []).flatMap((venue) => venue.races ?? []);
  results.push(
    report("get_today_races（本日分）", todayRaces, TODAY_RACE_KEYS),
  );

  const failed = results.some((r) => r.failed);
  const skipped = results.filter((r) => r.skipped).length;
  if (failed) {
    console.error(
      "\nNG: RPCの出力にフロントが参照するキーの欠落があります。直近のRPCマイグレーションが、古い定義を土台に関数全体を再定義していないか確認してください（本番の pg_get_functiondef を土台にする）。",
    );
    process.exit(1);
  }
  console.log(
    `\nOK: 検証できた全てのRPCが期待キーを含みます${skipped > 0 ? `（${skipped}件は対象レースが0件で検証不能）` : ""}`,
  );
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
});
