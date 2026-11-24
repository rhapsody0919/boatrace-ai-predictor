// 選手ページ「レース条件別の成績」の矢印を出してよいかの判定（純関数、I/O なし）。
// 「その条件の走」と「それ以外の走」の率の差が偶然と言えるときだけ矢印を付ける（二項の2群の比較、
// 合算の標準誤差）。根拠: docs/design/racer-wt-uiux-2026-11/analysis/number-scope.md §4

/** 率を出す・矢印を付ける最少の走数 */
export const COND_RATE_MIN_RUNS = 30;
/** 両側5%（正規分布の 97.5 パーセント点） */
export const COND_Z_CRITICAL = 1.96;

/**
 * 2群の率の差の z。x1/n1＝その条件の走、x2/n2＝それ以外の走。
 * どちらかの走が0、または合算の率が0か1で分散が0のときは null（検定できない）
 */
export function twoGroupZ(x1, n1, x2, n2) {
  if (!(n1 > 0) || !(n2 > 0)) return null;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return null;
  return (x1 / n1 - x2 / n2) / se;
}

/**
 * 矢印を付けてよいか。条件の走が30走以上で、かつ「それ以外の走」（全体－条件）との差が |z|≥1.96。
 * @param {{n:number, hits:number}} cond その条件の走数と該当（1着・2連対・3連対）の数
 * @param {{n:number, hits:number}} overall 全体の走数と該当の数（条件の走を含む）
 */
export function isConditionDiffSignificant(cond, overall) {
  if (cond.n < COND_RATE_MIN_RUNS) return false;
  const z = twoGroupZ(
    cond.hits,
    cond.n,
    overall.hits - cond.hits,
    overall.n - cond.n,
  );
  return z !== null && Math.abs(z) >= COND_Z_CRITICAL;
}
