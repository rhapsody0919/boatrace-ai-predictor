/**
 * verify-rpc-output-keys.js - 本番RPC（get_predictions_by_date / _light / get_today_races、
 * 199 の get_course_win_rate_baseline）の出力に、フロントが参照するキーが含まれているかを検証する（BOA-363の再発防止）。
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
 * weather の入れ子（observedAt 等）は、検証日に weather が非nullのレースが1件も無いと
 * [WARN] 未検証になる（終了コードは0だが、最後の OK 行に未検証と明記する）。070（observedAt）の検証には、気象を取得済みのレースがある日
 * （観測時刻の保存が始まった069適用後の日付）を --date で指定する。
 *
 * 読み取り専用（RPC 3回と、日付決定用の races 1〜2回の SELECT のみ）。接続は
 * scripts/lib/supabaseClient.js（SUPABASE_URL / SUPABASE_SERVICE_KEY）を使う。
 * 期待するキーは、フロント（src/services/supabaseDataService.js の transformEdgeResponse /
 * getRaces）の参照と、各マイグレーション（037・048・051・062・066・070等）が足したフィールドに
 * 合わせている。キーの値が null でも「キーが存在する」ことだけを検査する
 * （json_build_object は null値のキーも出力する）。
 *
 * 終了コード: 0=検証できた全てが合格 / 1=キーの欠落、日付指定RPCの対象レースが0件、
 * RPCエラー等。get_today_races は「今日(JST)」の開催が無いと検証できないため、
 * その場合は警告を出して未検証のまま終了する（失敗にはしない）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../lib/supabaseClient.js";
import {
  PREDICTION_NESTED_CHECKS,
  PREDICTION_RACE_KEYS,
} from "./verifyData/rpc-output-keys-prediction-keys.js";

// 109（BOA-543）: result のレースの成立状態・返還艇・備考・払戻明細。値が null（未判定・明細なし）でも
// キーは出る。コードは 109 の適用前にマージしてよい設計（未適用の間は画面が従来どおり）なので、
// 台帳（docs/db-migration/APPLIED.md）で 109 が「適用済み」になるまでは、欠落を失敗にせず WARN にする
// （nightly-verify-db が適用待ちの既知の欠落で毎晩失敗し、本物の回帰の通知を埋もれさせないため）。
// 適用済みになった後は、他のキーと同じく欠落を失敗にする
const MIGRATION_109_RESULT_KEYS = [
  "raceStatus",
  "refundBoats",
  "remark",
  "payoutRows",
];

/**
 * 台帳でそのマイグレーションが「適用済み」か（行の3列目）。台帳が読めなければ適用済みとみなす
 * （厳しい側に倒す）。コードを先にマージしてよい設計のマイグレーション（109・110）で、適用待ちの
 * 既知の欠落を失敗にしないために使う
 * @param {number} number
 */
function isMigrationApplied(number) {
  try {
    const ledger = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../docs/db-migration/APPLIED.md",
      ),
      "utf8",
    );
    const row = ledger
      .split("\n")
      .find((line) => new RegExp(`^\\|\\s*${number}\\s*\\|`).test(line));
    if (!row) return true;
    const status = row.split("|")[3] ?? "";
    return status.includes("適用済み");
  } catch {
    return true;
  }
}

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

// 110（BOA-542）: 着順つきの結果の有無（{rank1} / null）。109 と同じく、台帳で 110 が「適用済み」に
// なるまでは欠落を WARN にとどめ、適用済みになった後は失敗にする
const MIGRATION_110_TODAY_RACE_KEYS = ["result"];

// 157（BOA-822）: レース直下の inCaution（unified の feature_contributions.inCaution をそのまま。無ければ null）。
// get_predictions_by_date / _light / get_today_races の3関数。台帳で 157 が「適用済み」になるまでは欠落を WARN にとどめる
const MIGRATION_157_IN_CAUTION_KEYS = ["inCaution"];

