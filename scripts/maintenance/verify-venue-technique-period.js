/**
 * verify-venue-technique-period.js - 会場の決まり手の期間の表 venue_technique_period_stats（BOA-430、ADR 0088、マイグレーション 134）
 *
 *   (a) 集計（純関数、scripts/lib/venueTechniquePeriod.js）: DBに接続せずに固定データで確かめる。Quality Gates（PRごと）ではこれだけ
 *       - 期間は集計日の前日まで N 日（両端を含む）
 *       - 長期の表（〜2025-12-02）と新しい表（2025-12-03〜）の境目。新しい表の 2025-12-02 の行は数えない（長期の表と重なる）
 *       - 総数＝決まり手の件数の合計、90日 ⊂ 365日
 *       - 中止・不成立・1着なし・決まり手なしを数えない。想定外の決まり手はそのまま行にする
 *       - 期間に長期の表の日付が入るのに長期の表が0件なら失敗（新しい表だけを数えた 2,196件の誤りの再発防止）
 *   (b) 本番の鮮度: 環境変数 VERIFY_PRODUCTION=1 のときだけ本番の表を読む（読み取りのみ）。last_updated が2日より古い行・
 *       総数の不一致・24会場×2期間の欠けがあれば exit 1。nightly-verify-db.yml が毎晩（JST 3:00）実行し、失敗を Slack に流す
 *
 * 実行: node scripts/maintenance/verify-venue-technique-period.js
 *       VERIFY_PRODUCTION=1 node --env-file=.env.local scripts/maintenance/verify-venue-technique-period.js   # 本番も見る
 */
import { fileURLToPath } from "node:url";
import {
  VENUE_CODES,
  buildPeriodRecords,
  checkStoredRows,
  fromArchiveRow,
  fromLiveRow,
  periodRange,
  sourceRanges,
  validateSources,
} from "../lib/venueTechniquePeriod.js";

const todayJST = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );

