import { test, expect } from "./fixtures.js";

/**
 * 選手ページの検索向けの中身（GS00、2026-10-28、seo-marketer の指摘）の固定。
 *
 * - 登録番号とよみを画面に出す（「選手名 登録番号」・よみでの検索、同姓同名の見分け）
 * - description に登録番号・支部・級を入れ、選手ごとに違う文にする
 * - 成績の見出しに選手名を入れる
 * - 取得に失敗した画面にも登録番号を入れ、全選手が同じ中身にならないようにする
 *   （URL 検査 10/25 で、同じ中身の画面の76件が /racer/4760 の重複にされた）
 * - 取得の失敗は1回だけ取り直す
 *
 * 3941 池田浩二（A1・愛知支部、よみ イケダ コウジ）。級は 12/31 まで変わらない（1/1・7/1 に切り替わる）
 */

const descriptionOf = (page) =>
  page.evaluate(
    () =>
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") ?? "",
  );

test("登録番号・よみ・選手名入りの見出しと、選手ごとの description を出す", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
  await expect(page.locator(".racer-profile-header-kana")).toHaveText(
    "イケダ コウジ",
  );
  await expect(
    page.locator(".racer-profile-fact").filter({ hasText: "登録番号" }),
  ).toContainText("3941");
  await expect
    .poll(() => descriptionOf(page))
    .toContain("池田浩二選手（登録番号3941・愛知支部・A1）");
  await expect(page.locator(".racer-performance-stats h2").first()).toHaveText(
    "池田浩二の成績・調子",
  );

  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) =>
      nodes
        .map((n) => JSON.parse(n.textContent))
        .find((d) => d["@type"] === "Person"),
    );
  expect(jsonLd).toMatchObject({
    name: "池田浩二",
    identifier: "3941",
    alternateName: "イケダ コウジ",
  });
});

test("取得に失敗した画面にも登録番号を入れる", async ({ page }) => {
  await page.route("**/rest/v1/racer_profiles*", (route) => route.abort());
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-error")).toContainText(
    "登録番号3941",
  );
  await expect(page).toHaveTitle("選手 登録番号3941 | 龍神レーダー");
});

test("取得の失敗は1回だけ取り直し、2回目が通れば選手のページを出す", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/rest/v1/racer_profiles*", (route) => {
    if (failed) return route.fallback();
    failed = true;
    return route.abort();
  });
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
  await expect(page.locator(".racer-profile-error")).toHaveCount(0);
});

test("プロフィールが無い選手の見出しにも登録番号を入れる（全員が同じ見出しにならない）", async ({
  page,
}) => {
  // 3081 はプロフィール未取得の選手（smoke の「プロフィール未取得の選手ページ」と同じ）
  await page.goto("/racer/3081");
  await expect(page.locator(".racer-profile-header h1")).toHaveText(
    "登録番号3081の選手情報なし",
  );
});
