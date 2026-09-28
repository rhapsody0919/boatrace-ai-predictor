import { test, expect } from "@playwright/test";

/**
 * レース詳細ページを390px幅で見たときの固定（BOA-455）。
 *
 * このページは横に長い表を何枚も抱えており、「黙って切れて、その先があることに
 * 気づけない」という同じ不具合が繰り返し出ている（タブバー・モータ情報タブ・
 * 直前情報タブ・今節タブの日別表）。直したものが戻らないよう、幅の実測で固定する。
 *
 * 390pxは iPhone 14/15/16 の論理幅で、チケットの実測もこの幅で取っている
 * （layout.spec.js の layout-mobile は375px。あちらは横あふれとグリッドの
 * 空きだけを見る汎用テストで、個々の表の中の列の位置までは見ない）。
 *
 * 対象レースは layout.spec.js と同じく過去の固定レース。当日のレースを使うと
 * 節の進行で行数が変わり、日によって通ったり落ちたりする。
 */

const RACE_PATH = "/race/2026-09-21-02-05";

test.use({ viewport: { width: 390, height: 844 } });

async function openMeetTab(page) {
  await page.goto(RACE_PATH, { waitUntil: "domcontentloaded" });
  const meetTab = page.getByRole("tab", { name: "今節" });
  await expect(meetTab).toBeVisible({ timeout: 30000 });
  await meetTab.click();
  // 選んだ1艇の走（RaceHistoryTable）は板全体とは別のクエリで後から届く
  await expect(page.locator(".race-history-table-row").first()).toBeVisible({
    timeout: 30000,
  });
}

test.describe("レース詳細 今節タブの日別表（390px）", () => {
  test("右に続くことが分かる（フェードと「›」が出る）", async ({ page }) => {
    await openMeetTab(page);

    const wrapper = page.locator(".race-history-table-wrapper").first();
    const { client, scroll } = await wrapper.evaluate((el) => ({
      client: el.clientWidth,
      scroll: el.scrollWidth,
    }));
    // この幅で本当に溢れていることを先に確かめる。溢れていないのに
    // 手がかりが無いことを責めても意味が無い
    expect(scroll).toBeGreaterThan(client);

    // 手がかりは has-more クラス（右端のフェード）と「›」ボタンの2つで出す
    await expect(
      page.locator(".race-history-hscroll.has-more").first(),
    ).toBeVisible();
    await expect(
      page.locator(".race-history-hscroll .hscroll-more").first(),
    ).toBeVisible();
  });

  test("「›」を押すと右へ送られ、送りきると手がかりが消える", async ({
    page,
  }) => {
    await openMeetTab(page);

    const wrapper = page.locator(".race-history-table-wrapper").first();
    expect(await wrapper.evaluate((el) => el.scrollLeft)).toBe(0);

    await page.locator(".race-history-hscroll .hscroll-more").first().click();
    await expect
      .poll(() => wrapper.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);

    // 右端まで送れば「まだ右にある」の表示は消える（出しっぱなしにしない）
    await wrapper.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(
      page.locator(".race-history-hscroll .hscroll-more"),
    ).toHaveCount(0);
  });

  test("着順までは初期表示に収まる", async ({ page }) => {
    await openMeetTab(page);

    const wrapper = page.locator(".race-history-table-wrapper").first();
    const measured = await wrapper.evaluate((el) => {
      const cells = [...el.querySelectorAll("thead th")];
      const finish = cells.find((th) => th.textContent.trim() === "着順");
      return {
        client: el.clientWidth,
        finishRight: finish ? finish.offsetLeft + finish.offsetWidth : null,
      };
    });

    expect(measured.finishRight).not.toBeNull();
    // 着順はこの表で最も読まれる列。半分切れているのと、スクロールした先に
    // あるのとでは意味が違う。ここが可視域の外に出たら余白の詰めが効いていない
    expect(measured.finishRight).toBeLessThanOrEqual(measured.client);
  });
});
