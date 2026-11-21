/**
 * verify-scrape-monitor.js の後半の場面（8/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createScrapeCronHandler } from "../../lib/scrapeJobs/cronWrapper.js";
import { MONITOR_STALE_MIN, evaluateMonitorLiveness } from "../check-scrape-monitor-liveness.js";

let check, show, at, iso;

function scene1() {
  // ---------------------------------------------------------------------------
  // (g) メタ監視
  // ---------------------------------------------------------------------------
  {
    const now = at("09:30");
    const min = (m) => iso(new Date(now.getTime() - m * 60000));
    const monitor = (over) => ({
      job: "scrape-monitor",
      mode: "off",
      last_tick_at: min(3),
      consecutive_failures: 0,
      last_error: null,
      ...over,
    });
    const liveOdds = { job: "odds", mode: "live" };
    const ev = (jobStates, when = now) =>
      evaluateMonitorLiveness({ now: when, jobStates }).status;
    check("正常（3分前に起動）", ev([monitor({}), liveOdds]) === "ok");
    check(
      `異常: last_tick_at が${MONITOR_STALE_MIN}分以上前`,
      ev([monitor({ last_tick_at: min(MONITOR_STALE_MIN) })]) === "alert" &&
        ev([monitor({ last_tick_at: min(MONITOR_STALE_MIN - 1) })]) === "ok" &&
        ev([monitor({ last_tick_at: null })]) === "alert",
    );
    check(
      "異常: 連続失敗3回以上（Slack通知の失敗等）",
      ev([monitor({ consecutive_failures: 3, last_error: "Slack" })]) === "alert",
    );
    check(
      "行なし: 有効な取得ジョブがあれば異常、無ければ正常（まだ起動していない）",
      ev([liveOdds]) === "alert" &&
        ev([]) === "ok" &&
        ev([{ job: "odds", mode: "off" }]) === "ok",
    );
    check(
      "運用窓（JST 07:10〜23:59）の外は判定しない",
      ev([monitor({ last_tick_at: min(600) })], at("03:00")) === "skip",
    );
  }
}

async function scene2() {
  // ---------------------------------------------------------------------------
  // (h) HTTPハンドラー
  // ---------------------------------------------------------------------------
  {
    const mkRes = () => {
      const res = { statusCode: 0, body: null };
      res.status = (c) => {
        res.statusCode = c;
        return res;
      };
      res.json = (b) => {
        res.body = b;
        return res;
      };
      return res;
    };
    const ORIGINAL = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret";
    const missingClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: {
                code: "PGRST205",
                message:
                  "Could not find the table 'public.scrape_job_state' in the schema cache",
              },
            }),
          }),
        }),
      }),
    };
    let ran = 0;
    const handler = createScrapeCronHandler({
      job: "scrape-monitor",
      run: async () => {
        ran++;
        return {};
      },
      getClient: async () => missingClient,
    });
    let res = mkRes();
    await handler({ headers: {}, query: {} }, res);
    check("未認証は401（処理しない）", res.statusCode === 401 && ran === 0);
    res = mkRes();
    await handler({ headers: { authorization: "Bearer wrong" }, query: {} }, res);
    check("認証が違えば401", res.statusCode === 401);
    res = mkRes();
    await handler(
      { headers: { authorization: "Bearer s3cret" }, query: {} },
      res,
    );
    check(
      "075未適用のDB: 認証済みでも、何もせず200（skipped）",
      res.statusCode === 200 &&
        res.body.skipped === "scrape_schema_not_applied" &&
        ran === 0,
      show(res.body),
    );
    const noClient = createScrapeCronHandler({
      job: "scrape-monitor",
      run: async () => ({}),
      getClient: async () => null,
    });
    res = mkRes();
    await noClient(
      { headers: { authorization: "Bearer s3cret" }, query: {} },
      res,
    );
    check("Supabase未設定は500", res.statusCode === 500);
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・at・iso） */
export async function runScrapeMonitorScenes8(env) {
  ({ check, show, at, iso } = env);
  scene1();
  await scene2();
}
