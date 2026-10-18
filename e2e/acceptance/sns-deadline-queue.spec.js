import { test, expect, e2eNow } from "../fixtures.js";
// 自動送信ページの中身（DeadlineQueuePanel）。2026-10-18 にページを分け、全期間の一覧をやめて
// 「いまの状態」「要対応」「今日」と、畳んだ全月カレンダーにした
const iso = (ms) => new Date(ms).toISOString();
const H = 60 * 60 * 1000;
const control = {
  paused: false,
  channels: [
    { channel: "x", mode: "auto", dry_run: false },
    { channel: "youtube", mode: "auto", dry_run: true },
  ],
};
const route = (page, data, extra = { control }) =>
  page.route("**/*", (r) => {
    const url = new URL(r.request().url());
    if (url.hostname !== "127.0.0.1") return r.abort();
    if (url.pathname === "/api/admin/sns-hub/deadline-queue")
      return r.fulfill({ json: { data, ...extra } });
    return r.fallback();
  });
const section = (page, name) => page.getByRole("region", { name });

for (const theme of ["light", "dark"])
  test(`${theme}: 375px・端末が米国時間でも要対応と今日を JST で分ける`, async ({
    page,
  }) => {
    const now = e2eNow().getTime(); // ブラウザの時計（録画の再生では固定）とそろえる
    await route(page, [
      {
        id: "later",
        title: "明日以降の予定",
        channel: "x",
        state: "queued",
        scheduled_at: iso(now + 72 * H),
        expires_at: iso(now + 73 * H),
      },
      {
        id: "failed",
        title: "動画失敗",
        channel: "youtube",
        youtube_mode: "scheduled",
        state: "failed",
        scheduled_at: iso(now - H),
        expires_at: iso(now),
        error_code: "upload_failed",
      },
      {
        id: "old-failed",
        title: "先週の失敗",
        channel: "x",
        state: "failed",
        scheduled_at: iso(now - 7 * 24 * H),
      },
      {
        id: "posted",
        title: "今日公開した投稿",
        channel: "x",
        state: "posted",
        posted_at: iso(now - 60 * 1000),
      },
    ]);
    await page.goto("/__queue_test");
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
    await expect(section(page, "いまの状態")).toContainText("自動・本番");
    await expect(section(page, "いまの状態")).toContainText(
      "自動・試運転（送らない）",
    );
    const attention = section(page, "要対応");
    await expect(attention.getByRole("listitem")).toHaveCount(1);
    await expect(attention.getByRole("listitem")).toContainText("動画失敗");
    await attention.getByText("詳しく").click();
    await expect(attention).toContainText("保留・失敗理由: upload_failed");
    await expect(attention).toContainText("予約公開");
    const today = page.getByRole("region", { name: /^今日 / });
    await expect(today).toContainText("今日公開した投稿");
    await expect(today).not.toContainText("明日以降の予定");
    await expect(page.getByText("全月カレンダー（JST）を開く")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "全月カレンダー（JST）" }),
    ).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= 375),
    ).toBe(true);
    await page.screenshot({
      path: `../out/reports/queue-${theme}.png`,
      fullPage: true,
    });
  });

for (const theme of ["light", "dark"])
  test(`${theme}: 非公開残置の動画ID・要照合と手動削除案内は日付が古くても要対応に残る`, async ({
    page,
  }) => {
    await route(page, [
      {
        id: "retained",
        title: "公開しなかった動画",
        channel: "youtube",
        state: "reconcile",
        youtube_stage: "private_retained",
        external_post_id: "abcdefghijk",
        error_code: "youtube_private_retained",
        scheduled_at: "2026-09-01T03:00:00Z",
      },
    ]);
    await page.goto("/__queue_test");
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
    const item = section(page, "要対応").getByRole("listitem");
    await expect(item).toContainText("要照合（再送禁止）");
    await item.getByText("詳しく").click();
    await expect(item).toContainText("abcdefghijk");
    await expect(
      page.getByText(/非公開のまま残置（削除はオーナー操作）/),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= 375),
    ).toBe(true);
  });

