import { test, expect } from "./fixtures.js";

// BOA-680: 375px の展示情報を英語・日本語で固定する。320px の英語の
// 部品名による溢れは見せ方の判断待ちなので、このテストには含めない。
for (const [lang, tab] of [
  ["/en", "Just Before"],
  ["", "直前情報"],
]) {
  test(`${lang || "ja"} 375px: 直前情報の展示情報は6艇とも横スクロール無しで収まる（BOA-680）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`${lang}/race/2026-09-29-16-12`);
    await page.locator(".race-tabs-btn", { hasText: tab }).first().click();
    const table = page.locator(".rbi-card .drt-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });
    // BOA-612 と同じく、幅を取る補足行が出てから待つ。読み込み前の
    // 小さい表を測って誤って通すことを避ける。
    await expect(table.locator(".drt-sub").first()).toBeVisible({
      timeout: 30000,
    });
    await page.waitForTimeout(1500);

    const m = await table.evaluate((el) => {
      const wrap = el.parentElement;
      const sixth = el.querySelector("thead tr:first-child th:last-child");
      return {
        sw: wrap.scrollWidth,
        cw: wrap.clientWidth,
        sixthRight: sixth.getBoundingClientRect().right,
        vw: window.innerWidth,
        pageOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.pageOverflow).toBe(0);
    expect(m.sixthRight).toBeLessThanOrEqual(m.vw);
  });
}

// BOA-821: 英語・繁体字のデータ出走表が 320px・375px で枠からはみ出していた（en 320px で 348>312、
// zh-TW 320px で 391>312）。原因は決まり手のマスの訳語の括弧の補足（「Nige (Escape)」「外攻（Makuri）」）で、
// 補足の単語が折れず列を押し広げていた。スマホ幅だけ短い訳語にする（2026-10-10 ユーザー選択の案B）。
// 英語は英語の部分、繁体字は漢字だけ。韓国語・日本語は変えない。PC 幅は今の訳語のまま。
// e2e/race-detail-mobile-table.spec.js（BOA-612）は日本語だけを見ていたので検知できなかった
const RACE = "/race/2026-10-09-20-09";

async function openTable(page, lang, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${lang}${RACE}`);
  await page.locator(".race-tabs-btn").first().click();
  const table = page.locator(".drt-table").first();
  await expect(table).toBeVisible({ timeout: 30000 });
  // 決まり手のマスが出そろってから測る（幅を取る行が後から入るため）
  await expect(table.locator(".drt-technique").first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(1000);
  return table;
}

const SHORT = { "/en": "Escape", "/zh-TW": "逃走", "/ko": "인빠지기 (Nige)" };

for (const lang of ["/en", "/zh-TW", "/ko"]) {
  for (const width of [320, 375]) {
    test(`${lang} ${width}px: データ出走表は枠に収まり、決まり手は短い訳語`, async ({
      page,
    }) => {
      const table = await openTable(page, lang, width);
      const m = await table.evaluate((el) => {
        const wrap = el.parentElement;
        return {
          sw: wrap.scrollWidth,
          cw: wrap.clientWidth,
          pageOverflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      expect(m.pageOverflow).toBe(0);
      // 1号艇の決まり手は逃げ
      await expect(
        table.locator(".drt-technique").first().locator(".drt-tech-short"),
      ).toHaveText(SHORT[lang]);
      await expect(
        table.locator(".drt-technique").first().locator(".drt-tech-full"),
      ).toBeHidden();
    });
  }
}

test("/en 1440px: PC 幅の決まり手は今の訳語（括弧の補足つき）のまま", async ({
  page,
}) => {
  const table = await openTable(page, "/en", 1440);
  await expect(
    table.locator(".drt-technique").first().locator(".drt-tech-full"),
  ).toHaveText("Nige (Escape)");
  await expect(
    table.locator(".drt-technique").first().locator(".drt-tech-short"),
  ).toBeHidden();
});
