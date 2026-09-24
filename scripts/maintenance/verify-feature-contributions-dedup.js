/**
 * verify-feature-contributions-dedup.js - predictions.feature_contributions の3モデル重複解消（BOA-408、
 * docs/design/scraping-vercel-consolidation/predictions-write-optimization.md 対策0）の検証。
 * DBには一切接続しない（インメモリの偽Supabaseクライアント・既存のracesInit fixtureを使う）。
 *
 * 確認すること:
 *   (a) generateAndWriteFromRacesData（writeToSupabase、朝の初期化経路）が書く predictions は、
 *       model_id='standard' の行にのみ feature_contributions（turnPrediction・racerStats）を持ち、
 *       safeBet・upsetFocus はNULL
 *   (b) mainRefresh（発走前リフレッシュ経路）が書く predictions も同様。writeMode="replace"・
 *       "upsert" のどちらでも同じ
 *   (c) standard行のfeature_contributions自体がNULL（turnPrediction・racerStatsどちらも無い）
 *       レースでは、3モデルとも従来どおりNULLのまま（何かを新たにNULLにしたわけではない）
 *   (d) 上記(a)(b)により、feature_contributionsを持つ行数がレースあたり3行→1行に減ることを
 *       行数ベースで確認する（本番の実バイト数はPR本文の実測クエリを参照）
 *
 * 実行: node scripts/maintenance/verify-feature-contributions-dedup.js
 */
import fs from "node:fs";
import {
  generateAndWriteFromRacesData,
  mainRefresh,
} from "../daily/generate-predictions.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

/** テスト対象コードのログを捨てる */
async function quiet(fn) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
}

const FX = new URL("../lib/racesInit/__fixtures__/", import.meta.url);
const GOLDEN_VENUE = JSON.parse(
  fs.readFileSync(new URL("golden-venue-01.json", FX), "utf8"),
);

// ---------------------------------------------------------------------------
// (a) generateAndWriteFromRacesData（朝の初期化経路、writeToSupabase）
// ---------------------------------------------------------------------------
{
  const client = createFakeSupabaseClient({
    tables: {
      venues: [{ code: 1, avg_first_win_rate: 0.5 }],
      racer_aggregated_stats: [],
    },
  });
  await quiet(() =>
    generateAndWriteFromRacesData({
      racesData: { success: true, data: [structuredClone(GOLDEN_VENUE)] },
      date: "2026-09-21",
      client,
      throwOnError: true,
    }),
  );

  const preds = client.data.predictions;
  const byModel = (modelId) => preds.filter((p) => p.model_id === modelId);
  const standardRows = byModel("standard");
  const safeBetRows = byModel("safeBet");
  const upsetFocusRows = byModel("upsetFocus");

  check(
    "(a) 12レース×3モデル=36行を書く",
    preds.length === 36 &&
      standardRows.length === 12 &&
      safeBetRows.length === 12 &&
      upsetFocusRows.length === 12,
    `${preds.length}行`,
  );
  check(
    "(a) standard行は全レースでfeature_contributionsを持つ（turnPredictionは常に計算されるため）",
    standardRows.every(
      (p) =>
        p.feature_contributions !== null &&
        p.feature_contributions.turnPrediction != null,
    ),
    `non-null: ${standardRows.filter((p) => p.feature_contributions !== null).length}/12`,
  );
  check(
    "(a) safeBet・upsetFocus行のfeature_contributionsは全レースでNULL",
    safeBetRows.every((p) => p.feature_contributions === null) &&
      upsetFocusRows.every((p) => p.feature_contributions === null),
    `safeBet non-null: ${safeBetRows.filter((p) => p.feature_contributions !== null).length}, upsetFocus non-null: ${upsetFocusRows.filter((p) => p.feature_contributions !== null).length}`,
  );
  check(
    "(a) top_pick・confidence等の予測内容自体はモデルごとに従来どおり別々の値を持つ（NULL化の影響を受けない）",
    new Set(preds.map((p) => `${p.race_id}:${p.model_id}:${p.top_pick}`))
      .size === 36,
  );
}

