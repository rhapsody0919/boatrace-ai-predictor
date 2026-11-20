/**
 * verify-prediction-odds-derive.js - 買い目オッズ（BOA-404、tasks.md T4b-10-3）の導出実装の検証。
 * DBにも取得先にも接続しない（Supabaseクライアント・ストア・時計を差し替える）。
 *
 * 確認すること:
 *   (a) buildPredictionOddsRow（純粋関数）: 予測の買い目から3連単・3連複のキーを作り、race_odds の全通りから
 *       オッズを引く。買い目が無ければ null にする（既存値を上書きしない）。3連複はソート済みキー
 *   (b) percentDiff・percentileOf・summarizePredictionOddsDiff（純粋関数）: %差の計算、買い目が違う組の除外
 *   (c) fetchPredictionsByModel・fetchLatestRaceOdds: is_shadow=false のみ、券種ごとに独立最新（片方が古い窓でしか
 *       取れていない場合に、新しい窓のnullで上書きしない）
 *   (d) deriveRowsForRaces・deriveAndUpsertPredictionOdds: 予測 or race_odds が無いレースは含めない、shadowは書かず
 *       ダイジェストを返す、live は変更のある行だけ upsert する（変更なしはスキップ）
 *   (e) createOddsSlotHandler の onChanged: live かつ完了（ok・skipped_have_data）でだけ呼ぶ（shadow・partial・
 *       no_values・error では呼ばない）
 *   (f) runPredictionOddsDerivation: モード（off/shadow/live）のゲート、行が無いジョブは作るだけ、導出の失敗は
 *       例外を投げずに記録する
 *   (g) createOddsCronHandlerWithPredictionOdds: A3の応答（status・body）は変えない。変更が無ければ導出を呼ばない
 */
import {
  buildPredictionOddsRow,
  percentDiff,
  percentileOf,
  summarizePredictionOddsDiff,
  trioKeyOf,
} from "../lib/predictionOddsDerive.js";
import {
  fetchPredictionsByModel,
  fetchLatestRaceOdds,
  deriveRowsForRaces,
} from "../lib/scrapeJobs/predictionOddsHandlers.js";


import { runPredictionOddsDeriveScenes1 } from "./verifyData/prediction-odds-derive-scenes-1.js";
import { runPredictionOddsDeriveScenes2 } from "./verifyData/prediction-odds-derive-scenes-2.js";

const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);

// ---------------------------------------------------------------------------
// (a) buildPredictionOddsRow
// ---------------------------------------------------------------------------
{
  const row = buildPredictionOddsRow({
    raceId: "2026-09-19-05-01",
    predictionsByModel: {
      standard: { top1: 1, top2: 2, top3: 3 },
      safeBet: { top1: 3, top2: 1, top3: 2 },
    },
    trifectaAll: { "1-2-3": 10, "3-1-2": 25 },
    trioAll: { "1-2-3": 4 },
    updatedAtIso: "2026-09-19T05:00:00.000Z",
  });
  check(
    "買い目: 3連単は着順どおり、3連複は昇順ソートしたキーでオッズを引く",
    row.race_id === "2026-09-19-05-01" &&
      row.trifecta_pred_standard === "1-2-3" &&
      row.trifecta_odds_standard === 10 &&
      row.trio_pred_standard === "1-2-3" &&
      row.trio_odds_standard === 4 &&
      row.trifecta_pred_safe_bet === "3-1-2" &&
      row.trifecta_odds_safe_bet === 25 &&
      row.trio_pred_safe_bet === "1-2-3",
    show(row),
  );
  check(
    "買い目: upset_focus の予測が無いため、その列は含めない（他モデルを消さないよう、undefinedのまま）",
    row.trifecta_pred_upset_focus === undefined &&
      row.trifecta_odds_upset_focus === undefined,
  );
  check(
    "オッズ: race_odds に買い目のキーが無ければ null（既存値の上書きに使う側が、undefinedと区別できる）",
    buildPredictionOddsRow({
      raceId: "r",
      predictionsByModel: { standard: { top1: 4, top2: 5, top3: 6 } },
      trifectaAll: { "1-2-3": 10 },
      trioAll: null,
      updatedAtIso: "x",
    }).trifecta_odds_standard === null,
  );
  check(
    "予測が1モデルも無ければ null（書く価値が無い行）",
    buildPredictionOddsRow({
      raceId: "r",
      predictionsByModel: {},
      trifectaAll: {},
      trioAll: {},
      updatedAtIso: "x",
    }) === null &&
      buildPredictionOddsRow({
        raceId: "r",
        predictionsByModel: { standard: { top1: null, top2: 2, top3: 3 } },
        trifectaAll: {},
        trioAll: {},
        updatedAtIso: "x",
      }) === null,
  );
  check(
    "trioKeyOf: 艇番の順序によらず同じキー",
    trioKeyOf(3, 1, 2) === "1-2-3" && trioKeyOf(1, 2, 3) === "1-2-3",
  );
}

