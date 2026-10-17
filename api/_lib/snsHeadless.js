/**
 * 送る前のリンク先の表示の確認の実体（sns-pdca-loop tasks 10、spec A2、ADR 0091）。
 * createDeadlinePreflight（snsDeadlineQueue.js）の headless.inspect の契約:
 *   inspect({url, context: {storageState: null}, requiredSelectors}) -> {finalUrl, visibleSelectors}
 *
 * - Chromium は開くたびに起動し、開き終わったら閉じる。@sparticuz/chromium は --single-process で動き、開いた context を閉じると
 *   ブラウザごと終わる（2026-10-17 本番で /today の後の龍神ソナーの図が4枚とも「browser has been closed」。
 *   GitHub Actions の Docker で 1〜4 GB のどれでも再現し、メモリ不足ではなかった）。1枚で落ちても次は新しいブラウザで開く。
 *   close() は互換のために残す（呼び出し側の後始末、開いたままのブラウザは無い）
 * - 毎回新しい context（Cookie・Storage なし）で開く。解析のタグ（GA4）は読み込ませない（確認のアクセスを数えないため）
 * - 印は要素が実際に見えている（visible）ものだけを返す。待つのは1つの印につき最大 waitMs
 * - 1回の実行で開くのは maxInspections 回まで（1回 最大 約45秒。関数の300秒を超えないため）。超えたら public_check_budget で止める
 * - 起動に失敗したら、同じ実行の中では起動し直さない（同じ失敗を候補の数だけ繰り返さない）
 */
import {
  lastLaunch,
  launchChromium,
} from "../../scripts/lib/launchChromium.js";

const BLOCKED = /google-analytics\.com|googletagmanager\.com|doubleclick\.net/;
// Cookie の同意の帯（src/components/CookieConsent.jsx）は、同意の記録が無いと画面の下に出て、画像の下半分を覆う（2026-10-16）。
// 読み込みの前に「拒否」を記録しておく（解析は上の BLOCKED でも止めている）。キーは src/utils/analytics.js の CONSENT_KEY
export const CONSENT_KEY = "boatai:cookie-consent";
const OVERLAYS = [".cookie-consent"];

export function createChromiumHeadless({
  launch = launchChromium,
  gotoTimeoutMs = 30000,
  waitMs = 15000,
  maxInspections = 6,
} = {}) {
  let launchError = null;
  let inspections = 0;
  // 未ログインの新しい context で開き、印が見えるのを待ってから after(page) を呼ぶ。開いた回数は inspect・screenshot の合計で数える
  async function open(
    { url, viewport, deviceScaleFactor, requiredSelectors },
    after,
  ) {
    if (inspections >= maxInspections) throw new Error("public_check_budget");
    inspections += 1;
    if (launchError) throw launchError;
    let browser;
    try {
      browser = await launch();
    } catch (error) {
      launchError = error;
      throw error;
    }
    try {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor,
        storageState: undefined,
      });
      await context.route(BLOCKED, (route) => route.abort());
      await context.addInitScript((key) => {
        try {
          window.localStorage.setItem(key, "rejected");
        } catch {
          // 保存できない環境でも開く（帯が出れば screenshot が止める）
        }
      }, CONSENT_KEY);
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
        ...(after ? await after(page) : {}),
      };
    } finally {
      // context を閉じるとブラウザが終わるので、ブラウザを閉じる（context もまとめて閉じる）。落ちた後は閉じる失敗を無視する
      await browser.close().catch(() => {});
    }
  }
  return {
    async inspect({ url, context: options = {}, requiredSelectors = [] }) {
      if (options.storageState != null)
        throw new Error("未ログインの context だけで確かめます");
      return open({
        url,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        requiredSelectors,
      });
    },
    /**
     * 画面の上部を PNG で撮る（/today の X 投稿の画像、tasks 19b）。既定はスマホ幅の上部 4:5（390×488 を3倍で 1170×1464）。
     * 印が全部見えたときだけ撮る（見えないまま撮った画像を投稿しない）
     */
    /**
     * element を渡すと、その要素だけを撮る（/today の X 投稿の龍神ソナーの図、2026-10-16 ユーザー決定）。
     * label を渡すと、要素の先頭に1行の見出し（例: 会場R 締切）を差し込んでから撮る（どのレースの図か分かるように）
     */
    async screenshot({
      url,
      requiredSelectors = [],
      viewport = { width: 390, height: 488 },
      deviceScaleFactor = 3,
      element = null,
      label = null,
    }) {
      return open(
        { url, viewport, deviceScaleFactor, requiredSelectors },
        async (page) => {
          for (const selector of requiredSelectors)
            if (!(await page.locator(selector).first().isVisible()))
              throw new Error("screenshot_component_missing");
          // 画面を覆う帯が出ていれば撮らない
          for (const selector of OVERLAYS)
            if (await page.locator(selector).first().isVisible())
              throw new Error("screenshot_overlay_visible");
          // フォントの読み込みを待ってから撮る（文字が空白のまま撮らない）
          if (element) {
            const target = page.locator(element).first();
            // 図は印（requiredSelectors）より後に描かれることがある（本番の関数は手元より遅い）。印と同じだけ待つ
            await target
              .waitFor({ state: "visible", timeout: waitMs })
              .catch(() => {
                throw new Error("screenshot_component_missing");
              });
            if (label)
              await target.evaluate((node, text) => {
                const head = document.createElement("div");
                head.textContent = text;
                head.style.cssText =
                  "font-size:18px;font-weight:700;color:#fff;padding:12px 16px 0;letter-spacing:0.02em";
                node.prepend(head);
              }, label);
            await target.scrollIntoViewIfNeeded();
            await page.evaluate(() => document.fonts.ready);
            return { png: await target.screenshot({ type: "png" }) };
          }
          await page.evaluate(() => document.fonts.ready);
          return { png: await page.screenshot({ type: "png" }) };
        },
      );
    },
    async close() {},
    /** 直近の起動の様子（起動の前に止めた残りの Chromium の数・空きメモリ）。/today の失敗の理由に添える（2026-10-18） */
    launchInfo() {
      return `残り${lastLaunch.reaped}・空き${lastLaunch.freeMb ?? "?"}MB`;
    },
  };
}
