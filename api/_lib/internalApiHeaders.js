/**
 * 自分の処理が /api を呼ぶときに付ける合言葉のヘッダ（BOA-1110 段階1、ADR-0103、
 * docs/design/public-api-lockdown/plan.md §2.2・§4）。
 *
 * - x-ryujin-caller: 秘密でない呼び出し元の名前。関門のログで群ごとに数える（段階3の進む条件の母数）。常に付ける
 * - x-ryujin-internal-key: 環境変数 INTERNAL_API_KEY の値。鍵が無い（未設定・空）ときは付けない
 *   （plan §4 段階1「鍵が無ければ合言葉を付けないだけ」。関門が enforce になるまでは付けなくても動きは同じ）
 *
 * 呼び出し元の付け忘れは scripts/maintenance/verify-internal-api-callers.js（CI）が止める。
 * 鍵の値はログ・例外の文に出さない。
 */
export const INTERNAL_KEY_HEADER = "x-ryujin-internal-key";
export const CALLER_HEADER = "x-ryujin-caller";

// 関門（apiGate.js の sanitizeCaller）が英数字とハイフン32字までに丸めるので、付ける側で同じ形に限る
const CALLER_FORM = /^[A-Za-z0-9-]{1,32}$/;

/**
 * @param {string} caller 呼び出し元の名前（例 "bot-page"）
 * @param {Record<string, string|undefined>} [env] 既定は process.env
 * @returns {Record<string, string>} fetch の headers に混ぜる
 */
export function internalApiHeaders(caller, env = process.env) {
  if (typeof caller !== "string" || !CALLER_FORM.test(caller)) {
    throw new Error(
      `呼び出し元の名前 "${caller}" は英数字とハイフンの32字までにする`,
    );
  }
  const key = env?.INTERNAL_API_KEY;
  return typeof key === "string" && key !== ""
    ? { [CALLER_HEADER]: caller, [INTERNAL_KEY_HEADER]: key }
    : { [CALLER_HEADER]: caller };
}
