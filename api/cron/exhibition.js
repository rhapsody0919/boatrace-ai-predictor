/**
 * 展示データ取得（Vercel Function版、BOA案件: スクレイピング基盤のサーバーレス移行 Phase 1）
 *
 * 既存の scripts/daily/scrape-exhibition-data.js の run(schedule, date) をそのまま呼び出す。
 * ロジックは一切複製しない（GitHub Actions版と完全に同一の挙動）。
 *
 * cron-job.org から直接呼び出される想定。GitHub Actions の concurrency 直列化・
 * チェックアウト等の固定コストが無いため、5分間隔でも詰まらない設計にできる。
 * 詳細: docs/design/scraping-serverless-migration/spec.md
 *
 * 認証: Authorization: Bearer {CRON_SECRET} ヘッダーが一致しない限り拒否する。
 * cron-job.org のタイムアウトは30秒のため、応答をそれ以内に返す設計にすること
 * （実測ベースでは展示データ取得は数レース〜十数レースなら数十秒以内に収まる見込み。
 * 超過が確認された場合は spec.md の「タイムアウト設計」案A/Bを検討する）。
 */

import { timingSafeEqual } from "node:crypto";
import { getTodayDateJST } from "../../scripts/lib/dateUtils.js";
import { getRaceSchedule } from "../../scripts/lib/raceSchedule.js";
import { run as runExhibition } from "../../scripts/daily/scrape-exhibition-data.js";

export const config = {
  maxDuration: 60,
};

// 単純な !== 比較はタイミングサイドチャネルになりうるため定数時間で比較する
function isAuthorized(authHeader, expected) {
  if (!expected || !authHeader) return false;
  const expectedBuf = Buffer.from(`Bearer ${expected}`);
  const actualBuf = Buffer.from(authHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export default async function handler(req, res) {
  if (!isAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }

  try {
    const date = getTodayDateJST();
    const schedule = await getRaceSchedule(date);

    if (schedule.length === 0) {
      return res.status(200).json({
        success: true,
        updated: false,
        message: "no schedule for today",
        date,
      });
    }

    const result = await runExhibition(schedule, date);

    return res.status(200).json({
      success: true,
      date,
      ...result,
    });
  } catch (error) {
    console.error("❌ 展示データ取得エラー（Vercel Function）:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