// ---------------------------------------------------------------------------
// (b) percentDiff・percentileOf・summarizePredictionOddsDiff
// ---------------------------------------------------------------------------
{
  check(
    "percentDiff: 既存値を分母にした絶対%差。片方が数値でない・分母が0なら null",
    percentDiff(10, 11) === 10 &&
      percentDiff(10, 10) === 0 &&
      percentDiff(null, 10) === null &&
      percentDiff(0, 10) === null,
  );
  check(
    "percentileOf: 空配列は null。中央値・p90 は最近傍",
    percentileOf([], 50) === null &&
      percentileOf([1, 2, 3, 4], 50) === 3 &&
      percentileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90) === 10,
  );
  const derived = [
    {
      race_id: "r1",
      row: {
        trifecta_pred_standard: "1-2-3",
        trifecta_odds_standard: 11,
        trio_pred_standard: "1-2-3",
        trio_odds_standard: 5,
      },
    },
    {
      race_id: "r2",
      row: {
        trifecta_pred_standard: "4-5-6",
        trifecta_odds_standard: 20,
        trio_pred_standard: "4-5-6",
        trio_odds_standard: 8,
      },
    },
  ];
  const existing = new Map([
    [
      "r1",
      {
        trifecta_pred_standard: "1-2-3",
        trifecta_odds_standard: 10,
        trio_pred_standard: "1-2-3",
        trio_odds_standard: 4,
      },
    ],
    [
      "r2",
      {
        // 買い目が違う（予測が更新された、または比較時点がずれた）→ %差の対象から除外し、mismatchに数える
        trifecta_pred_standard: "6-5-4",
        trifecta_odds_standard: 99,
      },
    ],
  ]);
  const digest = summarizePredictionOddsDiff(derived, existing);
  check(
    "summarizePredictionOddsDiff: 買い目が一致する組だけ%差の対象にし、不一致は comboMismatch に数える",
    digest.sampleSize === 2 &&
      digest.comboMismatch === 1 &&
      digest.trifectaOddsDiffPct.n === 1 &&
      digest.trifectaOddsDiffPct.p50 === 10 &&
      digest.trioOddsDiffPct.n === 1 &&
      digest.trioOddsDiffPct.p50 === 25,
    show(digest),
  );
  check(
    "既存行が無いレースは対象外（比べようがない）",
    summarizePredictionOddsDiff(derived, new Map()).sampleSize === 0,
  );
}

