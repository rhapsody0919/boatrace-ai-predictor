/**
 * SNS の送信（sns-pdca-loop tasks 19、ADR 0094）。2分ごとに、送る時刻を過ぎた X・YouTube の job を最大3件送る。
 * 本体は scripts/lib/snsSendRunner.js。共通の cron ラッパ（認証・リース・モード）を通す。
 *
 * モード（scrape_job_state の job='sns_send'。153 で shadow の行を入れる）:
 *   off（または行なし）  何もしない
 *   shadow              送る前の検査までで止める（DB の状態も変えない）
 *   live                送る。ただしチャネルの sns_auto_send_control.dry_run が true の間は、送る前の検査までで止める
 *
 * 送る前の検査（createDeadlinePreflight）のリンク先の表示の確認（tasks 10）は、未ログインの Chromium（api/_lib/snsHeadless.js）で
 * screen_key の印（scripts/lib/snsScreenMarkers.js）が見えるかを確かめる。Chromium は1回の実行で1回だけ起動し、終わったら閉じる。
 * その前に元データの読み直し（tasks 9、snsClaimCheck.js の readCurrent: 素材 v1 の claims を公開 API で照合・中止・欠場・締切）を行う
 *
 * cron式（vercel.json）は UTC。分は2分ごと、時は 23・0〜11（UTC）= JST 8:00〜20:58 の2分ごと
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { postSlack } from "../../scripts/lib/scrapeJobs/monitor.js";
import {
  createPostgrestReader,
  createSnsSendStore,
  runSnsSend,
} from "../../scripts/lib/snsSendRunner.js";
import { createDeadlinePreflight } from "../_lib/snsDeadlineQueue.js";
import { createReadCurrent } from "../_lib/snsClaimCheck.js";
import { createChromiumHeadless } from "../_lib/snsHeadless.js";
import { SCREEN_MARKERS } from "../../scripts/lib/snsScreenMarkers.js";
import { loadXMedia, xSendStore } from "../_lib/snsXSendStore.js";
import {
  createPostgrestTokenDb,
  getXAccessToken,
} from "../_lib/snsTokenStore.js";
import { createXApiAdapter } from "../_lib/xApiAdapter.js";
import { createYoutubeQueueAdapter } from "../_lib/youtubeQueueAdapter.js";
import { getYoutubeAccessToken } from "../_lib/youtubeUpload.js";
import { SUPABASE_SERVICE_KEY, SUPABASE_URL } from "../_lib/snsHubHelpers.js";

export const config = { maxDuration: 300 };

const env = process.env;
const notify = async (text) => {
  if (env.SLACK_WEBHOOK_URL) await postSlack(env.SLACK_WEBHOOK_URL, { text });
};

export default createScrapeCronHandler({
  job: "sns_send",
  run: async (ctx) => {
    const headless = createChromiumHeadless();
    try {
      return await runSnsSend(ctx, {
        store: createSnsSendStore({
          db: createPostgrestReader({
            url: SUPABASE_URL,
            key: SUPABASE_SERVICE_KEY,
          }),
          xSendStore,
        }),
        adapters: {
          x: async () =>
            createXApiAdapter({
              accessToken: (
                await getXAccessToken({
                  db: createPostgrestTokenDb(),
                  keyBase64: env.SNS_TOKEN_ENC_KEY,
                  clientId: env.X_OAUTH_CLIENT_ID,
                  clientSecret: env.X_OAUTH_CLIENT_SECRET,
                  notify,
                })
              ).accessToken,
            }),
          youtube: async () => {
            const accessToken = await getYoutubeAccessToken({
              clientId: env.YOUTUBE_CLIENT_ID,
              clientSecret: env.YOUTUBE_CLIENT_SECRET,
              refreshToken: env.YOUTUBE_REFRESH_TOKEN,
            });
            if (!accessToken) throw new Error("YouTube の鍵が未設定です");
            return createYoutubeQueueAdapter({ accessToken });
          },
        },
        preflight: createDeadlinePreflight({
          headless,
          markers: SCREEN_MARKERS,
          readCurrent: createReadCurrent({
            db: createPostgrestReader({
              url: SUPABASE_URL,
              key: SUPABASE_SERVICE_KEY,
            }),
          }),
        }),
        loadMedia: loadXMedia,
        notify,
      });
    } finally {
      // 閉じるのに失敗しても、送信の結果（送った件数・要照合）は消さない
      await headless
        .close()
        .catch((error) =>
          console.error(`Chromium を閉じられません: ${error.message}`),
        );
    }
  },
});