/**
 * 台帳の適用状況で、欠落を失敗にするか WARN にとどめるかを分けるキーの検査。失敗したかを返す。
 * @param {string} label
 * @param {unknown[]} items
 * @param {string[]} keys
 * @param {number} migration
 */
function reportMigrationKeys(label, items, keys, migration) {
  if (isMigrationApplied(migration)) return reportGroup(label, items, keys);
  const missing = findMissingKeys(items, keys);
  console.log(
    missing.length === 0
      ? `  [WARN] ${label}: ${migration} のキー（${keys.join("・")}）は出ているが、台帳（APPLIED.md）の${migration}が「適用済み」になっていない。台帳を更新する`
      : `  [WARN] ${label}: ${migration} は台帳で未適用のため、${keys.join("・")} の欠落は失敗にしない`,
  );
  return false;
}

/**
 * 要素配列のうち、期待キーを持たない要素の件数をキーごとに数える。
 * @param {unknown[]} items
 * @param {string[]} expectedKeys
 * @returns {Array<{ key: string, missingCount: number }>} 欠落のあったキーのみ
 */
function findMissingKeys(items, expectedKeys) {
  return expectedKeys
    .map((key) => ({
      key,
      missingCount: items.filter(
        (item) => item == null || typeof item !== "object" || !(key in item),
      ).length,
    }))
    .filter(({ missingCount }) => missingCount > 0);
}

