import { test, expect } from "./fixtures.js";

const DATE = "2026-09-22";

async function openDigest(page) {
  await page.route("**/rest/v1/morning_digest_days*", (route) =>
    route.fulfill({
      json: {
        digest_date: DATE,
        generated_at: `${DATE}T00:00:00Z`,
        flying_data_complete: true,
        suppressed_venues: [],
      },
    }),
  );
  await page.route("**/rest/v1/morning_digest_rows*", (route) =>
    route.fulfill({
      json: [
        {
          section: "flying", rank: 1, racer_id: 3941, racer_name: "池田浩二",
          venue_code: 16, race_id: "202609211605", race_number: 5,
          boat_number: 1, detail: { label: "F.01" },
        },
        {
          section: "flying", rank: 2, racer_id: null, racer_name: "登録番号なしF",
          venue_code: 16, race_id: "202609211605", race_number: 5,
          boat_number: 2, detail: { label: "F" },
        },
        {
          section: "returned", rank: 1, racer_id: 4320, racer_name: "峰竜太",
          venue_code: 2, detail: { reason: "帰郷（公傷のため）" },
        },
        {
          section: "returned", rank: 2, racer_id: null,
          racer_name: "登録番号なし帰郷", venue_code: 2,
        },
      ],
    }),
  );
  await page.goto(`/today?date=${DATE}`);
}

for (const { title, id, name, missing, meta } of [
  { title: "昨日のフライング", id: 3941, name: "池田浩二", missing: "登録番号なしF", meta: /児島 5R 枠1/ },
  { title: "昨日の帰郷選手", id: 4320, name: "峰竜太", missing: "登録番号なし帰郷", meta: /戸田/ },
]) {
  test(`/today: ${title}の選手名から選手ページへ移動する`, async ({ page }) => {
    await openDigest(page);
    const section = page.locator("section.digest-section", {
      has: page.getByRole("heading", { name: title, exact: true }),
    });
    const row = section.locator("li", { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.locator(".racer-plain-list__id")).toHaveText(String(id));
    await expect(row.locator(".racer-plain-list__meta")).toContainText(meta);
    if (id === 3941) {
      await expect(row.locator(".racer-plain-list__accent")).toHaveText("F.01");
    } else {
      await expect(row.locator(".racer-plain-list__reason")).toHaveText("帰郷（公傷のため）");
    }
    const unknown = section.locator("li", { hasText: missing });
    await expect(unknown.getByText(missing, { exact: true })).toHaveAttribute("translate", "no");
    await expect(unknown.locator("a")).toHaveCount(0);
    const link = row.locator(`a[href="/racer/${id}"]`);
    await expect(link).toHaveText(name);
    await expect(link).toHaveAttribute("translate", "no");
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await link.hover();
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/racer/${id}$`));
  });
}
