import { test, expect, fetchRecorded } from "./fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
} from "./thinking-assist-fixture.js";

/**
 * 思考アシスト（BOA-430）の状態の出し分け。PR3 #1308 の Codex 独立レビュー（依頼27）で実在を確かめた指摘の再現テスト。
 *   F01/F02 一部の取得の失敗を「発売後に出る」「展示前」「段が無い」と取り違えない（FR-11、screens「取得の失敗」）
 *   F03 DB の展示で分かった欠場でも v16 の部分を出さず、外した組を知らせる（screens「欠場があった」・D-38）
 *   F04 タップ領域 44px（N-6）、F05 ヘッダーの件数にラウンド（D-37）、F06 会場の全レースの細い点線（FR-2）
 *   F07 中止のレースの買い目レンズ（D-38）、F08 レンズの固定位置が共通のヘッダーに隠れない（N-1）
 *   U05 最低額の点数はオッズのある組だけで数える
 * 例のレースは 2026-10-06 徳山10R（準優勝戦）。出走表・展示・オッズは録画（本番の実データ）、v16 は固定データ
 */

const RACE_ID = THINKING_ASSIST_RACE;
const URL_ = `/race/${RACE_ID}/assist`;

const lensTab = (page, name) =>
  page
    .getByRole("tablist", { name: "見方" })
    .getByRole("tab", { name, exact: true });
const candidate = (page, boat, pos) =>
  page.getByRole("button", { name: `${boat}号艇を${pos}着の候補に` });
const footer = (page) => page.getByRole("region", { name: "買い目" });
const roughBtn = (page) =>
  page.getByRole("button", { name: "堅い？荒れる？の材料" });

async function open(page) {
  await page.goto(URL_);
  await expect(page.getByRole("tablist", { name: "見方" })).toBeVisible({
    timeout: 20000,
  });
}

/** exhibition_data の録画の応答を加工する（欠場など） */
async function routeExhibition(page, edit, gate = null) {
  await page.route("**/rest/v1/exhibition_data*", async (route) => {
    const res = await fetchRecorded(route);
    const rows = await res.json();
    if (gate) await gate;
    await route.fulfill({ response: res, json: edit(rows) });
  });
}

