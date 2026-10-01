import { test, expect } from "./fixtures.js";

/**
 * 会場ページ（本日）を開いたら、次の発走レースへスクロールし、会場カード2枚（この会場の特徴・この日の水面傾向）を
 * その直上に出す（BOA-546）。
 *
 * - 次の発走レース＝開いた時点で最初の発走前（UPCOMING）のレース。締切後・結果待ちのレースはカードの上に残る
 * - 1Rが発走前・全レース締切後・過去日付は、従来どおりカードは最上部でスクロールしない
 * - 開いた時点で固定（時刻が進んでもカードは動かない）
 * - ブラウザの戻るで来たときは自動スクロールしない
 *
 * レースの並びは Edge API を差し替えて固定する（1R 10:30 〜 12R 16:00、30分おき）。結果は、開く時刻の
 * 40分以上前に発走したレースにだけ入れる（14:00 なら 1〜6R。7R 13:30・8R 14:00 は結果待ち）。
 */

const DATE = "2026-09-28";
const VENUE = 5;
const startOf = (n) => {
  const m = 10 * 60 + 30 + (n - 1) * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const edgeData = (at) => ({
  generatedAt: "2026-09-28T00:00:00Z",
  updatedAt: "2026-09-28T00:00:00Z",
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
    raceId: `${DATE}-${String(VENUE).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
    venueCode: VENUE,
    venue: "多摩川",
    raceNumber: n,
    startTime: startOf(n),
    entries: [1, 2, 3, 4, 5, 6].map((i) => ({
      number: i,
      name: `テスト選手${i}`,
      grade: "B1",
      age: 30,
      winRate: 5.0,
      localWinRate: 5.0,
      motorNumber: i,
      motor2Rate: 35,
      boatNumber: i,
      boat2Rate: 35,
    })),
    predictions: {},
    exhibitionData: [],
    result:
      minutesOf(startOf(n)) <= minutesOf(at) - 40
        ? { rank1: 1, rank2: 2, rank3: 3 }
        : null,
  })),
});

const jst = (hhmm) => new Date(`${DATE}T${hhmm}:00+09:00`);

async function open(page, { at, path = `/venue/${VENUE}`, install = false }) {
  if (install) await page.clock.install({ time: jst(at) });
  else await page.clock.setFixedTime(jst(at));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(at) }),
  );
  await page.goto(path);
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
  await expect(page.locator(".venue-characteristics-card")).toBeVisible({
    timeout: 20000,
  });
}

// 会場カード（この会場の特徴）が、何枚目のレースカードの前にあるか（最上部なら -1）
const cardsPosition = (page) =>
  page.evaluate(() => {
    const cards = document.querySelector(".venue-characteristics-card");
    const grid = document.querySelector(".race-grid");
    if (!cards || !grid) return null;
    if (!grid.contains(cards)) return -1;
    const children = [...grid.children];
    const holder = children.find((c) => c.contains(cards));
    return children
      .slice(children.indexOf(holder) + 1)
      .find((c) => c.classList.contains("race-card"))
      ?.textContent.match(/(\d+)R/)?.[1];
  });

for (const width of [375, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("本日・レース中: 会場カードを次の発走レース（9R）の直前に全幅で出し、そこまでスクロールする", async ({
      page,
    }) => {
      await open(page, { at: "14:00" }); // 7R 13:30・8R 14:00 は締切後、9R 14:30 が次
      const holder = page.getByTestId("venue-next-race-cards");
      await expect(holder).toBeVisible();
      expect(await cardsPosition(page)).toBe("9");
      // 全幅（グリッドの幅いっぱい）
      const [hw, gw] = await Promise.all([
        holder.evaluate((e) => e.getBoundingClientRect().width),
        page.locator(".race-grid").evaluate((e) => e.getBoundingClientRect().width),
      ]);
      expect(Math.abs(hw - gw)).toBeLessThan(1);
      // スクロールして、会場カード（折りたたみ）の先頭がヘッダーのすぐ下に来て、目印と次のレース（9R）が1画面目に入る
      const marker = page.getByTestId("venue-next-race-marker");
      const headerBottom = await page
        .locator(".app-header")
        .evaluate((e) => e.getBoundingClientRect().bottom);
      await expect
        .poll(() => holder.evaluate((e) => e.getBoundingClientRect().top))
        .toBeLessThan(headerBottom + 40);
      expect(
        await holder.evaluate((e) => e.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(headerBottom - 1);
      expect(
        await marker.evaluate((e) => e.getBoundingClientRect().bottom),
      ).toBeLessThan(page.viewportSize().height);
      const nineR = page.locator(".race-grid > .race-card").nth(8);
      await expect(nineR).toContainText("9R");
      expect(
        await nineR.evaluate((e) => e.getBoundingClientRect().top),
      ).toBeLessThan(page.viewportSize().height - 100);
    });
  });
}

test.describe("着いた位置の目印（ファン評価1・2周目）", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("目印に会場名と次の締切を出し、近道で次のレースへ移る", async ({
    page,
  }) => {
    await open(page, { at: "14:00" });
    const marker = page.getByTestId("venue-next-race-marker");
    await expect(marker).toContainText("多摩川");
    await expect(marker).toContainText("次の締切 9R 14:30");
    await expect(marker).not.toContainText("発走前");
    await marker.getByRole("button", { name: "9Rへ" }).click();
    const headerBottom = await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().bottom);
    const nineR = page.locator(".race-grid > .race-card").nth(8);
    await expect
      .poll(() => nineR.evaluate((e) => e.getBoundingClientRect().top))
      .toBeLessThan(headerBottom + 40);
  });

  test("開いたまま時間がたったら、目印の「次の締切」と近道はいまの次のレースになる（位置は固定）", async ({
    page,
  }) => {
    await open(page, { at: "14:00", install: true });
    await page.clock.fastForward("01:30:00"); // 15:30（11R 15:30 は締切、次は 12R 16:00）
    const marker = page.getByTestId("venue-next-race-marker");
    await expect(marker).toContainText("次の締切 12R 16:00");
    expect(await cardsPosition(page)).toBe("9");
    // 会場カード（この日の水面傾向）の読み込みが終わってから押す（押した後に上が伸びると12Rが押し下げられる）
    await expect(page.getByTestId("venue-day-summary-teaser")).toBeVisible({
      timeout: 20000,
    });
    await marker.getByRole("button", { name: "12Rへ" }).click();
    // 12R は最後のカードなので、ヘッダーの直下まで来るか、ページの末端までスクロールする
    const twelveR = page.locator(".race-grid > .race-card").nth(11);
    const headerBottom = await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().bottom);
    // （押した後に会場カードの読み込みでページが伸びることがあるため、どちらかを満たせばよい）
    await expect
      .poll(() =>
        twelveR.evaluate(
          (e, hb) => {
            const top = e.getBoundingClientRect().top;
            const atBottom =
              window.scrollY + window.innerHeight >=
              document.documentElement.scrollHeight - 2;
            return (
              top >= hb - 1 &&
              top < window.innerHeight &&
              (atBottom || top < hb + 40)
            );
          },
          headerBottom,
        ),
      )
      .toBe(true);
  });

  test("会場カードの読み込みが遅くても、着いた後に目印が画面外へ押し出されない", async ({
    page,
  }) => {
    // 会場カード（Supabase REST）の応答を遅らせる
    await page.route("**/rest/v1/**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fallback();
    });
    await open(page, { at: "14:00" });
    await page.waitForTimeout(2500);
    const holder = page.getByTestId("venue-next-race-cards");
    const marker = page.getByTestId("venue-next-race-marker");
    const headerBottom = await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().bottom);
    const top = await holder.evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(top).toBeLessThan(headerBottom + 40);
    expect(
      await marker.evaluate((e) => e.getBoundingClientRect().bottom),
    ).toBeLessThan(page.viewportSize().height);
  });
});

test.describe("目印の近道（「9Rへ」）の着地", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("押した後に上の会場カードが伸びても、9Rはヘッダーのすぐ下に保たれる", async ({
    page,
  }) => {
    // CI の負荷で会場カードの読み込みが遅れ、近道で移った後に会場カードが伸びて 9R が
    // 約90px 下にずれた（#1017・#1023 の CI で「目印に会場名と次の締切を出し…」が落ちた）。
    // 読み込みの遅れを、押した直後に会場カードの高さを伸ばすことで決定的に再現する
    await open(page, { at: "14:00" });
    const marker = page.getByTestId("venue-next-race-marker");
    await marker.getByRole("button", { name: "9Rへ" }).click();
    await page.evaluate(() => {
      const holder = document.querySelector(
        '[data-testid="venue-next-race-cards"]',
      );
      holder.style.paddingTop = "90px";
    });
    const headerBottom = await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().bottom);
    const nineR = page.locator(".race-grid > .race-card").nth(8);
    await expect
      .poll(() => nineR.evaluate((e) => e.getBoundingClientRect().top))
      .toBeLessThan(headerBottom + 40);
  });
});

test.describe("差し込んだ会場カードの折りたたみ（ユーザー判断）", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("見出しと要約1行に折りたたみ、目印と次のレース（9R）と一緒に1画面に入る", async ({
    page,
  }) => {
    await open(page, { at: "14:00" });
    const holder = page.getByTestId("venue-next-race-cards");
    const details = holder.locator("details.collapsible-section");
    await expect(details).toHaveCount(2);
    for (const d of await details.all()) {
      expect(await d.evaluate((e) => e.open)).toBe(false);
    }
    await expect(page.getByTestId("venue-characteristics-teaser")).toContainText(
      "1号艇の1着率",
    );
    await expect(page.getByTestId("venue-day-summary-teaser")).toContainText(
      "確定",
    );
    // 会場カードの見出し・目印・9R が1画面（高さ800）に入る
    const headerBottom = await page
      .locator(".app-header")
      .evaluate((e) => e.getBoundingClientRect().bottom);
    const holderTop = await holder.evaluate(
      (e) => e.getBoundingClientRect().top,
    );
    const nineRTop = await page
      .locator(".race-grid > .race-card")
      .nth(8)
      .evaluate((e) => e.getBoundingClientRect().top);
    expect(holderTop).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(nineRTop).toBeLessThan(800 - 100);
  });

  test("見出しを1タップで開閉でき、開いた状態はこのタブで覚える", async ({
    page,
  }) => {
    await open(page, { at: "14:00" });
    const first = page
      .getByTestId("venue-next-race-cards")
      .locator("details.collapsible-section")
      .first();
    await first.locator("summary").click();
    expect(await first.evaluate((e) => e.open)).toBe(true);
    await expect(first.locator(".venue-hud-row")).toHaveCount(6);
    await page.reload();
    await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
    const again = page
      .getByTestId("venue-next-race-cards")
      .locator("details.collapsible-section")
      .first();
    await expect(again).toBeVisible();
    expect(await again.evaluate((e) => e.open)).toBe(true);
  });

  test("最上部に置くとき（1R発走前）は折りたたまず従来どおり全部を出す", async ({
    page,
  }) => {
    await open(page, { at: "09:00" });
    await expect(page.locator("details.collapsible-section")).toHaveCount(0);
    await expect(page.locator(".venue-hud-row")).toHaveCount(6);
  });
});

test.describe("カードを動かさない・スクロールしない場合", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("1R が発走前: 従来どおり最上部でスクロールしない", async ({ page }) => {
    await open(page, { at: "09:00" });
    expect(await cardsPosition(page)).toBe(-1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("全レース締切後: 従来どおり最上部でスクロールしない", async ({
    page,
  }) => {
    await open(page, { at: "20:00" });
    expect(await cardsPosition(page)).toBe(-1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("過去日付のページ: 従来どおり最上部でスクロールしない", async ({
    page,
  }) => {
    await open(page, { at: "14:00", path: `/races/${DATE}/${VENUE}` });
    // 過去日付ビューは本日扱いにしない（時計は同じ日だが URL で決まる）
    expect(await cardsPosition(page)).toBe(-1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("時刻が進んで次のレースが変わっても、カードは開いた時点の位置のまま", async ({
    page,
  }) => {
    await open(page, { at: "14:00", install: true });
    expect(await cardsPosition(page)).toBe("9");
    await page.clock.fastForward("01:00:00"); // 15:00（次は 11R）
    await page.waitForTimeout(500);
    expect(await cardsPosition(page)).toBe("9");
  });

  test("リロードしたときは、読んでいた位置に戻す（ユーザー判断）", async ({
    page,
  }) => {
    await open(page, { at: "14:00" });
    // ユーザーが上へ戻って読む（ホイールで着地点の合わせ直しを止め、滑らかなスクロールが落ち着いてから位置を決める）
    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("venueScrollY:/venue/5")),
      )
      .toBe("1200");
    await page.reload();
    await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(1150);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(1250);
  });

  test("ブラウザの戻るで来たときは自動スクロールしない", async ({ page }) => {
    await open(page, { at: "14:00" });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    // いちばん上に戻してから、1Rのカードでレース詳細へ移り（アプリ内の遷移）、ブラウザの戻るで帰る
    await page.evaluate(() => window.scrollTo(0, 0));
    await page
      .locator(".race-card")
      .first()
      .getByRole("button", { name: /詳細を見る/ })
      .click();
    await expect(page).toHaveURL(/\/race\//);
    await page.goBack();
    await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
    await page.waitForTimeout(500);
    // 目印（9Rの直上、ページの下のほう）まで自動スクロールしていない（1Rを押した位置のまま）
    const markerTop = await page
      .getByTestId("venue-next-race-marker")
      .evaluate((e) => e.getBoundingClientRect().top);
    expect(markerTop).toBeGreaterThan(page.viewportSize().height);
  });
});
