/**
 * 生の HTML の head の材料: 会場ページ（本日分、/venue/:code）。GET /api/page-head/v1/venue/{1〜24}
 *
 * middleware が人の /venue/{code} の外枠に差し込む title・description・canonical・JSON-LD を JSON で返す。
 * 中身は api/_lib/pageHeadApi.js。リージョンは vercel.json の functions（syd1 の1行はオーナーが足す）
 */
import { createVenueHeadHandler } from "../../../_lib/pageHeadApi.js";

export const config = {
  maxDuration: 10,
};

export default createVenueHeadHandler();
