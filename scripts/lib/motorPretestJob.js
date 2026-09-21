/**
 * 前検タイム・節時点のモーター/ボート2連対率（N23、motor_pretest_stats）の共通ラッパ向けハンドラー（tasks.md T4b-20）。
 * api/cron/motor-pretest.js が createScrapeCronHandler の run に渡す。
 *
 * 方式: 日次のスナップショット（レジストリ motor_pretest、kind: daily）。その日の開催会場（races）ごとに、公式の
 * race/rankingmotor?jcd&hd を1ページ取得し、節の全選手（約45人）の前検タイム・前検順位・モーター/ボートの番号と2連対率を、
 * (日付, 会場, 選手) の行として保存する。「節初日の検出」は race_series に依存するため行わない（前検タイムは節の間は変わらず、
 * 2連対率は日々変わる。毎日1ページ×開催会場数（約13）で、負荷は小さい）。
 *
 * 実行時刻: JST 05:30・06:00・06:30（vercel.json の cron）。根拠（docs/design/scraping-vercel-consolidation/
 * verification-runbook.md T-1）:
 *   - 前検は節の初日の前日（午後）に行われ、公式のページは、その日の夕方には全選手の前検タイムが揃っている
 *     （2026-09-21 17:38 JSTに、翌日が初日の3会場のページで、全選手の前検タイムを実測）
 *   - 07:00〜23:59 JST は、オッズの取得の運用窓（取り直せないデータ。boatrace.jp の共有ブレーカーの損失が非対称）。
 *     この窓の外（朝の07:00前）に限定する
 *   - 朝の時点の値は、その日のレースの出走表（race_entries.motor_2rate）と同じ「その日の朝時点」で揃う
 *     （夜に取ると、その日の結果を含む値になり、レース前の特徴量には使えない）
 *   - 対象の会場は races（朝の初期化 races_init が05:00に作る）から決める。races_init が live で、その日の分がまだ
 *     完了していないときは、取得せず incomplete（次の起動が続きを処理する）
 *
 * モード（scrape_job_state.mode の job='motor_pretest'。DBの更新のみで切り替える）:
 *   off（または行なし）  何もしない
 *   shadow              取得・解析のみ（motor_pretest_stats へ書かない）。last_report に会場ごとの件数・期待に対する充足を記録する
 *   live                書き込む（変更のある行だけ。マイグレーション090が未適用なら、成功にせず失敗にする）
 */
import { runVenueDailyJob } from "./scrapeJobs/venueDailyJob.js";
import {
  previouslySettledVenues,
  reasonFromError,
} from "./scrapeJobs/venueJobSupport.js";
import {
  MOTOR_PRETEST_STATUSES,
  buildMotorPretestUrl,
  parseMotorPretestHtml,
} from "./motorPretestParser.js";
import {
  buildMotorPretestRows,
  loadExpectedRacers,
  summarizeVenueCoverage,
  writeMotorPretestRows,
} from "./motorPretestRows.js";
import { VENUE_NAMES } from "./supabaseClient.js";

/** 会場（1ページ、約8〜10秒）の同時取得数。開催中の約13会場を約40秒で終える（B2 得点率と同じ並列度） */
export const MOTOR_PRETEST_CONCURRENCY = 3;

/** 構造変化の疑いとして通知する、連続失敗の日数（取得のたびに全会場が同じ形のため、B3・B4（14日）より短い） */
export const MOTOR_PRETEST_DRIFT_ALERT_DAYS = 2;

/** 前検タイムの非NULL率がこれを下回ったら通知する（母数がこの件数以上のとき） */
export const PRETEST_FILL_RATE_THRESHOLD = 0.95;
export const PRETEST_FILL_MIN_ROWS = 20;

/** 期待した選手がページに載っていない会場・前検タイムの欠落の通知は、1回きり（この分数だけ、last_report に残す） */
const ONE_SHOT_ALERT_MINUTES = 30;

/** 構造起因の理由（待っても直らない）。一時的な失敗（http_5xx・timeout 等）は、補足の起動が再取得する */
const STRUCTURAL_REASON_RE = /^(parse_anomaly:|no_data_page$|page_mismatch$)/;

const venueName = (code) => VENUE_NAMES[code] ?? `会場コード${code}`;

/**
 * 1会場・1日分の取得と解析（DBへは書かない）。例外は理由コードにして返す（runVenueDailyJob は、例外を、実行全体の失敗にするため）。
 *
 * @returns {Promise<{rows: Array<Object>, reason: string|null, parsed?: Object}>}
 */
