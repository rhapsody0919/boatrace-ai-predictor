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
 *
 * タイムアウト設計（案B採用、2026-09-14決定）: cron-job.orgのタイムアウト（30秒）と
 * 実際のスクレイピング所要時間（対象レース数次第で30秒を超えうる、実測で確認済み）は
 * 別々の関心事のため、レスポンスを即座に返し、実処理は waitUntil() でバックグラウンド
 * 継続する。「トリガーが届いたか」（cron-job.orgの関心）と「スクレイピング・書き込みが
 * 成功したか」（こちらの関心）を混同しない設計。後者の監視は日次の欠落率チェック
 * （spec.md Step 2）で行う。1回あたりの処理レース数に人為的な上限は設けない
 * （設ける＝GitHub Actionsで起きたキュー詰まりを小さいスケールで再現するだけのため）。
 */

import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getTodayDateJST } from "../../scripts/lib/dateUtils.js";
import { getRaceSchedule } from "../../scripts/lib/raceSchedule.js";
import { run as runExhibition } from "../../scripts/daily/scrape-exhibition-data.js";

export const config = {
  maxDuration: 300,
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
    // バックグラウンドで継続する（対象レース数に関わらず同じコードパス、
    // 人為的な件数上限は設けない）。結果はSupabaseへの書き込みそのものと
    // 関数ログで確認する（日次の欠落率チェックが正式な監視手段）。
    waitUntil(
      runExhibition(schedule, date).catch((error) => {
        console.error(
          "❌ 展示データ取得エラー（バックグラウンド処理）:",
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
