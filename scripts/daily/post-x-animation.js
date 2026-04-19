/**
 * post-x-animation.js
 *
 * 毎朝 JST 10:00 に GitHub Actions から実行される。
 * boat-ai.jp の1マーク展開予測アニメーションを3モデル分録画し X に投稿する。
 *
 * 実行: node scripts/daily/post-x-animation.js
 * 環境変数: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 */

import { chromium } from "playwright";
import { TwitterApi } from "twitter-api-v2";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const TARGET_URL = "https://www.boat-ai.jp/";
const VIEWPORT = { width: 375, height: 900 };
const FLASH_DISPLAY_SEC = 3;
const AFTER_ANIM_WAIT_SEC = 1;
const ANIM_TIMEOUT_MS = 15000;
const OUT_DIR = path.join(os.tmpdir(), "pw-x-animation");

const MODELS = [
  { key: "standard", label: "スタンダード", btnText: "スタンダード" },
  { key: "safe-bet", label: "本命狙い", btnText: "本命狙い" },
  { key: "upset-focus", label: "穴狙い", btnText: "穴狙い" },
];

// ===== Playwright ヘルパー =====

async function waitReplay(replayBtn) {
  await replayBtn.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  await replayBtn.waitFor({ state: "visible", timeout: ANIM_TIMEOUT_MS });
}

async function playModel(page, model) {
  console.log(`  [モデル: ${model.label}]`);

  const modelBtn = page.locator(`button:has-text('${model.btnText}')`).first();
  await modelBtn.click();

  // key={selectedModel} による再マウント: detached → visible の順で待つ
  const animEl = page.locator(".first-mark-animation").first();
  await animEl.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await animEl.waitFor({ state: "visible", timeout: 20000 });
  await animEl.scrollIntoViewIfNeeded();

  const animBbox = await animEl.boundingBox();

  // 自動再生の完了を待つ（スキップ）
  const replayBtn = page.locator(".first-mark-animation__replay-btn").first();
  await replayBtn.waitFor({ state: "visible", timeout: ANIM_TIMEOUT_MS });

  // リプレイ × 3
  for (let i = 1; i <= 3; i++) {
    await replayBtn.click();
    await waitReplay(replayBtn);
    console.log(`    リプレイ ${i}/3 完了`);
  }

  await page.waitForTimeout(AFTER_ANIM_WAIT_SEC * 1000);

  // 注目データへスクロール
  const flashEl = page.locator(".prediction-flash").first();
  let flashBbox = null;
  const flashVisible = await flashEl
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (flashVisible) {
    const flashHandle = await flashEl.elementHandle();
    const cardAbsoluteTop = await page.evaluate(
      (el) => el.getBoundingClientRect().top + window.pageYOffset,
      flashHandle,
    );
    await page.evaluate(
      (y) => window.scrollTo({ top: y, behavior: "instant" }),
      cardAbsoluteTop - 60,
    );
    await page.waitForTimeout(300);
    flashBbox = await flashEl.boundingBox();
    await page.waitForTimeout(FLASH_DISPLAY_SEC * 1000);
  } else {
    await page.waitForTimeout(FLASH_DISPLAY_SEC * 1000);
  }

  return { animBbox, flashBbox };
}

// ===== 次に始まるレースを API から特定 =====

async function findNextRace() {
  const res = await fetch(`${TARGET_URL}api/races/today`);
  if (!res.ok) throw new Error(`API fetch failed: ${res.status}`);
  const json = await res.json();
  const venues = json.data || [];

  // 現在時刻（JST）を分換算
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const currentMinutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();

  let best = null;
  let bestDiff = Infinity;

  for (const venue of venues) {
    for (const race of venue.races || []) {
      if (!race.startTime) continue;
      const [h, m] = race.startTime.split(":").map(Number);
      const raceMinutes = h * 60 + m;
      const diff = raceMinutes - currentMinutes;
      // 現在時刻以降で最も近い発走
      if (diff >= 0 && diff < bestDiff) {
        bestDiff = diff;
        best = { venue, race };
      }
    }
  }

  // 全レース終了済みの場合は最後のレースを返す
  if (!best) {
    const lastVenue = venues[venues.length - 1];
    const lastRace = lastVenue?.races?.[lastVenue.races.length - 1];
    if (lastVenue && lastRace) {
      best = { venue: lastVenue, race: lastRace };
    }
  }

  return best;
}

