import { test, expect, e2eNow } from "../fixtures.js";

/**
 * BOA-570 の再現テスト。
 *
 * `/admin/rules`（src/pages/admin/AdminRules.css）と `/admin/sns-hub`
 * （src/pages/admin/SnsHubAdmin.css）が、同じ詳細度の `.tab-btn`・`.tab-content`・
 * `.loading-state`・`.error-state` を別々に定義していた。CSSは1つのバンドルに結合され、
 * SnsHubAdmin.css が後に来るため、`/admin/rules` のタブが SNSハブの青（#0ea5e9）になり、
 * AdminRules.css の @media の上書き（768px以下・480px以下の余白と文字サイズ）も
 * SNSハブの基本指定に負けて効いていなかった（修正前の実測: 768pxでタブの padding が
 * 9.6px 20px、文字 14.4px）。両画面ともクラス名に画面固有の接頭辞を付けて分けた。
 * 両方のCSSが適用済みになる「/admin/sns-hub → SPA遷移で /admin/rules」の順で測る。
 *
 * 期待値は各CSSファイルの指定そのもの:
 *   AdminRules.css  … アクティブの背景 #7c3aed。padding は 768px以下 0.5rem 1rem、
 *                      480px以下 0.4rem 0.75rem、それ以外 0.6rem 1.25rem
 *   SnsHubAdmin.css … padding は 480px以下 0.5rem 0.75rem、それ以外 0.6rem 1.25rem
 */
function expectedAdminRulesTabPadding(width) {
  if (width <= 480) return "6.4px 12px";
  if (width <= 768) return "8px 16px";
  return "9.6px 20px";
}

function expectedSnsHubTabPadding(width) {
  return width <= 480 ? "8px 12px" : "9.6px 20px";
}

