/**
 * ボット向け HTML（ADR 0089 第2段、BOA-848）: レース詳細（本日の /race/{id}）の部分集合。GET /api/bot-page/race/{id}
 *
 * id は YYYY-MM-DD-VV-RR で、日付が本日（JST）のものだけ。それ以外は 404。選手一覧・オッズ・払戻・着順は出さない。
 * middleware の rewrite 経由では req.url が元の /race/{id} のまま届く。
 * ランタイムは Node、リージョンは syd1（vercel.json の functions）。中身は api/_lib/botRace.js
 */
import { createRaceBotHandler } from "../../_lib/botRace.js";

export const config = {
  maxDuration: 15,
};

export default createRaceBotHandler();
