/** verify-sns-observations.js --ui から呼ぶ。外部通信・env読込なし。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
export async function verifyObservationCsvUi(csv) {
  const output =
    process.env.SNS_CSV_UI_OUTPUT ||
    (await fs.mkdtemp(path.join(tmpdir(), "sns-csv-ui-")));
  await fs.mkdir(output, { recursive: true });
  const server = await createServer({
    configFile: false,
    envDir: false,
    publicDir: false,
    appType: "custom",
    plugins: [react()],
    server: { host: "127.0.0.1", port: 47857, strictPort: true },
  });
  // appType=custom。SPAのフォールバックを使わず先に専用経路を登録する。
  server.middlewares.use("/__observation_csv_test", async (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      await server.transformIndexHtml(
        "/__observation_csv_test",
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div class="sns-hub-admin-page" id="root"></div><script type="module">
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import MetricsTab from '/src/pages/admin/sns-hub/MetricsTab.jsx';
  import '/src/styles/design-tokens.css'; import '/src/pages/admin/SnsHubAdmin.css';
  createRoot(document.getElementById('root')).render(React.createElement(MetricsTab));
  </script></body></html>`,
      ),
    );
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch();
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width: theme === "light" ? 375 : 1440, height: 900 },
        acceptDownloads: true,
      });
      let mode = "csv";
      let calls = 0;
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== "127.0.0.1") return route.abort();
        if (url.pathname === "/api/admin/sns-hub/observations") {
          if (url.searchParams.get("export") !== "csv")
            return route.fulfill({
              json: { data: { drafts: [], observations: [] } },
            });
          calls++;
          assert.equal(url.searchParams.get("start"), "2026-09-01");
          assert.equal(url.searchParams.get("end"), "2026-09-07");
          assert.equal(url.searchParams.get("platform"), "x");
          if (mode === "html")
            return route.fulfill({
              contentType: "text/html",
              body: "<html>fallback</html>",
            });
          if (mode === "error")
            return route.fulfill({
              status: 500,
              json: { error: "PRIVATE_DETAIL" },
            });
          return route.fulfill({
            contentType: "text/csv; charset=utf-8",
            body: csv,
          });
        }
        return route.continue();
      });
      await page.goto("http://127.0.0.1:47857/__observation_csv_test");
      await page.getByRole("heading", { name: "週次観測CSV" }).waitFor();
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      await page.getByRole("button", { name: "CSVをダウンロード" }).click();
      assert.equal(calls, 0);
      await page.getByLabel("公開開始日").fill("2026-09-01");
      await page.getByLabel("公開終了日").fill("2026-09-07");
      await page.getByLabel("チャネル", { exact: true }).selectOption("x");
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "CSVをダウンロード" }).click();
      const download = await pending;
      assert.equal(
        download.suggestedFilename(),
        "posts-2026-09-01-2026-09-07-x.csv",
      );
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.ok(
        Buffer.concat(chunks).toString("utf8").includes('"link_clicks"'),
      );
      await page
        .getByRole("status")
        .filter({ hasText: "ダウンロードを開始" })
        .waitFor();
      for (mode of ["html", "error"]) {
        let unintended = false;
        const onDownload = () => {
          unintended = true;
        };
        page.on("download", onDownload);
        await page.getByRole("button", { name: "CSVをダウンロード" }).click();
        await page
          .getByRole("status")
          .filter({ hasText: "CSVを取得できませんでした" })
          .waitFor();
        assert.equal(unintended, false);
        assert.ok(
          !(await page.locator("body").innerText()).includes("PRIVATE_DETAIL"),
        );
        page.off("download", onDownload);
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: path.join(output, `task-13-csv-${theme}.png`),
        fullPage: true,
      });
      await page.close();
    }
    console.log(
      "SNS CSV UI: download, input validation, HTML/error rejection, light/dark PASS",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
}
