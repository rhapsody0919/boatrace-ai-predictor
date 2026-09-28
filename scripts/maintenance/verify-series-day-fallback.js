/**
 * verify-series-day-fallback.js - 日目（race_conditions.series_day）のフォールバックの契約検証（BOA-501）
 *
 * DBにも取得先にも接続しない（純関数と、インメモリのクライアントだけ）。
 *
 * 確認すること:
 *   (a) 導出: race_date − start_date + 1。節の期間外・不正な日付は null
 *   (b) 索引: 会場×日から節を引く。期間外は引かない
 *   (c) 優先順位: ページから読めた値を必ず優先し、読めなかったときだけ導出値で補う。
 *       is_final_day は補わない（節の終了日は予定で、順延でずれる）
 *   (d) 読み取りの失敗: 節を読めなくても例外にせず、空の対応を返す（日目だけ諦め、レース情報の更新は続ける）
 *   (e) バックフィルの計画: 既存の値は触らない・行の有無で挿入と更新に分ける・節の無い会場×日は埋めない
 *   (f) 変異検証: 優先順位を逆にした版・既存の値を上書きする版で、上の検証が失敗する
 *
 * 取得経路（スロットのハンドラーが節を1回だけ読むこと、ページの値が優先されること）の検証は
 * scripts/maintenance/verify-scrape-pre-race-job.js にある。
 */
import { buildRaceConditionRow } from "../lib/preRaceRows.js";
import {
  buildSeriesDayByVenue,
  deriveSeriesDay,
  findSeriesFor,
  indexSeriesByVenue,
  loadSeriesDayByVenue,
  planSeriesDayBackfill,
} from "../lib/raceSeriesLookup.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// (a) 導出
// ---------------------------------------------------------------------------
check(
  "導出: 開始日は1日目、翌日は2日目",
  deriveSeriesDay("2026-09-14", "2026-09-14") === 1 &&
    deriveSeriesDay("2026-09-15", "2026-09-14") === 2,
);
check(
  "導出: 月をまたいでも日数で数える（2026-09-28 開始の 2026-10-02 は5日目）",
  deriveSeriesDay("2026-10-02", "2026-09-28") === 5,
);
check(
  "導出: 開始日より前・不正な日付は null（0や負の日目を作らない）",
  deriveSeriesDay("2026-09-13", "2026-09-14") === null &&
    deriveSeriesDay("2026-09-14", "") === null &&
    deriveSeriesDay(null, "2026-09-14") === null,
);

// ---------------------------------------------------------------------------
// (b) 索引
// ---------------------------------------------------------------------------
// 実データ（2026-09-28）の3節
const SERIES_ROWS = [
  { venue_code: 24, start_date: "2026-09-28", end_date: "2026-10-02" },
  { venue_code: 2, start_date: "2026-09-18", end_date: "2026-09-24" },
  { venue_code: 2, start_date: "2026-09-26", end_date: "2026-09-30" },
];
{
  const byVenue = indexSeriesByVenue(SERIES_ROWS);
  check(
    "索引: 同じ会場の複数の節から、その日を含む節を選ぶ",
    findSeriesFor(byVenue, 2, "2026-09-22")?.start_date === "2026-09-18" &&
      findSeriesFor(byVenue, 2, "2026-09-27")?.start_date === "2026-09-26",
  );
  check(
    "索引: 節と節の隙間の日・節が無い会場は、引けない",
    findSeriesFor(byVenue, 2, "2026-09-25") === null &&
      findSeriesFor(byVenue, 7, "2026-09-22") === null,
  );
  const map = buildSeriesDayByVenue(SERIES_ROWS, "2026-09-28");
  check(
    "索引: 1日ぶんの 会場→日目 の対応（大村24は初日、戸田02は3日目。期間外の節は入らない）",
    map.get(24) === 1 && map.get(2) === 3 && map.size === 2,
    show([...map]),
  );
}

