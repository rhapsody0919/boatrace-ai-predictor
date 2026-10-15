import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * /today の「逃がしやすい選手」は当日の2号艇だけを一覧に出し、3号艇は折りたたみの中、4〜6号艇は出さない
 * （2026-10-15 オーナー承認）。過去日の保存行に4〜6号艇が残っていても出さない。
 * 日付は生成済みの過去日に固定する（today-seo-meta.spec.js と同じ）。2026-09-22 の逃がしは 2号艇2・3号艇6・4号艇4・6号艇2
 */
const DIGEST_FIXED_DATE = "2026-09-22";

async function openNigashi(page, edit = (rows) => rows) {
  await page.route("**/rest/v1/morning_digest_rows*", async (route) => {
    const response = await fetchRecorded(route);
    const rows = await response.json();
    await route.fulfill({ response, json: edit(rows) });
  });
  await page.goto(`/today?date=${DIGEST_FIXED_DATE}`);
  const heading = page.getByRole("heading", { name: "逃がしやすい選手" });
  await expect(heading).toBeVisible({ timeout: 30000 });
  return page.locator("section.digest-section", { has: heading });
}

test("/today: 逃がしの一覧は2号艇だけ、3号艇は閉じた折りたたみの中、4〜6号艇は出さない", async ({
  page,
}) => {
  const section = await openNigashi(page);
  const fold = section.getByTestId("nigashi-course3");
  // 一覧（折りたたみの外）のカードは枠2だけ
  const listText = await section.evaluate((el) =>
    [...el.querySelectorAll(".digest-card")]
      .filter((c) => !c.closest("details"))
      .map((c) => c.innerText),
  );
  expect(listText.length).toBeGreaterThan(0);
  for (const t of listText) expect(t).toMatch(/枠2/);
  await expect(section.locator(".digest-section__count")).toHaveText(
    `${listText.length}件`,
  );
  // 3号艇は閉じた折りたたみの中
  await expect(fold).not.toHaveAttribute("open", "");
  await expect(fold.locator("summary")).toHaveText(
    /^3号艇で当てはまる選手（\d+件）$/,
  );
  await fold.locator("summary").click();
  const foldText = await fold.locator(".digest-card").allInnerTexts();
  expect(foldText.length).toBeGreaterThan(0);
  for (const t of foldText) expect(t).toMatch(/枠3/);
  // 4〜6号艇はどこにも出ない
  await expect(section.getByText(/枠[456]/)).toHaveCount(0);
});

test("/today: 2号艇が0件の日は0件の文言を出し、3号艇の折りたたみは残す", async ({
  page,
}) => {
  const section = await openNigashi(page, (rows) =>
    rows.filter((r) => !(r.section === "nigashi" && r.course === 2)),
  );
  await expect(section.locator(".digest-section__count")).toHaveText("0件");
  await expect(
    section.getByText(
      "本日、条件に当てはまる2号艇の選手はいません（22ポイントの基準はゆるめていません）",
    ),
  ).toBeVisible();
  await expect(section.getByTestId("nigashi-course3")).toBeVisible();
});

test("/today: 2号艇も3号艇も0件なら、0件の文言だけで折りたたみは出さない", async ({
  page,
}) => {
  const section = await openNigashi(page, (rows) =>
    rows.filter((r) => !(r.section === "nigashi" && r.course <= 3)),
  );
  await expect(section.locator(".digest-section__count")).toHaveText("0件");
  await expect(section.getByTestId("nigashi-course3")).toHaveCount(0);
});
