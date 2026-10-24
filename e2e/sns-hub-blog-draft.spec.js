import { test, expect } from "./fixtures.js";

const PR_URL = "https://github.com/rhapsody0919/boatrace-ai-predictor/pull/1";

test.use({ viewport: { width: 1280, height: 800 } });

test("blog はPRリンクと修正依頼を残し、YouTubeだけDB反映を再試行できる", async ({
  page,
}) => {
  const base = {
    status: "pending_review",
    caption_text: "本文",
    created_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
  };
  const drafts = [
    {
      ...base,
      id: "11111111-1111-4111-8111-111111111111",
      platform: "blog",
      title: "記事の確認",
      pr_url: PR_URL,
    },
    {
      ...base,
      id: "22222222-2222-4222-8222-222222222222",
      platform: "blog",
      title: "反映待ちの記事",
      external_operation_state: "external_done",
    },
    {
      ...base,
      id: "33333333-3333-4333-8333-333333333333",
      platform: "youtube",
      title: "反映待ちの動画",
      external_operation_state: "external_done",
    },
  ];
  await page.route(/\/api\/admin\/sns-hub\//, (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/admin/sns-hub",
      "",
    );
    if (path === "/deadline-queue")
      return route.fulfill({ json: { data: [], control: null } });
    const data = {
      "/drafts": drafts,
      "/approvers": [
        { id: "44444444-4444-4444-8444-444444444444", display_name: "本人" },
      ],
    };
    return route.fulfill({ json: { data: data[path] ?? [] } });
  });
  await page.goto("/admin/sns-hub");
  const cards = page.locator(".draft-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "反映待ちの記事" })).toBeVisible();
  await expect(page.locator(`a[href="${PR_URL}"]`)).toBeVisible();
  await expect(cards.getByRole("button", { name: /修正を依頼/ })).toBeVisible();
  await expect(cards.getByRole("button", { name: /PRをマージ/ })).toHaveCount(0);
  await expect(
    cards.getByRole("button", { name: "承認するPRの版を取得" }),
  ).toHaveCount(0);
  await expect(cards.getByRole("button", { name: "DB反映を再試行" })).toHaveCount(0);
  await expect(
    cards.getByText(
      "外部操作は完了済みです。DBへの反映だけを再試行できます。",
      { exact: true },
    ),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /^YouTube \(1\)$/i }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole("button", { name: "DB反映を再試行" })).toBeVisible();
  await expect(
    cards.getByText(
      "外部操作は完了済みです。DBへの反映だけを再試行できます。",
      { exact: true },
    ),
  ).toBeVisible();
});