function selfTest() {
  let failures = 0;
  const check = (label, pass, detail = "") => {
    if (pass) console.log(`✅ ${label}`);
    else {
      failures++;
      console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
    }
  };

  // 期間
  const r365 = periodRange("2026-10-06", 365);
  const r90 = periodRange("2026-10-06", 90);
  check(
    "(a) 期間: 集計日 2026-10-06 の365日は 2025-10-06〜2026-10-05、90日は 2026-07-08〜2026-10-05",
    r365.from === "2025-10-06" &&
      r365.to === "2026-10-05" &&
      r90.from === "2026-07-08" &&
      r90.to === "2026-10-05",
    JSON.stringify({ r365, r90 }),
  );
  const src = sourceRanges("2026-10-06");
  check(
    "(a) 読む範囲: 長期の表は 2025-10-06〜2025-12-02、新しい表は 2025-12-03〜2026-10-05",
    src.archive?.from === "2025-10-06" &&
      src.archive?.to === "2025-12-02" &&
      src.live?.from === "2025-12-03" &&
      src.live?.to === "2026-10-05",
    JSON.stringify(src),
  );
  check(
    "(a) 読む範囲: 期間が 2025-12-02 より後だけになったら長期の表は読まない",
    sourceRanges("2026-12-03").archive === null &&
      sourceRanges("2026-12-02").archive?.to === "2025-12-02",
    JSON.stringify(sourceRanges("2026-12-03")),
  );

  // 行の変換（除外）
  const live = (id, extra = {}) => ({
    race_id: id,
    race_status: "normal",
    is_cancelled: false,
    rank1: 1,
    winning_technique: "逃げ",
    ...extra,
  });
  const arch = (date, venue, extra = {}) => ({
    race_id: `${date}-${String(venue).padStart(2, "0")}-01`,
    race_date: date,
    venue_code: venue,
    has_result: true,
    technique: "逃げ",
    ...extra,
  });
  const excluded = [
    fromLiveRow(live("2026-10-01-18-01", { is_cancelled: true })),
    fromLiveRow(live("2026-10-01-18-02", { race_status: "no_race" })),
    fromLiveRow(live("2026-10-01-18-03", { rank1: null })),
    fromLiveRow(live("2026-10-01-18-04", { winning_technique: null })),
    fromLiveRow(live("2025-12-02-18-05")), // 境目の日は長期の表で数える
    fromArchiveRow(arch("2025-11-01", 18, { has_result: false })),
    fromArchiveRow(arch("2025-11-01", 18, { technique: null })),
    fromArchiveRow(arch("2025-12-03", 18)), // 境目より後は新しい表で数える
  ];
  check(
    "(a) 除外: 中止・不成立・1着なし・決まり手なし・境目の向こう側の行を数えない",
    excluded.every((x) => x === null),
    JSON.stringify(excluded),
  );
  const kept = [
    fromLiveRow(live("2026-10-01-18-06", { race_status: null })),
    fromLiveRow(live("2026-10-01-18-07", { race_status: "partial_refund" })),
    fromArchiveRow(arch("2025-12-02", 18)),
  ];
  check(
    "(a) 数える: 状態不明（078以前）・一部返還・長期の表の境目の日",
    kept.every((x) => x !== null) &&
      kept[0].venue_code === 18 &&
      kept[0].date === "2026-10-01" &&
      kept[2].date === "2025-12-02",
    JSON.stringify(kept),
  );

  // 集計（徳山18・平和島4。新しい表の 2025-12-02 の重複行を含む固定データ）
  const liveRows = [
    live("2026-10-05-18-01"), // 90日・365日
    live("2026-10-05-18-02", { winning_technique: "差し" }),
    live("2026-07-08-18-01"), // 90日の初日
    live("2026-07-07-18-01", { winning_technique: "まくり" }), // 90日の外・365日の中
    live("2026-10-06-18-01"), // 集計日当日（数えない）
    live("2025-12-03-18-01", { winning_technique: "抜き" }),
    live("2025-12-02-18-01"), // 新しい表の重複（数えない）
    live("2026-09-01-04-01", { winning_technique: "逃げ抜き" }), // 想定外の決まり手
  ];
  const archRows = [
    arch("2025-12-02", 18), // 長期の表の境目の日
    arch("2025-10-06", 18, { technique: "恵まれ" }), // 365日の初日
    arch("2025-10-05", 18), // 365日の外
  ];
  const races = [
    ...liveRows.map(fromLiveRow),
    ...archRows.map(fromArchiveRow),
  ].filter(Boolean);
  const byVenue = buildPeriodRecords(races, "2026-10-06");
  const pick = (venue, days) =>
    Object.fromEntries(
      byVenue[venue]
        .filter((r) => r.period_days === days)
        .map((r) => [r.winning_technique, r.race_count]),
    );
  const t18_90 = pick(18, 90);
  const t18_365 = pick(18, 365);
  check(
    "(a) 集計: 徳山の90日は 逃げ2・差し1（初日を含み、当日と期間外を含まない）",
    JSON.stringify(t18_90) === JSON.stringify({ 差し: 1, 逃げ: 2 }),
    JSON.stringify(t18_90),
  );
  check(
    "(a) 集計: 徳山の365日は 逃げ3（2025-12-02 は長期の表の1件だけ）・差し1・まくり1・抜き1・恵まれ1",
    JSON.stringify(t18_365) ===
      JSON.stringify({ まくり: 1, 差し: 1, 恵まれ: 1, 抜き: 1, 逃げ: 3 }),
    JSON.stringify(t18_365),
  );
  const totals = (venue, days) => [
    ...new Set(
      byVenue[venue]
        .filter((r) => r.period_days === days)
        .map((r) => r.total_races),
    ),
  ];
  check(
    "(a) 総数: total_races は決まり手の件数の合計（徳山 90日 3・365日 7）",
    JSON.stringify(totals(18, 90)) === "[3]" &&
      JSON.stringify(totals(18, 365)) === "[7]",
    JSON.stringify({ t90: totals(18, 90), t365: totals(18, 365) }),
  );
  check(
    "(a) 想定外の決まり手（逃げ抜き）はそのまま行にする",
    pick(4, 90)["逃げ抜き"] === 1 && pick(4, 365)["逃げ抜き"] === 1,
    JSON.stringify(byVenue[4]),
  );
  check(
    "(a) 全24会場のキーがあり、レースの無い会場は行が無い（書き込みで古い行を消すだけ）",
    VENUE_CODES.every((v) => Array.isArray(byVenue[v])) &&
      byVenue[1].length === 0,
    Object.keys(byVenue).length,
  );
  const row = byVenue[18][0];
  check(
    "(a) 行の形: period_from・period_to・last_updated",
    row.period_from === "2026-07-08" &&
      row.period_to === "2026-10-05" &&
      row.last_updated === "2026-10-06",
    JSON.stringify(row),
  );
  const all = Object.values(byVenue).flat();
  check(
    "(a) 書いた行は保存後の検査（checkStoredRows）を通る",
    checkStoredRows(all, "2026-10-06").length === 0,
    checkStoredRows(all, "2026-10-06").join(" / "),
  );

  // 書き込み前の検査
  check(
    "(a) 期間に長期の表の日付が入るのに長期の表が0件なら失敗",
    validateSources({ today: "2026-10-06", archiveCount: 0, liveCount: 10 })
      .length === 1 &&
      validateSources({ today: "2026-10-06", archiveCount: 5, liveCount: 10 })
        .length === 0 &&
      validateSources({ today: "2026-12-04", archiveCount: 0, liveCount: 10 })
        .length === 0,
  );

  // 保存後の検査
  const stored = [
    {
      venue_code: 18,
      period_days: 90,
      race_count: 2,
      total_races: 3,
      last_updated: "2026-10-06",
    },
    {
      venue_code: 18,
      period_days: 90,
      race_count: 1,
      total_races: 3,
      last_updated: "2026-10-06",
    },
    {
      venue_code: 18,
      period_days: 365,
      race_count: 2,
      total_races: 2,
      last_updated: "2026-10-03",
    },
  ];
  const p = checkStoredRows(stored, "2026-10-06");
  check(
    "(a) 保存後の検査: 2日より古い行と、90日の総数が365日を超える会場を見つける",
    p.length === 2 &&
      p.some((x) => x.includes("2026-10-04 より古い行が 1件")) &&
      p.some((x) => x.includes("会場18")),
    p.join(" / "),
  );
  check(
    "(a) 保存後の検査: total_races が件数の合計と合わない組を見つける",
    checkStoredRows(
      [
        {
          venue_code: 1,
          period_days: 90,
          race_count: 2,
          total_races: 3,
          last_updated: "2026-10-06",
        },
      ],
      "2026-10-06",
    ).some((x) => x.includes("1:90")),
  );
  return failures;
}

