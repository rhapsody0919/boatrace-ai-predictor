import { viewportSkipReason } from "../viewport-skip.js";
import { test, expect, fetchRecorded } from "../fixtures.js";
import {
  OVERFLOW_TOLERANCE_PX,
  gotoAndSettle,
  inspectGrids,
  expectNoWastedGrids,
} from "./helpers.js";

test("BOA-1025: 直前情報の小標本は375pxで灰・通常の太さになる", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/race/2026-09-29-16-12?tab=beforeInfo");
  const table = page.locator(".rbi-card .drt-table").first();
  await expect(table).toBeVisible();
  for (const theme of ["light", "dark"]) {
    const styles = await table.evaluate((table, theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      const sample = document.createElement("span");
      sample.className = "drt-sub drt-n-small-sample";
      sample.textContent = "⚠n=2";
      table.querySelector("td").append(sample);
      const probe = document.createElement("span");
      probe.style.color = "var(--text-secondary)";
      document.body.append(probe);
      const result = {
        color: getComputedStyle(sample).color,
        expectedColor: getComputedStyle(probe).color,
        weight: getComputedStyle(sample).fontWeight,
      };
      sample.remove();
      probe.remove();
      return result;
    }, theme);
    expect(styles.color, theme).toBe(styles.expectedColor);
    expect(styles.weight, theme).toBe("400");
  }
});

test("rbit-bar: Fバッジの有無・長さによらず6艇の棒の枠がそろう", async ({
  page,
}) => {
  await page.goto("/race/2026-09-21-02-05?tab=basic", {
    waitUntil: "domcontentloaded",
  });
  const rows = page.locator(".rbit-bar-row");
  await expect(rows).toHaveCount(6);
  // レイアウトだけの再現用。録画のF数に依存せず、FlyingBadgeと同じ構造を
  // 6号艇にだけ置く（本番データ・集計値は変更しない）。
  // 置き換えと測定は1回の evaluate（同期）の中で行う。await を挟むと、その間に
  // データの再描画が本物の F バッジを戻し、バッジが2つになって落ちた（BOA-871）
  for (const label of ["", "今節", "this meet", "이번 시리즈", "本節"]) {
    const measured = await rows.evaluateAll((elements, meetLabel) => {
      for (const row of elements) {
        row
          .querySelectorAll(".flying-badge")
          .forEach((badge) => badge.remove());
      }
      const badge = document.createElement("span");
      badge.className = `flying-badge is-f2${meetLabel ? " has-meet" : ""}`;
      badge.textContent = "F2";
      if (meetLabel) {
        const meet = document.createElement("span");
        meet.className = "flying-badge-meet";
        meet.textContent = meetLabel;
        badge.append(meet);
      }
      elements[5].querySelector(".rbit-name-cell").append(badge);
      return {
        badges: elements.map(
          (row) => row.querySelectorAll(".flying-badge").length,
        ),
        widths: elements.map(
          (row) =>
            row.querySelector(".rbit-bar-track").getBoundingClientRect().width,
        ),
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    }, label);
    expect(measured.badges, `${label}: バッジは6号艇にだけ1つ`).toEqual([
      0, 0, 0, 0, 0, 1,
    ]);
    const { widths } = measured;
    expect(widths).toHaveLength(6);
    expect(Math.min(...widths), `${label}: 空の棒枠`).toBeGreaterThan(0);
    expect(
      Math.max(...widths) - Math.min(...widths),
      `${label}: 6艇の棒枠の幅 ${widths.join(", ")}`,
    ).toBeLessThanOrEqual(1);
    expect(measured.overflow, `${label}: 横スクロール`).toBeLessThanOrEqual(
      OVERFLOW_TOLERANCE_PX,
    );
  }
});

/**
 * 直前情報タブ（BOA-485）。上の PAGES はレース詳細を既定タブのまま測るため、
 * 直前情報タブの「この枠からの進入コース」カード（艇番・横棒・要約の3列グリッド）と
 * 展示進入の行を含む表は検査の対象外だった。タブを開いた状態で同じ2つの検査を通す。
 * 横棒が要約列に押されて潰れていないか（幅が残っているか）も見る
 */
test.describe("レイアウト: 直前情報タブ（この枠からの進入コース）", () => {
  const RACE = "/race/2026-09-26-08-02";

  test("横スクロールが出ず、グリッドの幅も無駄にならず、横棒が潰れない", async ({
    page,
  }) => {
    await gotoAndSettle(page, RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    const card = page.getByTestId("entry-course-dist");
    await expect(card.locator(".ecd-seg").first()).toBeVisible({
      timeout: 30000,
    });
    // 6艇ぶんの取得が出揃ってから測る（1艇目の棒が出た時点では他艇が
    // 読み込み中のことがある。CIで実際にそのタイミングを踏んだ）
    await expect(card.locator(".drt-skeleton")).toHaveCount(0, {
      timeout: 30000,
    });

    const layout = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        overflow: de.scrollWidth - de.clientWidth,
        bars: [...document.querySelectorAll(".ecd-row .ecd-bar")].map((bar) =>
          Math.round(bar.getBoundingClientRect().width),
        ),
      };
    });
    expect(layout.overflow, JSON.stringify(layout)).toBeLessThanOrEqual(
      OVERFLOW_TOLERANCE_PX,
    );
    expect(layout.bars).toHaveLength(6);
    // 375pxでも棒として読める幅がある（艇番28px＋要約104pxを除いた残り）
    for (const width of layout.bars) expect(width).toBeGreaterThan(120);

    expectNoWastedGrids(await inspectGrids(page));
  });
});

