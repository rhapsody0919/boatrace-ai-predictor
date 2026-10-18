import { test, expect, e2eNow } from "../fixtures.js";
import { mkdir } from "node:fs/promises";

// SNS ハブ管理画面のページ分割（2026-10-18 オーナー承認、docs/design/sns-hub-page-split/APPROVED.md）。
// 4ページ（手動承認・自動送信・数字と戦略メモ・資料）と上部の切り替え、撤去した区画が出ないことを見る。
// dev サーバーには Edge Function が無いので /api/admin/sns-hub/* はすべてスタブ
const H = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

function stubApi(page, { now, queue }) {
  const drafts = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      platform: "blog",
      status: "pending_review",
      title: "ボートレース初心者のための展示タイムの読み方",
      caption_text: "本文",
      created_at: iso(now - 2 * H),
      updated_at: iso(now - 2 * H),
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      platform: "note",
      status: "pending_review",
      title: "今週の会場まとめ",
      caption_text: "本文",
      created_at: iso(now - 3 * H),
      updated_at: iso(now - 3 * H),
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      platform: "tiktok",
      status: "pending_review",
      title: "TikTokの古い下書き",
      caption_text: "本文",
      created_at: iso(now - 4 * H),
      updated_at: iso(now - 4 * H),
    },
  ];
  const data = {
    "/drafts": drafts,
    "/approvers": [
      { id: "44444444-4444-4444-4444-444444444444", display_name: "本人" },
    ],
    "/topics": [],
    "/topic-categories": [],
    "/insights": [
      {
        id: "i1",
        status: "proposed",
        insight_text: "数字の比較を冒頭に置く",
        evidence: "48h の再生が伸びた型",
        source: "own-metrics",
        created_at: iso(now),
      },
    ],
    "/revisions": [],
    "/template-variants": [],
    "/observations": { drafts: [], observations: [] },
    "/deadline-queue": queue,
  };
  let mobileCalls = 0;
  page.route(/\/api\/admin\/sns-hub\//, (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/admin/sns-hub",
      "",
    );
    if (path.startsWith("/mobile-approval")) mobileCalls++;
    if (path === "/deadline-queue")
      return route.fulfill({
        json: {
          data: queue,
          control: {
            paused: false,
            channels: [
              { channel: "x", mode: "auto", dry_run: false },
              { channel: "youtube", mode: "auto", dry_run: false },
            ],
          },
        },
      });
    return route.fulfill({ json: { data: data[path] ?? [] } });
  });
  return { mobileCalls: () => mobileCalls };
}

const nav = (page) => page.getByRole("navigation", { name: "SNSハブのページ" });

for (const width of [375, 1440]) {
  test(`${width}px: 4ページを切り替え、撤去した区画は出ない`, async ({
    page,
  }) => {
    const now = e2eNow().getTime();
    const queue = [
      {
        id: "f",
        title: "住之江 12R 全貌",
        channel: "youtube",
        state: "failed",
        scheduled_at: iso(now - H),
        expires_at: iso(now),
        error_code: "upload_failed",
      },
      {
        id: "p",
        title: "/today 朝のまとめ",
        channel: "x",
        state: "posted",
        posted_at: iso(now - 30 * 60 * 1000),
      },
      {
        id: "q",
        title: "桐生 12R 全貌",
        channel: "x",
        state: "queued",
        scheduled_at: iso(now + 2 * H),
        expires_at: iso(now + 3 * H),
      },
    ];
    const api = stubApi(page, { now, queue });
    await page.setViewportSize({ width, height: 900 });
    const dir = `../out/reports/sns-hub-pages`;
    await mkdir(dir, { recursive: true });

    // 手動承認
    await page.goto("/admin/sns-hub");
    await expect(
      nav(page).getByRole("link", { name: /手動承認/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      nav(page).getByRole("link", { name: /手動承認/ }),
    ).toContainText("2");
    await expect(
      nav(page).getByRole("link", { name: /自動送信/ }),
    ).toContainText("要対応 1");
    await expect(
      page.getByRole("button", { name: /^Blog \(1\)$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^note \(1\)$/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /TikTok/ })).toHaveCount(0);
    await expect(page.getByText("今日のレースを確認・個別承認")).toHaveCount(0);
    await expect(page.getByText("全月カレンダー（JST）")).toHaveCount(0);
    await expect(
      page.getByText("ボートレース初心者のための展示タイムの読み方"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${dir}/manual-${width}.png`,
      fullPage: true,
    });

    // 自動送信
    await nav(page)
      .getByRole("link", { name: /自動送信/ })
      .click();
    await expect(page).toHaveURL(/\/admin\/sns-hub\/auto$/);
    await expect(
      page.getByRole("region", { name: "いまの状態" }),
    ).toContainText("自動・本番");
    await expect(
      page.getByRole("region", { name: "要対応" }).getByRole("listitem"),
    ).toHaveCount(1);
    await expect(page.getByRole("region", { name: /^今日 / })).toContainText(
      "/today 朝のまとめ",
    );
    await expect(page.getByText("全月カレンダー（JST）を開く")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${dir}/auto-${width}.png`, fullPage: true });

    // 数字と戦略メモ
    await nav(page).getByRole("link", { name: "数字と戦略メモ" }).click();
    await expect(page).toHaveURL(/\/admin\/sns-hub\/metrics$/);
    await expect(
      page.getByRole("heading", { name: "観測窓別の型比較" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "投稿ごとの観測" }),
    ).toContainText("/today 朝のまとめ");
    await page.getByRole("button", { name: /^戦略メモ \(1\)$/ }).click();
    await expect(page.getByText("数字の比較を冒頭に置く")).toBeVisible();
    await page.screenshot({
      path: `${dir}/metrics-${width}.png`,
      fullPage: true,
    });

    // 資料
    await nav(page).getByRole("link", { name: "資料" }).click();
    await expect(page).toHaveURL(/\/admin\/sns-hub\/library$/);
    await expect(page.getByRole("heading", { name: "型一覧" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "展望素材の取り込み" }),
    ).toBeVisible();
    await page.screenshot({
      path: `${dir}/library-${width}.png`,
      fullPage: true,
    });

    expect(api.mobileCalls()).toBe(0);
  });
}

test("各ページの URL を直接開ける", async ({ page }) => {
  const now = e2eNow().getTime();
  stubApi(page, { now, queue: [] });
  for (const [path, text] of [
    ["/admin/sns-hub/auto", "いまの状態"],
    ["/admin/sns-hub/metrics", "観測窓別の型比較"],
    ["/admin/sns-hub/library", "型一覧"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: text })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});