// ---------------------------------------------------------------------------
// (c) fetchPredictionsByModel・fetchLatestRaceOdds
// ---------------------------------------------------------------------------
function fakeSelectClient(tableRows) {
  return {
    from(table) {
      const rows = tableRows[table] ?? [];
      const s = { filters: [] };
      const q = {
        select() {
          return q;
        },
        eq(col, val) {
          s.filters.push((r) => r[col] === val);
          return q;
        },
        in(col, vals) {
          s.filters.push((r) => vals.includes(r[col]));
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: rows.filter((r) => s.filters.every((f) => f(r))),
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

{
  const client = fakeSelectClient({
    predictions: [
      {
        race_id: "r1",
        model_id: "standard",
        top_pick: 1,
        top_2nd: 2,
        top_3rd: 3,
        is_shadow: false,
      },
      {
        race_id: "r1",
        model_id: "safeBet",
        top_pick: 2,
        top_2nd: 1,
        top_3rd: 3,
        is_shadow: false,
      },
      {
        // is_shadow=true は対象外
        race_id: "r1",
        model_id: "upsetFocus",
        top_pick: 9,
        top_2nd: 9,
        top_3rd: 9,
        is_shadow: true,
      },
    ],
  });
  const map = await fetchPredictionsByModel(client, ["r1", "r2"]);
  check(
    "fetchPredictionsByModel: is_shadow=false のみ、モデルID別に集約する。空なら空Map（クエリしない）",
    map.size === 1 &&
      same(map.get("r1").standard, { top1: 1, top2: 2, top3: 3 }) &&
      same(map.get("r1").safeBet, { top1: 2, top2: 1, top3: 3 }) &&
      map.get("r1").upsetFocus === undefined &&
      (await fetchPredictionsByModel(client, [])).size === 0,
    show([...map.entries()]),
  );
}
{
  const client = fakeSelectClient({
    race_odds: [
      {
        race_id: "r1",
        captured_at: "2026-09-19T04:00:00.000Z",
        trifecta_all: { "1-2-3": 10 },
        trio_all: null,
      },
      {
        // trifecta は無いが trio は取れている、より新しい窓
        race_id: "r1",
        captured_at: "2026-09-19T04:30:00.000Z",
        trifecta_all: null,
        trio_all: { "1-2-3": 4 },
      },
      {
        // より新しいが trifecta も trio も無い（無視され、上の2行がそれぞれ残る）
        race_id: "r1",
        captured_at: "2026-09-19T04:55:00.000Z",
        trifecta_all: null,
        trio_all: null,
      },
    ],
  });
  const map = await fetchLatestRaceOdds(client, ["r1"]);
  check(
    "fetchLatestRaceOdds: 券種ごとに、値が入っている最新の行を独立に選ぶ（新しいnullの窓に上書きされない）",
    same(map.get("r1"), {
      trifectaAll: { "1-2-3": 10 },
      trioAll: { "1-2-3": 4 },
    }),
    show(map.get("r1")),
  );
  check(
    "fetchLatestRaceOdds: 該当行が無いレースはMapに含めない",
    !(await fetchLatestRaceOdds(client, ["r99"])).has("r99"),
  );
}

// ---------------------------------------------------------------------------
// (d) deriveRowsForRaces・deriveAndUpsertPredictionOdds
// ---------------------------------------------------------------------------
function createFakeDb(initial = { prediction_odds: [] }) {
  const tables = JSON.parse(JSON.stringify(initial));
  const writes = [];
  const reads = [];
  return {
    tables,
    writes,
    reads,
    from(table) {
      const rows = tables[table] ?? (tables[table] = []);
      const s = { op: "select", filters: [], rows: null, onConflict: null };
      const q = {
        select() {
          return q;
        },
        eq(col, val) {
          s.filters.push((r) => r[col] === val);
          return q;
        },
        in(col, vals) {
          s.filters.push((r) => vals.includes(r[col]));
          return q;
        },
        upsert(data, opts = {}) {
          s.op = "upsert";
          s.rows = data;
          s.onConflict = opts.onConflict;
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve(exec()).then(resolve, reject);
        },
      };
      function exec() {
        if (s.op === "select") {
          reads.push({ table });
          return {
            data: rows.filter((r) => s.filters.every((f) => f(r))),
            error: null,
          };
        }
        const keys = (s.onConflict ?? "").split(",").filter(Boolean);
        for (const row of s.rows) {
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (existing)
            Object.assign(existing, JSON.parse(JSON.stringify(row)));
          else rows.push(JSON.parse(JSON.stringify(row)));
        }
        writes.push({ table, onConflict: s.onConflict, count: s.rows.length });
        return { error: null };
      }
      return q;
    },
  };
}

{
  const db = createFakeDb({
    predictions: [
      {
        race_id: "r1",
        model_id: "standard",
        top_pick: 1,
        top_2nd: 2,
        top_3rd: 3,
        is_shadow: false,
      },
    ],
    race_odds: [
      {
        race_id: "r1",
        captured_at: "2026-09-19T04:55:00.000Z",
        trifecta_all: { "1-2-3": 10 },
        trio_all: { "1-2-3": 4 },
      },
    ],
    prediction_odds: [],
  });
  const derived = await deriveRowsForRaces({
    raceIds: ["r1", "r2"],
    client: db,
    now: () => new Date("2026-09-19T05:00:00Z"),
  });
  check(
    "deriveRowsForRaces: 予測とrace_oddsの両方があるレースだけ含める（r2は両方無いので除外）",
    derived.length === 1 &&
      derived[0].race_id === "r1" &&
      derived[0].row.trifecta_odds_standard === 10,
    show(derived),
  );
}

// ---- 後半の場面（verifyData/prediction-odds-derive-scenes-1.js・prediction-odds-derive-scenes-2.js） ----
await runPredictionOddsDeriveScenes1({ check, show, same, createFakeDb });
await runPredictionOddsDeriveScenes2({ check });

printOut(`\n${failures === 0 ? "✅ 全項目パス" : `❌ ${failures}件失敗`}`);
if (failures > 0) process.exit(1);