async function checkProduction() {
  const { fetchAll } = await import("../lib/supabaseClient.js");
  const today = todayJST();
  const rows = await fetchAll(
    "venue_technique_period_stats",
    "venue_code, period_days, winning_technique, race_count, total_races, last_updated",
    (q) =>
      q.order("venue_code").order("period_days").order("winning_technique"),
  );
  const problems = checkStoredRows(rows, today);
  const missing = VENUE_CODES.flatMap((v) =>
    [90, 365]
      .filter(
        (d) => !rows.some((r) => r.venue_code === v && r.period_days === d),
      )
      .map((d) => `${v}:${d}`),
  );
  // 24会場は毎日どこかで開催するとは限らないが、365日に開催の無い会場は無い。90日は休場が続く会場がありうるので警告だけ
  const missing365 = missing.filter((k) => k.endsWith(":365"));
  if (missing365.length > 0)
    problems.push(`365日の行が無い会場: ${missing365.join(", ")}`);
  const missing90 = missing.filter((k) => k.endsWith(":90"));
  if (missing90.length > 0)
    console.warn(
      `⚠️ 90日の行が無い会場（休場が続いている可能性）: ${missing90.join(", ")}`,
    );
  if (problems.length === 0) {
    console.log(
      `✅ (b) 本番: venue_technique_period_stats ${rows.length}行。鮮度・総数・90日⊂365日に問題なし（${today}）`,
    );
    return 0;
  }
  for (const x of problems) console.error(`❌ (b) 本番: ${x}`);
  return problems.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failures = selfTest();
  if (process.env.VERIFY_PRODUCTION === "1")
    failures += await checkProduction();
  else
    console.log(
      "（本番の表は見ていない。VERIFY_PRODUCTION=1 で読む。nightly-verify-db.yml が毎晩実行する）",
    );
  if (failures > 0) {
    console.error(`\n${failures}件の失敗`);
    process.exit(1);
  }
  console.log("\n全ての検証に成功しました");
}