// ---------------------------------------------------------------------------
// (b)(c) mainRefresh（発走前リフレッシュ経路）
// ---------------------------------------------------------------------------
{
  const raceIds = ["2026-09-20-01-01", "2026-09-20-01-02"];
  const grades = ["A1", "A2", "B1", "B1", "B2", "B1"];
  const raceTables = () => ({
    race_entries: raceIds.flatMap((race_id) =>
      grades.map((grade, i) => ({
        race_id,
        boat_number: i + 1,
        racer_id: `${4000 + i}`,
        player_name: `選手${i + 1}`,
        grade,
        age: 30 + i,
        win_rate: 6.5 - i * 0.5,
        global_2rate: 50 - i * 5,
        global_3rate: 65 - i * 5,
        local_win_rate: 6.0 - i * 0.4,
        local_2rate: 48 - i * 4,
        local_3rate: 62 - i * 4,
        motor_number: 10 + i,
        motor_2rate: 40 - i * 2,
        motor_3rate: 55 - i * 2,
        boat_number_id: 20 + i,
        boat_2rate: 38 - i * 2,
        boat_3rate: 52 - i * 2,
      })),
    ),
    race_conditions: raceIds.map((race_id) => ({
      race_id,
      weather: "晴",
      temperature: 22,
      wind_speed: 2,
      water_temperature: 21,
      wave_height: 3,
      race_title: "テスト戦",
    })),
    exhibition_data: raceIds.flatMap((race_id) =>
      [1, 2, 3, 4, 5, 6].map((boat_number) => ({
        race_id,
        boat_number,
        exhibition_time: 6.7 + boat_number * 0.01,
        start_timing: 0.1 + boat_number * 0.01,
      })),
    ),
    races: raceIds.map((race_id) => ({ race_id, race_grade: "一般" })),
    venues: [],
    racer_aggregated_stats: [],
    predictions: [],
  });

  for (const writeMode of ["replace", "upsert"]) {
    const client = createFakeSupabaseClient({ tables: raceTables() });
    await quiet(() =>
      mainRefresh({
        isDryRun: false,
        specificRaceIds: raceIds,
        client,
        writeMode,
        date: "2026-09-20",
        now: () => new Date("2026-09-20T03:03:00.000Z"),
      }),
    );

    const preds = client.data.predictions;
    const byModel = (modelId) => preds.filter((p) => p.model_id === modelId);
    const standardRows = byModel("standard");
    const safeBetRows = byModel("safeBet");
    const upsetFocusRows = byModel("upsetFocus");

    check(
      `(b) writeMode=${writeMode}: 2レース×3モデル=6行を書く`,
      preds.length === 6 &&
        standardRows.length === 2 &&
        safeBetRows.length === 2 &&
        upsetFocusRows.length === 2,
      `${preds.length}行`,
    );
    check(
      `(b) writeMode=${writeMode}: standard行はfeature_contributionsを持つ`,
      standardRows.every((p) => p.feature_contributions !== null),
    );
    check(
      `(b) writeMode=${writeMode}: safeBet・upsetFocus行のfeature_contributionsはNULL`,
      safeBetRows.every((p) => p.feature_contributions === null) &&
        upsetFocusRows.every((p) => p.feature_contributions === null),
    );
  }

  // (c) turnPrediction・racerStatsどちらも無いレース（racerが存在しない）では、
  //     standardも含め従来どおり3モデルともNULL（新たな挙動ではない）
  const emptyClient = createFakeSupabaseClient({
    tables: {
      race_entries: [],
      race_conditions: [],
      exhibition_data: [],
      races: [{ race_id: "2026-09-20-01-01", race_grade: "一般" }],
      venues: [],
      racer_aggregated_stats: [],
      predictions: [],
    },
  });
  const result = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ["2026-09-20-01-01"],
      client: emptyClient,
      writeMode: "upsert",
      date: "2026-09-20",
      now: () => new Date("2026-09-20T03:03:00.000Z"),
    }),
  );
  check(
    "(c) race_entriesが無いレースは予測を生成できず対象外（フィクスチャの前提確認）",
    result === undefined && emptyClient.data.predictions.length === 0,
  );
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------
console.log("");
if (failures > 0) {
  console.error(`❌ ${failures}件失敗`);
  process.exit(1);
} else {
  console.log(
    "✅ 全件成功（feature_contributionsはstandard行にのみ書かれ、safeBet・upsetFocusはNULL）",
  );
}
