/**
 * SNS の 48h・7d の取り込み（sns-pdca-loop tasks 21、plan §5）。5分ごと（終日）に、due_at を過ぎた sns_metric_jobs を処理する。
 * 本体は scripts/lib/snsMetricsRunner.js。共通の cron ラッパ（認証・リース・モード）を通す。
 *
 * モード（scrape_job_state の job='sns_metrics'。153 で shadow の行を入れる）:
 *   off（または行なし）  何もしない
 *   shadow              対象の件数を数えるだけ（外部を読まない・DB も変えない）
 *   live                YouTube・X を読んで sns_metric_observations に入れる
 *
 * 累積値の許容差は15分（SQL154）。5分ごとなら1回抜けても間に合う
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { postSlack } from "../../scripts/lib/scrapeJobs/monitor.js";
import {
  createSnsMetricsStore,
  createXMetricsReader,
  createYoutubeMetricsReader,
  runSnsMetrics,
} from "../../scripts/lib/snsMetricsRunner.js";
import {
  createPostgrestTokenDb,
  getXAccessToken,
} from "../_lib/snsTokenStore.js";
import { getYoutubeAccessToken } from "../_lib/youtubeUpload.js";
import { SUPABASE_SERVICE_KEY, SUPABASE_URL } from "../_lib/snsHubHelpers.js";

export const config = { maxDuration: 120 };

const env = process.env;
const notify = async (text) => {
  if (env.SLACK_WEBHOOK_URL) await postSlack(env.SLACK_WEBHOOK_URL, { text });
};

export default createScrapeCronHandler({
  job: "sns_metrics",
  run: (ctx) =>
    runSnsMetrics(ctx, {
      store: createSnsMetricsStore({
        url: SUPABASE_URL,
        key: SUPABASE_SERVICE_KEY,
      }),
      readers: {
        x: async () => {
          const { accessToken, accountId } = await getXAccessToken({
            db: createPostgrestTokenDb(),
            keyBase64: env.SNS_TOKEN_ENC_KEY,
            clientId: env.X_OAUTH_CLIENT_ID,
            clientSecret: env.X_OAUTH_CLIENT_SECRET,
            notify,
            maxWaits: 10,
          });
          return createXMetricsReader({ accessToken, accountId });
        },
        youtube: async () => {
          const accessToken = await getYoutubeAccessToken({
            clientId: env.YOUTUBE_CLIENT_ID,
            clientSecret: env.YOUTUBE_CLIENT_SECRET,
            refreshToken: env.YOUTUBE_REFRESH_TOKEN,
          });
          if (!accessToken) throw new Error("YouTube の鍵が未設定です");
          return createYoutubeMetricsReader({ accessToken });
        },
      },
      notify,
    }),
});