/** 各レースの入れ子（配列は展開、オブジェクトは1件、nullは無視）を1つの配列にまとめる。 */
function collectNested(races, path) {
  return races.flatMap((race) => {
    const value = race?.[path];
    if (Array.isArray(value)) return value;
    return value != null && typeof value === "object" ? [value] : [];
  });
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

/** 1グループ（レース直下 or 入れ子）の検査結果を出力し、失敗したかを返す。 */
function reportGroup(label, items, expectedKeys) {
  const missing = findMissingKeys(items, expectedKeys);
  if (missing.length === 0) {
    console.log(
      `  [OK]   ${label}: ${items.length}件が期待キー${expectedKeys.length}個を含む`,
    );
    return false;
  }
  console.log(`  [FAIL] ${label}: ${items.length}件中、キーが欠落`);
  for (const { key, missingCount } of missing) {
    console.log(`           - ${key}: ${missingCount}件で欠落`);
  }
  return true;
}

// 199（BOA-1290）: get_course_win_rate_baseline(p_race_date, p_venue_code) の jsonb の形。
// フロントの getCourseWinRateBaseline と、それを前提にする BOA-1292 の口が読むキー
const BASELINE_TOP_KEYS = ["terms", "national", "venue"];
const BASELINE_TERM_KEYS = ["calc_from", "calc_to"];
const BASELINE_VENUE_KEYS = ["venueCode", "from", "to", "byCourse"];
const BASELINE_CELL_KEYS = ["wins", "entries", "winRate"];
const BASELINE_COURSES = ["1", "2", "3", "4", "5", "6"];

/**
 * 199 の get_course_win_rate_baseline を検証日・その日の最初の会場で呼び、キーを確かめる。失敗したかを返す。
 * 台帳で 199 が「適用済み」になるまでは、関数が無い・キーの欠落を WARN にとどめる
 * @param {string} date
 */
async function checkCourseWinRateBaseline(date) {
  const applied = isMigrationApplied(199);
  const { data: raceRows, error: raceError } = await supabase
    .from("races")
    .select("venue_code")
    .eq("race_date", date)
    .order("venue_code")
    .limit(1);
  if (raceError)
    throw new Error(`races の会場の取得に失敗: ${raceError.message}`);
  const venueCode = raceRows?.[0]?.venue_code ?? null;
  const { data, error } = await supabase.rpc("get_course_win_rate_baseline", {
    p_race_date: date,
    p_venue_code: venueCode,
  });
  console.log(
    `get_course_win_rate_baseline（${date}・会場 ${venueCode ?? "なし"}）`,
  );
  if (error) {
    if (!applied) {
      console.log(
        `  [WARN] 199 は台帳で未適用のため、呼び出しの失敗は失敗にしない: ${error.message}`,
      );
      return false;
    }
    console.log(`  [FAIL] 呼び出しに失敗: ${error.message}`);
    return true;
  }
  return reportBaselineKeys(data, venueCode, applied);
}

/** 199 の jsonb のキーの検査（最上位・terms・national・venue）。失敗したかを返す */
function reportBaselineKeys(data, venueCode, applied) {
  const report = (label, items, keys) =>
    applied
      ? reportGroup(label, items, keys)
      : reportMigrationKeys(label, items, keys, 199);
  let failed = report("最上位", [data], BASELINE_TOP_KEYS);
  const terms = Array.isArray(data?.terms) ? data.terms : [];
  if (terms.length !== 3) {
    console.log(
      `  [${applied ? "FAIL" : "WARN"}] terms が3つでない（${terms.length}）。racer_period_stats の期を確かめる`,
    );
    if (applied) failed = true;
  } else {
    failed = report("terms", terms, BASELINE_TERM_KEYS) || failed;
  }
  const national = BASELINE_COURSES.map((c) => data?.national?.[c]);
  failed =
    report("national（6コース）", national, BASELINE_CELL_KEYS) || failed;
  if (venueCode === null) {
    console.log("  [SKIP] venue: 検証日にレースが無く会場が無い");
  } else {
    failed = report("venue", [data?.venue], BASELINE_VENUE_KEYS) || failed;
    const byCourse = BASELINE_COURSES.map((c) => data?.venue?.byCourse?.[c]);
    failed =
      report("venue.byCourse（6コース）", byCourse, BASELINE_CELL_KEYS) ||
      failed;
  }
  return failed;
}

/** 入れ子の1か所（result・weather 等）の検査。weather が空なら未検証を返す */
function checkNestedOne(races, { path, keys }, migration109Applied) {
  const items = collectNested(races, path);
  if (items.length === 0) {
    if (path === "weather") {
      console.log(`  [WARN] ${path}: 全レースで空のため未検証`);
      return { failed: false, weatherUnverified: true };
    }
    console.log(`  [SKIP] ${path}: 全レースで空（検査対象なし）`);
    return { failed: false, weatherUnverified: false };
  }
  const expected =
    path === "result" && migration109Applied
      ? [...keys, ...MIGRATION_109_RESULT_KEYS]
      : keys;
  const failed = reportGroup(path, items, expected);
  if (path === "result" && !migration109Applied) {
    const missing109 = findMissingKeys(items, MIGRATION_109_RESULT_KEYS);
    console.log(
      missing109.length === 0
        ? "  [WARN] result: 109 の4キーは出ているが、台帳（APPLIED.md）の109が「適用済み」になっていない。台帳を更新する"
        : `  [WARN] result: 109 は台帳で未適用のため、4キー（${MIGRATION_109_RESULT_KEYS.join("・")}）の欠落は失敗にしない`,
    );
  }
  return { failed, weatherUnverified: false };
}

/** 予測の RPC 1本（get_predictions_by_date 系）の検査 */
async function checkPredictionRpc(rpc, date, migration109Applied) {
  const data = await callRpc(rpc, { target_date: date });
  if (!Array.isArray(data?.races)) {
    throw new Error(`RPC ${rpc} の出力に races 配列がありません`);
  }
  console.log(`${rpc}（${data.races.length}レース）`);
  if (data.races.length === 0) {
    // 検証日にレースが無い（未来日・誤った日付等）と、何も検証できていない
    console.log(`  [FAIL] 検証日のレースが0件のため検証できません`);
    return { failed: true, weatherUnverified: false };
  }
  let failed = reportGroup("レース", data.races, PREDICTION_RACE_KEYS);
  failed =
    reportMigrationKeys(
      "レース（157）",
      data.races,
      MIGRATION_157_IN_CAUTION_KEYS,
      157,
    ) || failed;
  let weatherUnverified = false;
  for (const check of PREDICTION_NESTED_CHECKS) {
    const r = checkNestedOne(data.races, check, migration109Applied);
    failed = r.failed || failed;
    if (r.weatherUnverified) weatherUnverified = true;
  }
  return { failed, weatherUnverified };
}

/** get_today_races の検査（本日分。0件なら未検証） */
function checkTodayRaces(todayRaces, migration110Applied) {
  let failed = false;
  failed =
    reportGroup(
      "レース",
      todayRaces,
      migration110Applied
        ? [...TODAY_RACE_KEYS, ...MIGRATION_110_TODAY_RACE_KEYS]
        : TODAY_RACE_KEYS,
    ) || failed;
  failed =
    reportMigrationKeys(
      "レース（157）",
      todayRaces,
      MIGRATION_157_IN_CAUTION_KEYS,
      157,
    ) || failed;
  if (!migration110Applied) {
    const missing110 = findMissingKeys(
      todayRaces,
      MIGRATION_110_TODAY_RACE_KEYS,
    );
    console.log(
      missing110.length === 0
        ? "  [WARN] レース: 110 の result は出ているが、台帳（APPLIED.md）の110が「適用済み」になっていない。台帳を更新する"
        : "  [WARN] レース: 110 は台帳で未適用のため、result の欠落は失敗にしない",
    );
  }
  return failed;
}

async function resolveDate() {
  const explicitDate = parseDateArg(process.argv.slice(2));
  const { date, hasCancellation } = explicitDate
    ? { date: explicitDate, hasCancellation: null }
    : await resolveTargetDate();
  console.log(
    `検証日: ${date}${hasCancellation === false ? "（中止レースが無いため直近の開催日）" : ""}`,
  );
  return date;
}

async function main() {
  if (!supabase) {
    throw new Error(
      "Supabaseの接続情報がありません（.env.local の SUPABASE_URL / SUPABASE_SERVICE_KEY を確認）",
    );
  }
  const date = await resolveDate();

  let failed = false;
  const migration109Applied = isMigrationApplied(109);
  const migration110Applied = isMigrationApplied(110);
  // weather は「気象が非nullのレースが無い日」だと検査対象が空になる。他の入れ子（SKIP）と違い、
  // 070（observedAt）の検証そのものなので、黙って OK にせず、最後の出力で未検証を明示する
  let weatherUnverified = false;
  for (const rpc of [
    "get_predictions_by_date",
    "get_predictions_by_date_light",
  ]) {
    const r = await checkPredictionRpc(rpc, date, migration109Applied);
    failed = r.failed || failed;
    if (r.weatherUnverified) weatherUnverified = true;
  }

  // get_today_races は引数なしで「今日(JST)」のレースだけを返す。開催が無い日は検証できない
  const today = await callRpc("get_today_races", {});
  const todayRaces = (today?.data ?? []).flatMap((venue) => venue.races ?? []);
  console.log(`get_today_races（本日分、${todayRaces.length}レース）`);
  const todayUnverified = todayRaces.length === 0;
  if (todayUnverified) {
    console.log("  [WARN] 本日のレースが0件のため未検証");
  } else {
    failed = checkTodayRaces(todayRaces, migration110Applied) || failed;
  }

  failed = (await checkCourseWinRateBaseline(date)) || failed;

  if (failed) {
    console.error(
      "\nNG: RPCの出力にフロントが参照するキーの欠落、または検証不能があります。直近のRPCマイグレーションが、古い定義を土台に関数全体を再定義していないか確認してください（本番の pg_get_functiondef を土台にする）。",
    );
    process.exit(1);
  }
  const unverifiedNotes = [
    todayUnverified &&
      "get_today_racesは本日の開催が無く未検証。開催日に再実行してください",
    weatherUnverified &&
      "weather（observedAt）は検証日に気象を取得済みのレースが無く未検証。--date で気象のある日を指定して再実行してください",
  ].filter(Boolean);
  console.log(
    `\nOK: 検証できたRPCは全て期待キーを含みます${unverifiedNotes.length > 0 ? `（${unverifiedNotes.join("。")}）` : ""}`,
  );
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
});
