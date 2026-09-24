/**
 * wilson - 二項比率のWilson信頼区間（純関数）
 *
 * 「本日のデータ一覧」（BOA-402、docs/design/morning-data-digest/）の小標本フラグと
 * 並び順に使う。バッチ（scripts/daily/generate-morning-digest.js）とフロント
 * （src/components/digest/）の両方から呼ぶため、DBにもDOMにも依存しない純関数にする。
 *
 * なぜ単純な比率ではなくWilson下限を使うか:
 *   地力窓（利用可能な全期間）でも1選手あたりの1コース進入は中央値26走しかなく
 *   （spec.md §1.2、構造的な上限でデータ蓄積では解決しない）、生の率で並べると
 *   小標本が上位を占める。Wilson区間は正規近似（Wald）と違い、p̂が0や1に近くても
 *   区間が[0,1]の外に出ず、小標本でも破綻しない。
 *
 * 小標本フラグの基準（2026-09-24の独立レビュー指摘H-3で修正）:
 *   当初は「Wilson下限 < その指標の全国ベースレート」としていたが、まくりで
 *   数学的に逆に働いていた。まくりのベースレートは3.76〜5.08%と低く、
 *   抽出条件（25%以上）の最小構成 p̂=0.25・n=10 でもWilson下限は8.1%で
 *   ベースレートを上回るため、フラグが一度も立たない。
 *   比較対象を「抽出閾値」に変えると 8.1% < 25% となり正しく立つ。
 */

const DEFAULT_Z = 1.96; // 95%

/**
 * Wilson信頼区間の下限を返す。
 *
 * @param {number} successes 成功数（0以上、n以下）。**整数でなくてもよい**
 *   （率から逆算した値を渡すケースがあるため。整数に丸めてから渡すと
 *   p̂ がずれる: n=8・率70% を round(5.6)=6 にすると p̂=0.75 になる）
 * @param {number} n 試行数
 * @param {number} [z] 標準正規分布の分位点（既定1.96＝95%）
 * @returns {number|null} 下限（0〜1）。n<=0 のときは null（「0%だった」と「走っていない」を区別する）
 */
export function wilsonLowerBound(successes, n, z = DEFAULT_Z) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isFinite(successes) || successes < 0 || successes > n) {
    throw new Error(
      `wilsonLowerBound: successes(${successes}) は 0以上 n(${n})以下である必要があります`,
    );
  }

  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);

  // 数値誤差で 0 をわずかに下回ることがあるため下側だけクランプする
  return Math.max(0, (center - margin) / denominator);
}

/**
 * 比率（0〜1）と試行数からWilson下限を返す。
 *
 * 保存されている値が丸め済みの率（NUMERIC(5,2)）だけで成功数の整数が手元に無い場合に使う。
 * 成功数の整数が分かるなら wilsonLowerBound を直接使うほうが正確。
 *
 * @param {number} rate 比率（0〜1）
 * @param {number} n 試行数
 * @param {number} [z]
 * @returns {number|null}
 */
export function wilsonLowerBoundFromRate(rate, n, z = DEFAULT_Z) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(
      `wilsonLowerBoundFromRate: rate(${rate}) は 0〜1 である必要があります`,
    );
  }
  return wilsonLowerBound(rate * n, n, z);
}

/**
 * 小標本かどうかを判定する。
 *
 * 「この率は、母数が少ないせいで基準値を上回って見えているだけかもしれない」状態を
 * 小標本とみなす。referenceRate には**その指標の抽出閾値**を渡す（ベースレートではない。
 * 上記の経緯を参照）。
 *
 * 注意: 率がちょうど抽出閾値と等しい行は、**母数がいくら大きくても常に true になる**。
 * Wilson下限は定義上 p̂ を下回るため。これは意図した挙動で、「ぎりぎり閾値を満たしただけの
 * 行」は母数が大きくても『本当は閾値未満かもしれない』という注意書きに値する。
 * 率が閾値から十分離れていれば、母数が増えるにつれて false になる
 * （例: 逃げ率90.3%・n=31 は下限が約74%で閾値70%を上回るため false）。
 *
 * @param {number} successes 成功数（整数でなくてもよい）
 * @param {number} n 試行数
 * @param {number} referenceRate 比較する基準（0〜1）。通常はその指標の抽出閾値
 * @param {number} [z]
 * @returns {boolean} 母数が無い場合も true（数値を鵜呑みにさせない側に倒す）
 */
export function isSmallSample(successes, n, referenceRate, z = DEFAULT_Z) {
  const lower = wilsonLowerBound(successes, n, z);
  if (lower === null) return true;
  return lower < referenceRate;
}
