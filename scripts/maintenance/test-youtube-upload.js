/**
 * YouTube自動アップロードロジックのstandalone動作確認スクリプト。
 *
 * `api/admin/sns-hub/drafts/[id]/publish-youtube.js`（sns_drafts経由の本番承認フロー）
 * と全く同じアップロード処理（api/_lib/youtubeUpload.js）を、Supabase・下書きレコード
 * 無しで直接叩く。ローカルの動画・サムネイルファイルを指定して実行するだけで、
 * OAuthリフレッシュ→動画アップロード→サムネイル設定の一連の実装が実際に動くかを
 * 確認できる。
 *
 * 事前準備（実行者本人が行う。Claudeはこの値を見ない/入力しない）:
 *   1. `vercel env pull .env.local` で本番のYOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET /
 *      YOUTUBE_REFRESH_TOKEN をこのworktreeの .env.local に取得する
 *      （worktreeでも `vercel link` 済みなら通常のプロジェクトルートと同様に使える。
 *      未リンクの場合はメインリポジトリ側の.env.localをコピーしてもよい）
 *   2. 動画・サムネイルファイルのパスを確認する
 *
 * 実行例（限定公開でテストアップロード、既定値）:
 *   node scripts/maintenance/test-youtube-upload.js \
 *     --video sns-video-studio/remotion/out/technique-consistency-cm-v2.mp4 \
 *     --thumb sns-video-studio/remotion/out/technique-consistency-youtube-thumb.jpg \
 *     --title "【テスト】1号艇は逃げ一強、4号艇はバラバラ"
 *
 * 既定のprivacyStatusは"unlisted"（限定公開）。本番同様public公開でテストしたい
 * 場合のみ明示的に --privacy public を付ける（誤って一般公開しないためのガード）。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  getYoutubeAccessToken,
  uploadYoutubeVideo,
  uploadYoutubeThumbnail,
} from "../../api/_lib/youtubeUpload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

function parseArgs(argv) {
  const args = {
    privacy: "unlisted",
    title: "【テスト投稿】龍神レーダー コンテンツパイプライン検証",
    description: "自動アップロードロジックの動作確認用テスト投稿です。",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--video") args.video = argv[++i];
    else if (key === "--thumb") args.thumb = argv[++i];
    else if (key === "--title") args.title = argv[++i];
    else if (key === "--description") args.description = argv[++i];
    else if (key === "--privacy") args.privacy = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.video) {
    console.error(
      "使い方: node scripts/maintenance/test-youtube-upload.js --video <mp4パス> [--thumb <jpgパス>] [--title <タイトル>] [--privacy unlisted|private|public]",
    );
    process.exit(1);
  }
  if (!["unlisted", "private", "public"].includes(args.privacy)) {
    console.error(
      `--privacyは unlisted/private/public のいずれかを指定してください（指定値: ${args.privacy}）`,
    );
    process.exit(1);
  }
  if (!fs.existsSync(args.video)) {
    console.error(`動画ファイルが見つかりません: ${args.video}`);
    process.exit(1);
  }
  if (args.thumb && !fs.existsSync(args.thumb)) {
    console.error(`サムネイルファイルが見つかりません: ${args.thumb}`);
    process.exit(1);
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.error(
      "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN が.env.localに未設定です。" +
        "`vercel env pull .env.local` で本番環境変数を取得してから再実行してください。",
    );
    process.exit(1);
  }

  console.log(`[1/4] OAuthアクセストークンを取得中...`);
  const accessToken = await getYoutubeAccessToken({
    clientId,
    clientSecret,
    refreshToken,
  });
  if (!accessToken) {
    console.error("アクセストークン取得に失敗しました（値がnull）");
    process.exit(1);
  }
  console.log("      OK");

  console.log(
    `[2/4] 動画をアップロード中... (${args.video}, privacyStatus=${args.privacy})`,
  );
  const videoBytes = fs.readFileSync(args.video);
  const videoBlob = new Blob([videoBytes], { type: "video/mp4" });
  const uploaded = await uploadYoutubeVideo(
    accessToken,
    {
      title: args.title,
      description: args.description,
      tags: ["龍神レーダー", "ボートレース", "テスト投稿"],
      privacyStatus: args.privacy,
    },
    videoBlob,
  );
  const videoId = uploaded.id;
  console.log(`      OK (videoId=${videoId})`);

  if (args.thumb) {
    console.log(`[3/4] サムネイルを設定中... (${args.thumb})`);
    const thumbBytes = fs.readFileSync(args.thumb);
    const thumbBlob = new Blob([thumbBytes], { type: "image/jpeg" });
    await uploadYoutubeThumbnail(accessToken, videoId, thumbBlob);
    console.log("      OK");
  } else {
    console.log("[3/4] サムネイル未指定のためスキップ");
  }

  console.log(`[4/4] 完了`);
  console.log(`      https://youtu.be/${videoId}`);
  console.log(
    `      YouTube Studioで確認: https://studio.youtube.com/video/${videoId}/edit`,
  );
}

main().catch((error) => {
  console.error("エラー:", error.message);
  process.exit(1);
});
