/**
 * .range() のページを、短いページが返るまで読み続けて全件を返す（BOA-1051）。
 *
 * PostgREST の既定の上限は1000行で、超えるとエラーにならず黙って切れる
 * （.claude/rules/frontend-data-fetch.md §5）。fetchPage は1ページ分のクエリを
 * 毎回新しく組み立てて返す。ページの境目で行が重複・欠落しないよう、クエリには
 * 一意な並び（主キー）の .order() を付けておくこと（BOA-595）。
 * 取得の失敗は、クライアントの .throwOnError() 既定（ADR-0069）で例外になる。
 *
 * DB のクライアントに依存しないので、偽の fetchPage で試験できる
 * （scripts/maintenance/verify-racer-entries-paging.js）
 *
 * @template T
 * @param {(from: number, to: number) => PromiseLike<{ data: T[] | null }>} fetchPage
 * @param {number} [pageSize]
 * @returns {Promise<T[]>}
 */
export async function fetchAllPages(fetchPage, pageSize = 1000) {
  const results = [];
  let from = 0;
  while (true) {
    const { data } = await fetchPage(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

/**
 * in() の値を並べて chunkSize ごとに分け、それぞれを fetchAllPages で読み切って、分けた順につなぐ（BOA-1051）。
 * in() の値が多いと URL が長すぎて要求が落ちる（2026-10-25 の本番の実測: race_id 800件・URL 約15.4KB は通り、
 * 850件・約16.3KB で fetch failed）。in() の列が並びの先頭の列で、値の文字列の順と DB の並びが一致する
 * （race_id のように桁と区切りの位置がそろった文字列）なら、つないだ結果は分けずに読んだときと同じ並びになる。
 * 分けた組は並行で読む（待ち時間を1組分にするため）。どれか1組でも失敗したら例外。値が無ければ要求を送らず空配列
 *
 * @template T
 * @param {Array<string|number>} values
 * @param {number} chunkSize
 * @param {(chunk: Array<string|number>, from: number, to: number) => PromiseLike<{ data: T[] | null }>} fetchPage
 * @returns {Promise<T[]>}
 */
export async function fetchAllInChunks(values, chunkSize, fetchPage) {
  const sortedValues = [...new Set(values)].sort();
  const chunks = [];
  for (let i = 0; i < sortedValues.length; i += chunkSize) {
    chunks.push(sortedValues.slice(i, i + chunkSize));
  }
  const pages = await Promise.all(
    chunks.map((chunk) =>
      fetchAllPages((from, to) => fetchPage(chunk, from, to)),
    ),
  );
  return pages.flat();
}
