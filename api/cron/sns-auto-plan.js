/**
 * SNS の自動送信の計画（sns-pdca-loop tasks 12、ADR 0094）。5分ごとに、その日の優勝戦・準優勝戦の素材 v1 から
 * レース×チャネルの item を作り、検査して個別承認に回す。本体は scripts/lib/snsAutoPlanRunner.js。共通の cron ラッパを通す。
 *
 * モード（scrape_job_state の job='sns_auto_plan'。153 で shadow の行を入れた）:
 *   off（または行なし）  何もしない
 *   shadow              検査までで止める（item・下書き・UTM の表・Slack に書かない）
 *   live                item を作り、検査の結果を書き、合格した下書きの公開保留を外す（送るのは sns-send。dry_run の間は claim の前で止まる）
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
import { SUPABASE_SERVICE_KEY, SUPABASE_URL } from "../_lib/snsHubHelpers.js";

export const config = { maxDuration: 300 };

const env = process.env;
const notify = async (text) => {
  if (env.SLACK_WEBHOOK_URL) await postSlack(env.SLACK_WEBHOOK_URL, { text });
};

export default createScrapeCronHandler({
  job: "sns_auto_plan",
  run: async (ctx) => {
    const headless = createChromiumHeadless();
    try {
      return await runSnsAutoPlan(ctx, {
        store: createAutoPlanStore({
          url: SUPABASE_URL,
          key: SUPABASE_SERVICE_KEY,
        }),
        checkClaims,
        headless,
        markers: SCREEN_MARKERS,
        riskRules: riskRules.rules,
        trackingStore: createPostTrackingStore({
          url: SUPABASE_URL,
          key: SUPABASE_SERVICE_KEY,
        }),
        notify,
      });
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
