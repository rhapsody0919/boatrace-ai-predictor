import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { parseLiveOddsPage } from "../scripts/lib/liveOdds.js";

/**
 * オッズ一覧タブのライブ取得（BOA-487）の固定。
 *
 * ライブ API（/api/odds/live）と race_odds のスナップショットは route でモックし、ページの時計を
 * レースの締切前に固定する（公式・DBの状態に左右されない）。出走表などタブ以外は本番の Supabase を読む。
 *
 * - 成功: 「最新 公式更新 8:14 取得 13:55 [更新]」に差し替わる
 * - 取得中: スナップショットを出したまま「最新オッズを取得中… いまは○取得の値」
 * - 失敗: スナップショットのまま「最新の取得に失敗しました」＋再取得。スナップショットも無ければ InlineFetchError
 * - 票0: 「票なし」。全艇票0なら注記
 * - 締切後: ライブ取得しない
 * - 更新ボタン: 取り直して差し替える
 */

const RACE = "2026-09-28-03-08"; // 江戸川8R（締切 14:24）
const BEFORE_DEADLINE = new Date("2026-09-28T13:55:00+09:00");
const AFTER_DEADLINE = new Date("2026-09-28T14:40:00+09:00");

const FIX = (n) =>
  fs.readFileSync(
    new URL(`../scripts/lib/__fixtures__/odds/${n}`, import.meta.url),
    "utf8",
  );
const PARSED = {
  tf: parseLiveOddsPage("tf", FIX("oddstf-zero-votes-2026-09-28-03-08.html")),
  "3t": parseLiveOddsPage(
    "3t",
    FIX("odds3t-predeadline-2026-09-29-21-02.html"),
  ),
  "3f": parseLiveOddsPage("3f", FIX("odds3f-2026-09-19-05-01.html")),
  "2tf": parseLiveOddsPage("2tf", FIX("odds2tf-2026-09-19-05-01.html")),
  k: parseLiveOddsPage("k", FIX("oddsk-2026-09-19-05-01.html")),
};

const liveBody = (page, overrides = {}) => ({
  ok: true,
  raceId: RACE,
  page,
  fetchedAt: "2026-09-28T04:55:10Z", // 13:55 JST
  officialUpdatedAt: PARSED[page].officialUpdatedAt ?? "08:14",
  final: false,
  data: PARSED[page].data,
  ...overrides,
});

// 締切30分前（13:54 JST）のスナップショット1行
const SNAPSHOT_ROW = (() => {
  const t3 = parseLiveOddsPage("3t", FIX("odds3t-2026-09-19-05-01.html")).data
    .trifectaAll;
  const row = {
    captured_at: "2026-09-28T04:54:00Z",
    trifecta_all: t3,
    trio_all: null,
    exacta_all: null,
    quinella_all: null,
    wide_all: null,
  };
  for (let n = 1; n <= 6; n++) {
    row[`odds_win_${n}`] = n === 4 ? null : 2 + n;
    row[`odds_place_${n}_low`] = 1.1;
    row[`odds_place_${n}_high`] = 1.9;
  }
  return row;
})();

