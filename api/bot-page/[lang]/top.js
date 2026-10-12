/**
 * ボット向け HTML（ADR 0089、BOA-848 第2段）: 言語版のトップ（/en/・/zh-TW/・/ko/）の部分集合。GET /api/bot-page/{lang}/top
 *
 * 言語はパスから読む（en・zh-TW・ko 以外は 404）。middleware の rewrite 経由では req.url が元の /{lang}/ のまま届く。
 * ランタイムは Node、リージョンは syd1（vercel.json の functions）。中身は api/_lib/botPage.js
 */
import { createBotPageHandler } from "../../_lib/botPage.js";

export const config = {
  maxDuration: 15,
};

export default createBotPageHandler("top", { langMode: "prefixed" });
