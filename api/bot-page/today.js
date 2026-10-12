/**
 * ボット向け HTML（ADR 0089 第2段、BOA-848）: /today（本日のデータ一覧）の部分集合。GET /api/bot-page/today
 *
 * 材料は morning_digest_days・morning_digest_rows（人の画面と同じ2表・同じ anon キー）。選手の一覧は出さない。
 * ランタイムは Node、リージョンは syd1（vercel.json の functions）。中身は api/_lib/botToday.js
 */
import { createTodayBotHandler } from "../_lib/botToday.js";

export const config = {
  maxDuration: 15,
};

export default createTodayBotHandler();
