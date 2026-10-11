/**
 * ページを並列に描いて保存する。1件失敗したら、そのページを閉じて新しいページで再試行する。
 *
 * 2026-10-11 の本番ビルドで、ページが1つ落ちた（"Target page, context or browser has been
 * closed"）あと、同じページを使い続けた後続の3記事がすべて失敗し、AI クローラーには
 * 中身の無い画面が返っていた。失敗のたびにページを作り直すことで、落ちたページを引きずらない。
 *
 * @template T
 * @param {T[]} items
 * @param {{
 *   concurrency: number,
 *   openPage: () => Promise<{ isClosed: () => boolean, close: () => Promise<void> }>,
 *   render: (page: unknown, item: T) => Promise<void>,
 *   retries?: number,
 * }} options
 * @returns {Promise<{ succeeded: T[], failed: { item: T, error: string }[] }>}
 */
export async function renderWithFreshPage(
  items,
  { concurrency, openPage, render, retries = 1 },
) {
  let index = 0;
  const succeeded = [];
  const failed = [];

  const closePage = async (page) => {
    if (!page.isClosed()) await page.close();
  };

  async function worker() {
    let page = await openPage();
    try {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
          try {
            await render(page, item);
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            await closePage(page);
            page = await openPage();
          }
        }
        if (lastError) {
          failed.push({ item, error: lastError.message });
        } else {
          succeeded.push(item);
        }
      }
    } finally {
      await closePage(page);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { succeeded, failed };
}