// PC幅で、1行に名前と数値を並べるリストが 1200px の箱の両端に離れない（BOA-619 項目3）。
// 1440px で、展開予測の決まり手と確率が約1000px、払戻金の券種と金額も約1000px離れていた
test.describe("レイアウト: PC幅で名前と数値を離しすぎない（BOA-619）", () => {
  const RACE = "/race/2026-09-29-16-12"; // 児島12R（確定済み）

  // 指定は 1025px から効く。箱が 1200px で止まる前の帯（1025〜1279px）も通すため、
  // layout-desktop のときは 1100px でも確かめる
  const widthsFor = (testInfo) => {
    if (testInfo.project.name === "layout-desktop") return [1100, 1440];
    if (testInfo.project.name === "layout-wide") return [1920];
    return [];
  };

  test("AI予想の振り返り: 決まり手と確率が近く、左端はタブの列にそろえる（BOA-820）", async ({
    page,
  }, testInfo) => {
    const widths = widthsFor(testInfo);
    test.skip(
      widths.length === 0,
      viewportSkipReason("PC幅（1025px以上）だけの指定"),
    );
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${RACE}?tab=aiPrediction`, {
        waitUntil: "domcontentloaded",
      });
      const row = page.locator(".turn-pattern-row").first();
      await expect(row).toBeVisible({ timeout: 30000 });
      const m = await row.evaluate((el) => {
        const r = (q) => el.querySelector(q).getBoundingClientRect();
        const tab = el
          .closest(".race-ai-prediction-tab")
          .getBoundingClientRect();
        const box = el.closest(".race-tabs-panel").getBoundingClientRect();
        return {
          gap: r(".turn-pattern-prob").left - r(".turn-pattern-technique").left,
          tabLeft: tab.left,
          boxLeft: box.left,
        };
      });
      expect(
        m.gap,
        `${width}px: 決まり手の左端から確率の左端まで`,
      ).toBeLessThanOrEqual(700);
      // 以前はページの中央に置いていたが、タブを切り替えるたびに左端が飛ぶので、タブの列にそろえる
      // （BOA-820、2026-10-10 ユーザー決定。BOA-881 で列そのものを画面の中央に置いた後も同じ）
      expect(
        Math.abs(m.tabLeft - m.boxLeft),
        `${width}px: 振り返りの左端`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("結果の払戻金: 券種と金額が近い", async ({ page }, testInfo) => {
    const widths = widthsFor(testInfo);
    test.skip(
      widths.length === 0,
      viewportSkipReason("PC幅（1025px以上）だけの指定"),
    );
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${RACE}?tab=result`, { waitUntil: "domcontentloaded" });
      const row = page.locator(".rr-payout-row").first();
      await expect(row).toBeVisible({ timeout: 30000 });
      const gap = await row.evaluate(
        (el) =>
          el.querySelector(".rr-amount").getBoundingClientRect().right -
          el.querySelector(".rr-payout-type").getBoundingClientRect().left,
      );
      expect(
        gap,
        `${width}px: 券種の左端から金額の右端まで`,
      ).toBeLessThanOrEqual(640);
    }
  });

  test("払戻の注記と水面傾向の間に16pxの余白（BOA-707）", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "layout-desktop",
      viewportSkipReason("1440pxで確認"),
    );
    // 1100px は縦に積む（上下の余白）。1440px は払戻金の右に置く2段（BOA-881、左右の余白）
    for (const width of [1100, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${RACE}?tab=result`, { waitUntil: "domcontentloaded" });
      const card = page.locator(".race-result .vds-card");
      await expect(card).toBeVisible({ timeout: 30000 });
      const gap = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const side = el.closest(".race-split__side");
        if (side && getComputedStyle(side).display !== "contents") {
          const main = side.previousElementSibling.getBoundingClientRect();
          return box.left - main.right;
        }
        // 囲み（display: contents）を飛ばして、見た目の直前の要素を探す
        let prev = el.previousElementSibling;
        if (!prev && side) prev = side.previousElementSibling?.lastElementChild;
        if (!prev) throw new Error("水面傾向カードの直前に払戻表・注記が無い");
        return box.top - prev.getBoundingClientRect().bottom;
      });
      expect(gap, `${width}px`).toBeGreaterThanOrEqual(16);
    }
  });

  // 今節タブの得点率早見。箱の幅いっぱいに広がり、余りが全部選手名の列に入って、
  // 1440px で選手名の列が 853px、1024px でも 672px あった（BOA-736）。指定は 769px から効く
  // 今節タブの比較表（6艇の今節）。1440px で表が 1174px に広がり、選手名と得点率・節内順位・
  // 前検の間が約800px 離れた（BOA-755）。得点率早見（BOA-736）と同じ 769px〜・640px。
  // 最終日（予選の着順が8走並ぶ）でもセルの中身がはみ出さないことを見る
  test("今節の比較表: 選手名と得点率・順位・前検の列が近く、中身がはみ出さない", async ({
    page,
  }, testInfo) => {
    const widths =
      testInfo.project.name === "layout-desktop"
        ? [900, 1100, 1440]
        : testInfo.project.name === "layout-wide"
          ? [1920]
          : [];
    test.skip(widths.length === 0, viewportSkipReason("769px 以上だけの指定"));
    for (const race of ["2026-09-23-09-12", "2026-09-28-09-11"]) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/race/${race}?tab=meet`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6, {
          timeout: 30000,
        });
        const m = await page.evaluate(() => {
          const t = document.querySelector(".rmt-compare");
          return {
            table: t.getBoundingClientRect().width,
            overflow: [...t.querySelectorAll("th, td")].filter(
              (el) => el.scrollWidth > el.clientWidth + 1,
            ).length,
          };
        });
        expect(m.table, `${race} ${width}px: 表の幅`).toBeLessThanOrEqual(640);
        expect(m.overflow, `${race} ${width}px: はみ出したセル`).toBe(0);
      }
    }
  });

  test("今節の得点率早見: 選手名と得点率・着順の列が近い", async ({
    page,
  }, testInfo) => {
    const widths =
      testInfo.project.name === "layout-desktop"
        ? [900, 1100, 1440]
        : testInfo.project.name === "layout-wide"
          ? [1920]
          : [];
    test.skip(widths.length === 0, viewportSkipReason("769px 以上だけの指定"));
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/race/2026-09-23-09-12?tab=meet", {
        waitUntil: "domcontentloaded",
      });
      const head = page.locator(".rmt-forecast-table thead th").first();
      await expect(head).toBeVisible({ timeout: 30000 });
      const m = await page.evaluate(() => ({
        name: document
          .querySelector(".rmt-forecast-table thead th")
          .getBoundingClientRect().width,
        table: document
          .querySelector(".rmt-forecast-table")
          .getBoundingClientRect().width,
      }));
      expect(m.table, `${width}px: 表の幅`).toBeLessThanOrEqual(640);
      expect(m.name, `${width}px: 選手名の列の幅`).toBeLessThanOrEqual(400);
    }
  });
});