test.describe("思考アシスト: 状態の出し分け（Codex 依頼27）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("F01: オッズの取得に失敗したら「発売後に出る」と断定せず、失敗を出す", async ({
    page,
  }) => {
    await page.route("**/rest/v1/race_odds*", (route) =>
      route.fulfill({ status: 500, json: { message: "boom" } }),
    );
    await open(page);
    await lensTab(page, "買い目").click();
    await expect(
      page.getByText("オッズは表示できませんでした", { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText("オッズは発売後に出る")).toHaveCount(0);
  });

  test("F02: 展示の取得に失敗したら、展示前として黙らず失敗を出す", async ({
    page,
  }) => {
    await page.route("**/rest/v1/exhibition_data*", (route) =>
      route.fulfill({ status: 500, json: { message: "boom" } }),
    );
    await open(page);
    await expect(
      page.getByText("展示は表示できませんでした", { exact: false }),
    ).toBeVisible();
  });

  test("F02: 展示後の類似レースの取得に失敗したら、出走表の時点の値に戻さず失敗を出す", async ({
    page,
  }) => {
    await page.route("**/api/analogy/similar/**", (route) => {
      const stage = new URL(route.request().url()).searchParams.get("stage");
      if (stage === "exhibition")
        return route.fulfill({ status: 500, json: { error: "boom" } });
      return route.fallback();
    });
    await open(page);
    await roughBtn(page).click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByText("類似レースは表示できませんでした", { exact: false }),
    ).toBeVisible();
    await expect(sheet.getByText(/類似レース\d+件/)).toHaveCount(0);
  });

  test("F03: DB の展示で欠場が分かったら、v16 の状態が欠場でなくても過去レースの傾向を出さない", async ({
    page,
  }) => {
    await routeExhibition(page, (rows) =>
      rows.map((r) => (r.boat_number === 4 ? { ...r, is_absent: true } : r)),
    );
    await open(page);
    await expect(
      page.getByText("欠場があったため、過去レースの傾向は出していません"),
    ).toBeVisible();
    await expect(roughBtn(page)).toHaveCount(0);
    await lensTab(page, "買い目").click();
    await expect(candidate(page, 4, 1)).toHaveCount(0);
  });

  test("F03: 欠場が分かる前に組んだ組は外し、外したことを1行で知らせる", async ({
    page,
  }) => {
    let release;
    const gate = new Promise((r) => (release = r));
    await routeExhibition(
      page,
      (rows) =>
        rows.map((r) => (r.boat_number === 4 ? { ...r, is_absent: true } : r)),
      gate,
    );
    await open(page);
    await lensTab(page, "買い目").click();
    await candidate(page, 1, 1).click();
    await candidate(page, 2, 2).click();
    await candidate(page, 4, 2).click();
    await candidate(page, 3, 3).click();
    await expect(footer(page)).toContainText("（2点）");
    release();
    await expect(footer(page)).toContainText("4号艇の欠場で1点を外しました");
    await expect(footer(page)).toContainText("3連単 1-2-3（1点）");
  });

  test("F05: 準優勝戦に絞った件数は、ヘッダーの枠にもラウンドを添える", async ({
    page,
  }) => {
    await open(page);
    await expect(roughBtn(page)).toContainText("準優勝戦 112件");
  });

  test("F06: 堅い？荒れる？の材料に会場の全レースを参考の細い点線で並べる", async ({
    page,
  }) => {
    await open(page);
    await roughBtn(page).click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByText("細い点線＝徳山の全レース（参考）", { exact: false }),
    ).toBeVisible();
    await expect(
      sheet.getByText(/徳山の全レース: 1号艇の1着 \d+%・万舟 \d+%/),
    ).toBeVisible();
  });

  test("F07: 中止のレースは買い目レンズに中止だけを出す", async ({ page }) => {
    await page.route("**/api/predictions/**", async (route) => {
      const res = await fetchRecorded(route);
      const body = await res.json();
      for (const r of body.races ?? [])
        if (r.raceId === RACE_ID) {
          r.cancellationStatus = "confirmed";
          r.result = null;
        }
      await route.fulfill({ response: res, json: body });
    });
    // 出走表は軽量版→完全版の2回取る。完全版が届く前にテストを終えると、取得中の route が閉じたページで落ちる
    const full = page.waitForResponse(
      (r) =>
        r.url().includes("/api/predictions/") && !r.url().includes("light"),
      { timeout: 60000 },
    );
    await open(page);
    await full;
    await lensTab(page, "買い目").click();
    await expect(page.getByText("このレースは中止です")).toBeVisible();
    await expect(candidate(page, 1, 1)).toHaveCount(0);
    await expect(footer(page)).toHaveCount(0);
  });

  test("U05: オッズの無い組があるとき、最低額の点数はオッズのある組だけで数える", async ({
    page,
  }) => {
    await page.route("**/rest/v1/race_odds*", async (route) => {
      const res = await fetchRecorded(route);
      const rows = await res.json();
      for (const row of rows)
        if (row.trifecta_all) delete row.trifecta_all["1-2-4"];
      await route.fulfill({ response: res, json: rows });
    });
    await open(page);
    await lensTab(page, "買い目").click();
    await candidate(page, 1, 1).click();
    await candidate(page, 2, 2).click();
    await candidate(page, 3, 3).click();
    await candidate(page, 4, 3).click();
    await page
      .getByRole("button", { name: "マークシートを開く", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "マークシート" });
    await sheet.getByRole("spinbutton", { name: "予算" }).fill("50");
    await expect(sheet.getByText("1点には最低100円")).toBeVisible();
  });
});