export async function fetchMotorPretest(venueCode, date, politeFetch) {
  const url = buildMotorPretestUrl(venueCode, date);
  let response;
  try {
    response = await politeFetch(url);
  } catch (error) {
    return { rows: [], reason: reasonFromError(error) };
  }
  if (!response.ok) return { rows: [], reason: `http_${response.status}` };
  let parsed;
  try {
    parsed = parseMotorPretestHtml(await response.text());
  } catch (error) {
    return { rows: [], reason: reasonFromError(error) };
  }
  if (parsed.status === MOTOR_PRETEST_STATUSES.noData) {
    // 開催のある会場・日で「データがありません」は、想定外（races にレースがあるため）
    return { rows: [], reason: "no_data_page", parsed };
  }
  if (parsed.status !== MOTOR_PRETEST_STATUSES.ok) {
    return {
      rows: [],
      reason: `parse_anomaly:${parsed.anomalies.slice(0, 3).join("|")}`,
      parsed,
    };
  }
  // ページが、要求した会場・日付のものであることを確かめる（別のページを、この会場の値として保存しない）
  if (
    (parsed.venueCode !== null && parsed.venueCode !== venueCode) ||
    (parsed.date !== null && parsed.date !== date)
  ) {
    return { rows: [], reason: "page_mismatch", parsed };
  }
  return {
    rows: buildMotorPretestRows({ venueCode, date, parsed }),
    reason: null,
    parsed,
  };
}

/** 履歴から、構造変化の疑い（構造起因の理由が連続している会場）を、monitor の通知の形にする */
export function findMotorPretestDriftAlerts(health) {
  return Object.entries(health)
    .filter(
      ([, entry]) =>
        entry.consecutiveFailDays >= MOTOR_PRETEST_DRIFT_ALERT_DAYS &&
        STRUCTURAL_REASON_RE.test(entry.lastReason ?? ""),
    )
    .map(([code, entry]) => ({
      key: `drift:${code}`,
      text: `前検タイム（rankingmotor）の取得が${entry.consecutiveFailDays}日連続で失敗しています（構造変化の疑い） ${venueName(Number(code))}: ${entry.lastReason}`,
    }));
}

/**
 * 期待の選手・前検タイムの充足から、1回きりの通知を作る（純関数）。
 *
 * @param {string} date
 * @param {Array<{venueCode: number, expected: number, missing: number[], pageRows: number, pretestFilled: number}>} coverage 取得できた会場の集計
 * @param {Date} now
 */
export function buildCoverageAlerts(date, coverage, now) {
  const until = new Date(now.getTime() + ONE_SHOT_ALERT_MINUTES * 60 * 1000);
  const alerts = [];
  const lacking = coverage.filter((c) => c.missing.length > 0);
  if (lacking.length > 0) {
    const detail = lacking
      .slice(0, 5)
      .map(
        (c) =>
          `${venueName(c.venueCode)}${c.missing.length}人（${c.missing.slice(0, 3).join("・")}${c.missing.length > 3 ? "…" : ""}）`,
      )
      .join(" / ");
    alerts.push({
      key: `coverage:${date}`,
      text: `前検タイムのページに、出走する選手が載っていない会場があります（${date}、${lacking.length}会場）: ${detail}`,
      until: until.toISOString(),
    });
  }
  const rows = coverage.reduce((n, c) => n + c.pageRows, 0);
  const filled = coverage.reduce((n, c) => n + c.pretestFilled, 0);
  if (
    rows >= PRETEST_FILL_MIN_ROWS &&
    filled / rows < PRETEST_FILL_RATE_THRESHOLD
  ) {
    alerts.push({
      key: `pretest_fill:${date}`,
      text: `前検タイムが入っている選手の割合が閾値未満です（${date}）: ${(
        (filled / rows) *
        100
      ).toFixed(
        1,
      )}%（${filled}/${rows}、閾値${PRETEST_FILL_RATE_THRESHOLD * 100}%）`,
      until: until.toISOString(),
    });
  }
  return alerts;
}

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx。targetDate は日次ジョブで解決済み）
 * @param {Object} [deps] テスト用の差し替え
 */
