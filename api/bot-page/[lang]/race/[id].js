/**
 * ボット向け HTML（ADR 0089 第2段、BOA-848）: 言語版のレース詳細（本日の /{lang}/race/{id}）の部分集合。
 * GET /api/bot-page/{lang}/race/{id}
 *
 * 言語（en・zh-TW・ko）と id（本日の YYYY-MM-DD-VV-RR）はパスから読み、それ以外は 404。
 * middleware の rewrite 経由では req.url が元の /{lang}/race/{id} のまま届く。
 * ランタイムは Node、リージョンは syd1（vercel.json の functions）。中身は api/_lib/botRace.js
 */
import { createRaceBotHandler } from "../../../_lib/botRace.js";

export const config = {
  maxDuration: 15,
};

export default createRaceBotHandler({ langMode: "prefixed" });
