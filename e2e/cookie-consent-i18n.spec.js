import { test, expect } from "./fixtures.js";

/**
 * Cookie 同意バナーの文言が表示言語に追随することの固定（BOA-614）。
 *
 * バナーは AppRouter 直下で全ページに出るため、/en/ などでも日本語のまま出ていた。
 * プライバシーポリシーは ja 専用（TRANSLATED_PATHS 未登録）なので、リンク先は
 * どの言語でも /privacy（言語プレフィックス無し）にする。/en/privacy は
 * LocalizedLayout が /privacy へ location.replace するため、直接 /privacy を指す。
 */
const HIRAGANA_KATAKANA = /[぀-ヿ]/;

const CASES = [
  {
    path: "/",
    text: "当サイトでは、サービス向上のためにCookieを使用しています。",
    link: "プライバシーポリシー",
    accept: "同意する",
    reject: "拒否する",
  },
  {
    path: "/en/",
    text: "We use cookies to improve our service.",
    link: "Privacy Policy",
    accept: "Accept",
    reject: "Reject",
  },
  {
    path: "/zh-TW/",
    text: "本網站使用 Cookie 以提升服務品質。",
    link: "隱私權政策",
    accept: "同意",
    reject: "拒絕",
  },
  {
    path: "/ko/",
    text: "이 사이트는 서비스 향상을 위해 쿠키를 사용합니다.",
    link: "개인정보 처리방침",
    accept: "동의",
    reject: "거부",
  },
];

for (const c of CASES) {
  test(`Cookie バナー: ${c.path} で表示言語の文言が出る`, async ({ page }) => {
    await page.goto(c.path);
    const banner = page.locator(".cookie-consent");
    await expect(banner).toBeVisible();
    await expect(banner.locator(".cookie-consent__text")).toContainText(c.text);

    const link = banner.locator(".cookie-consent__link");
    await expect(link).toHaveText(c.link);
    await expect(link).toHaveAttribute("href", "/privacy");
    await expect(banner.locator(".cookie-consent__accept")).toHaveText(
      c.accept,
    );
    await expect(banner.locator(".cookie-consent__reject")).toHaveText(
      c.reject,
    );

    if (c.path === "/") {
      // ja は修正前と同じ文面のまま（文間の半角スペースも従来の JSX の描画どおり）
      await expect(banner.locator(".cookie-consent__text")).toHaveText(
        "当サイトでは、サービス向上のためにCookieを使用しています。 詳しくはプライバシーポリシーをご確認ください。",
      );
    } else {
      expect(await banner.innerText()).not.toMatch(HIRAGANA_KATAKANA);
    }
  });
}

for (const [button, stored] of [
  [".cookie-consent__accept", "accepted"],
  [".cookie-consent__reject", "rejected"],
]) {
  test(`Cookie バナー: /en/ で ${stored} を押すと閉じて保存される`, async ({
    page,
  }) => {
    await page.goto("/en/");
    const banner = page.locator(".cookie-consent");
    await expect(banner).toBeVisible();
    await banner.locator(button).click();
    await expect(banner).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("boatai:cookie-consent")),
    ).toBe(stored);
  });
}