test.describe("思考アシスト: 承認モックとの差（mock-diff-checker）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("ヘッダーに一般のグレードの札を出す（承認モック v7）", async ({
    page,
  }) => {
    await open(page);
    await expect(
      page.locator("header").getByText("一般", { exact: true }),
    ).toBeVisible();
  });

  test("図の右端の印は何着の候補をハイフンでつなぐ（「2-3着」）", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "買い目").click();
    await candidate(page, 2, 2).click();
    await candidate(page, 2, 3).click();
    await lensTab(page, "軸").click();
    await expect(
      page.getByRole("button", { name: /^2号艇: 2・3着の候補/ }),
    ).toHaveText("2-3着");
  });
});

test.describe("思考アシスト: ファン評価 1周目", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("指摘1: 平均ST は期間（直近30走）を名前に書く", async ({ page }) => {
    await open(page);
    await expect(
      page.getByRole("button", {
        name: "平均ST（直近30走） 0.132、6艇で比べる",
      }),
    ).toBeVisible();
  });

  test("指摘13: 終わったレースのオッズは「締切まで動く」と書かない", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "買い目").click();
    await candidate(page, 1, 1).click();
    await candidate(page, 2, 2).click();
    await candidate(page, 3, 3).click();
    await page
      .getByRole("button", { name: "マークシートを開く", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "マークシート" });
    await expect(sheet.getByText(/確定オッズではない/)).toBeVisible();
    await expect(sheet.getByText(/締切まで動く/)).toHaveCount(0);
  });
});

test.describe("思考アシスト: v16 の保存が無いレース（ファン評価 1周目 指摘3）", () => {
  test("平均ST を「記録なし」と書かない（記録が無いのではなく、データが無い）", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, {
      overrides: { facts: () => ({ status: "not_saved" }) },
    });
    await open(page);
    await expect(
      page.getByText(
        "このレースは、過去レースの傾向を表示できるデータがありません",
      ),
    ).toBeVisible();
    await expect(page.getByRole("figure").getByText("記録なし")).toHaveCount(0);
    await lensTab(page, "展開").click();
    await page.getByRole("button", { name: "展示前", exact: true }).click();
    await expect(page.getByRole("figure").getByText("記録なし")).toHaveCount(0);
  });
});

