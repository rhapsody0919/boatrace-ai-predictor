/**
 * ボット向け HTML（ADR 0089）: 会場ページ（本日分、/venue/:code）の部分集合。GET /api/bot-page/venue/{1〜24}
 *
 * 会場コードはパスの末尾から読む（0埋め・範囲外・数字以外は 404、クエリ文字列は見ない）。
 * middleware が配る UA の /venue/{1〜24} をここへ rewrite する（req.url は元の /venue/{code} のまま届く）。ランタイムは Node、リージョンは syd1（vercel.json の functions）。
 * 中身は api/_lib/botPage.js
 */
import { createBotPageHandler } from "../../_lib/botPage.js";

export const config = {
  maxDuration: 15,
};

export default createBotPageHandler("venue");
