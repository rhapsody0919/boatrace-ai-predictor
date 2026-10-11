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
 * 中身の無い画面が返っていた。失敗のたびに新しいページで描き直し、落ちたページを引きずらない。
 *
 * ページは途中で閉じない（最後にブラウザごと閉じる）。単一プロセスの Chromium では、ページを閉じた
 * だけでブラウザごと落ちることがあり、失敗が毎回、ワーカーが仕事を終えてページを閉じ始めるリストの
 * 最後に集まっていた（2026-10-11 の本番・Preview のビルドログ）。
 *
 * @template T
 * @param {T[]} items
 * @param {{
 *   concurrency: number,
 *   openPage: () => Promise<unknown>,
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

  async function worker() {
    let page = await openPage();
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
          // 失敗したページは閉じずに置いておく（関数の説明の「ページは途中で閉じない」）
          page = await openPage();
        }
      }
      if (lastError) {
        failed.push({ item, error: lastError.message });
      } else {
        succeeded.push(item);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { succeeded, failed };
}
