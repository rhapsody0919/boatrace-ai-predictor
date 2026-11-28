/**
 * 出走表の当地勝率の下に出す、本人の全国勝率との差（意味づけ）。
 * 当地勝率は会場ごとの物差しなので全選手の中の位置は付けず、本人の全国勝率との差を色なしで出す
 * （data-scientist 2026-11-28）。勝率・2連率の「今日の出走者の中の上位N割」は、オーナー（2026-11-28）と
 * ファン役4人が「表には不要」としたので出さない。
 */

const valueOf = (raw) => {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** 当地勝率 − 全国勝率（小数2桁）。当地が 0・値なし（当地の出走なし）なら null */
export function localVsNational(localWinRate, winRate) {
  const local = valueOf(localWinRate);
  const national = valueOf(winRate);
  if (local === null || national === null) return null;
  return Math.round((local - national) * 100) / 100;
}