// ===== メイン =====

async function main() {
  console.log("=== post-x-animation 開始 ===");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 次に始まるレースを特定
  console.log("\n[0] 次のレースを API から取得中...");
  const next = await findNextRace();
  if (!next) {
    console.log("    本日開催なし → スキップ");
    process.exit(0);
  }
  const targetPlaceCd = next.venue.place_cd;
  const targetPlaceName = next.venue.place_name;
  const targetRaceNo = next.race.raceNo;
  console.log(
    `    → ${targetPlaceName} ${targetRaceNo}R (発走: ${next.race.startTime})`,
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: "no-preference",
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  });

  const page = await context.newPage();

  // 広告ブロック
  await page.route(
    /\/(googlesyndication|doubleclick|adservice|googletagmanager|googletagservices|googlea[dp]services|amazon-adsystem|adsystem|adnxs|adzerk|outbrain|taboola|criteo|pubmatic|openx|rubiconproject|appnexus|smartadserver)\./,
    (route) => route.abort(),
  );

  const contextStartMs = Date.now();

  console.log(`\n[1] ${TARGET_URL} を開いています...`);
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 });

  await page.addStyleTag({
    content: `
      iframe[src*="ad"], iframe[id*="ad"], iframe[class*="ad"],
      div[id*="ad-"], div[class*="ad-"], div[id*="-ad"], div[class*="-ad"],
      div[id*="banner"], div[class*="banner"],
      div[id*="overlay"], div[class*="overlay"],
      ins.adsbygoogle, [data-ad], [data-ads],
      .adsbygoogle, .ad-container, .ad-wrapper, .advertisement,
      #google_ads_iframe, .google-ad,
      div[class*="plaza"], div[id*="plaza"],
      div[class*="ticker"], div[id*="ticker"],
      div[class*="marquee"], div[id*="marquee"]
      { display: none !important; }
    `,
  });

  // Cookieバナー
  const cookieBtn = page.locator("button:has-text('同意する')").first();
  if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cookieBtn.click();
  }

  // [2] 会場ドロップダウンで対象会場を選択
  console.log(`\n[2] 会場選択: ${targetPlaceName} (place_cd=${targetPlaceCd})`);
  const venueSelect = page.locator("#venue-select");
  await venueSelect.waitFor({ state: "visible", timeout: 15000 });
  await venueSelect.selectOption(String(targetPlaceCd));

  // レースカードが描画されるのを待つ
  await page.locator(".race-card").first().waitFor({ state: "visible", timeout: 10000 });

  // 対象レース番号のカードを特定してクリック
  const targetCard = page.locator(".race-card", {
    has: page.locator(`.race-number:has-text('${targetRaceNo}R')`),
  });
  if (!(await targetCard.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log(`    ⚠️  ${targetRaceNo}R のカードが見つかりません → スキップ`);
    await browser.close();
    process.exit(0);
  }

  const venue = targetPlaceName;
  const raceNo = `${targetRaceNo}`;
  console.log(`    ✅ ${venue} ${raceNo}R を選択`);
  await targetCard.locator(".predict-btn").click();

  // 最初のアニメーション出現待ち
  console.log("\n[3] アニメーション出現待ち...");
  const animElFirst = page.locator(".first-mark-animation").first();
  await animElFirst.waitFor({ state: "visible", timeout: 20000 });
  const firstAppearMs = Date.now();

  // 決まり手を取得（最初のモデルの自動再生完了後）
  const replayBtnFirst = page
    .locator(".first-mark-animation__replay-btn")
    .first();
  await replayBtnFirst.waitFor({ state: "visible", timeout: ANIM_TIMEOUT_MS });
  const technique = await page
    .locator(".result-card--1st .result-technique")
    .first()
    .textContent()
    .catch(() => "");
  const winnerCourse = await page
    .locator(".result-card--1st .result-course")
    .first()
    .textContent()
    .catch(() => "");

  // [4] 3モデルをループ
  let cropAnimBbox = null;
  let cropFlashBbox = null;

  for (let i = 0; i < MODELS.length; i++) {
    const { animBbox, flashBbox } = await playModel(page, MODELS[i]);
    if (i === 0) {
      cropAnimBbox = animBbox;
      cropFlashBbox = flashBbox;
    }
  }

  const endMs = Date.now();

  // [5] ブラウザを閉じる
  const video = page.video();
  await browser.close();
  const rawWebm = await video.path();
  console.log(
    `\n[5] 生録画: ${rawWebm} (${(fs.statSync(rawWebm).size / 1024).toFixed(0)} KB)`,
  );

  // [6] ffmpegでクロップ → MP4
  const ss = Math.max(0, (firstAppearMs - contextStartMs) / 1000 - 0.1).toFixed(
    2,
  );
  const trimDuration = ((endMs - firstAppearMs) / 1000 + 0.5).toFixed(2);
  const cropX = cropAnimBbox ? Math.round(cropAnimBbox.x) : 0;
  const cropW = cropAnimBbox ? Math.round(cropAnimBbox.width) : VIEWPORT.width;
  const flashBottom = cropFlashBbox
    ? Math.min(
        Math.round(cropFlashBbox.y + cropFlashBbox.height + 10),
        VIEWPORT.height,
      )
    : VIEWPORT.height;
  const cropFilter = `crop=${cropW}:${flashBottom}:${cropX}:0`;
  const outMp4 = path.join(OUT_DIR, "animation.mp4");

  const ffmpegArgs = [
    "-y",
    "-i", rawWebm,
    "-ss", ss,
    "-t", trimDuration,
    "-vf", cropFilter,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    outMp4,
  ];

  console.log(`\n[6] ffmpeg ${ffmpegArgs.join(" ")}`);
  execFileSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
  console.log(
    `    ✅ MP4: ${outMp4} (${(fs.statSync(outMp4).size / 1024).toFixed(0)} KB)`,
  );

  // [7] X に投稿
  console.log("\n[7] X に動画をアップロード中...");
  const twitterClient = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
  const mp4SizeBytes = fs.statSync(outMp4).size;
  const mediaId = await twitterClient.v1.uploadMedia(outMp4, {
    mimeType: "video/mp4",
    longVideo: mp4SizeBytes > 5 * 1024 * 1024,
  });
  console.log(`    media_id: ${mediaId}`);

  const venueTrimmed = venue?.trim() || "";
  const raceNoTrimmed = raceNo ? `${raceNo}R` : "";
  const techniqueTrimmed = technique?.trim() || "";
  const courseTrimmed = winnerCourse?.trim() || "";
  const caption = [
    `🚤 ${venueTrimmed} ${raceNoTrimmed} 1マーク展開予測`,
    `${courseTrimmed}コース${techniqueTrimmed}`,
    "",
    `AIが予測した展開をチェック👇`,
    TARGET_URL,
    "#ボートレース #AI予想 #BoatAI",
  ].join("\n");

  const tweet = await twitterClient.v2.tweet({
    text: caption,
    media: { media_ids: [mediaId] },
  });
  console.log(`    ✅ 投稿完了: https://x.com/i/web/status/${tweet.data.id}`);

  // [8] 一時ファイル削除
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  console.log("\n=== 完了 ===");
}

main()
  .catch((err) => {
    console.error("エラー:", err);
    process.exit(1);
  })
  .finally(() => {
    // エラー時も一時ファイルを確実に削除
    try {
      fs.rmSync(OUT_DIR, { recursive: true, force: true });
    } catch {
      // 既に削除済みの場合は無視
    }
  });
