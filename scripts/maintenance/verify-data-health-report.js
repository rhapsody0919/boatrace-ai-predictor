/**
 * verify-data-health-report.js - data-health-report.js の存在充足率の分母の定義（BOA-381）の検証。
 * DBには接続しない（fetchを差し替える）。
 *
 * 確認すること:
 *   (a) 全券種オッズ（trio・exacta・quinella・wide、5種すべて）は、取得開始日（2026-09-17）より前の日を
 *       分母から外し「対象外」と出す。trifecta_all は取得開始日による対象外を設けない。
 *       期間の全日が対象外なら、欠損（未達）にしない
 *   (b) rank4〜6は、完走艇数を確定できるレースは完走艇数まで順位が付いているかで判定し、確定できず
 *       rank4〜6に欠けがあるレースは「判定不能」として分母外に件数を別に出す（欠損に混ぜない）。
 *       判定不能を全て欠損とした場合の下限も出す
 *   (c) 閾値未達の一覧に、定義変更後の値・分母外の内訳が出る
 *   (d) 窓内取得率: 第1レースの発走60分前の「想定内の未公開」（後続の窓で公開が確認できたもの）を、閾値判定の分母から外し、
 *       件数と除外なしの値を別に出す。定義は監視（scripts/lib/scrapeJobs/monitor.js）と共有（BOA-386）
 *
 * SQL側の分類（艇別の着欄から完走艇数を確定し、確定・充足・判定不能に分ける）は、DBが無いと実行できない。
 * 生成したSQLが分類の主要な条件を含むことだけを確認し、値の突合は本番DBの読み取り専用クエリで行う
 * （BOA-381の完了報告に実測を添付）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildQueries,
  main as runHealthReport,
  summarizeCoverage,
  summarizeRankDetail,
  summarizeWindows,
} from "../analysis/data-health-report.js";
import { DETECTION_LAG } from "../lib/scrapeJobs/expectedUnpublished.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const near = (actual, expected) =>
  actual !== null && Math.abs(actual - expected) < 1e-9;

// 1日分のcoverageクエリの結果（DBが返す形。数値は文字列で来ることがあるため、一部は文字列にする）
function day(date, overrides = {}) {
  const denom = overrides.denom ?? 100;
  return {
    d: date,
    total: denom,
    excluded: 0,
    denom,
    result: denom,
    rank_denom: denom,
    rank4_6: denom,
    rank_determined: 0,
    rank_full: denom,
    rank_le3: 0,
    rank_no_result: 0,
    rank_undetermined: 0,
    rank_undetermined_absent_hint: 0,
    rank_polluted_confirmed: 0,
    rank_absent_suspect: 0,
    rank4_6_all_present: denom,
    actual_course: denom,
    winning_technique: denom,
    race_stage: denom,
    st_row: denom,
    st_value: denom,
    exhibition_row: denom,
    exhibition_time: denom,
    odds: denom,
    odds_all: 0,
    trifecta_all: denom,
    trio_all: 0,
    exacta_all: 0,
    quinella_all: 0,
    wide_all: 0,
    ...overrides,
  };
}

const find = (aggregate, key) => aggregate.find((m) => m.metric === key);
const full5 = {
  odds_all: 100,
  trio_all: 100,
  exacta_all: 100,
  quinella_all: 100,
  wide_all: 100,
};

// ---------------------------------------------------------------------------
// (a) 全券種オッズの取得開始日
// ---------------------------------------------------------------------------
{
  // 9/16まで（取得開始前）は4種が無く、9/17以降は全種そろっている
  const perDay = [
    day("2026-09-15"),
    day("2026-09-16", { odds_all: 30, trio_all: 30 }),
    day("2026-09-17", full5),
    day("2026-09-18", { ...full5, odds_all: 99, trio_all: 99 }),
  ];
  const aggregate = summarizeCoverage(perDay);
  const all = find(aggregate, "odds_all");
  check(
    "全券種オッズ(5種): 9/17より前を分母から外し、9/17以降だけで充足率を出す",
    all.denominator === 200 && all.numerator === 199 && near(all.rate, 0.995),
    JSON.stringify(all),
  );
  check(
    "全券種オッズ(5種): 分母から外した日数・レース数を「対象外」として出す",
    all.notApplicableDays === 2 &&
      all.notApplicableRaces === 200 &&
      all.since === "2026-09-17",
    JSON.stringify(all),
  );
  check(
    "全券種オッズ(5種): 取得開始前の日の欠落を、最低の日・未達の日に数えない",
    all.worstDay.date === "2026-09-18" && all.daysBelowThreshold === 0,
    JSON.stringify(all.worstDay),
  );
  for (const key of ["trio_all", "exacta_all", "quinella_all", "wide_all"]) {
    const m = find(aggregate, key);
    check(
      `${key}: 取得開始日（9/17）以降のみを分母にする`,
      m.denominator === 200 && m.notApplicableRaces === 200,
      JSON.stringify(m),
    );
  }
  const tri = find(aggregate, "trifecta_all");
  check(
    "trifecta_all: 取得開始日による対象外を設けない（全日を分母にする）",
    tri.denominator === 400 &&
      tri.notApplicableRaces === 0 &&
      tri.since === null,
    JSON.stringify(tri),
  );
  check(
    "取得開始日を持たない指標（結果・オッズ1件以上）の分母は、従来どおり全日",
    find(aggregate, "result").denominator === 400 &&
      find(aggregate, "odds").denominator === 400,
  );
}
{
  // 期間の全日が取得開始前: 対象が無いだけで、欠損（未達）にしない
  const perDay = [day("2026-09-10"), day("2026-09-11")];
  const all = find(summarizeCoverage(perDay), "odds_all");
  check(
    "全券種オッズ(5種): 期間の全日が取得開始前なら、充足率はnull・未達にしない",
    all.rate === null &&
      all.denominator === 0 &&
      all.belowThreshold === false &&
      all.notApplicableRaces === 200,
    JSON.stringify(all),
  );
  // 対象日にデータが無い（充足0）は、対象外とは区別して未達にする
  const missing = find(
    summarizeCoverage([day("2026-09-17", { odds_all: 0 })]),
    "odds_all",
  );
  check(
    "全券種オッズ(5種): 対象日に1件も無ければ、未達にする",
    missing.rate === 0 && missing.belowThreshold === true,
    JSON.stringify(missing),
  );
}

// ---------------------------------------------------------------------------
// (b) rank4〜6の分母
// ---------------------------------------------------------------------------
{
  // 2日分: 着欄で確定したレース・確定できないが充足のレース・判定不能・分母外の区分が混在
  const perDay = [
    day("2026-09-19", {
      denom: 100,
      rank_denom: 90,
      rank4_6: 90,
      rank_determined: 10,
      rank_full: 80,
      rank_le3: 2,
      rank_no_result: 0,
      rank_undetermined: 8,
      rank_undetermined_absent_hint: 3,
      rank_polluted_confirmed: 1,
      rank_absent_suspect: 4,
      rank4_6_all_present: 90,
    }),
    day("2026-09-20", {
      denom: 100,
      rank_denom: 95,
      rank4_6: 94,
      rank_determined: 5,
      rank_full: 90,
      rank_le3: 1,
      rank_no_result: 1,
      rank_undetermined: 3,
      rank_undetermined_absent_hint: 0,
      rank_polluted_confirmed: 0,
      rank_absent_suspect: 0,
      rank4_6_all_present: 94,
    }),
  ];
  const rank = find(summarizeCoverage(perDay), "rank4_6");
  check(
    "rank4〜6: 分母は、判定できたレース（確定＋確定できないが充足）で、中止除外後の全レースではない",
    rank.denominator === 185 && rank.numerator === 184,
    JSON.stringify(rank),
  );
  check(
    "rank4〜6: 日別の最低の日は、その日の分母で計算する",
    rank.worstDay.date === "2026-09-20" && near(rank.worstDay.rate, 94 / 95),
    JSON.stringify(rank.worstDay),
  );
  const detail = summarizeRankDetail(perDay);
  check(
    "rank4〜6の内訳: 判定不能・完走3艇以下・結果なしを、分母外の件数として別に出す",
    detail.undeterminedRaces === 11 &&
      detail.finishersAtMost3Races === 3 &&
      detail.noResultRaces === 1 &&
      detail.undeterminedAbsentHintRaces === 3 &&
      detail.determinedRaces === 15 &&
      detail.fullRaces === 170,
    JSON.stringify(detail),
  );
  check(
    "rank4〜6の内訳: 判定不能を全て欠損とした場合の下限を出す",
    near(detail.lowerBoundRate, 184 / (185 + 11)),
    String(detail.lowerBoundRate),
  );
  check(
    "rank4〜6の内訳: 変更前の定義（全レースを分母にrank4・5・6がすべてある）を比較用に出す",
    detail.legacyDefinition.numerator === 184 &&
      detail.legacyDefinition.denominator === 200 &&
      near(detail.legacyDefinition.rate, 0.92),
    JSON.stringify(detail.legacyDefinition),
  );
  check(
    "rank4〜6の内訳: 非完走艇が順位に入っているレース（確定・疑い）を参考として出す（BOA-362）",
    detail.pollutedConfirmedRaces === 1 && detail.absentSuspectRaces === 4,
    JSON.stringify(detail),
  );
}
{
  // データが無い（対象レース0件）でも失敗しない
  const detail = summarizeRankDetail([]);
  check(
    "rank4〜6の内訳: 対象レースが0件でも、充足率・下限はnull（0除算にしない）",
    detail.lowerBoundRate === null && detail.denominator === 0,
    JSON.stringify(detail),
  );
}

// ---------------------------------------------------------------------------
// SQLの主要な条件（分類の要点が落ちていないこと）
// ---------------------------------------------------------------------------
{
  const sql = buildQueries({
    coverageStart: "2026-09-07",
    windowStart: "2026-09-14",
    endDate: "2026-09-20",
  }).coverage;
  check(
    "coverageのSQL: 艇別の着欄が6艇分そろったレースだけ、完走艇数を確定する",
    /n_rows = 6 and f\.n_mark = 6/.test(sql) &&
      /count\(x\.finish_rank\) as n_fin/.test(sql) &&
      sql.includes("race_start_timings"),
  );
  check(
    "coverageのSQL: 完走艇数まで順位が付いているかで判定する（rank5は完走5艇以上、rank6は6艇）",
    /n_fin < 5 or rank5 is not null/.test(sql) &&
      /n_fin < 6 or rank6 is not null/.test(sql),
  );
  check(
    "coverageのSQL: 着欄を確定できず欠けがあるレースは、判定不能（rank_class = 'undetermined'）にする",
    /else 'undetermined'/.test(sql) &&
      /when rank1 is null then 'no_result'/.test(sql),
  );
}

// ---------------------------------------------------------------------------
// (c) 閾値未達の一覧・Markdown（レポート全体をmainで実行）
// ---------------------------------------------------------------------------
async function runReport(coverageRows, windowRows = [], detectionLagRows = []) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-report-"));
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const env = {
    SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
  };
  const output = [];
  process.env.SUPABASE_ACCESS_TOKEN = "dummy-token";
  process.env.SUPABASE_URL = "https://dummyref.supabase.co";
  globalThis.fetch = async (url, init) => {
    const { query } = JSON.parse(init.body);
    let rows = [];
    if (query.includes("information_schema")) rows = [];
    else if (query.includes("pg_database_size")) rows = [{ bytes: "1000" }];
    else if (query.includes("with o as")) rows = coverageRows;
    else if (query.includes("window_closed_at")) rows = detectionLagRows;
    else if (query.includes("first_race_in_window")) rows = windowRows;
    return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
  };
  console.log = (...args) => output.push(args.join(" "));
  console.error = () => {};
  try {
    await runHealthReport([
      "--end-date",
      "2026-09-20",
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
  return { markdown: output.join("\n"), json };
}

{
  const rows = [
    // 取得開始前の日: 全券種は無いが、対象外なので未達にならない
    day("2026-09-16", { odds_all: 0, trio_all: 0 }),
    // 取得開始日以降: 判定不能が多く、下限が閾値を割る
    day("2026-09-17", {
      ...full5,
      rank_denom: 90,
      rank4_6: 90,
      rank_determined: 10,
      rank_full: 80,
      rank_undetermined: 10,
      rank_undetermined_absent_hint: 4,
      rank4_6_all_present: 90,
    }),
  ];
  const { markdown, json } = await runReport(rows);
  const items = json.alerts.map((a) => a.item);
  check(
    "閾値未達の一覧: 全券種オッズは、取得開始前の日を含めても未達にならない",
    !items.some((i) => i.includes("全券種オッズ") || i.includes("trio_all")),
    items.join(" / "),
  );
  const undetermined = json.alerts.find((a) => a.kind === "rank_undetermined");
  check(
    "閾値未達の一覧: 判定不能を全て欠損とした場合の下限（定義変更後の値）と件数が出る",
    undetermined !== undefined &&
      near(undetermined.value, 190 / 200) &&
      undetermined.detail.includes("判定不能 10レース"),
    JSON.stringify(undetermined),
  );
  check(
    "Markdown: 対象外（取得開始前）・判定不能・下限・変更前の定義が、項目名つきで出る",
    markdown.includes("対象外(取得開始前)") &&
      markdown.includes("着順4位以降(完走艇数まで)") &&
      markdown.includes("判定不能（着欄は未確定・rank4〜6に欠けあり）") &&
      markdown.includes("判定不能を全て欠損とみなした場合の下限: 95.0%") &&
      markdown.includes("変更前の定義"),
  );
  check(
    "JSON: 全券種オッズの取得開始日と、指標ごとの分母の定義を残す",
    json.params.oddsFullGridSince === "2026-09-17" &&
      json.params.metricDenominators.rank4_6.includes("判定不能") &&
      json.coverage.rankDetail.undeterminedRaces === 10,
  );
}
{
  // DBが空でも（coverage 0行）、レポートは失敗しない
  const { json } = await runReport([]);
  check(
    "coverageが0行でも、レポートは失敗せず、rank4〜6は未達（分母0）として出る",
    json.coverage.aggregate.some((m) => m.metric === "rank4_6") &&
      json.alerts.some((a) => a.item.includes("着順4位以降")),
  );
}

// ---------------------------------------------------------------------------
// (d) 窓内取得率: 想定内の未公開（第1レースの発走60分前のオッズ。BOA-386）
// ---------------------------------------------------------------------------
{
  const sql = buildQueries({
    coverageStart: "2026-09-07",
    windowStart: "2026-09-14",
    endDate: "2026-09-20",
  }).windows;
  check(
    "windowsのSQL: 第1レースは、その会場・日の races の最小のレース番号（race_id の末尾に依存しない）",
    /not exists \(select 1 from races fr where fr\.race_date = r\.race_date and fr\.venue_code = r\.venue_code and fr\.race_number < r\.race_number\)/.test(
      sql,
    ) && !/right\(r\.race_id/.test(sql),
  );
  check(
    "windowsのSQL: 想定内の未公開 = 第1レースの60分前の窓が窓内に取れておらず、後続の窓（30・15・10・5・0分前）のどれかに取れている",
    /w\.m = 60 and b\.is_first and not c\.hit and c\.later_hit/.test(sql) &&
      [30, 15, 10, 5, 0].every((m) =>
        sql.includes(
          `o2.captured_at between b.dl - make_interval(mins => ${m + 3})`,
        ),
      ),
  );

  const row = (m, over = {}) => ({
    d: "2026-09-19",
    m,
    races: "100",
    in_window: "100",
    races_clean: "100",
    in_window_clean: "100",
    first_race: "0",
    first_race_in_window: "0",
    structural: "0",
    ...over,
  });
  // 60分前: 100レース中97が窓内。第1レース10件のうち7が窓内、3が未公開で、うち2が後続の窓で公開が確認できた（1は取れていない）
  const w60 = summarizeWindows([
    row(60, {
      in_window: "97",
      first_race: "10",
      first_race_in_window: "7",
      structural: "2",
    }),
    row(30),
  ]).find((x) => x.minutesBefore === 60);
  check(
    "summarizeWindows: 想定内の未公開を分母から外した値（97/98）と、除外した件数・除外なしの値（97/100）を別に持つ",
    w60.structural === 2 &&
      w60.racesAdjusted === 98 &&
      near(w60.rateAdjusted, 97 / 98) &&
      near(w60.rate, 0.97) &&
      w60.firstRace === 10 &&
      w60.firstRaceInWindow === 7,
    JSON.stringify(w60),
  );
  check(
    "閾値判定（belowThreshold）は、想定内の未公開を外した値で行う（除外なし97%は未達だが、97/98=98.98%は達成）",
    w60.belowThreshold === false,
  );
  const w60none = summarizeWindows([
    row(60, { in_window: "97", first_race: "10", first_race_in_window: "7" }),
  ]).find((x) => x.minutesBefore === 60);
  check(
    "想定内の未公開が0件なら、除外なしの値で判定する（97/100は未達）。後続の窓にも取れていない第1レース（structuralに入らない）は、分母から外さない",
    w60none.belowThreshold === true &&
      w60none.structural === 0 &&
      w60none.racesAdjusted === 100,
  );
  const legacy = summarizeWindows([
    {
      d: "2026-09-19",
      m: 60,
      races: "100",
      in_window: "99",
      races_clean: "100",
      in_window_clean: "99",
    },
  ]).find((x) => x.minutesBefore === 60);
  check(
    "この列が無い行（古い --cache-file）でも、structural は0で、率は NaN にならない",
    legacy.structural === 0 && near(legacy.rateAdjusted, 0.99),
    JSON.stringify(legacy),
  );

  // レポート全体: 未達の一覧は除外後の値で出し、件数と除外なしの値を併記する。Markdown・JSONに定義と件数が出る
  const { markdown, json } = await runReport(
    [day("2026-09-19", { ...full5 })],
    [
      row(60, {
        in_window: "90",
        first_race: "10",
        first_race_in_window: "6",
        structural: "4",
      }),
      ...[30, 15, 10, 5, 0].map((m) => row(m)),
    ],
  );
  const winAlert = json.alerts.find((a) => a.item === "窓内取得率 60分前");
  check(
    "レポート: 60分前の未達は、除外後の値（90/96）で判定・表示し、除外した件数と除外なしの値（90/100）を併記する",
    winAlert !== undefined &&
      near(winAlert.value, 90 / 96) &&
      /90\/96/.test(winAlert.detail) &&
      /想定内の未公開 4件/.test(winAlert.detail) &&
      /90\/100/.test(winAlert.detail),
    JSON.stringify(winAlert),
  );
  check(
    "Markdown: 想定内の未公開の件数（別列）と、第1レースの60分前の窓の日別の内訳が出る",
    markdown.includes("全体(想定内の未公開を除外)") &&
      markdown.includes("第1レースの60分前の窓") &&
      /\| 2026-09-19\(土\) \| 10 \| 6 \| 60\.0% \| 4 \| 0 \|/.test(markdown),
    markdown
      .split("\n")
      .filter((l) => l.includes("第1レース") || l.includes("2026-09-19"))
      .join(" | "),
  );
  check(
    "JSON: 想定内の未公開の分母の定義と、集計の件数を残す",
    /第1レース/.test(
      json.params.metricDenominators.windowExpectedUnpublished,
    ) &&
      json.windows.aggregate.find((x) => x.minutesBefore === 60).structural ===
        4,
  );
}

// ---------------------------------------------------------------------------
// (e) 発売開始の検知の遅れ（想定内の未公開のレースだけ。近似値。BOA-386続き・完了の定義Bの見直し）
// ---------------------------------------------------------------------------
{
  const sql = buildQueries({
    coverageStart: "2026-09-07",
    windowStart: "2026-09-14",
    endDate: "2026-09-20",
  }).detectionLag;
  check(
    "detectionLagのSQL: 対象は、-60の窓（60分前±3分）に取れておらず（想定内の未公開）、後続の窓（30・15・10・5・0分前）のどれかに取れているレース",
    /confirmed_at/.test(sql) &&
      /window_closed_at/.test(sql) &&
      [30, 15, 10, 5, 0].every((m) =>
        sql.includes(
          `o2.captured_at between b.dl - make_interval(mins => ${m + 3})`,
        ),
      ),
  );
  check(
    "detectionLagのSQL: 5分以内の割合・p50・p95・最大・計測不能を集計する（基準は expectedUnpublished.js の DETECTION_LAG と同じ）",
    sql.includes(`<= ${DETECTION_LAG.thresholdMin}`) &&
      /percentile_cont\(0\.5\)/.test(sql) &&
      /percentile_cont\(0\.95\)/.test(sql) &&
      /count\(\*\) filter \(where confirmed_at is null\) as unmeasured/.test(
        sql,
      ),
  );

  const lagRow = (over = {}) => ({
    total: "10",
    measured: "8",
    unmeasured: "2",
    within_threshold: "3",
    p50_min: "6.2",
    p95_min: "20.5",
    max_min: "25.0",
    ...over,
  });
  const { markdown, json } = await runReport(
    [day("2026-09-19", { ...full5 })],
    [],
    [lagRow()],
  );
  check(
    "JSON: 発売開始の検知の遅れ（対象・計測可能・5分以内の件数・割合・p50/p95/最大・計測不能）を残す",
    json.detectionLag.total === 10 &&
      json.detectionLag.measured === 8 &&
      json.detectionLag.unmeasured === 2 &&
      json.detectionLag.within === 3 &&
      json.detectionLag.over === 5 &&
      near(json.detectionLag.rate, 3 / 8) &&
      json.detectionLag.p50Min === 6.2 &&
      json.detectionLag.p95Min === 20.5 &&
      json.detectionLag.maxMin === 25.0,
    JSON.stringify(json.detectionLag),
  );
  check(
    "検知の遅れが基準未満（3/8=37.5% < 98%）なら未達として警告に出す",
    json.detectionLag.belowThreshold === true &&
      json.alerts.some(
        (a) =>
          a.kind === "detection_lag" &&
          a.item === "発売開始の検知の遅れ" &&
          /5分以内 3\/8/.test(a.detail),
      ),
    JSON.stringify(json.alerts.filter((a) => a.kind === "detection_lag")),
  );
  check(
    "Markdown: 発売開始の検知の遅れの見出し・件数・割合が出る",
    (markdown.includes("発売開始の検知の遅れ") &&
      /3.*8.*37\.5%/.test(markdown.replace(/\s+/g, " "))) ||
      markdown.includes("37.5%"),
    markdown
      .split("\n")
      .filter((l) => l.includes("検知の遅れ") || l.includes("37.5"))
      .join(" | "),
  );

  const { json: zeroJson } = await runReport(
    [day("2026-09-19", { ...full5 })],
    [],
    [],
  );
  check(
    "検知の遅れの対象が0件（DBが空行を返す）なら、報告は失敗せず null になる（未達として誤警告しない）",
    zeroJson.detectionLag === null &&
      !zeroJson.alerts.some((a) => a.kind === "detection_lag"),
    JSON.stringify(zeroJson.detectionLag),
  );
  const { json: highJson } = await runReport(
    [day("2026-09-19", { ...full5 })],
    [],
    [
      lagRow({
        total: "10",
        measured: "10",
        unmeasured: "0",
        within_threshold: "10",
      }),
    ],
  );
  check(
    "検知の遅れが基準以上（10/10=100%）なら警告に出さない",
    !highJson.alerts.some((a) => a.kind === "detection_lag"),
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
