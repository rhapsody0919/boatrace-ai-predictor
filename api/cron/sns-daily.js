/**
 * SNS の暦日の値の取り込み（sns-pdca-loop tasks 22、plan §5）。JST 10:00（補足 11:30）に、YouTube Analytics と GA4 の
 * D−3〜D−1 を取り直して sns_channel_daily に入れる。本体は scripts/lib/snsDailyRunner.js。共通の cron ラッパを通す。
 *
 * モード（scrape_job_state の job='sns_daily'。153 で shadow の行を入れる）: off は何もしない、shadow は取得と比較まで、live は書く
 * cron式（vercel.json）は UTC: 01:00・02:30 = JST 10:00・11:30
 *
 * 鍵: YouTube Analytics は YOUTUBE_ANALYTICS_*（3つ）、GA4 は GOOGLE_SERVICE_ACCOUNT_KEY（サービスアカウントの JSON）と GA4_PROPERTY_ID。
 * GA4 の鍵が無い間は GA4 を飛ばして知らせる
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import {
  createSnsDailyStore,
  createYoutubeAnalyticsClient,
  runSnsDaily,
} from "../../scripts/lib/snsDailyRunner.js";
import {
  createGa4Client,
  getServiceAccountToken,
} from "../../scripts/lib/snsGa4.js";
import { getYoutubeAccessToken } from "../_lib/youtubeUpload.js";
import { SUPABASE_SERVICE_KEY, SUPABASE_URL } from "../_lib/snsHubHelpers.js";

export const config = { maxDuration: 300 };

const env = process.env;

export default createScrapeCronHandler({
  job: "sns_daily",
  run: (ctx) =>
    runSnsDaily(ctx, {
      store: createSnsDailyStore({
        url: SUPABASE_URL,
        key: SUPABASE_SERVICE_KEY,
      }),
      youtube: async () => {
        const accessToken = await getYoutubeAccessToken({
          clientId: env.YOUTUBE_ANALYTICS_CLIENT_ID,
          clientSecret: env.YOUTUBE_ANALYTICS_CLIENT_SECRET,
          refreshToken: env.YOUTUBE_ANALYTICS_REFRESH_TOKEN,
        });
        if (!accessToken)
          throw new Error("YouTube Analytics の鍵が未設定です");
        return createYoutubeAnalyticsClient({ accessToken });
      },
      ga4:
        env.GOOGLE_SERVICE_ACCOUNT_KEY && env.GA4_PROPERTY_ID
          ? async () =>
              createGa4Client({
                propertyId: env.GA4_PROPERTY_ID,
                accessToken: await getServiceAccountToken(
                  env.GOOGLE_SERVICE_ACCOUNT_KEY,
                ),
              })
          : null,
    }),
});
