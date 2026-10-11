/**
 * 新しいページを開く関数を作る。ブラウザが落ちていたら起動し直してから開く。
 *
 * Vercel のビルドで使う Chromium（@sparticuz/chromium）は `--single-process` で動くため、
 * ページが1つ落ちるとブラウザごと落ちる（2026-10-11 の Preview で、作り直しの newPage が
 * "Target page, context or browser has been closed" で失敗し、ブログの生成全体が止まった）。
 * 並列のワーカーが同時に落ちたことに気づいても、起動し直すのは1回だけにする。
 *
 * @param {() => Promise<{ isConnected: () => boolean, newPage: () => Promise<unknown>, close: () => Promise<void> }>} launch
 * @returns {{ openPage: () => Promise<unknown>, close: () => Promise<void>, launches: () => number }}
 */
export function createPageOpener(launch) {
  let launched = 0;
  const start = () => {
    launched += 1;
    return launch();
  };
  let browserPromise = null;

  const openPage = async () => {
    browserPromise ??= start();
    const browser = await browserPromise;
    if (!browser.isConnected()) {
      // 先に気づいたワーカーが差し替えた後なら、それを使う
      browserPromise = browserPromise.then((current) =>
        current.isConnected() ? current : start(),
      );
    }
    return (await browserPromise).newPage();
  };

  const close = async () => {
    if (!browserPromise) return;
    const browser = await browserPromise;
    if (browser.isConnected()) await browser.close();
  };

  return { openPage, close, launches: () => launched };
}

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
