/**
 * ボット向け HTML（ADR 0089、BOA-848 第2段）: 言語版の会場ページ（本日分、/{lang}/venue/:code）の部分集合。
 * GET /api/bot-page/{lang}/venue/{1〜24}
 *
 * 言語（en・zh-TW・ko）と会場コード（1〜24、0埋めなし）はパスから読み、それ以外は 404。クエリ文字列は見ない。
 * middleware の rewrite 経由では req.url が元の /{lang}/venue/{code} のまま届く。
 * ランタイムは Node、リージョンは syd1（vercel.json の functions）。中身は api/_lib/botPage.js
 */
import { createBotPageHandler } from "../../../_lib/botPage.js";

export const config = {
  maxDuration: 15,
};

export default createBotPageHandler("venue", { langMode: "prefixed" });
