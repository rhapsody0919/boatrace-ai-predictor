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
 * 読み取り専用（RPC 3回と、日付決定用の races 1〜2回の SELECT のみ）。接続は
 * scripts/lib/supabaseClient.js（SUPABASE_URL / SUPABASE_SERVICE_KEY）を使う。
 * 期待するキーは、フロント（src/services/supabaseDataService.js の transformEdgeResponse /
 * getRaces）の参照と、各マイグレーション（037・048・051・062・066等）が足したフィールドに
 * 合わせている。キーの値が null でも「キーが存在する」ことだけを検査する
 * （json_build_object は null値のキーも出力する）。
 *
 * 終了コード: 0=検証できた全てが合格 / 1=キーの欠落、日付指定RPCの対象レースが0件、
 * RPCエラー等。get_today_races は「今日(JST)」の開催が無いと検証できないため、
 * その場合は警告を出して未検証のまま終了する（失敗にはしない）。
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

// get_predictions_by_date / _light の入れ子要素が持つべきキー。同じ回帰が入れ子のフィールド
// （037のracerId、051のresultの着順・払戻等）にも起こりうるため、レース直下と同様に検査する。
// 値が null の入れ子（結果未確定のresult、中止レースのentries等）は検査対象から外れる
const PREDICTION_NESTED_CHECKS = [
  {
    path: "entries",
    keys: [
      "number",
      "name",
      "racerId", // 037
      "grade",
      "age",
      "winRate",
      "localWinRate",
      "global2Rate",
      "motorNumber",
      "motor2Rate",
      "boatNumber",
      "boat2Rate",
      "aiScoreStandard",
      "aiScoreSafeBet",
      "aiScoreUpsetFocus",
    ],
  },
  {
    path: "exhibitionData", // 008
    keys: ["boatNumber", "exhibitionTime", "startTiming"],
  },
  {
    path: "predictionOdds", // 011・019
    keys: [
      "trifectaPredStandard",
      "trifectaOddsStandard",
      "trioPredStandard",
      "trioOddsStandard",
      "trifectaPredSafeBet",
      "trifectaOddsSafeBet",
      "trioPredSafeBet",
      "trioOddsSafeBet",
      "trifectaPredUpsetFocus",
      "trifectaOddsUpsetFocus",
      "trioPredUpsetFocus",
      "trioOddsUpsetFocus",
    ],
  },
  {
    path: "result", // 051（全着順・払戻・人気）
    keys: [
      "finished",
      "isCancelled",
      "isNoRace",
      "rank1",
      "rank2",
      "rank3",
      "rank4",
      "rank5",
      "rank6",
      "raceTime1",
      "raceTime2",
      "raceTime3",
      "raceTime4",
      "raceTime5",
      "raceTime6",
      "winningTechnique",
      "payoutWin",
      "payoutPlace1",
      "payoutPlace2",
      "payoutTrifecta",
      "payoutTrio",
      "payoutExacta",
      "payoutQuinella",
      "payoutWide1",
      "payoutWide2",
      "payoutWide3",
      "popularityTrifecta",
      "popularityTrio",
      "popularityExacta",
      "popularityQuinella",
      "popularityWide1",
      "popularityWide2",
      "popularityWide3",
    ],
  },
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

  let failed = false;
  for (const rpc of [
    "get_predictions_by_date",
    "get_predictions_by_date_light",
  ]) {
    const data = await callRpc(rpc, { target_date: date });
    if (!Array.isArray(data?.races)) {
      throw new Error(`RPC ${rpc} の出力に races 配列がありません`);
    }
    console.log(`${rpc}（${data.races.length}レース）`);
    if (data.races.length === 0) {
      // 検証日にレースが無い（未来日・誤った日付等）と、何も検証できていない
      console.log(`  [FAIL] 検証日のレースが0件のため検証できません`);
      failed = true;
      continue;
    }
    failed = reportGroup("レース", data.races, PREDICTION_RACE_KEYS) || failed;
    for (const { path, keys } of PREDICTION_NESTED_CHECKS) {
      const items = collectNested(data.races, path);
      if (items.length === 0) {
        console.log(`  [SKIP] ${path}: 全レースで空（検査対象なし）`);
        continue;
      }
      failed = reportGroup(path, items, keys) || failed;
    }
  }

  // get_today_races は引数なしで「今日(JST)」のレースだけを返す。開催が無い日は検証できない
  const today = await callRpc("get_today_races", {});
  const todayRaces = (today?.data ?? []).flatMap((venue) => venue.races ?? []);
  console.log(`get_today_races（本日分、${todayRaces.length}レース）`);
  const todayUnverified = todayRaces.length === 0;
  if (todayUnverified) {
    console.log("  [WARN] 本日のレースが0件のため未検証");
  } else {
    failed = reportGroup("レース", todayRaces, TODAY_RACE_KEYS) || failed;
  }

  if (failed) {
    console.error(
      "\nNG: RPCの出力にフロントが参照するキーの欠落、または検証不能があります。直近のRPCマイグレーションが、古い定義を土台に関数全体を再定義していないか確認してください（本番の pg_get_functiondef を土台にする）。",
    );
    process.exit(1);
  }
  console.log(
    `\nOK: 検証できたRPCは全て期待キーを含みます${todayUnverified ? "（get_today_racesは本日の開催が無く未検証。開催日に再実行してください）" : ""}`,
  );
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
});
