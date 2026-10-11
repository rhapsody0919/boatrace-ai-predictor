/**
 * ボット向け HTML（ADR 0089）: トップ（/）の部分集合。GET /api/bot-page/top
 *
 * まだ middleware から配線していない（PR3 で配線する）。直接呼ばれても中身は公開ページの部分集合。
 * ランタイムは Node、リージョンは syd1（vercel.json の functions）。中身は api/_lib/botPage.js
 */
import { createBotPageHandler } from "../_lib/botPage.js";

export const config = {
  maxDuration: 15,
};

export default createBotPageHandler("top");
