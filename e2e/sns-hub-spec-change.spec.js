import { test, expect } from "./fixtures.js";

// SNS ハブ管理画面の「制作仕様の変更要望」。Linear の起票が失敗したら、理由を通知に出し、
// 入力欄を閉じずに本文を残す（2026-10-18 調査: 無料枠の上限で失敗しても汎用の通知だけが出て、
// 入力欄が閉じて本文が消えていた）。dev サーバーには Edge Function が無いので API はスタブ
const DRAFT_ID = "22222222-2222-2222-2222-222222222222";
const MESSAGE = "BGMをもっと軽快な曲にしてほしい";

function stubApi(page, specChangeReply) {
  const data = {
    "/drafts": [
      {
        id: DRAFT_ID,
        platform: "note",
        status: "pending_review",
        title: "今週の会場まとめ",
        caption_text: "本文",
        created_at: "2026-10-18T00:00:00Z",
        updated_at: "2026-10-18T00:00:00Z",
      },
    ],
    "/approvers": [
      { id: "44444444-4444-4444-4444-444444444444", display_name: "本人" },
    ],
  };
  return page.route(/\/api\/admin\/sns-hub\//, (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/admin/sns-hub",
      "",
    );
    if (path === `/drafts/${DRAFT_ID}/request-spec-change`)
      return route.fulfill(specChangeReply);
    if (path === "/deadline-queue")
      return route.fulfill({ json: { data: [], control: null } });
    return route.fulfill({ json: { data: data[path] ?? [] } });
  });
}

async function submitSpecChange(page) {
  await page.goto("/admin/sns-hub");
  await page.getByRole("button", { name: /^note \(1\)$/ }).click();
  await page.getByRole("button", { name: /修正を依頼/ }).click();
  await page.getByRole("button", { name: /制作仕様の変更要望/ }).click();
  await page.locator(".revision-freetext").fill(MESSAGE);
  await page.getByRole("button", { name: "送信", exact: true }).click();
}

test("Linear の無料枠の上限で起票できなかったら、理由を出し、入力した本文を欄に残す", async ({
  page,
}) => {
  await stubApi(page, {
    status: 502,
    json: {
      error: "Linear の無料枠の上限で起票できませんでした",
      code: "LINEAR_USAGE_LIMIT_EXCEEDED",
    },
  });
  await submitSpecChange(page);

  await expect(
    page.getByText(/Linear の無料枠の上限で起票できませんでした/),
  ).toBeVisible();
  await expect(page.locator(".revision-freetext")).toHaveValue(MESSAGE);
});

test("起票できたら入力欄を閉じる", async ({ page }) => {
  await stubApi(page, {
    json: { data: { draftId: DRAFT_ID }, issue: { created: true, url: "u" } },
  });
  await submitSpecChange(page);

  await expect(page.getByText("Linearに起票しました")).toBeVisible();
  await expect(page.locator(".revision-freetext")).toHaveCount(0);
});