async function setup(
  page,
  { now = BEFORE_DEADLINE, snapshots = [SNAPSHOT_ROW], live } = {},
) {
  await page.clock.setFixedTime(now);
  const calls = [];
  await page.route("**/rest/v1/race_odds**", (route) =>
    route.fulfill({ json: snapshots }),
  );
  await page.route("**/api/odds/live**", async (route) => {
    const p = new URL(route.request().url()).searchParams.get("page");
    calls.push(p);
    const body = live ? await live(p, calls) : liveBody(p);
    return route.fulfill({ json: body });
  });
  await page.goto(`/race/${RACE}`, { waitUntil: "domcontentloaded" });
  await page
    .locator(".race-tabs-btn", { hasText: "オッズ一覧" })
    .click({ timeout: 60000 });
  return { calls, status: page.getByTestId("odds-live-status") };
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe("オッズ一覧のライブ取得（BOA-487）", () => {
  test.slow();

  test("成功: 単勝・複勝と3連単を並列に取り、最新と公式更新時刻に差し替わる", async ({
    page,
  }) => {
    const { calls, status } = await setup(page);
    await expect(status).toContainText("最新");
    await expect(status).toContainText("公式更新 8:14");
    await expect(status).toContainText("取得 13:55");
    await expect(status.getByRole("button", { name: "更新" })).toBeVisible();
    expect([...new Set(calls)].sort()).toEqual(["3t", "tf"]);
    // 3連単の票0は「票なし」
    await expect(page.locator(".rol-odds.is-no-votes").first()).toContainText(
      "票なし",
    );

    // 他の券種はチップを切り替えたときに取る
    await page.getByRole("tab", { name: "2連単" }).click();
    await expect(status).toContainText("最新");
    expect(calls).toContain("2tf");
  });

  test("単勝・複勝: 票0の艇は「票なし」、全艇票0なら注記", async ({ page }) => {
    const allZero = {
      win: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, 0])),
      place: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((n) => [n, { low: 0, high: 0 }]),
      ),
    };
    let tfCount = 0;
    const { status } = await setup(page, {
      live: (p) => {
        if (p !== "tf") return liveBody(p);
        tfCount++;
        return tfCount === 1
          ? liveBody("tf", { data: allZero })
          : liveBody("tf");
      },
    });
    await page.getByRole("tab", { name: "単勝・複勝" }).click();
    await expect(status).toContainText("公式更新");
    const table = page.locator(".rol-win-table");
    await expect(table.locator("tbody tr")).not.toHaveCount(0);
    await expect(page.locator(".rol-callout")).toContainText(
      "票がまだ入っていません",
    );
    await expect(table).toContainText("票なし");
    await expect(table).not.toContainText("0.0");
  });

  test("取得中はスナップショットを出したまま、取得時刻を示す", async ({
    page,
  }) => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { status } = await setup(page, {
      live: async (p) => {
        await gate;
        return liveBody(p);
      },
    });
    await expect(status).toContainText("最新オッズを取得中… いまは");
    await expect(status).toContainText("13:54 取得（締切30分前）");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    release();
    await expect(status).toContainText("公式更新 8:14");
  });

  test("失敗: スナップショットの値を出し、再取得で差し替わる", async ({
    page,
  }) => {
    let fail = true;
    const { status } = await setup(page, {
      live: (p) =>
        fail
          ? { ok: false, reason: "fetch_failed", retryAfterSec: 10 }
          : liveBody(p),
    });
    await expect(status).toContainText("最新の取得に失敗しました");
    await expect(status).toContainText("13:54 取得（締切30分前）の値を表示中");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    fail = false;
    await status.getByRole("button", { name: "再取得" }).click();
    await expect(status).toContainText("公式更新 8:14");
  });

  test("失敗かつスナップショットも無い: InlineFetchError", async ({ page }) => {
    await setup(page, {
      snapshots: [],
      live: () => ({
        ok: false,
        reason: "upstream_http_503",
        retryAfterSec: 10,
      }),
    });
    await expect(page.locator(".inline-fetch-error")).toContainText(
      "最新のオッズを取得できませんでした",
    );
  });

  test("スナップショットが無くてもライブ値だけで表を出す", async ({ page }) => {
    const { status } = await setup(page, { snapshots: [] });
    await expect(status).toContainText("公式更新 8:14");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    await page.getByRole("button", { name: /^1-2-3 / }).click();
    await expect(page.locator(".rol-trend-item.is-live")).toContainText(
      "最新 8:14",
    );
  });

  test("更新ボタン: 取り直して差し替える（自動では取り直さない）", async ({
    page,
  }) => {
    const { calls, status } = await setup(page, {
      live: (p, all) =>
        liveBody(p, {
          officialUpdatedAt:
            all.filter((c) => c === p).length > 1 ? "13:58" : "08:14",
        }),
    });
    await expect(status).toContainText("公式更新 8:14");
    const before = calls.filter((c) => c === "3t").length;
    await status.getByRole("button", { name: "更新" }).click();
    await expect(status).toContainText("公式更新 13:58");
    expect(calls.filter((c) => c === "3t").length).toBe(before + 1);
  });

  test("締切後のレースはライブ取得しない", async ({ page }) => {
    const { calls, status } = await setup(page, { now: AFTER_DEADLINE });
    await expect(status).toContainText("13:54 取得（締切30分前）の値");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    expect(calls).toEqual([]);
    await expect(status.getByRole("button")).toHaveCount(0);
  });
});
