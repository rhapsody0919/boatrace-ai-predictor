/**
 * 送る前のリンク先の表示の確認の実体（sns-pdca-loop tasks 10、spec A2、ADR 0091）。
 * createDeadlinePreflight（snsDeadlineQueue.js）の headless.inspect の契約:
 *   inspect({url, context: {storageState: null}, requiredSelectors}) -> {finalUrl, visibleSelectors}
 *
 * - Chromium は最初の inspect で1回だけ起動し、同じ実行の中で使い回す。終わったら close() する（呼び出し側の責任）
 * - 毎回新しい context（Cookie・Storage なし）で開く。解析のタグ（GA4）は読み込ませない（確認のアクセスを数えないため）
 * - 印は要素が実際に見えている（visible）ものだけを返す。待つのは1つの印につき最大 waitMs
 * - 1回の実行で開くのは maxInspections 回まで（1回 最大 約45秒。関数の300秒を超えないため）。超えたら public_check_budget で止める
 * - 起動に失敗したら、同じ実行の中では起動し直さない（同じ失敗を候補の数だけ繰り返さない）
 */
import { launchChromium } from "../../scripts/lib/launchChromium.js";

const BLOCKED = /google-analytics\.com|googletagmanager\.com|doubleclick\.net/;

export function createChromiumHeadless({
  launch = launchChromium,
  gotoTimeoutMs = 30000,
  waitMs = 15000,
  maxInspections = 6,
} = {}) {
  let browser = null;
  let launchError = null;
  let inspections = 0;
  return {
    async inspect({ url, context: options = {}, requiredSelectors = [] }) {
      if (options.storageState != null)
        throw new Error("未ログインの context だけで確かめます");
      if (inspections >= maxInspections) throw new Error("public_check_budget");
      inspections += 1;
      if (launchError) throw launchError;
      try {
        browser ??= await launch();
      } catch (error) {
        launchError = error;
        throw error;
      }
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