// 枠別情報タブ（BOA-757）。折れるなら全部の列・行で同じ位置で折る
test.describe("レイアウト: 枠別情報の ST考察と「1コースが逃げたとき」の折れ方がそろう", () => {
  test("ST考察の「平均◯◯」と「2連単 ◯%」の高さが行の中でそろう", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "layout-mobile",
      viewportSkipReason("スマホ幅（320・375px）だけの指定"),
    );
    for (const [path, width] of [
      ["/race/2026-09-28-09-11", 320],
      ["/en/race/2026-09-23-09-12", 320],
      ["/ko/race/2026-09-23-09-12", 320],
      ["/race/2026-09-28-09-11", 375],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${path}?tab=waku`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".rsc-baseline").first()).toBeVisible({
        timeout: 30000,
      });
      await expect(page.locator(".nsc-exacta").first()).toBeVisible({
        timeout: 30000,
      });
      const m = await page.evaluate(() => ({
        // 行ごとの「平均◯◯」の高さの種類の数（1ならそろっている）
        baseline: [...document.querySelectorAll(".rsc-grid tbody tr")]
          .map(
            (tr) =>
              new Set(
                [...tr.querySelectorAll(".rsc-baseline")].map((e) =>
                  Math.round(e.getBoundingClientRect().height),
                ),
              ).size,
          )
          .filter((n) => n > 0),
        exacta: new Set(
          [...document.querySelectorAll(".nsc-exacta")].map((e) =>
            Math.round(e.getBoundingClientRect().height),
          ),
        ).size,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      }));
      for (const n of m.baseline) {
        expect(n, `${path} ${width}px: 「平均」の高さの種類`).toBe(1);
      }
      expect(m.exacta, `${path} ${width}px: 「2連単」の高さの種類`).toBe(1);
      expect(m.overflow, `${path} ${width}px: 横スクロール`).toBe(0);
    }
  });
});

/**
 * レース詳細の 1R〜12R の帯（BOA-1189 GS01-c）。レース数は会場・日で変わりうるので、
 * 件数を差し替えて、スマホの2段目の残りが横いっぱいに伸びないこと・768px 以上で1行に並ぶことを見る
 * （component-reuse.md「件数がデータで変わるグリッド」）。8件は会場16の 1〜7R と 12R
 */
/**
 * レース詳細の出走6艇（BOA-1189 GS01-c、A案）。スマホの2行で、選手名のリンクの押せる高さが
 * 44px 以上あり、上下・左右の選手のリンクと押せる範囲が重ならないこと（ui-layout.md。
 * 32px で上下の行の間が4pxだった。ファン評価 A案の周 P2）
 */
test("レイアウト: レース詳細の出走6艇の選手名は 44px 以上で重ならない（BOA-1189）", async ({
  page,
}) => {
  test.skip(
    page.viewportSize().width >= 768,
    viewportSkipReason("スマホ幅（2行になる幅）で確認"),
  );
  await gotoAndSettle(page, "/race/2026-09-29-16-12");
  const links = page.locator(
    '[data-testid="race-entrants"] a[href^="/racer/"]',
  );
  await expect(links).toHaveCount(6, { timeout: 30000 });
  const rects = await links.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }),
  );
  for (const r of rects) {
    expect(
      r.bottom - r.top,
      `高さ ${JSON.stringify(r)}`,
    ).toBeGreaterThanOrEqual(44);
  }
  // 2行に分かれている（検査の空振り防止）
  expect(new Set(rects.map((r) => Math.round(r.top))).size).toBeGreaterThan(1);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlap =
        a.left < b.right - 0.5 &&
        b.left < a.right - 0.5 &&
        a.top < b.bottom - 0.5 &&
        b.top < a.bottom - 0.5;
      expect(overlap, `重なり ${JSON.stringify([a, b])}`).toBe(false);
    }
  }
});

test.describe("レイアウト: レース詳細の 1R〜12R の帯は件数によらずそろう（BOA-1189）", () => {
  for (const keep of [8, 12]) {
    test(`帯が${keep}件のとき、項目の幅がそろう`, async ({ page }) => {
      await page.route("**/api/predictions/2026-09-29**", async (route) => {
        const response = await fetchRecorded(route);
        const body = await response.json();
        if (keep < 12) {
          body.races = (body.races ?? []).filter(
            (r) =>
              r.venueCode !== 16 ||
              r.raceNumber <= keep - 1 ||
              r.raceNumber === 12,
          );
        }
        await route.fulfill(response.fulfillOptions({ json: body }));
      });
      await gotoAndSettle(page, "/race/2026-09-29-16-12");
      const items = page.locator(".race-number-strip__list > li");
      await expect(items).toHaveCount(keep, { timeout: 30000 });
      const boxes = await items.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), top: Math.round(r.top) };
        }),
      );
      const widths = boxes.map((b) => b.w);
      expect(
        Math.max(...widths) - Math.min(...widths),
        `帯の項目の幅がそろっていません: ${JSON.stringify(widths)}`,
      ).toBeLessThanOrEqual(1);
      if (page.viewportSize().width >= 768) {
        expect(
          new Set(boxes.map((b) => b.top)).size,
          `768px 以上で帯が1行に並んでいません: ${JSON.stringify(boxes)}`,
        ).toBe(1);
      }
    });
  }
});