test.describe("思考アシスト: ファン評価 2周目", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("指摘8: 一般戦はラウンドとグレードの「一般」を2つ並べない", async ({
    page,
  }) => {
    // v16 のラウンドも一般戦に（v16 にラウンドがあればそれで決まるため。依頼25 F01）
    await routeThinkingAssistV16(page, {
      overrides: {
        facts: (body) => ({
          ...body,
          today: { ...body.today, round: "other" },
        }),
      },
    });
    await page.route("**/api/predictions/**", async (route) => {
      const res = await fetchRecorded(route);
      const body = await res.json();
      for (const r of body.races ?? [])
        if (r.raceId === RACE_ID) r.raceStage = "一般";
      await route.fulfill({ response: res, json: body });
    });
    const full = page.waitForResponse(
      (r) =>
        r.url().includes("/api/predictions/") && !r.url().includes("light"),
      { timeout: 60000 },
    );
    await open(page);
    await full;
    await expect(
      page.locator(".ta-header").getByText("一般", { exact: true }),
    ).toHaveCount(1);
  });

  test("P3: 形の正しくない raceId（13R）は読み込み中に残さず「表示できるデータがありません」", async ({
    page,
  }) => {
    await page.goto("/race/2026-10-06-18-13/assist");
    await expect(
      page.getByText("このレースは表示できるデータがありません"),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe("思考アシスト: ファン評価 3周目", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("指摘10: 展示前・展示後を切り替えても、切り替えのボタンの位置が動かない", async ({
    page,
  }) => {
    await open(page);
    const pos = () =>
      page
        .getByRole("group", { name: "時点" })
        .evaluate((el) => Math.round(el.getBoundingClientRect().right));
    const post = await pos();
    await page.getByRole("button", { name: "展示前", exact: true }).click();
    expect(await pos()).toBe(post);
  });

  test("指摘11: 表示できないレースからレース一覧へ戻れる", async ({ page }) => {
    await page.goto("/race/2026-10-06-18-13/assist");
    await expect(
      page.getByRole("main").getByRole("link", { name: "レース一覧へ戻る" }),
    ).toHaveAttribute("href", "/");
  });

  test("指摘12: 目盛りの外の値の数字は図の右端からはみ出さない", async ({
    page,
  }) => {
    await routeExhibition(page, (rows) =>
      rows.map((r) => (r.boat_number === 4 ? { ...r, start_timing: 0.32 } : r)),
    );
    await open(page);
    await lensTab(page, "展開").click();
    const over = await page.evaluate(() =>
      [...document.querySelectorAll(".ta-track")]
        .map((t) => {
          const v = t.querySelector(".ta-track-val");
          return v
            ? v.getBoundingClientRect().right - t.getBoundingClientRect().right
            : 0;
        })
        .filter((d) => d > 0.5),
    );
    expect(over).toEqual([]);
  });
});

test.describe("思考アシスト: ユーザー決定（2026-10-08）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("オッズがまだ無いときは「締切の約1時間前から出る」（発売後とは書かない）", async ({
    page,
  }) => {
    await page.route("**/rest/v1/race_odds*", (route) =>
      route.fulfill({ json: [] }),
    );
    await open(page);
    await lensTab(page, "買い目").click();
    await expect(
      page.getByText("オッズは締切の約1時間前から出る").first(),
    ).toBeVisible();
    await expect(page.getByText(/発売後/)).toHaveCount(0);
  });

  test("軸レンズの平均ST の札に期間を出す（「ST(30走)」）", async ({
    page,
  }) => {
    await open(page);
    await expect(
      page.getByRole("button", { name: /^平均ST（直近30走） 0\.132/ }),
    ).toContainText("ST(30走)");
  });

  test("「数える」を使わず「集めたレースは2通り」", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "堅い？荒れる？の材料" }).click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByRole("button", { name: "集めたレースは2通り" }),
    ).toBeVisible();
    await expect(page.getByText(/数え/)).toHaveCount(0);
  });

  test("級の並びの呼び名の近くに今日の値の例と注記（単位つき、枠は問わない）", async ({
    page,
  }) => {
    const note =
      "全国・級の並びが同じ: 1号艇は B1、ほかの5艇は A1 が2艇・A2 が2艇・B1 が1艇（どの枠にいたかは問わない）";
    await open(page);
    await expect(
      page
        .getByRole("region", { name: "このレースは堅い？荒れる？" })
        .getByText(note),
    ).toBeVisible();
    await page.getByRole("button", { name: "堅い？荒れる？の材料" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(note)).toBeVisible();
    await expect(page.getByText(/固定|入れ替わってもOK/)).toHaveCount(0);
  });

  test("集めたレースの表の「2〜6号艇の級」の行に、級の並びの絵を小さく置く", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "堅い？荒れる？の材料" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "集めたレースは2通り" }).click();
    const row = sheet.getByRole("row", { name: /2〜6号艇の級/ });
    await expect(row).toContainText(
      "2〜6号艇の級（A1 が2艇・A2 が2艇・B1 が1艇、どの枠かは問わない）",
    );
    await expect(
      row.getByRole("img", { name: /1号艇は枠も級（B1）も同じ/ }),
    ).toBeVisible();
  });
});

