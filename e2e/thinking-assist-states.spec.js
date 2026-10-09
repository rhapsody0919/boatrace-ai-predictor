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

/**
 * exhibition_data の録画の応答を加工する（欠場など）。対象は展示の基本（getRaceExhibitionBasics、select に
 * start_flag を含む。整備の問い合わせの prev_start_timing と取り違えないよう start_timing では見ない）だけ。PR4 で足した整備の問い合わせ（体重・チルト・展示の進入）は録画に無く本番へ素通しなので、
 * ここで止めるとテストの終わった後に応答が返って落ちる（CI の F03）。そちらは録画の再生へ回す
 */
async function routeExhibition(page, edit, gate = null) {
  await page.route("**/rest/v1/exhibition_data*", async (route) => {
    if (!route.request().url().includes("start_flag")) return route.fallback();
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

/**
 * PR4（レンズの要約・図の印・深掘り）。値は承認モック v7 と v16 の固定データに一致すること:
 *   軸の要約は準優勝戦に絞った 65/119（D-37）、展開の手がかりは2コース凹み 13%（65/501）、
 *   深掘りの今節の平均着順点は v16 と同じ 8.57＝60点÷7走（今日の走は入れない。D-29）
 */
test.describe("思考アシスト: レンズの要約と深掘り（PR4）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("軸: 1号艇の1着は準優勝戦に絞った 54.6%（65/119レース）", async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByText("65/119レース")).toBeVisible();
    await expect(page.getByText("54.6%").first()).toBeVisible();
  });

  test("展開: 手がかりの印が2号艇、攻め手が3号艇に付き、点の値を押すと6艇比較になる", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    await expect(page.getByText("本番で2コース凹みになるのは")).toBeVisible();
    await expect(
      page.getByText("★平均STの手がかり（2コース凹み）13%"),
    ).toBeVisible();
    await expect(
      // PR5 で印は押せるボタン（セオリーカード）にした。名前は「{印}（{n}号艇）の過去レースの傾向」
      page.getByRole("button", {
        name: "2コース凹みなら攻め手（3号艇）の過去レースの傾向",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^展示ST .*、6艇で比べる$/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: /図を戻す/ })).toBeVisible();
  });

  test("深掘り: 今節の平均は 8.57＝60点÷7走、今日の走は点に入れない", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const toggle = page.getByRole("button", { name: "1走ずつの表" });
    await expect(toggle).toBeVisible({ timeout: 30000 });
    await toggle.click();
    await expect(page.getByRole("table", { name: /今節の各走/ })).toBeVisible();
    await expect(page.getByText("平均 8.57＝60点÷7走")).toBeVisible();
    await expect(
      page.getByRole("table", { name: /今節より前の5走/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "1号艇の詳しい情報" }),
    ).toHaveCount(0);
  });
});

/** PR4 の /code-review 指摘の再現テスト */
test.describe("思考アシスト: PR4 の /code-review 指摘", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("指摘1: 選手の登録番号が無い艇の深掘りは「読み込み中」に残らない", async ({
    page,
  }) => {
    await page.route("**/api/predictions/**", async (route) => {
      const res = await fetchRecorded(route);
      const body = await res.json();
      for (const r of body.races ?? [])
        if (r.raceId === RACE_ID)
          for (const e of r.entries ?? []) if (e.number === 1) e.racerId = null;
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
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const region = page.getByRole("region", { name: "1号艇の詳しい情報" });
    await expect(region).toBeVisible();
    await expect(
      region.getByText("表示できるデータがありません").first(),
    ).toBeVisible();
    await expect(region.getByText("読み込み中…")).toHaveCount(0);
  });

  test("指摘2: 欠場があるレースでも、機力レンズのチルトの印は出す（v16 の部分だけ出さない）", async ({
    page,
  }) => {
    await routeExhibition(page, (rows) =>
      rows.map((r) => (r.boat_number === 4 ? { ...r, is_absent: true } : r)),
    );
    await open(page);
    await lensTab(page, "機力").click();
    await expect(
      page
        .getByRole("button", {
          name: /^チルト-0\.5（\d号艇）の過去レースの傾向$/,
        })
        .first(),
    ).toBeVisible();
  });
});

/** PR4 の mock-diff-checker の差分（承認モック v7 にそろえた）の再現テスト */
test.describe("思考アシスト: PR4 の承認モックとの差分", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("今節の各走は新しい順、見出しは1つ（今節の各走（徳山））", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const toggle = page.getByRole("button", { name: "1走ずつの表" });
    await expect(toggle).toBeVisible({ timeout: 30000 });
    await toggle.click();
    const table = page.getByRole("table", { name: "今節の各走（徳山）" });
    await expect(table).toBeVisible();
    const days = await table.locator("tbody tr td:first-child").allInnerTexts();
    const dated = days.filter((d) => /^\d+\/\d+$/.test(d));
    expect(dated[0]).toBe("10/5");
    expect(dated[dated.length - 1]).toBe("10/2");
  });

  test("類似レースの決まり手は割合を1回だけ書く（名前の横に小数の割合を出さない）", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    await expect(page.getByText("逃げ 32件", { exact: true })).toBeVisible();
    await expect(page.getByText("50.8%")).toHaveCount(0);
  });
});

