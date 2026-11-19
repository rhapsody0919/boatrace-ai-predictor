/**
 * verify-data-health-report.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-data-health-report.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { buildQueries, summarizeWindows, summarizeDetectionLagRow } from "../../analysis/data-health-report.js";
import {
  DETECTION_LAG,
  summarizeDetectionLags,
  classifyExpectedUnpublished,
} from "../../lib/scrapeJobs/expectedUnpublished.js";
import { evaluateDetectionLag } from "../../lib/scrapeJobs/monitor.js";

let check, near, day, full5, runReport;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
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
  return { row, legacy };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ row, legacy }) {
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

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene3() {
  const sql = buildQueries({
    coverageStart: "2026-09-07",
    windowStart: "2026-09-14",
    endDate: "2026-09-20",
  }).detectionLag;
  check(
    "detectionLagのSQL: odds・対象期間・-60と後続5窓、racesの判定用列を返し、旧近似を使わない",
    /from scrape_slots s/.test(sql) && /s.job = 'odds'/.test(sql) &&
      sql.includes("s.race_date between '2026-09-14' and '2026-09-20'") &&
      sql.includes("s.offset_min in (-60,-30,-15,-10,-5,0)") &&
      /r.start_time/.test(sql) && /r.cancellation_status/.test(sql) &&
      /as races/.test(sql) && !/window_closed_at/.test(sql),
  );
  const lagAt = (w) => summarizeDetectionLagRow({ total: 50, measured: 50, unmeasured: 0, within_threshold: w }).belowThreshold, edge = Math.round(DETECTION_LAG.rate * 50);
  check("閾値は共通のDETECTION_LAGから読む（割合がちょうど rate なら未達でなく、1件少ないと未達）", edge / 50 === DETECTION_LAG.rate && !lagAt(edge) && lagAt(edge - 1) && !lagAt(50));
  const slot = (over = {}) => ({
    job: "odds", race_id: "test", race_date: "2026-09-19", offset_min: -60,
    status: "done", outcome: "ok", run_mode: "live", attempts: 11,
    first_attempt_at: "2026-09-19T02:00:00Z",
    last_attempt_at: "2026-09-19T02:10:00Z", done_at: "2026-09-19T02:10:00Z",
    races: { start_time: "12:00:00", cancellation_status: null }, ...over,
  });
  const extension = slot();
  const expired = slot({ status: "expired", outcome: "no_values", attempts: 1,
    last_attempt_at: "2026-09-19T02:20:00Z", done_at: null });
  const later = slot({ offset_min: -30, attempts: 1,
    first_attempt_at: "2026-09-19T02:30:00Z",
    last_attempt_at: "2026-09-19T02:30:00Z", done_at: "2026-09-19T02:30:00Z" });
  return { slot, extension, expired, later };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene4({ slot, extension, expired, later }) {
  for (const [label, slots, expected] of [
    ["延長1分", [extension], 1], ["後続窓10分・初回成功", [expired, later], 10],
  ]) {
    const summary = summarizeDetectionLags(slots, classifyExpectedUnpublished(slots, { siblingSlots: slots }), slots);
    const { json, markdown } = await runReport([day("2026-09-19", full5)], [], slots);
    check(`${label}: レポートと監視の計測・判定が一致`,
      json.detectionLag?.maxMin === expected && json.detectionLag.measured === 1 &&
      json.detectionLag.belowThreshold === (evaluateDetectionLag(summary, "2026-09-19").length > 0) &&
      json.alerts.some((a) => a.kind === "detection_lag") === (expected > DETECTION_LAG.thresholdMin));
    check(`${label}: 注記は監視と同じ定義`, markdown.includes("監視と同じ定義") && !markdown.includes("窓が閉じた時刻を起点"));
  }
  const excluded = [
    slot({ race_id: "shadow", run_mode: "shadow" }),
    slot({ race_id: "cancelled", races: { start_time: "12:00:00", cancellation_status: "confirmed" } }),
    slot({ race_id: "deferred", status: "expired", outcome: "no_values" }),
    slot({ race_id: "deferred", offset_min: -30, status: "pending", outcome: null }),
  ];
  const missing = slot({ race_id: "missing", last_attempt_at: null });
  const mixedSlots = [1, 2, 3, 6.2, 7, 8, 20.5, 25].map((lag, i) => slot({
    race_id: `mixed-${i}`, attempts: 2,
    last_attempt_at: new Date(Date.parse(extension.first_attempt_at) + lag * 60000).toISOString(),
  }));
  const { json: mixed, markdown } = await runReport([day("2026-09-19", full5)], [],
    [...mixedSlots, missing, { ...missing, race_id: "missing-2" }, ...excluded]);
  check("実スロット: 除外・計測不能・3/8の未達と分位点を反映", mixed.detectionLag.total === 10 &&
    mixed.detectionLag.measured === 8 && mixed.detectionLag.unmeasured === 2 &&
    mixed.detectionLag.within === 3 && mixed.detectionLag.p50Min === 6.2 &&
    mixed.detectionLag.p95Min === 25 && mixed.detectionLag.maxMin === 25 &&
    mixed.detectionLag.belowThreshold && mixed.alerts.some((a) => a.kind === "detection_lag" && /5分以内 3\/8/.test(a.detail)));
  check("Markdown: 件数・割合を表示", markdown.includes("37.5%"));
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
  const json = { detectionLag: summarizeDetectionLagRow(lagRow()) };
  return { slot, json };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene5({ slot, json }) {
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
  check("集計行: 3/8は98%未満", json.detectionLag.belowThreshold === true);
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
    Array.from({ length: 10 }, (_, i) => slot({ race_id: `success-${i}` })),
  );
  check(
    "検知の遅れが基準以上（10/10=100%）なら警告に出さない",
    !highJson.alerts.some((a) => a.kind === "detection_lag"),
  );
}

async function scene6() {
  {
    const s1 = scene1();
    await scene2(s1);
  }
  {
    const s1 = scene3();
    const s2 = await scene4(s1);
    await scene5(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・near・day・full5・runReport） */
export async function runDataHealthReportScenes1(env) {
  ({ check, near, day, full5, runReport } = env);
  await scene6();
}
