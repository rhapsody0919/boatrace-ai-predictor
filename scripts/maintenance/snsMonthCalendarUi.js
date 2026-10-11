// env読込なし。専用経路を登録し、localhost以外の通信を遮断する。
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const server = await createServer({
  configFile: false,
  envDir: false,
  publicDir: false,
  appType: "custom",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 47859, strictPort: true },
});
server.middlewares.use("/__month_calendar_test", async (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    await server.transformIndexHtml(
      "/__month_calendar_test",
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import DeadlineQueuePanel from '/src/pages/admin/sns-hub/DeadlineQueuePanel.jsx';
    import '/src/styles/design-tokens.css'; import '/src/pages/admin/SnsHubAdmin.css';
    createRoot(document.getElementById('root')).render(React.createElement(DeadlineQueuePanel));
  </script></body></html>`,
    ),
  );
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const output = await mkdtemp(path.join(tmpdir(), "sns-month-calendar-ui-"));
  for (const width of [375, 768, 1024, 1440, 1920])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        timezoneId: "America/Los_Angeles",
      });
      let failed = false;
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== "127.0.0.1") return route.abort();
        if (url.pathname === "/api/admin/sns-hub/deadline-queue")
          return route.fulfill({
            status: failed ? 503 : 200,
            json: failed
              ? { error: "private SQL detail" }
              : {
                  data: [
                    {
                      id: "planned",
                      title: "今月の予約",
                      channel: "x",
                      state: "queued",
                      scheduled_at: "2099-10-07T15:00:00Z",
                      expires_at: "2099-10-08T05:00:00Z",
                      format: "short",
                      race_id: "2099-10-08-01-01",
                      grade: "SG",
                    },
                    {
                      id: "posted",
                      title: "月境界の投稿",
                      channel: "youtube",
                      state: "posted",
                      posted_at: "2099-09-30T15:00:00Z",
                      expires_at: "2000-01-01T00:00:00Z",
                      format: "normal",
                      race_id: "2099-10-01-24-01",
                      observations: [
                        {
                          window: "48h",
                          metric_name: "views",
                          metric_value: null,
                          missing_reason: "未収集",
                          source: "manual",
                          definition: "再生数",
                          observed_at: "2000-01-03T00:00:00Z",
                        },
                      ],
                    },
                    {
                      id: "expired",
                      title: "承認失効",
                      channel: "x",
                      state: "cancelled",
                      scheduled_at: "2099-10-08T00:00:00Z",
                      format: "short",
                      race_id: "2099-10-08-01-01",
                    },
                    {
                      id: "unknown",
                      title: "日付なし",
                      channel: "x",
                      state: "pending_review",
                    },
                  ],
                },
          });
        return route.continue();
      });
      await page.goto("http://127.0.0.1:47859/__month_calendar_test");
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      await page.getByLabel("表示月", { exact: true }).fill("2099-10");
      await page
        .getByRole("button", { name: "2099-10-08の投稿 2件", exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".sns-month-calendar-grid button").count(),
        31,
      );
      // labelがselectを包む構造では、label.textContentにoption文字列まで
      // 含まれるためgetByLabel(exact:true)が一致しない（patch08で特定済みの既知の不具合）。
      // role+nameでselect自体のaccessible nameを見る。
      await page
        .getByRole("combobox", { name: "型", exact: true })
        .selectOption("short");
      await page
        .getByRole("combobox", { name: "会場", exact: true })
        .selectOption("01");
      await page
        .getByRole("button", { name: "2099-10-08の投稿 2件", exact: true })
        .click();
      assert.equal(await page.getByRole("listitem").count(), 2);
      assert(
        (
          await page.locator(".sns-month-calendar-summary").innerText()
        ).includes("SG"),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${width}/${theme}: 横スクロール`,
      );
      await page.screenshot({
        path: path.join(output, `${width}-${theme}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "絞り込みを解除", exact: true })
        .click();
      await page
        .getByRole("button", { name: "2099-10-01の投稿 1件", exact: true })
        .click();
      assert.equal(await page.getByRole("listitem").count(), 1);
      assert((await page.getByRole("listitem").innerText()).includes("未収集"));
      await page.getByLabel("表示月", { exact: true }).fill("2099-02");
      assert.equal(
        await page.locator(".sns-month-calendar-grid button").count(),
        28,
      );
      await page
        .getByRole("button", { name: "2099-02-01の投稿 0件", exact: true })
        .click();
      await page
        .getByText("対象の投稿はありません。", { exact: true })
        .waitFor();
      failed = true;
      await page.reload();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.locator(".sns-month-calendar").count(),
        0,
        "取得失敗を空月に化けさせない",
      );
      assert(
        !(await page.getByRole("alert").innerText()).includes("private SQL"),
      );
      await page.close();
    }
  console.log(`SNS month calendar UI PASS; screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
