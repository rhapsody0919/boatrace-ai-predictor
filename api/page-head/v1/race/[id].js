/**
 * 生の HTML の head の材料: レース詳細（/race/:raceId、本日と過去日）。GET /api/page-head/v1/race/{id}
 *
 * middleware が人の /race/{id} の外枠に差し込む title・description・canonical・JSON-LD を JSON で返す。
 * 中身は api/_lib/pageHeadApi.js。リージョンは vercel.json の functions（syd1 の1行はオーナーが足す）
 */
import { createRaceHeadHandler } from "../../../_lib/pageHeadApi.js";

export const config = {
  maxDuration: 10,
};

export default createRaceHeadHandler();