// ---------------------------------------------------------------------------
// (c) 優先順位（変異検証のため、実装を引数で受ける）
// ---------------------------------------------------------------------------
const META = (seriesDay, isFinalDay = false) => ({
  seriesDay,
  isFinalDay,
  raceTitle: "テスト節",
  raceStage: "予選",
  distanceM: 1800,
  labels: [],
});

/** @param {typeof buildRaceConditionRow} build */
function priorityCases(build) {
  return [
    [
      "優先順位: ページから読めた日目を使う（節からの導出は無視する）",
      build("R", META(2), { fallbackSeriesDay: 5 }).series_day === 2,
    ],
    [
      "優先順位: ページから読めないとき、節からの導出で補う",
      build("R", META(null), { fallbackSeriesDay: 5 }).series_day === 5,
    ],
    [
      "優先順位: どちらも無いときは null（従来どおり）",
      build("R", META(null)).series_day === null &&
        build("R", META(null), { fallbackSeriesDay: null }).series_day === null,
    ],
    [
      // 戸田 2026-09-18〜24 の節。09-21 に全12レースが中止になり、公式は 09-22 に「4日目」を振り直した。
      // 導出（09-22 − 09-18 + 1 = 5）はページ（4）と食い違う。ページ側を採らないと、表示が1日ずれる
      "優先順位: 順延・中止で食い違うとき、ページ側を採る（戸田 2026-09-22: ページ4日目 / 導出5日目）",
      build("R", META(4), { fallbackSeriesDay: 5 }).series_day === 4,
    ],
  ];
}
for (const [label, pass] of priorityCases(buildRaceConditionRow)) {
  check(label, pass);
}
check(
  "優先順位: 日目を補っても is_final_day は補わない（節の終了日は予定で、順延でずれる）",
  buildRaceConditionRow("R", META(null), { fallbackSeriesDay: 5 })
    .is_final_day === false &&
    buildRaceConditionRow(
      "R",
      { ...META(null), isFinalDay: null },
      {
        fallbackSeriesDay: 5,
      },
    ).is_final_day === null,
);
check(
  "優先順位: 既存の列（race_id・節名・ステージ・extended の距離とラベル）は変わらない",
  show(
    buildRaceConditionRow("R", META(3), {
      extended: true,
      fallbackSeriesDay: 9,
    }),
  ) ===
    show({
      race_id: "R",
      series_day: 3,
      is_final_day: false,
      race_title: "テスト節",
      race_stage: "予選",
      race_distance_m: 1800,
      race_labels: [],
    }),
);

// ---------------------------------------------------------------------------
// (d) 読み取りの失敗
// ---------------------------------------------------------------------------
{
  const stubClient = (result) => ({
    from: () => ({
      select: () => ({
        lte() {
          return this;
        },
        gte: () => Promise.resolve(result),
      }),
    }),
  });
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  const ok = await loadSeriesDayByVenue("2026-09-28", {
    client: stubClient({ data: SERIES_ROWS, error: null }),
  });
  const down = await loadSeriesDayByVenue("2026-09-28", {
    client: stubClient({ data: null, error: { message: "DB down" } }),
  });
  const threw = await loadSeriesDayByVenue("2026-09-28", {
    client: {
      from: () => {
        throw new Error("fetch failed");
      },
    },
  });
  console.warn = realWarn;
  check(
    "読み取り: 成功したら 会場→日目 の対応を返す",
    ok.get(24) === 1 && ok.get(2) === 3,
    show([...ok]),
  );
  check(
    "読み取り: 失敗したら例外にせず、空の対応を返して警告を残す（日目だけ諦め、レース情報の更新は止めない）",
    down.size === 0 && warnings.some((w) => /DB down/.test(w)),
    show(warnings),
  );
  check(
    "読み取り: 例外が飛んでも呼び出し側へは投げ返さない（通信の断・テーブル未適用）",
    threw.size === 0 && warnings.some((w) => /fetch failed/.test(w)),
    show(warnings),
  );
}

