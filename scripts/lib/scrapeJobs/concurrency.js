/**
 * 並列度の上限つきの map（取得先への負荷を抑える。plan.md §8）。
 * 結果は入力と同じ順序。fn が投げた例外は、その要素の結果を投げ直さず、呼び出し側で扱えるよう
 * 呼び出し側の fn の中で捕捉すること（1つの失敗で他の要素を止めないため、ここでは捕捉しない）。
 *
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} limit 同時に実行する数（1以上）
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  if (!(limit >= 1)) throw new Error(`並列度は1以上にしてください: ${limit}`);
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * 同時実行数を制限するセマフォ（politeFetch が使う）。
 * @param {number} max
 */
export function createSemaphore(max) {
  let active = 0;
  const waiters = [];
  return {
    /** @template R @param {() => Promise<R>} fn @returns {Promise<R>} */
    async run(fn) {
      // 空きがあれば、その場で枠を取る。無ければ、待機して、前の実行から枠を引き継ぐ
      // （枠を一度返してから取り直すと、その間に新しい呼び出しが割り込み、上限を超える）
      if (active < max) active++;
      else await new Promise((resolve) => waiters.push(resolve));
      try {
        return await fn();
      } finally {
        const next = waiters.shift();
        if (next) next();
        else active--;
      }
    },
    get active() {
      return active;
    },
  };
}