export async function runMotorPretestJob(
  ctx,
  {
    load = loadExpectedRacers,
    fetchVenue = fetchMotorPretest,
    write = writeMotorPretestRows,
    concurrency = MOTOR_PRETEST_CONCURRENCY,
  } = {},
) {
  const date = ctx.targetDate;
  if (!date)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");
  const previousReport = ctx.state?.last_report ?? null;

  // 早期に終わる場合も、last_report の health・settledVenues を引き継ぐ（共通ラッパは、report を丸ごと置き換える）
  const carry = (extra) => ({
    date,
    mode: ctx.mode,
    health: structuredClone(previousReport?.health ?? {}),
    settledVenues: [...previouslySettledVenues(previousReport, date, ctx.mode)],
    alerts: [],
    ...extra,
  });

  // 朝の初期化（races_init）が live のとき、その日の分が完了する前は、対象の会場が揃っていない
  const initState = await ctx.client
    .from("scrape_job_state")
    .select("mode, last_target_date")
    .eq("job", "races_init")
    .maybeSingle();
  if (initState.error) {
    throw new Error(
      `前検タイム: races_init の状態の取得に失敗しました: ${initState.error.message}`,
    );
  }
  if (
    initState.data?.mode === "live" &&
    initState.data.last_target_date !== date
  ) {
    return {
      rowsWritten: 0,
      incomplete: true,
      report: carry({ waiting: "races_init" }),
      body: { waiting: "races_init" },
    };
  }

  const expected = await load(ctx.client, date);
  if (expected.venues.length === 0) {
    // races が無い（朝の初期化の前。休催日は、日次の未処理として、監視が知らせる）
    return {
      rowsWritten: 0,
      incomplete: true,
      report: carry({ waiting: "races" }),
      body: { waiting: "races" },
    };
  }

  /** @type {Map<number, ReturnType<typeof summarizeVenueCoverage>>} */
  const coverageByVenue = new Map();
  const result = await runVenueDailyJob(ctx, {
    venues: expected.venues.map((v) => ({
      venueCode: v.venueCode,
      name: venueName(v.venueCode),
    })),
    scrapeVenue: async (venue) => {
      const { rows, reason } = await fetchVenue(
        venue.venueCode,
        date,
        ctx.politeFetch,
      );
      if (reason === null) {
        coverageByVenue.set(
          venue.venueCode,
          summarizeVenueCoverage(
            rows,
            expected.expectedByVenue.get(venue.venueCode) ?? new Set(),
          ),
        );
      }
      return { rows, reason };
    },
    writeRows: (rows) => write(ctx.client, rows),
    // 通知は、下で作る（会場公式サイト向けの文言・閾値と分ける）
    findDriftAlerts: () => [],
    nameByCode: {},
    concurrency,
  });

  // 同じ日の補足の起動は、書き込み済みの会場を再取得しない。その会場の集計は、前回の last_report から引き継ぐ
  const settled = new Set(result.report.settledVenues);
  const sameDayLive =
    previousReport?.date === date && previousReport?.mode === ctx.mode;
  const carried = (sameDayLive ? (previousReport.coverage ?? []) : [])
    .filter(
      (c) => settled.has(c.venueCode) && !coverageByVenue.has(c.venueCode),
    )
    .map((c) => ({ ...c, pageRows: c.pageRows ?? 0 }));
  const coverage = [
    ...carried,
    ...[...coverageByVenue.entries()].map(([venueCode, c]) => ({
      venueCode,
      ...c,
    })),
  ].sort((a, b) => a.venueCode - b.venueCode);
  const expectedRacers = coverage.reduce((n, c) => n + c.expected, 0);
  const expectedPresent = coverage.reduce(
    (n, c) => n + (c.expected - c.missing.length),
    0,
  );
  const alerts = [
    ...findMotorPretestDriftAlerts(result.report.health),
    ...buildCoverageAlerts(date, coverage, ctx.now()),
  ];
  const summary = {
    venuesInRaces: expected.venues.length,
    racesInDb: expected.raceCount,
    excludedCancelledRaces: expected.excludedCancelledRaces,
    expectedRacers,
    expectedRacersOnPage: expectedPresent,
    pageRows: coverage.reduce((n, c) => n + c.pageRows, 0),
    pretestFilled: coverage.reduce((n, c) => n + c.pretestFilled, 0),
  };
  return {
    ...result,
    report: {
      ...result.report,
      alerts,
      summary,
      coverage: coverage.map((c) => ({
        venueCode: c.venueCode,
        pageRows: c.pageRows,
        expected: c.expected,
        // 通知の判定に使うため、人数分を残す（1会場で数人。上限は念のため）
        missing: c.missing.slice(0, 30),
        pretestFilled: c.pretestFilled,
      })),
    },
    body: { ...result.body, ...summary, alerts: alerts.length },
  };
}