test("状態が取得できないときは止める手順を出し、停止中は「全部止める」を押せない", async ({
  page,
}) => {
  await route(page, [], { control: null });
  await page.goto("/__queue_test");
  await expect(section(page, "いまの状態")).toContainText(
    "送信の状態を取得できません",
  );
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await route(page, [], { control: { ...control, paused: true } });
  await page.reload();
  await expect(section(page, "いまの状態")).toContainText("止まっている");
  await expect(page.getByRole("button", { name: "全部止める" })).toBeDisabled();
});

test("「全部止める」は確認してから x-send-stop を呼ぶ", async ({ page }) => {
  let stopped = 0;
  await page.route("**/api/admin/sns-hub/x-send-stop", (r) => {
    stopped++;
    return r.fulfill({ json: { data: { paused: true } } });
  });
  await route(page, []);
  await page.goto("/__queue_test");
  await page.getByRole("button", { name: "全部止める" }).click();
  expect(stopped).toBe(0);
  await page
    .getByRole("button", { name: "止める（X・YouTube すべて）" })
    .click();
  await expect.poll(() => stopped).toBe(1);
});

// 2026-10-18 オーナー報告: ダークテーマで :root の白文字が一覧に継承され、明るい地の上で読めなかった。
// 一覧の各行の文字色と、実際に下に見える地の色のコントラスト比が 4.5 以上かを見る
const contrastOfListText = (page) =>
  page.evaluate(() => {
    // color-mix() の計算値は color(srgb 0〜1 …) で返るので 0〜255 にそろえる（透明度は4つ目のまま）
    const rgb = (v) => {
      const n = v.match(/[\d.]+/g).map(Number);
      return v.startsWith("color(srgb")
        ? [...n.slice(0, 3).map((x) => x * 255), ...n.slice(3)]
        : n;
    };
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map((x) => {
        x /= 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = rgb(getComputedStyle(e).backgroundColor);
        if (c.length < 4 || c[3] > 0) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    return [
      ...document.querySelectorAll(
        ".sns-auto-send :is(h2,p,dt,dd,.sns-queue-name,.sns-queue-time,.sns-queue-state)",
      ),
    ].map((el) => {
      const a = lum(rgb(getComputedStyle(el).color)),
        b = lum(bgOf(el));
      return {
        text: el.textContent.slice(0, 30),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
for (const [label, setup] of [
  [
    "data-theme=light",
    async (page) =>
      page.evaluate(() =>
        document.documentElement.setAttribute("data-theme", "light"),
      ),
  ],
  [
    "data-theme=dark",
    async (page) =>
      page.evaluate(() =>
        document.documentElement.setAttribute("data-theme", "dark"),
      ),
  ],
  [
    "OSのダーク設定（data-theme 未設定）",
    async (page) => page.emulateMedia({ colorScheme: "dark" }),
  ],
])
  test(`${label}: 自動送信ページの文字が地の色に対して 4.5:1 以上`, async ({
    page,
  }) => {
    const now = e2eNow().getTime(); // ブラウザの時計（録画の再生では固定）とそろえる
    await route(page, [
      {
        id: "failed",
        title: "滋賀支部のA1比率は、長崎支部の2.2倍",
        channel: "x",
        state: "failed",
        scheduled_at: iso(now),
      },
      {
        id: "posted",
        title: "公開済み",
        channel: "youtube",
        state: "posted",
        posted_at: iso(now),
      },
      {
        id: "queued",
        title: "予定",
        channel: "x",
        state: "queued",
        scheduled_at: iso(now + H),
        expires_at: iso(now + 2 * H),
      },
      {
        id: "held",
        title: "保留",
        channel: "x",
        state: "held",
        scheduled_at: iso(now),
        expires_at: iso(now + 2 * H),
      },
      {
        id: "cancelled",
        title: "失効",
        channel: "x",
        state: "cancelled",
        scheduled_at: iso(now),
      },
    ]);
    await page.goto("/__queue_test");
    await setup(page);
    await expect(
      section(page, "要対応").getByRole("listitem").first(),
    ).toContainText("失敗");
    const low = (await contrastOfListText(page)).filter((r) => r.ratio < 4.5);
    expect(low).toEqual([]);
  });