/** PR4 のファン評価 1周目の指摘（P1・P2）の再現テスト */
test.describe("思考アシスト: PR4 のファン評価 1周目", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  const openDeep = async (page, boat) => {
    await page
      .getByRole("button", { name: new RegExp(`^${boat}号艇\\s`) })
      .click();
    return page.getByRole("region", { name: `${boat}号艇の詳しい情報` });
  };

  test("指摘1: 展開の進入の割合に、集めた範囲（準優勝戦の日は予選も含む）と件数を書く", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    await expect(
      page.getByText(/^全国・級の並びが同じ（予選も含む） 2,463件$/),
    ).toBeVisible();
  });

  test("指摘2: 勝ち決まり手に期間（直近90日）を書く", async ({ page }) => {
    await open(page);
    const region = await openDeep(page, 1);
    await expect(region.getByText("直近90日", { exact: true })).toBeVisible({
      timeout: 30000,
    });
  });

  test("指摘3: 会場に絞った艇（2号艇）の説明文は「徳山・級の並びが同じ」", async ({
    page,
  }) => {
    await open(page);
    const region = await openDeep(page, 2);
    // 説明文は「全部の材料」の中（2026-10-09 ユーザー決定 A）
    await region.getByRole("button", { name: /^全部の材料（2号艇）/ }).click();
    await expect(
      region.getByText(/^徳山・級の並びが同じ: 2号艇は A2/),
    ).toBeVisible();
  });

  test("指摘4: v16 の展示後の段が無いときは、展示タイムの札を「—」で出さない", async ({
    page,
  }) => {
    await open(page);
    const region = await openDeep(page, 1);
    await expect(
      // 項目名の横に用語の「?」（PR5）が付くので、項目名（dt）を役割で探す
      region.getByRole("term").filter({ hasText: "全国勝率" }).first(),
    ).toBeVisible();
    await expect(
      region.locator(".ta-chip").getByText("展示タイム"),
    ).toHaveCount(0);
  });

  test("指摘5: v16 の保存が無いレースは、今節の平均を走から出し、平均ST を「記録なし」と書かない", async ({
    page,
  }) => {
    await page.route("**/api/analogy/facts/**", (route) =>
      route.fulfill({
        json: { status: "not_saved", today: null, facts: null },
      }),
    );
    await open(page);
    const region = await openDeep(page, 1);
    await expect(region.getByText("8.57", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(region.getByText("記録なし")).toHaveCount(0);
  });

  test("指摘6: 押せない「過去の1着」はボタンの見た目（指の形）にしない", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "買い目").click();
    const past = page.getByText(/^過去の1着/).first();
    await expect(past).toBeVisible();
    expect(await past.evaluate((el) => getComputedStyle(el).cursor)).not.toBe(
      "pointer",
    );
  });

  test("指摘7: 展示ST の F（5号艇 F.01）は .00 より左の端に置く", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    const left = await page.evaluate(
      () =>
        document.querySelectorAll(".ta-lane")[4].querySelector(".ta-track-dot")
          ?.style.left,
    );
    expect(left).toBe("0%");
  });
});

