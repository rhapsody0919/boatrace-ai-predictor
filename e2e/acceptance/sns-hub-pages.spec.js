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
        scheduled_at: iso(now), // 日付をまたぐ時刻でも「今日」に入るよう今の時刻にする
        expires_at: iso(now),
        error_code: "upload_failed",
      },
      {
        id: "p",
        title: "/today 朝のまとめ",
        channel: "x",
        state: "posted",
        posted_at: iso(now),
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

// レビューで見つけた退行の再現テスト（PR #1645）
test("後から届いた古い下書きの一覧で新しい一覧を上書きせず、ナビの件数も操作に追従する", async ({
  page,
}) => {
  const now = e2eNow().getTime();
  const draft = (id, title) => ({
    id,
    platform: "blog",
    status: "pending_review",
    title,
    caption_text: "本文",
    created_at: iso(now),
    updated_at: iso(now),
  });
  const d1 = draft("55555555-5555-5555-5555-555555555555", "1本目の記事");
  const d2 = draft("66666666-6666-6666-6666-666666666666", "2本目の記事");
  // サーバー側の状態。1本目を非表示にした直後の一覧の読み込みだけ 1.5 秒遅らせる
  // （dev の StrictMode で初回の読み込みが2回走るので、呼び出しの回数ではなく状態で返す）
  let current = [d1, d2];
  let delayNextRead = false;
  let delayedReadDone = false;
  await page.route(/\/api\/admin\/sns-hub\//, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/admin/sns-hub",
      "",
    );
    if (path.endsWith("/archive")) {
      const id = path.split("/")[2];
      current = current.filter((d) => d.id !== id);
      if (id === d1.id) delayNextRead = true;
      return route.fulfill({ json: { data: {} } });
    }
    if (path === "/drafts") {
      const snapshot = current;
      if (delayNextRead) {
        delayNextRead = false;
        await new Promise((r) => setTimeout(r, 1500));
        delayedReadDone = true;
      }
      return route.fulfill({ json: { data: snapshot } });
    }
    if (path === "/approvers")
      return route.fulfill({
        json: {
          data: [
            {
              id: "44444444-4444-4444-4444-444444444444",
              display_name: "本人",
            },
          ],
        },
      });
    if (path === "/deadline-queue")
      return route.fulfill({ json: { data: [], control: null } });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto("/admin/sns-hub");
  await expect(nav(page).getByRole("link", { name: /手動承認/ })).toContainText(
    "2",
  );
  for (const title of ["1本目の記事", "2本目の記事"]) {
    const card = page.locator(".draft-card", { hasText: title });
    await card.getByRole("button", { name: "🗂️ 非表示にする" }).click();
    await card
      .getByRole("button", { name: "非表示にする", exact: true })
      .click();
  }
  // 1回目の読み直し（1.5秒遅れて [2本目] を返す）が、2回目（[] を返す）より後に届く
  await expect.poll(() => delayedReadDone, { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(2000);
  await expect(page.getByText("該当する下書きはありません。")).toBeVisible();
  await expect(page.locator(".draft-card")).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: /手動承認/ })).toContainText(
    "0",
  );
});

test("戦略メモの採用で返ったリスク警告を、消えない通知に残す", async ({
  page,
}) => {
  await page.route(/\/api\/admin\/sns-hub\//, (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/admin/sns-hub",
      "",
    );
    if (path === "/insights/i1/approve")
      return route.fulfill({
        json: { data: {}, riskWarnings: [{ description: "断定的な表現" }] },
      });
    if (path === "/insights")
      return route.fulfill({
        json: {
          data: [
            {
              id: "i1",
              status: "proposed",
              insight_text: "数字の比較を冒頭に置く",
              source: "own-metrics",
              created_at: iso(e2eNow().getTime()),
            },
          ],
        },
      });
    if (path === "/deadline-queue")
      return route.fulfill({ json: { data: [], control: null } });
    if (path === "/observations")
      return route.fulfill({
        json: { data: { drafts: [], observations: [] } },
      });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto("/admin/sns-hub/metrics");
  await page.getByRole("button", { name: /^戦略メモ \(1\)$/ }).click();
  await page.getByRole("button", { name: "採用", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "リスク警告: 断定的な表現" }),
  ).toBeVisible();
  await page.waitForTimeout(2500); // トースト（2秒）が消えても残る
  await expect(
    page.getByRole("alert").filter({ hasText: "リスク警告: 断定的な表現" }),
  ).toBeVisible();
});

test("自動送信のナビの件数は 10 秒ごとの読み直しに追従する", async ({
  page,
}) => {
  const now = e2eNow().getTime();
  let failed = false;
  await page.route(/\/api\/admin\/sns-hub\//, (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/admin/sns-hub",
      "",
    );
    if (path === "/deadline-queue")
      return route.fulfill({
        json: {
          data: failed
            ? [
                {
                  id: "f",
                  title: "失敗",
                  channel: "x",
                  state: "failed",
                  scheduled_at: iso(now),
                },
              ]
            : [],
          control: null,
        },
      });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto("/admin/sns-hub/auto");
  await expect(page.getByRole("region", { name: "要対応" })).toContainText(
    "0件",
  );
  await expect(
    nav(page).getByRole("link", { name: /自動送信/ }),
  ).not.toContainText("要対応");
  failed = true;
  await expect(nav(page).getByRole("link", { name: /自動送信/ })).toContainText(
    "要対応 1",
    { timeout: 15000 },
  );
});
