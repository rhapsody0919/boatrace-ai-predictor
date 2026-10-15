/**
 * SNS の自動送信の計画（sns-pdca-loop tasks 12、ADR 0094）。5分ごとに、その日の優勝戦・準優勝戦の素材 v1 から
 * レース×チャネルの item を作り、検査して個別承認に回す。本体は scripts/lib/snsAutoPlanRunner.js。共通の cron ラッパを通す。
 *
 * モード（scrape_job_state の job='sns_auto_plan'。153 で shadow の行を入れた）:
 *   off（または行なし）  何もしない
 *   shadow              検査までで止める（item・下書き・UTM の表・Slack に書かない）
 *   live                item を作り、検査の結果を書き、合格した下書きの公開保留を外す（送るのは sns-send。dry_run の間は claim の前で止まる）
 *
 * /today の画像つき X 投稿（tasks 19b）も同じ実行で計画する（JST 5:30〜7:45 だけ。scripts/lib/snsTodayPlanner.js）。
 * /today の計画が落ちてもレースの計画は続け、理由を report.alerts に出す（次の5分でやり直す）
 *
 * cron式（vercel.json）は UTC。5分ごと、時は 20〜23・0〜13（UTC）= JST 5:00〜22:55（稼働時間の監視は JST 5:30〜23:00。ミッドナイトの優勝戦のため、2026-10-14 オーナー決定）
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { postSlack } from "../../scripts/lib/scrapeJobs/monitor.js";
import {
  createAutoPlanStore,
  runSnsAutoPlan,
} from "../../scripts/lib/snsAutoPlanRunner.js";
import { createPostTrackingStore } from "../../scripts/lib/snsPostTracking.js";
import { SCREEN_MARKERS } from "../../scripts/lib/snsScreenMarkers.js";
import { checkClaims } from "../_lib/snsClaimCheck.js";
import { createChromiumHeadless } from "../_lib/snsHeadless.js";
import riskRules from "../_lib/snsRiskRulesFile.js";
import {
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
  signStoragePath,
} from "../_lib/snsHubHelpers.js";
import {
  createTodayStore,
  runTodayPlan,
} from "../../scripts/lib/snsTodayPlanner.js";
import { createTodayDigestSource } from "../_lib/snsTodayDigest.js";
import { getJaT } from "../_lib/botPage.js";
import { bundleStore } from "../_lib/snsBundleImport.js";

export const config = { maxDuration: 300 };

const env = process.env;
const notify = async (text) => {
  if (env.SLACK_WEBHOOK_URL) await postSlack(env.SLACK_WEBHOOK_URL, { text });
};

export default createScrapeCronHandler({
  job: "sns_auto_plan",
  run: async (ctx) => {
    const headless = createChromiumHeadless();
    const trackingStore = createPostTrackingStore({
      url: SUPABASE_URL,
      key: SUPABASE_SERVICE_KEY,
    });
    try {
      let today;
      try {
        today = await runTodayPlan(ctx, {
          store: createTodayStore({
            url: SUPABASE_URL,
            key: SUPABASE_SERVICE_KEY,
          }),
          getDigest: createTodayDigestSource(),
          t: await getJaT(),
          headless,
          markers: SCREEN_MARKERS,
          riskRules: riskRules.rules,
          trackingStore,
          saveImage: (path, bytes) =>
            bundleStore.saveFile(path, { mime: "image/png", bytes }),
          signImage: (path) => signStoragePath(path, 6 * 3600),
          notify,
        });
      } catch (error) {
        today = {
          rowsWritten: 0,
          report: {
            items: [
              { kind: "digest", outcome: "error", reason: error.message },
            ],
            alerts: [
              {
                key: "today",
                text: `SNS /today の計画に失敗（次の5分でやり直す）: ${error.message}`,
              },
            ],
          },
        };
      }
      const race = await runSnsAutoPlan(ctx, {
        store: createAutoPlanStore({
          url: SUPABASE_URL,
          key: SUPABASE_SERVICE_KEY,
        }),
        checkClaims,
        headless,
        markers: SCREEN_MARKERS,
        riskRules: riskRules.rules,
        trackingStore,
        notify,
      });
      return {
        rowsWritten: race.rowsWritten + today.rowsWritten,
        report: {
          items: [...today.report.items, ...race.report.items],
          alerts: [...today.report.alerts, ...race.report.alerts],
        },
        body: { items: [...today.report.items, ...race.body.items] },
      };
    } finally {
      // 閉じるのに失敗しても、計画の結果は消さない
      await headless
        .close()
        .catch((error) =>
          console.error(`Chromium を閉じられません: ${error.message}`),
        );
    }
  },
});
