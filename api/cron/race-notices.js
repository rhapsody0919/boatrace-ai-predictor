/**
 * レース特記事項取得（Vercel Function版、FR-1）
 *
 * scripts/daily/scrape-race-information.js の run(schedule, date) をそのまま
 * 呼び出す。ロジックは一切複製しない（api/cron/exhibition.jsと同じ設計方針）。
 *
 * cron-job.org から10分間隔（7:00-23:00 JST）で直接呼び出される想定。
 * 開催中の全会場（最大24会場）を1回の呼び出しで巡回するため、素朴に実装すると
 * cron-job.orgのタイムアウト（30秒）を超えるリスクがある（ADR-0059参照）。
 * exhibition.jsと同じ「即時応答＋waitUntilバックグラウンド継続」パターンを踏襲する。
 *
 * 認証: Authorization: Bearer {CRON_SECRET} ヘッダーが一致しない限り拒否する。
 */

import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getTodayDateJST } from "../../scripts/lib/dateUtils.js";
import { getRaceSchedule } from "../../scripts/lib/raceSchedule.js";
import { run as runRaceInformation } from "../../scripts/daily/scrape-race-information.js";

export const config = {
  maxDuration: 300,
};

// 単純な !== 比較はタイミングサイドチャネルになりうるため定数時間で比較する
// （api/cron/exhibition.jsと同一実装）
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

  const date = getTodayDateJST();
  try {
    const schedule = await getRaceSchedule(date);

    if (schedule.length === 0) {
      return res.status(200).json({
        success: true,
        accepted: false,
        message: "no schedule for today",
        date,
      });
    }

    // cron-job.orgへは即座に応答を返し、実際のスクレイピング・書き込みは
    // バックグラウンドで継続する。結果はSupabaseへの書き込みそのものと
    // 関数ログ、および日次の構造変化監視（check-race-notices-drift.js）で確認する
    waitUntil(
      runRaceInformation(schedule, date).catch((error) => {
        console.error(
          "❌ レース特記事項取得エラー（バックグラウンド処理）:",
          error,
        );
      }),
    );

    return res.status(202).json({
      success: true,
      accepted: true,
      date,
      message: "processing in background",
    });
  } catch (error) {
    console.error("❌ スケジュール取得エラー（Vercel Function）:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
