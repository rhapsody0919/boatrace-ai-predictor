/**
 * データ取得の状態の集計（GET・読み取り専用。BOA-1480、ZB15 票4）。
 * 返すのは集計だけ（今日の JST の日付・races の件数・ジョブごとの last_tick_at と mode・開いている expired の件数・
 * scrape-monitor 自身の last_run）。選手・オッズ・鍵・URL は含めない。集計は scripts/lib/scrapeJobs/statusSummary.js。
 *
 * 認証: この面では検査も除外も足さない。呼び出しの認証は ADR-0103 の関門（x-ryujin-internal-key）が行う
 * （middleware.js・vercel.json は変えない）。
 */
import { readStatusSummary } from "../../scripts/lib/scrapeJobs/statusSummary.js";

export const config = {
  maxDuration: 30,
};

/** テストでは getClient・now を差し替える（既定は共通の Supabase クライアントと現在時刻） */
export function createStatusSummaryHandler({
  getClient = async () => (await import("../../scripts/lib/supabaseClient.js")).supabase,
  now = () => new Date(),
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ success: false, error: "method_not_allowed" });
    }
    try {
      const client = await getClient();
      if (!client) {
        return res
          .status(500)
          .json({ success: false, error: "Supabase が設定されていません" });
      }
      const summary = await readStatusSummary(client, now());
      return res.status(200).json({ success: true, ...summary });
    } catch (error) {
      console.error("scrape-status summary error:", error);
      // 内部の文言は返さない（鍵・URL が混じりうる）。原因はログで見る
      return res.status(500).json({ success: false, error: "summary_failed" });
    }
  };
}

export default createStatusSummaryHandler();
