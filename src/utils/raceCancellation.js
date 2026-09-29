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
 * 着順つきの結果があるか（＝レースは行われた）。
 *
 * 「結果がある」は **1着の艇番（rank1）が入っている** こと。
 * - `result` は画面の結果オブジェクト（buildRaceResult の戻り。rank1 が無ければ
 *   result 自体が null）でも、`race_results` の生の行でもよい。どちらも `rank1` を持つ
 * - 返還（race_status='partial_refund'）・不成立（'no_race'）の行も rank1 を持つ。
 *   不成立は「舟券が成立しなかった」だけでレースは行われているので、中止ではない
 * - 本当の中止・順延は結果ページ自体が無く、`race_results` の行が無い（078 の設計）
 *
 * 2026-09-29 の本番実測: `race_results` 46,451行はすべて rank1 が非NULL、
 * `cancellation_status='confirmed'` の531レースはすべて結果の行が無い。
 *
 * @param {{result?: {rank1?: number|null}|null}|null|undefined} entity
 * @returns {boolean}
 */
export function hasRaceResult(entity) {
  return entity?.result?.rank1 != null;
}

/**
 * 開催中止として扱うか。
 *
 * **中止が確定（confirmed） かつ 着順つきの結果が無い** とき真。
 * `confirmed` は「中止・順延」と「発走90分後までに結果が取れなかった」の両方を表し
 * （マイグレーション047）、結果が後から入っても自動では消えないことがある
 * （BOA-512: 2026-09-12 に結果のある32本が confirmed のまま残り、的中/外れバッジと
 * 中止バッジが同時に出た）。結果があるなら行われたレースなので、中止扱いしない
 * （BOA-525。集計側の BOA-490 と同じ考え方）。
 *
 * `cancellationStatus` と、あれば `result` を持つものなら何でも受ける
 * （レース・予想・RPCの戻り）。`result` を持たない呼び出し元（今日のレース一覧 RPC 等）
 * では、従来どおり `cancellationStatus` だけで決まる。
 * null / undefined は「中止ではない」に倒す（データ未取得を中止として扱わない）。
 *
 * @param {{cancellationStatus?: string|null, result?: {rank1?: number|null}|null}|null|undefined} entity
 * @returns {boolean}
 */
export function isRaceCancelled(entity) {
  return (
    entity?.cancellationStatus === CANCELLATION_CONFIRMED &&
    !hasRaceResult(entity)
  );
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
