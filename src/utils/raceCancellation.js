/**
 * 開催中止・順延の判定を1箇所に集める。
 *
 * `races.cancellation_status` は null / "tentative" / "confirmed" の3値を取る
 * （遷移の定義は scripts/lib/cancellationStatus.js、ADR-0041）。画面側は
 * `cancellationStatus === "confirmed"` という文字列比較を各所で独立に書いており、
 * 2026-09-25時点で3箇所に散らばっていた。同日のPR #824（イン崩れハイライトが
 * 中止レースを除外していない不具合）は、中央化せずに4箇所目を足す形で直している。
 *
 * ADR-0069（Supabaseの取得エラーを既定で例外にする）と同じ発想で、
 * 「毎回正しく書く」ではなく「1箇所を呼ぶ」に寄せる。生の文字列比較が戻ってきたら
 * scripts/maintenance/verify-race-cancellation-usage.js が検知する。
 */

/** 開催中止が確定した。結果も出ない。 */
export const CANCELLATION_CONFIRMED = "confirmed";
/**
 * 中止の疑い（発走前の暫定検知で、選手情報0人が3回続いた）。
 * 確定ではないので、画面はこれを中止として扱っていない。誤検出からの復帰もありうる。
 */
export const CANCELLATION_TENTATIVE = "tentative";

/**
 * 開催中止が確定しているか。
 *
 * `cancellationStatus` を持つものなら何でも受ける（レース・予想・RPCの戻り）。
 * null / undefined は「中止ではない」に倒す（データ未取得を中止として扱わない）。
 *
 * @param {{cancellationStatus?: string|null}|null|undefined} entity
 * @returns {boolean}
 */
export function isRaceCancelled(entity) {
  return entity?.cancellationStatus === CANCELLATION_CONFIRMED;
}

/**
 * 中止の疑いがあるが、まだ確定していないか。
 *
 * 今のところ画面では使っていない。`isRaceCancelled` が false であることと
 * 「中止の疑いが無い」ことは別だと呼び出し側が意識できるよう、対で公開する。
 *
 * @param {{cancellationStatus?: string|null}|null|undefined} entity
 * @returns {boolean}
 */
export function isCancellationSuspected(entity) {
  return entity?.cancellationStatus === CANCELLATION_TENTATIVE;
}