// ---------------------------------------------------------------------------
// (e) バックフィルの計画（変異検証のため、実装を引数で受ける）
// ---------------------------------------------------------------------------
const BACKFILL_INPUT = {
  races: [
    // 行が無い（2025-12・2026-01 の大半がこれ）
    { race_id: "2026-09-28-24-01", race_date: "2026-09-28", venue_code: 24 },
    // 行はあるが series_day が NULL
    { race_id: "2026-09-28-02-01", race_date: "2026-09-28", venue_code: 2 },
    // 既に値が入っている（触らない）
    { race_id: "2026-09-28-02-02", race_date: "2026-09-28", venue_code: 2 },
    // 節が無い会場
    { race_id: "2026-09-28-07-01", race_date: "2026-09-28", venue_code: 7 },
    // 節と節の隙間の日
    { race_id: "2026-09-25-02-01", race_date: "2026-09-25", venue_code: 2 },
  ],
  existingSeriesDay: new Map([
    ["2026-09-28-02-01", null],
    ["2026-09-28-02-02", 3],
  ]),
  seriesRows: SERIES_ROWS,
};

/** @param {typeof planSeriesDayBackfill} plan */
function backfillCases(plan) {
  const r = plan(BACKFILL_INPUT);
  return [
    [
      "バックフィル: 行が無いレースは挿入（大村24 2026-09-28 は初日）",
      show(r.inserts) ===
        show([{ race_id: "2026-09-28-24-01", series_day: 1 }]),
      show(r.inserts),
    ],
    [
      "バックフィル: 行があって NULL のレースは更新（戸田02 2026-09-28 は3日目）",
      show(r.updates) ===
        show([{ race_id: "2026-09-28-02-01", series_day: 3 }]),
      show(r.updates),
    ],
    [
      "バックフィル: 既に値が入っている行は触らない（ページの値を上書きしない）",
      r.alreadyFilled === 1 &&
        ![...r.inserts, ...r.updates].some(
          (x) => x.race_id === "2026-09-28-02-02",
        ),
      show(r.alreadyFilled),
    ],
    [
      "バックフィル: 節が無い会場×日は埋めず、理由つきで残す（黙って捨てない）",
      r.skipped.length === 2 &&
        r.skipped.every((s) => s.reason === "no_series") &&
        r.skipped.map((s) => s.race_id).join(",") ===
          "2026-09-28-07-01,2026-09-25-02-01",
      show(r.skipped),
    ],
  ];
}
for (const [label, pass, detail] of backfillCases(planSeriesDayBackfill)) {
  check(label, pass, detail);
}

// ---------------------------------------------------------------------------
// (f) 変異検証
// ---------------------------------------------------------------------------
{
  // 優先順位を逆にした版（導出をページより優先する）
  const reversed = (
    raceId,
    meta,
    { extended = false, fallbackSeriesDay = null } = {},
  ) =>
    buildRaceConditionRow(
      raceId,
      { ...meta, seriesDay: fallbackSeriesDay ?? meta.seriesDay },
      { extended },
    );
  const reversedFailures = priorityCases(reversed).filter(([, pass]) => !pass);
  check(
    "変異検証: 「節からの導出をページより優先する」版では、優先順位の検証が失敗する（順延の食い違いを含む）",
    reversedFailures.length === 2 &&
      reversedFailures.some(([l]) => /順延・中止で食い違う/.test(l)),
    show(reversedFailures.map(([l]) => l)),
  );

  // 既存の値を上書きする版
  const overwriting = (input) =>
    planSeriesDayBackfill({
      ...input,
      existingSeriesDay: new Map(
        [...input.existingSeriesDay].map(([k]) => [k, null]),
      ),
    });
  const overwritingFailures = backfillCases(overwriting).filter(
    ([, pass]) => !pass,
  );
  check(
    "変異検証: 「既に入っている日目も上書きする」版では、バックフィルの検証が失敗する",
    overwritingFailures.some(([l]) => /既に値が入っている行は触らない/.test(l)),
    show(overwritingFailures.map(([l]) => l)),
  );
}

console.log("");
if (failures === 0) {
  console.log("✅ すべての検証に成功しました");
} else {
  console.error(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}