const fulfillAdminJson = (body) => (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

test.describe("レイアウト: 管理画面2つのタブの指定が混ざらない（BOA-570）", () => {
  test("/admin/sns-hub からSPA遷移した /admin/rules のタブが AdminRules.css の指定になる", async ({
    page,
  }) => {
    // dev サーバーには Edge Function が無いので管理APIはスタブにする
    // （e2e/admin-rules-performance.spec.js と同じ）。predictions も空で返し、
    // 録画に無いリクエストを本番へ素通しさせない（BOA-551）
    await page.route(/\/api\/admin\/sns-hub\//, fulfillAdminJson({ data: [] }));
    await page.route(
      /\/api\/admin\/rules\/performance/,
      fulfillAdminJson({
        startDate: "2026-01-16",
        data: {
          total: { samples: 0, hits: 0, payout: 0 },
          by_rule: [],
          by_week: [],
        },
      }),
    );
    await page.route(/\/rest\/v1\/predictions\?/, fulfillAdminJson([]));

    const tabStyle = (selector) =>
      page.locator(selector).evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          width: window.innerWidth,
          padding: cs.padding,
          backgroundColor: cs.backgroundColor,
        };
      });

    await page.goto("/admin/sns-hub");
    const snsTab = await tabStyle(".sns-hub-tab-btn.active");
    expect(snsTab.padding, JSON.stringify(snsTab)).toBe(
      expectedSnsHubTabPadding(snsTab.width),
    );
    // SNSハブ側は自分の配色のまま（AdminRules.css の紫が漏れていない）
    expect(snsTab.backgroundColor).not.toBe("rgb(124, 58, 237)");

    await page.evaluate(() => {
      window.history.pushState({}, "", "/admin/rules");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/admin\/rules$/);
    const rulesTab = await tabStyle(".admin-rules-tab-btn.active");
    expect(rulesTab.padding, JSON.stringify(rulesTab)).toBe(
      expectedAdminRulesTabPadding(rulesTab.width),
    );
    expect(rulesTab.backgroundColor, JSON.stringify(rulesTab)).toBe(
      "rgb(124, 58, 237)",
    );
  });

  /**
   * BOA-570 の最後の1件（.tab-navigation のleak）。
   *
   * AdminRules.css と SnsHubAdmin.css が同じ詳細度で `.tab-navigation` を
   * 定義しており（AdminRules.css は余白をタブ本体に、SnsHubAdmin.css は
   * `.tab-navigation-row` に置く設計）、CSSが1つのバンドルに結合され後に来る
   * 方が勝つため、AdminRules.css の margin-bottom: 1rem が /admin/sns-hub の
   * タブの下にも漏れていた（修正前の実測: /admin/sns-hub のタブ下の余白が
   * 本来の16pxから32pxに増える）。画面ごとに admin-rules- / sns-hub- の
   * 接頭辞を付けて分けた。
   *
   * 期待値は各CSSファイルの設計そのもの:
   *   AdminRules.css  … 余白はタブ本体(.admin-rules-tab-navigation)に1rem
   *   SnsHubAdmin.css … 余白は行(.tab-navigation-row)に1rem、タブ本体は0
   */
  test("/admin/sns-hub のタブ下の余白に AdminRules.css の margin-bottom が漏れない", async ({
    page,
  }) => {
    await page.route(/\/api\/admin\/sns-hub\//, fulfillAdminJson({ data: [] }));
    await page.route(
      /\/api\/admin\/rules\/performance/,
      fulfillAdminJson({
        startDate: "2026-01-16",
        data: {
          total: { samples: 0, hits: 0, payout: 0 },
          by_rule: [],
          by_week: [],
        },
      }),
    );
    await page.route(/\/rest\/v1\/predictions\?/, fulfillAdminJson([]));

    const marginBottom = (selector) =>
      page
        .locator(selector)
        .evaluate((el) => getComputedStyle(el).marginBottom);

    await page.goto("/admin/sns-hub");
    await expect(page.locator(".sns-hub-tab-navigation")).toBeVisible();
    expect(await marginBottom(".tab-navigation-row")).toBe("16px");
    expect(await marginBottom(".sns-hub-tab-navigation")).toBe("0px");

    await page.evaluate(() => {
      window.history.pushState({}, "", "/admin/rules");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/admin\/rules$/);
    await expect(page.locator(".admin-rules-tab-navigation")).toBeVisible();
    expect(await marginBottom(".admin-rules-tab-navigation")).toBe("16px");
  });
});

/**
 * SNSハブの管理画面は地（.sns-hub-admin-page・.sns-hub-tab-content）を明るい色で固定しているが、
 * 後から足したパネル（全月カレンダー・レース単位の確認）は意味トークン（--text-primary・--surface-card）を
 * 使っていた。ダークテーマでは意味トークンが白文字・紺の地に切り替わり、明るい地に白文字が載って
 * 読めなくなった（2026-10-13 オーナー報告）。ダークテーマで、文字色と実際の地の色のコントラストを測る。
 * 地は、その要素から親へたどって最初に不透明な背景色。基準は WCAG の本文 4.5:1
 */
test.describe("レイアウト: SNSハブの文字が地とかぶらない（ダークテーマ）", () => {
  const SELECTORS = [
    ".sns-month-calendar h2",
    ".sns-month-calendar > p",
    ".sns-month-calendar-filters label",
    ".sns-month-calendar-filters button",
    ".sns-month-calendar-weekday",
    ".sns-month-calendar-x",
    ".sns-month-calendar-youtube",
    ".sns-month-calendar-grid button",
    // 自動送信ページ（2026-10-18 にページを分け、レース単位の確認は撤去した）
    ".sns-hub-page-link",
    ".sns-queue-title",
    ".sns-queue-empty",
    ".sns-queue-time",
    ".sns-queue-name",
    ".sns-queue-state",
    ".sns-send-control-grid dt",
    ".sns-send-control-grid dd",
  ];
  for (const width of [375, 1440]) {
    test(`${width}px: 自動送信ページ（全月カレンダー・要対応・今日）の文字が 4.5:1 以上`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() =>
        localStorage.setItem("ryujin-radar-theme", "dark"),
      );
      // dev サーバーには Edge Function が無いので管理APIはスタブにする（上の BOA-570 と同じ）。
      // 状態の色をすべて測れるよう、今日の行を状態ごとに1件ずつ置く
      const now = e2eNow().toISOString();
      const rows = ["failed", "held", "queued", "posted", "cancelled"].map(
        (state) => ({
          id: state,
          title: `${state} の投稿`,
          channel: state === "posted" ? "youtube" : "x",
          state,
          scheduled_at: now,
          posted_at: now,
          expires_at: new Date(Date.parse(now) + 2 * 3600 * 1000).toISOString(),
        }),
      );
      await page.route(/\/api\/admin\/sns-hub\//, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            route.request().url().includes("/deadline-queue")
              ? {
                  data: rows,
                  control: {
                    paused: false,
                    channels: [
                      { channel: "x", mode: "auto", dry_run: false },
                      { channel: "youtube", mode: "auto", dry_run: true },
                    ],
                  },
                }
              : { data: [] },
          ),
        }),
      );
      await page.goto("/admin/sns-hub/auto");
      await page.getByText("全月カレンダー（JST）を開く").click();
      await expect(
        page.locator(".sns-month-calendar-weekday").first(),
      ).toBeVisible();
      await expect(page.locator(".sns-queue-state").first()).toBeVisible();
      const measured = await page.evaluate((selectors) => {
        const rgba = (s) => {
          // color-mix() の計算値は color(srgb 0〜1 …) で返る（要対応・今日の状態の地）
          const srgb = s.match(/color\(srgb ([^)]+)\)/);
          if (srgb) {
            const [r, g, b, a = 1] = srgb[1]
              .split(/[ /]+/)
              .filter(Boolean)
              .map(Number);
            return { r: r * 255, g: g * 255, b: b * 255, a };
          }
          const m = s.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const [r, g, b, a = 1] = m[1]
            .split(/[ ,/]+/)
            .filter(Boolean)
            .map(Number);
          return { r, g, b, a };
        };
        const lum = ({ r, g, b }) => {
          const ch = (v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
        };
        const bgOf = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const c = rgba(getComputedStyle(n).backgroundColor);
            if (c && c.a > 0.5) return c;
          }
          return { r: 255, g: 255, b: 255, a: 1 };
        };
        const out = [];
        for (const sel of selectors)
          for (const el of document.querySelectorAll(sel)) {
            if (!el.textContent.trim() || !el.getClientRects().length) continue;
            const fg = rgba(getComputedStyle(el).color);
            const bg = bgOf(el);
            const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
            out.push({
              sel,
              text: el.textContent.trim().slice(0, 20),
              ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
            });
          }
        return out;
      }, SELECTORS);
      expect(measured.length, "測った要素がある").toBeGreaterThan(10);
      const low = measured.filter((m) => m.ratio < 4.5);
      expect(low, JSON.stringify(low.slice(0, 8))).toEqual([]);
    });
  }
});
