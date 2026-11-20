/**
 * verify-data-health-job.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-data-health-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { COUNT_CHECKS, EMPTY_TABLE_POLICIES } from "../../lib/dataHealth/checks.js";
import { renderInlineSql, functionByName, DATA_HEALTH_FUNCTIONS } from "../../lib/dataHealth/functions.js";
import { buildQueries } from "../../analysis/data-health-report.js";
import { buildCoverageSql, literalCoverageSlots } from "../../lib/dataHealth/coverageSpec.js";
import { SCRAPE_JOBS, validateRegistry } from "../../lib/scrapeJobs/registry.js";
import { evaluateDataHealthLiveness } from "../check-scrape-monitor-liveness.js";
import { show } from "./data-health-job-fixtures.js";

let printErr, check, MIGRATION_FILES, LIVENESS_WF, LIVENESS_SCRIPT, VERCEL_JSON_TEXT, CRON_SRC, MORNING_CRON_SRC, JOB_SRC;

export const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, "");

// ---------------------------------------------------------------------------
// (c) DB関数の意味論（PGlite）
// ---------------------------------------------------------------------------
export let PGlite;

function scene1() {
  check(
    "登録表: 完了の定義の項目（結果・実進入・決まり手・レース種別・ST・展示・オッズ・全券種・出走表の拡張列・節・期別成績・ピットレポート）が揃う",
    [
      "coverage.result",
      "coverage.rank4_6",
      "coverage.actual_course",
      "coverage.winning_technique",
      "coverage.race_stage",
      "coverage.st_row",
      "coverage.exhibition_time",
      "coverage.odds",
      "coverage.odds_all",
      "pre_race.weight_kg",
      "pre_race.f_count",
      "pre_race.l_count",
      "race_series.covered",
      "racer_period_stats.covered",
      "pit_reports.report",
    ].every((id) => COUNT_CHECKS.some((c) => c.id === id)),
  );
  check(
    "登録表: race_special_notes は info（0件でも警告しない）、race_series・racer_period_stats は pending（未導入）",
    EMPTY_TABLE_POLICIES.race_special_notes.policy === "info" &&
      EMPTY_TABLE_POLICIES.race_series.policy === "pending" &&
      EMPTY_TABLE_POLICIES.racer_period_stats.policy === "pending",
  );
  {
    // 分母の定義は data-health-report.js と共有（同じテンプレートから作る）
    const q = buildQueries({
      coverageStart: "2026-09-07",
      windowStart: "2026-09-14",
      endDate: "2026-09-20",
    });
    check(
      "分母の定義の共有: data-health-report.js の coverage SQL は、共有テンプレート（coverageSpec.js）と同一",
      q.coverage ===
        buildCoverageSql(literalCoverageSlots("2026-09-07", "2026-09-20")),
    );
    const fnSql = renderInlineSql(functionByName("data_health_coverage"), {
      from: "2026-09-07",
      to: "2026-09-20",
    });
    check(
      "分母の定義の共有: 関数 data_health_coverage の本体にも、同じ SQL（rank4〜6の完走艇数・全券種オッズ）が入る",
      fnSql.includes(q.coverage) && q.coverage.includes("fin_known"),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printErr・check） */
export function runDataHealthJobTail1(env) {
  ({ printErr, check } = env);
  scene1();
}