/** PR4 の 271 の指摘の型の点検と UI/UX デザイナーのレビューの再現テスト */
test.describe("思考アシスト: PR4 のデザイナーのレビューと 271 の指摘の型", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("P1-1: 375px で艇の丸を押すと、深掘りの上端が画面の中に入る", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const region = page.getByRole("region", { name: "1号艇の詳しい情報" });
    await expect
      .poll(async () => (await region.boundingBox())?.y ?? 9999)
      .toBeLessThan(700);
  });

  test("P1-2・単位: 手がかりの割合に範囲と件数、コースの1着に「走」", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    await expect(
      page.getByText(/^全国・級の並びが同じ（予選も含む） 2,457件$/),
    ).toBeVisible();
    await lensTab(page, "軸").click();
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    await expect(page.getByText("1着 17/38走")).toBeVisible({ timeout: 30000 });
  });

  test("P1-3: 上の枠と数字が違う理由（返還を含むか）を畳まずに出す", async ({
    page,
  }) => {
    await open(page);
    await expect(
      page.getByText(/ここは返還のあったレースも含める（119件・54\.6%）/),
    ).toBeVisible();
  });

  test("P2-8: 機力の要約の最初に結論の1行", async ({ page }) => {
    await open(page);
    await lensTab(page, "機力").click();
    await expect(
      page.getByText(
        "展示タイムは4号艇が一番速い（6.83）・モーター2連率は4号艇が一番高い（38.5%）",
      ),
    ).toBeVisible();
  });

  test("P2-5: 深掘りの値・札・1走ずつの表のボタンは 44px 以上押せる", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const toggle = page.getByRole("button", { name: "1走ずつの表" });
    await expect(toggle).toBeVisible({ timeout: 30000 });
    const sizes = await page.evaluate(() =>
      [".ta-kv-btn", ".ta-linkish", ".ta-feat-item .ta-tag"].map((sel) => {
        const el = document.querySelector(sel);
        const a = getComputedStyle(el, "::after");
        return [sel, parseFloat(a.width), parseFloat(a.height)];
      }),
    );
    for (const [sel, w, h] of sizes) {
      expect(w, sel).toBeGreaterThanOrEqual(44);
      expect(h, sel).toBeGreaterThanOrEqual(44);
    }
  });
});

/** 2026-10-09 ユーザー決定 A（深掘りの並び）・B（同じ数字を1回だけ）の再現テスト */
test.describe("思考アシスト: ユーザー決定 A・B（2026-10-09）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("A: 深掘りの先頭に▲の付いた材料が最大3件、値の一覧はその下、残りは「全部の材料」で開く", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const region = page.getByRole("region", { name: "1号艇の詳しい情報" });
    const head = region.getByRole("heading", { name: "差がつく材料（1号艇）" });
    await expect(head).toBeVisible();
    const top = region.locator(".ta-deep-facts").first().locator(".ta-chip");
    const n = await top.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
    await expect(top.filter({ hasText: "▲" })).toHaveCount(n);
    // 先頭の材料は値の一覧（dl）より前（開くと下へ送るので座標ではなく DOM の順で比べる）
    const before = await region.evaluate((el) => {
      const h = el.querySelector("h4");
      const dl = el.querySelector("dl");
      return Boolean(
        h.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(before).toBe(true);
    const all = region.getByRole("button", { name: /^全部の材料（1号艇）/ });
    await expect(all).toHaveAttribute("aria-expanded", "false");
    await all.click();
    await expect(all).toHaveAttribute("aria-expanded", "true");
    await expect(region.locator(".ta-chip").nth(n)).toBeVisible();
  });

  test("B: 軸の大きい数字（54.6%）は1回だけ、件数の札を横に、比べる相手は会場の全レースの棒", async ({
    page,
  }) => {
    await open(page);
    const sum = page.locator(".ta-sum");
    await expect(sum.getByText("54.6%", { exact: true })).toHaveCount(1);
    await expect(
      sum
        .getByText("全国・級の並びが同じ準優勝戦 119件", { exact: true })
        .first(),
    ).toBeVisible();
    await expect(sum.getByText(/^徳山の全レース 17,552件/)).toBeVisible();
  });

  test("B: 展開の「当てはまるとき」の棒は出さず、比べる相手（当てはまらないとき）の棒だけ", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    await expect(page.getByText(/当てはまるとき、本番が/)).toHaveCount(0);
    await expect(page.getByText(/^当てはまらないとき/)).toBeVisible();
  });
});

