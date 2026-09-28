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
 *
 * 確かめることは3つあるが、テストは1本にまとめて `test.step` で分けている。
 * 今節タブは開いてから getMeetScoreboard → getRacerScopedRaceStats と
 * 本番Supabaseを2段で引き、表が出るまでに実測で1〜2分かかる日がある。
 * テストごとに開き直すと、確認の中身ではなく読み込みの待ち時間だけで
 * 5分以上を使う（実測5.3分）。
 */

const RACE_PATH = "/race/2026-09-21-02-05";

test.use({ viewport: { width: 390, height: 844 } });

// Cookie同意バナーは画面下部に固定で出て、下の方の要素へのクリック・ポインタ操作を
// 遮る（BOA-502）。このファイルは表の幅とグラフの当たり判定を測るので、
// 出たままだと測っているものが変わる
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boatai:cookie-consent", "accepted"),
  );
});

test("レース詳細 今節タブの日別表は、右に続くことが分かり、着順までは初期表示に収まる（390px）", async ({
  page,
}) => {
  // 上記の理由で既定の60秒では足りない。中身の失敗と時間切れが区別できなくなる
  test.slow();

  await page.goto(RACE_PATH, { waitUntil: "domcontentloaded" });
  const meetTab = page.getByRole("tab", { name: "今節" });
  await expect(meetTab).toBeVisible({ timeout: 30000 });
  await meetTab.click();
  // 選んだ1艇の走（RaceHistoryTable）は板全体とは別のクエリで後から届く
  await expect(page.locator(".race-history-table-row").first()).toBeVisible({
    timeout: 60000,
  });

  const wrapper = page.locator(".race-history-table-wrapper").first();

  await test.step("右に続くことが分かる（フェードと「›」が出る）", async () => {
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

  await test.step("着順までは初期表示に収まる", async () => {
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

  await test.step("「›」を押すと右へ送られ、送りきると手がかりが消える", async () => {
    expect(await wrapper.evaluate((el) => el.scrollLeft)).toBe(0);

    await page.locator(".race-history-hscroll .hscroll-more").first().click();
    await expect
      .poll(() => wrapper.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);

    // 右端まで送れば「まだ右にある」の表示は消える（出しっぱなしにしない）
    await wrapper.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(
      page.locator(".race-history-hscroll .hscroll-more"),
    ).toHaveCount(0);
  });
});

test("今節タブの折れ線は、点に合わせるとその走の日付・R・値・着順を出す", async ({
  page,
}) => {
  // 上と同じ理由（本番Supabaseを2段で引く）
  test.slow();

  await page.goto(RACE_PATH, { waitUntil: "domcontentloaded" });
  const meetTab = page.getByRole("tab", { name: "今節" });
  await expect(meetTab).toBeVisible({ timeout: 30000 });
  await meetTab.click();

  const spark = page.locator(".rmt-sparks .meet-sparkline-wrap").first();
  await expect(spark).toBeVisible({ timeout: 60000 });
  const tip = page.locator(".meet-sparkline-tip");

  // 合わせるまでは出ていない
  await expect(tip).toHaveCount(0);

  // `toBeVisible` は画面内にあることまでは保証しない。グラフはページの
  // 下の方にあり、スクロールせずにマウスを動かしても当たらない
  await spark.scrollIntoViewIfNeeded();
  const box = await spark.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tip).toHaveCount(1);

  await test.step("中身が下の「日別の走り」表と食い違わない", async () => {
    // 実装中に実際に踏んだ: 生の meet 行はレース番号を持たず、着順も
    // finishPositionOf を通して初めて決まるため、生の行から組み立てると
    // 表には「11R・4着」と出ているのに吹き出しだけ「—R・着外」になる
    const text = await tip.innerText();
    expect(text).not.toContain("—R");
    expect(text).toMatch(/\d+R/);

    // 表の同じ走（吹き出しの日付とRで引く）と、値・着順が一致する
    const [, date, raceNo] = text.match(/^(\d+\/\d+)\s+(\d+)R/);
    const row = page
      .locator(".race-history-table-row")
      .filter({ hasText: `${raceNo}R` })
      .filter({ hasText: date })
      .first();
    const cells = await row.locator("td").allInnerTexts();
    // 表の列は 日付/R/枠番/進入/展示/ST/着順/決まり手/単勝配当
    const st = cells[5];
    const finish = cells[6];
    expect(text).toContain(st);
    expect(text).toContain(finish);
  });

  await test.step("吹き出しはグラフの箱からはみ出さない", async () => {
    // 上に出すと見出し（平均・通常値）に、下に出すと「前走 0.09」の行に重なる
    const tipBox = await tip.boundingBox();
    expect(tipBox.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(
      box.y + box.height + 1,
    );
  });

  // 離れたら消える（出しっぱなしにしない）
  await page.mouse.move(box.x + box.width / 2, box.y - 120);
  await expect(tip).toHaveCount(0);
});
