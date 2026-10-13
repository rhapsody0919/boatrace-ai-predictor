/**
 * 送る前のリンク先の表示の確認の実体（sns-pdca-loop tasks 10、spec A2、ADR 0091）。
 * createDeadlinePreflight（snsDeadlineQueue.js）の headless.inspect の契約:
 *   inspect({url, context: {storageState: null}, requiredSelectors}) -> {finalUrl, visibleSelectors}
 *
 * - Chromium は最初の inspect で1回だけ起動し、同じ実行の中で使い回す。終わったら close() する（呼び出し側の責任）
 * - 毎回新しい context（Cookie・Storage なし）で開く。解析のタグ（GA4）は読み込ませない（確認のアクセスを数えないため）
 * - 印は要素が実際に見えている（visible）ものだけを返す。待つのは1つの印につき最大 waitMs
 */
import { launchChromium } from "../../scripts/lib/launchChromium.js";

const BLOCKED = /google-analytics\.com|googletagmanager\.com|doubleclick\.net/;

export function createChromiumHeadless({
  launch = launchChromium,
  gotoTimeoutMs = 30000,
  waitMs = 15000,
} = {}) {
  let browser = null;
  return {
    async inspect({ url, context: options = {}, requiredSelectors = [] }) {
      if (options.storageState != null)
        throw new Error("未ログインの context だけで確かめます");
      browser ??= await launch();
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: undefined,
      });
      try {
        await context.route(BLOCKED, (route) => route.abort());
        const page = await context.newPage();
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: gotoTimeoutMs,
        });
        const visible = await Promise.all(
          requiredSelectors.map((selector) =>
            page
              .locator(selector)
              .first()
              .waitFor({ state: "visible", timeout: waitMs })
              .then(
                () => selector,
                () => null,
              ),
          ),
        );
        return {
          finalUrl: page.url(),
          visibleSelectors: visible.filter(Boolean),
        };
      } finally {
        await context.close();
      }
    },
    async close() {
      if (browser) await browser.close();
      browser = null;
    },
  };
}