test.describe("思考アシスト: PR5 のシート・ガイド（デザイナーのレビュー）", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page, { preview: true });
  });

  /** その要素の真ん中を押したときに、その要素（か中の要素）に当たるか */
  // 固定のレンズ・フッターに隠れないよう画面の中央へ送ってから測る。外れたときは何に当たったかを返す
  const hitsItself = (loc) =>
    loc.evaluate((el) => {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return el === top || el.contains(top)
        ? true
        : `${el.getAttribute("aria-label")} → ${top?.className} ${top?.getAttribute?.("aria-label") ?? top?.textContent?.slice(0, 30)}`;
    });

  test("P1-1: ガイドの上の吹き出しはサイトのヘッダーの下に出る", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "ガイド", exact: true }).click();
    await page.getByRole("button", { name: "次へ" }).click();
    const q = page.getByText("1号艇は逃げられそう？");
    await expect(q).toBeVisible();
    expect(await hitsItself(q)).toBe(true);
  });

  test("P1-2: 展開の図の印の押せる範囲が、隣の艇の ST の数字を覆わない", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    await expect(
      page.getByText("★平均STの手がかり（2コース凹み）13%"),
    ).toBeVisible();
    const values = page.getByRole("button", {
      name: /^展示ST .*、6艇で比べる$/,
    });
    const n = await values.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++)
      expect(await hitsItself(values.nth(i))).toBe(true);
  });

  test("P2-3: セオリーカードを開く札は札の枠を保つ", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const chip = page
      .getByRole("button", { name: "1号艇のモーター2連率の過去レースの傾向" })
      .first();
    await expect(chip).toBeVisible();
    const border = await chip.evaluate(
      (el) => getComputedStyle(el).borderTopWidth,
    );
    expect(border).not.toBe("0px");
  });

  test("P2-4: 機力の表の下の札は、押すとその札自身に当たる（下の札の範囲に取られない）", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "機力").click();
    const x1 = page.getByRole("button", {
      name: "1号艇は展示が速く出やすいの過去レースの傾向",
    });
    await expect(x1).toBeVisible();
    await x1.scrollIntoViewIfNeeded();
    expect(await hitsItself(x1)).toBe(true);
  });

  test("ファン評価 指摘1: 会場の型は cluster ではなく、1号艇の1着を全国の全レースと比べて書く", async ({
    page,
  }) => {
    await page.route("**/rest/v1/venue_technique_period_stats*", (route) =>
      route.fulfill({ json: [] }),
    );
    await open(page);
    await page.getByRole("button", { name: "徳山の特徴" }).click();
    const sheet = page.getByRole("dialog", { name: "徳山の特徴" });
    await expect(
      sheet.getByText(/全国の全レースより1着が(高め|低め)|差ははっきりしない/),
    ).toBeVisible();
    await expect(sheet.getByText("イン（1号艇）が強い会場")).toHaveCount(0);
  });

  test("ファン評価 指摘4: 375px で機力の展示の表がはみ出さない", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "機力").click();
    const scroll = page.locator(".ta-table-ex").locator("xpath=..");
    await expect(scroll).toBeVisible();
    const [sw, cw] = await scroll.evaluate((el) => [
      el.scrollWidth,
      el.clientWidth,
    ]);
    expect(sw).toBeLessThanOrEqual(cw);
  });
});
