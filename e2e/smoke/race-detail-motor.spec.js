import { test, expect, fetchRecorded } from "../fixtures.js";

// 前検タイム・公式2連率（節時点）をモータ情報タブに出す（BOA-451 / phase a FR-4a）
test.describe("レース詳細のモータ情報タブ: 前検タイムと公式2連率", () => {
  const RACE = "/race/2026-09-21-05-12";

  const openMotorTab = async (page) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    await expect(page.locator(".motor-ranking-table").first()).toBeVisible({
      timeout: 30000,
    });
  };

  test("前検の行が取れている節では「前検」列に秒数と節内順位が出て、出典が添えられる", async ({
    page,
  }) => {
    let racerIds = [];
    // 表示中レースの出走選手の登番を拾って、その選手ぶんの前検を返す
    await page.route("**/rest/v1/motor_pretest_stats*", async (route) => {
      const url = new URL(route.request().url());
      // 実レスポンスを一度取って登番を得る（節の全選手ぶんが返る）。
      // route.fetch() は録画を通らないため fetchRecorded を使う
      const response = await fetchRecorded(route);
      const rows = await response.json().catch(() => []);
      racerIds = Array.isArray(rows) ? rows.map((r) => r.racer_id) : [];
      const stub = racerIds.map((racerId, i) => ({
        racer_id: racerId,
        race_date:
          url.searchParams.get("race_date")?.slice(-10) ?? "2026-09-21",
        pretest_time: 6.6 + i * 0.01,
        pretest_rank: i + 1,
        racer_class: "A1",
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(stub),
      });
    });
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).toContainText("前検");
    // 過去レースは2連率の列そのものが出走表時点の公式値なので、同じ値の列を2本並べない
    // （BOA-329、2026-09-29 ユーザー判断(c)）。BOA-428 で、残す1本の見出しを当日と同じ
    // 「公式2連率（節時点）」にした（承認済みのモック）。期間で集計した2連率の列は出さない
    await expect(
      table.locator("thead th", { hasText: "公式2連率" }),
    ).toHaveCount(1);
    await expect(table.locator("thead")).not.toContainText(
      /2連率（(過去|直近)/,
    );
    // 6艇のどれかに前検の秒数（6.60〜6.9x）が出ている
    await expect(table.locator("td.motor-pretest-cell").first()).toHaveText(
      /\d\.\d{2}/,
    );
    await expect(page.locator(".motor-official-source-note")).toContainText(
      "BOAT RACE オフィシャルウェブサイト",
    );
  });

  test("節に前検の行が無い開催では「前検」列ごと出さない（「-」を6つ並べない）", async ({
    page,
  }) => {
    await page.route("**/rest/v1/motor_pretest_stats*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).not.toContainText("前検");
    await expect(table.locator("td.motor-pretest-cell")).toHaveCount(0);
    // 過去レースでは2連率の列が race_entries 由来の公式値で、前検が無くても出る。
    // 期間の切り替えは出さず、公式値である旨の注記に置き換える（BOA-329）
    // 1本だけの2連率の列は、BOA-428 から見出しが「公式2連率（節時点）」
    await expect(
      table.locator("thead th", { hasText: "公式2連率" }),
    ).toHaveCount(1);
    await expect(table.locator("thead")).not.toContainText(
      /2連率（(過去|直近)/,
    );
    await expect(page.locator(".period-toggle")).toHaveCount(0);
    await expect(
      page.getByText("出走表時点の公式値で表示しています"),
    ).toBeVisible();
  });

  test("旧形状のキャッシュが残っていても「前検」列が出る（キャッシュキーの版を上げている）", async ({
    page,
  }) => {
    // BOA-264 で 1着率・優出数を足したときと同じ事故。返り値に
    // フィールドを足したのにキャッシュキーの版を上げないと、過去レースは
    // 7日TTLの旧キャッシュが新フィールド無しの形で返り、列が消える
    await page.addInitScript(() => {
      const stale = [1, 2, 3, 4, 5, 6].map((n) => ({
        boat_number: n,
        player_name: `旧キャッシュ${n}`,
        motor_number: n,
        motor_2rate: 30,
        motor_3rate: 40,
        power_index: 0,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: 10,
      }));
      [90, 30].forEach((days) => {
        try {
          window.localStorage.setItem(
            `boatai:race-motor-breakdown-v3-5-${days}-2026-09-21-05-12`,
            JSON.stringify({ data: stale, timestamp: Date.now() }),
          );
        } catch {
          /* private window 等ではスキップ */
        }
      });
    });
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).toContainText("前検");
    await expect(table).not.toContainText("旧キャッシュ1");
  });
});

test.describe("レース詳細のモータ情報タブ: 連対率の桁（BOA-474）", () => {
  test("2連率・公式2連率・3連率をすべて小数1桁で出す", async ({ page }) => {
    await page.goto("/race/2026-09-21-05-12");
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    const table = page.locator(".motor-ranking-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });

    // 同じ節・同じモーターでも、当日の出走表更新が走る前の行は1桁で入っている。
    // 2桁で出すと同じモーターが 54.80 と 54.84 に見えるため1桁に揃えた
    // 列は位置でなく見出しで引く。会場内順位の列（BOA-428、「2位/65」）は会場のスナップショットが
    // あるときだけ出るので、位置で決め打ちすると録画の日によって別の列を読む（BOA-929）
    // 見出しと本体は同じ1回の evaluate で読む。会場内順位の列は一覧表を出したあとに
    // スナップショットの取得を待って差し込まれる（MotorConditionChart の setVenueRanks）。
    // 見出しを数えたあとで列が増えると、nth-child で読む列が1つ右へずれ、「3位/65」を
    // 2連率として読んでいた（2026-10-26、e2e-shard で繰り返し落ちた）
    const cells = await table.evaluate((tableEl) => {
      const heads = [...tableEl.querySelectorAll("thead th")];
      const rateIndexes = heads
        .map((th, i) => ({
          i,
          text: th.textContent.trim(),
          venueRank: th.classList.contains("motor-venue-rank-head"),
        }))
        .filter((h) => /連率/.test(h.text) && !h.venueRank)
        .map((h) => h.i);
      const rows = [...tableEl.querySelectorAll("tbody tr")].map((tr) => [
        ...tr.children,
      ]);
      return {
        headCount: heads.length,
        rateIndexes,
        rows: rows.map((tds) => ({
          width: tds.length,
          texts: rateIndexes.map((i) => ({
            column: i + 1,
            header: heads[i].textContent.trim(),
            text: (tds[i]?.innerText ?? "").trim(),
          })),
        })),
      };
    });
    expect(cells.rateIndexes.length).toBeGreaterThan(0);
    expect(cells.rows.length).toBeGreaterThan(0);
    for (const row of cells.rows) {
      // 本体の列の数が見出しと違えば、位置で引いた値は別の列のもの
      expect(row.width, "見出しと本体の列の数").toBe(cells.headCount);
      for (const { column, header, text } of row.texts) {
        // セルには数値のあとに注記・札（「前の節までの走り（N走）で出た数字」「初下ろし」等）が
        // 付くことがある。桁を見るのは先頭の数値だけ
        const value = text.match(/^\d+(?:\.\d+)?/)?.[0];
        if (value === undefined) continue;
        expect(value, `${column}列目（${header}）: ${text}`).toMatch(
          /^\d+\.\d$/,
        );
      }
    }
  });
});