function scene2() {
  check(
    "マイグレーション: functions.js の migration が、全て MIGRATION_FILES に載っている（検証から漏れたファイルが無い）",
    DATA_HEALTH_FUNCTIONS.every((f) => MIGRATION_FILES.includes(f.migration)),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（printErr・check・MIGRATION_FILES） */
export function runDataHealthJobTail2(env) {
  ({ printErr, check, MIGRATION_FILES } = env);
  scene2();
}

async function scene3() {
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    printErr(
      "@electric-sql/pglite が見つかりません。次を実行してから再実行してください:\n  npm ci（または npm i --no-save @electric-sql/pglite）",
    );
    process.exit(2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printErr・check・MIGRATION_FILES） */
export async function runDataHealthJobTail3(env) {
  ({ printErr, check, MIGRATION_FILES } = env);
  await scene3();
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene4() {
  const def = SCRAPE_JOBS.data_health;
  check(
    "レジストリ: data_health は daily・指定時刻 06:30・hosts なし（取得先に触れない）で、整合性の検査を通る",
    def?.kind === "daily" &&
      def.targetTimeJst === "06:30" &&
      def.hosts.length === 0 &&
      validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const vercel = JSON.parse(
    VERCEL_JSON_TEXT,
  );
  const cron = vercel.crons.filter((c) => c.path === "/api/cron/data-health");
  const m = /^(\d+) ([\d,-]+) \* \* \*$/.exec(cron[0]?.schedule ?? "");
  // "21-23" のような範囲、または "21,22" の一覧を、UTCの時の配列にする
  const hoursUtc = m
    ? m[2].includes("-")
      ? Array.from(
          {
            length: Number(m[2].split("-")[1]) - Number(m[2].split("-")[0]) + 1,
          },
          (_, k) => Number(m[2].split("-")[0]) + k,
        )
      : m[2].split(",").map(Number)
    : [];
  const jst = hoursUtc.map(
    (h) => `${String((h + 9) % 24).padStart(2, "0")}:${m[1].padStart(2, "0")}`,
  );
  check(
    "vercel.json: data-health は JST 06:35・07:35・08:35（指定時刻 06:30 の後の本番1回と補足2回。オッズの窓・毎分のジョブが動く 07:00 の前に本番）",
    cron.length === 1 && show(jst) === show(["06:35", "07:35", "08:35"]),
    show(cron),
  );
  check(
    "vercel.json: functions が api/cron/*.js を syd1 に固定している（DBと同じリージョン）",
    show(vercel.functions?.["api/cron/*.js"]?.regions) === show(["syd1"]),
  );
  const src = CRON_SRC;
  const mod = await import("../../../api/cron/data-health.js");
  check(
    "api/cron/data-health.js: maxDuration がレジストリと一致し、ハンドラーをexportする。未認証は401（DBに触れない）",
    new RegExp(`maxDuration: ${def.maxDurationSec}`).test(src) &&
      mod.config.maxDuration === def.maxDurationSec &&
      typeof mod.default === "function",
  );
  let status = null;
  await mod.default(
    { headers: {}, query: {} },
    {
      status(s) {
        status = s;
        return { json() {} };
      },
    },
  );
  check(
    "api/cron/data-health.js: 認証なしのリクエストは401",
    status === 401,
    String(status),
  );
  // 朝の監視 data_health_morning（07:50指定、07:55・08:55 JST）
  const mdef = SCRAPE_JOBS.data_health_morning;
  return { vercel, mdef };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene5({ vercel, mdef }) {
  check(
    "レジストリ: data_health_morning は daily・指定時刻 07:50（龍神ソナーの締め）・hosts なし",
    mdef?.kind === "daily" &&
      mdef.targetTimeJst === "07:50" &&
      mdef.hosts.length === 0,
    show(mdef),
  );
  const mcron = vercel.crons.filter(
    (c) => c.path === "/api/cron/data-health-morning",
  );
  check(
    "vercel.json: data-health-morning は JST 07:55・08:55（締め 07:50 の後の本番1回と補足1回）",
    mcron.length === 1 && mcron[0].schedule === "55 22,23 * * *",
    show(mcron),
  );
  const msrc = MORNING_CRON_SRC;
  const mmod = await import("../../../api/cron/data-health-morning.js");
  let mstatus = null;
  await mmod.default(
    { headers: {}, query: {} },
    {
      status(s) {
        mstatus = s;
        return { json() {} };
      },
    },
  );
  check(
    "api/cron/data-health-morning.js: maxDuration がレジストリと一致し、job='data_health_morning' で runDataHealthMorningJob を呼ぶ。未認証は401",
    new RegExp(`maxDuration: ${mdef.maxDurationSec}`).test(msrc) &&
      mmod.config.maxDuration === mdef.maxDurationSec &&
      msrc.includes('job: "data_health_morning"') &&
      msrc.includes("runDataHealthMorningJob") &&
      mstatus === 401,
    String(mstatus),
  );
  check(
    "非DB: job.js は書き込みのAPI（insert・update・upsert・delete）を持たない（書き込みは共通ラッパの last_report のみ）",
    !/\.(insert|update|upsert|delete)\(/.test(
      JOB_SRC,
    ),
  );
}

async function scene6() {
  // ---------------------------------------------------------------------------
  // (h) メタ監視
  // ---------------------------------------------------------------------------
  {
    const NOW_JST_0930 = new Date("2026-09-22T00:30:00Z");
    const done = {
      job: "data_health",
      mode: "live",
      last_target_date: "2026-09-22",
      last_success_at: "2026-09-21T21:35:10Z",
    };
    const stale = { ...done, last_target_date: "2026-09-21" };
    check(
      "メタ監視: live で対象日を処理済みなら正常、未処理なら異常（監視のCron・デプロイ・089の未適用の案内付き）",
      evaluateDataHealthLiveness({ now: NOW_JST_0930, jobStates: [done] })
        .status === "ok" &&
        evaluateDataHealthLiveness({ now: NOW_JST_0930, jobStates: [stale] })
          .status === "alert" &&
        evaluateDataHealthLiveness({
          now: NOW_JST_0930,
          jobStates: [stale],
        }).message.includes("089"),
    );
    check(
      "メタ監視: off・行なしは判定しない。指定時刻から3時間以内・運用窓の外は判定しない",
      evaluateDataHealthLiveness({
        now: NOW_JST_0930,
        jobStates: [{ ...stale, mode: "off" }],
      }).status === "ok" &&
        evaluateDataHealthLiveness({ now: NOW_JST_0930, jobStates: [] })
          .status === "ok" &&
        evaluateDataHealthLiveness({
          now: new Date("2026-09-21T22:30:00Z"),
          jobStates: [stale],
        }).status === "ok" &&
        evaluateDataHealthLiveness({
          now: new Date("2026-09-22T15:30:00Z"),
          jobStates: [stale],
        }).status === "skip",
    );
    check(
      "メタ監視: shadow は、対象日を処理済みにしない設計のため、最終成功の時刻で鮮度を見る",
      evaluateDataHealthLiveness({
        now: NOW_JST_0930,
        jobStates: [
          {
            job: "data_health",
            mode: "shadow",
            last_success_at: "2026-09-21T21:35:10Z",
          },
        ],
      }).status === "ok" &&
        evaluateDataHealthLiveness({
          now: NOW_JST_0930,
          jobStates: [
            {
              job: "data_health",
              mode: "shadow",
              last_success_at: "2026-09-20T21:35:10Z",
            },
          ],
        }).status === "alert",
    );
    const wf = LIVENESS_WF;
    const script = LIVENESS_SCRIPT;
    check(
      "メタ監視: 日次のワークフローが確認スクリプトを呼び、スクリプトが data_health の鮮度を確認して異常時に exit 1、Slack通知の文言に data_health の案内がある",
      wf.includes("check-scrape-monitor-liveness.js") &&
        wf.includes("data_health") &&
        script.includes("evaluateDataHealthLiveness({ now, jobStates: data })") &&
        script.includes("process.exit(1)"),
    );
  }
  {
    const s1 = await scene4();
    await scene5(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printErr・check・MIGRATION_FILES・LIVENESS_WF・LIVENESS_SCRIPT・VERCEL_JSON_TEXT・CRON_SRC・MORNING_CRON_SRC・JOB_SRC） */
export async function runDataHealthJobTail4(env) {
  ({ printErr, check, MIGRATION_FILES, LIVENESS_WF, LIVENESS_SCRIPT, VERCEL_JSON_TEXT, CRON_SRC, MORNING_CRON_SRC, JOB_SRC } = env);
  await scene6();
}