test.describe("思考アシスト: シートのフォーカス（Codex 依頼27 U03）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("U03: シートを開いている間は、Tab・Shift+Tab で背後の共通ヘッダーへ抜けない", async ({
    page,
  }) => {
    await open(page);
    await page
      .getByRole("button", { name: "マークシートを開く", exact: true })
      .click();
    const inSheet = () =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      );
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      expect(await inSheet(), `Tab ${i + 1}回目`).toBe(true);
    }
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inSheet(), `Shift+Tab ${i + 1}回目`).toBe(true);
    }
  });
});

test.describe("思考アシスト: 375px の押せる範囲と固定位置（Codex 依頼27 F04・F08）", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("F04: 小さく見えるボタンも、上下（候補の印は左右も）22px 離れた所で押せる", async ({
    page,
  }) => {
    await open(page);
    // 押せる範囲: 中心から dx・dy ずらした点の一番上の要素が、そのボタン（か中身）か
    const hit = (selector, dirs) =>
      page.evaluate(
        ({ selector, dirs }) => {
          const el = document.querySelector(selector);
          if (!el) return `${selector} が無い`;
          // 固定のレンズ・フッターの下に入ると、その上の点は押せない（フッターが上に来る）ので、画面の中央に送ってから測る
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const miss = dirs.filter(([dx, dy]) => {
            const t = document.elementFromPoint(cx + dx, cy + dy);
            return !(t && el.contains(t));
          });
          return miss.length ? `${selector} ${JSON.stringify(miss)}` : null;
        },
        { selector, dirs },
      );
    const V = [
      [0, -21],
      [0, 21],
    ];
    const HV = [...V, [-21, 0], [21, 0]];
    const misses = [
      await hit(".ta-seg button", V),
      await hit(".ta-lane:nth-of-type(3) .ta-num-btn", V),
      await hit(".ta-lane:nth-of-type(3) .ta-add", HV),
    ];
    await lensTab(page, "買い目").click();
    misses.push(await hit(".ta-lane:nth-of-type(3) .ta-pos3 button", V));
    expect(misses.filter(Boolean)).toEqual([]);
  });

  test("指摘7: 展開レンズの展示ST の数字は点に重ならない", async ({ page }) => {
    await open(page);
    await lensTab(page, "展開").click();
    const overlaps = await page.evaluate(() =>
      [...document.querySelectorAll(".ta-track")]
        .map((t) => {
          const v = t.querySelector(".ta-track-val");
          const d = t.querySelector(".ta-track-dot");
          if (!v || !d) return null;
          return (
            v.getBoundingClientRect().bottom - d.getBoundingClientRect().top
          );
        })
        .filter((x) => x != null && x > 0.5),
    );
    expect(overlaps).toEqual([]);
  });

  test("指摘8: 固定フッターの買い目は長くても点数まで見える", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "買い目").click();
    for (const b of [1, 2]) await candidate(page, b, 1).click();
    for (const b of [1, 2, 3, 4]) await candidate(page, b, 2).click();
    for (const b of [1, 2, 3, 4, 5, 6]) await candidate(page, b, 3).click();
    const b = footer(page).locator("b").first();
    await expect(b).toContainText("点）");
    const clipped = await b.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(clipped).toBe(false);
  });

  test("F08: 下へスクロールしても、レンズは共通のヘッダーの下に止まり隠れない", async ({
    page,
  }) => {
    await open(page);
    // 例のレースはページが短く、レンズが上端に届くまで縮められないので、下に余白を足して伸ばす
    await page.evaluate(() => {
      const pad = document.createElement("div");
      pad.style.height = "2000px";
      document.querySelector(".ta-page").append(pad);
    });
    await page.mouse.wheel(0, 1200);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(800);
    const gap = await page.evaluate(() => {
      const header = document.querySelector(".app-header");
      const lens = document.querySelector(".ta-lens");
      return (
        lens.getBoundingClientRect().top - header.getBoundingClientRect().bottom
      );
    });
    expect(gap).toBeGreaterThanOrEqual(-1);
  });
});
