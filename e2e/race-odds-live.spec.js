import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { parseLiveOddsPage } from "../scripts/lib/liveOdds.js";

/**
 * オッズ一覧タブのライブ取得（BOA-487）の固定。
 *
 * ライブ API（/api/odds/live）と race_odds のスナップショットは route でモックし、ページの時計を
 * レースの締切前に固定する（公式・DBの状態に左右されない）。出走表などタブ以外は本番の Supabase を読む。
 *
 * - 成功: 「最新 13:55 取得 公式更新 8:14 [更新]」に差し替わる
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
    await expect(status).toContainText("13:55 取得");
    await expect(status.getByRole("button", { name: "更新" })).toBeVisible();
    // 開いたときは単勝・複勝、3連単、3連単の表の「2単」に使う2連単を取る
    expect([...new Set(calls)].sort()).toEqual(["2tf", "3t", "tf"]);
    // 3連単の票0は「票なし」
    await expect(page.locator(".rol-odds.is-no-votes").first()).toContainText(
      "票なし",
    );
    // ファン評価1周目: 「最新」の真下の「2単」はライブの2連単（スナップショットの値・「-」にしない）
    const exacta12 = PARSED["2tf"].data.exactaAll["1-2"].toFixed(1);
    await expect(
      page.locator(".rol-block").first().locator(".rol-col").first(),
    ).toContainText(`2単${exacta12}`);

    // 他の券種はチップを切り替えたときに取る
    await page.getByRole("tab", { name: "3連複" }).click();
    await expect(status).toContainText("最新");
    expect(calls).toContain("3f");
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
    // ファン評価2周目: 最新の点もスナップショットと同じ「締切○分前」（13:55:10 取得、締切 14:24）
    await expect(page.locator(".rol-trend-item.is-live")).toContainText(
      "最新（締切29分前）",
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

  // /code-review の指摘の再現: 単勝が全艇 null の行が最新でも、単勝の値を持つ直前の行を出す
  // （全艇 null の行を「最新」とみなして、表を全て「-」にしない）
  test("単勝・複勝（スナップショット）: 単勝が全艇 null の最新行より、値を持つ行を使う", async ({
    page,
  }) => {
    const nullWinRow = { ...SNAPSHOT_ROW, captured_at: "2026-09-28T05:19:00Z" };
    for (let n = 1; n <= 6; n++) {
      nullWinRow[`odds_win_${n}`] = null;
      nullWinRow[`odds_place_${n}_low`] = null;
      nullWinRow[`odds_place_${n}_high`] = null;
    }
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [SNAPSHOT_ROW, nullWinRow],
    });
    await page.getByRole("tab", { name: "単勝・複勝" }).click();
    await expect(status).toContainText("13:54 取得（締切30分前）の値");
    const table = page.locator(".rol-win-table");
    await expect(table).toContainText("3.0");
    await expect(table).toContainText("1.1-1.9");
    // この行でも4号艇の単勝は null（票0か未取得か区別できない）→「-」＋注記
    await expect(page.locator(".rol-callout")).toContainText(
      "票なし（または未取得）",
    );
  });

  // ---- ファン評価1周目の指摘の再現テスト ----

  test("締切後: スナップショットは公式表示の遅れの注記を付け、「締切時点」と断定しない", async ({
    page,
  }) => {
    const atDeadline = { ...SNAPSHOT_ROW, captured_at: "2026-09-28T05:24:10Z" };
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [SNAPSHOT_ROW, atDeadline],
    });
    await expect(status).toContainText("14:24 取得（締切直前）の値");
    await expect(status).toContainText(
      "締切時オッズ・確定の払戻とは一致しないことがあります",
    );
    await expect(status).not.toContainText("締切時点");
  });

  test("推移パネル: スナップショットの時点は「締切○分前」と書く", async ({
    page,
  }) => {
    await setup(page, { now: AFTER_DEADLINE });
    await page.getByRole("button", { name: /^1-2-3 / }).click();
    await expect(page.locator(".rol-trend-label").first()).toHaveText(
      "締切30分前",
    );
  });

  test("更新: CDN から同じ応答が返ったら「変化なし」を出す", async ({
    page,
  }) => {
    const { status } = await setup(page);
    await expect(status).toContainText("公式更新 8:14");
    await status.getByRole("button", { name: "更新" }).click();
    await expect(page.getByTestId("odds-live-unchanged")).toContainText(
      "変化なし",
    );
  });

  test("スナップショットが無いときの取得中は、時間がかかることを示す", async ({
    page,
  }) => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { status } = await setup(page, {
      snapshots: [],
      live: async (p) => {
        await gate;
        return liveBody(p);
      },
    });
    await expect(status).toContainText("10秒ほどかかります");
    release();
    await expect(status).toContainText("公式更新 8:14");
  });

  test("スナップショットで票0（保存時にキーが落ちた組み合わせ）は「-」でなく「票なし」", async ({
    page,
  }) => {
    const row = {
      ...SNAPSHOT_ROW,
      trifecta_all: { ...SNAPSHOT_ROW.trifecta_all },
    };
    delete row.trifecta_all["6-5-4"];
    await setup(page, { now: AFTER_DEADLINE, snapshots: [row] });
    await expect(
      page.getByRole("button", { name: "6-5-4 票なし" }),
    ).toBeVisible();
  });

  test("375px: 3連単の列の下の「合成」「2単」が2行に割れない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, { now: AFTER_DEADLINE });
    await expect(page.locator(".rol-col-foot").first()).toBeVisible();
    const broken = await page.$$eval(".rol-col-foot > span", (spans) =>
      spans
        .filter(
          (s) =>
            s.getClientRects().length > 1 ||
            s.getBoundingClientRect().height > 20,
        )
        .map((s) => s.textContent),
    );
    expect(broken).toEqual([]);
  });

  // ---- ファン評価2周目の指摘の再現テスト ----

  test("拡連複（スナップショット）: キーの無い組があってもページが落ちず「票なし」", async ({
    page,
  }) => {
    const wide = { ...PARSED.k.data.wideAll };
    delete wide["3-5"];
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [{ ...SNAPSHOT_ROW, wide_all: wide }],
    });
    await page.getByRole("tab", { name: "拡連複" }).click();
    await expect(
      page.getByRole("button", { name: "3-5 票なし" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("単勝・複勝（スナップショット）: 単勝の null は「票なし」と断定せず「-」と注記", async ({
    page,
  }) => {
    await setup(page, { now: AFTER_DEADLINE });
    await page.getByRole("tab", { name: "単勝・複勝" }).click();
    const row4 = page.locator(".rol-win-table tbody tr").filter({
      has: page.locator(".rol-boat-badge", { hasText: /^4$/ }),
    });
    await expect(row4.locator("td").first()).toHaveText("-");
    await expect(page.locator(".rol-win-table")).not.toContainText("票なし");
    await expect(page.locator(".rol-callout")).toContainText(
      "票なし（または未取得）",
    );
  });

  test("取得中→最新で、主に出す時刻が戻らない（取得時刻を主に、公式更新は補足）", async ({
    page,
  }) => {
    const { status } = await setup(page);
    await expect(status.locator("b")).toHaveText("13:55 取得");
    await expect(status.locator(".rol-status-sub").first()).toContainText(
      "公式更新 8:14",
    );
  });

  test("締切90分より前の当日レース: いつ出るかと公式オッズへの導線を示す", async ({
    page,
  }) => {
    const { calls } = await setup(page, {
      now: new Date("2026-09-28T12:30:00+09:00"),
      snapshots: [],
    });
    const note = page.getByTestId("odds-before-window");
    await expect(note).toContainText("締切90分前から");
    await expect(note.getByRole("link")).toHaveAttribute(
      "href",
      "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=8&jcd=03&hd=20260928",
    );
    expect(calls).toEqual([]);
  });
});
