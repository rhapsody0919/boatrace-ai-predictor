/**
 * 生の HTML の head の材料: 選手ページ（/racer/:id、4桁）。GET /api/page-head/v1/racer/{4桁}
 *
 * middleware が人の /racer/{id} の外枠に差し込む title・description・canonical・JSON-LD を JSON で返す。
 * 中身は api/_lib/pageHeadRacer.js。リージョンは vercel.json の functions（syd1 の1行はオーナーが足す）
 */
import { createRacerHeadHandler } from "../../../_lib/pageHeadRacer.js";

export const config = {
  maxDuration: 10,
};

export default createRacerHeadHandler();
