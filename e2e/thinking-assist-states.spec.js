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
      page.getByText(
        /^全国・級の並びが同じ（予選も含む） 2,463件・進入が分かったレース$/,
      ),
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
      page.getByText(
        /^全国・級の並びが同じ（予選も含む） 2,457件・平均STがそろったレース$/,
      ),
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
        // BOA-808 2 でオリジナル展示の一番も結論に入れた
        "展示タイム・モーター2連率は4号艇（6.83秒・38.5%）、一周・まわり足は1号艇（37.31秒・11.49秒）が一番",
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
        .getByText("全国・級の並びが同じ準優勝戦（1号艇がB1） 119件", {
          exact: true,
        })
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

test.describe("思考アシスト: 上部の切り替え（PR6、承認モック pr6-switch）", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page, { preview: true });
  });
  const group = (page) => page.getByRole("group", { name: "表示" });

  test("レース詳細ではサイトのヘッダーの直下・パンくずの上に出し、説明の1行と「新」の札を出す", async ({
    page,
  }) => {
    await page.goto(`/race/${RACE_ID}`);
    await expect(group(page)).toBeVisible();
    const [swTop, crumbTop] = await Promise.all([
      group(page).evaluate((el) => el.getBoundingClientRect().top),
      page
        .getByRole("navigation", { name: /パンくず|breadcrumb/i })
        .first()
        .evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(swTop).toBeLessThan(crumbTop);
    await expect(
      page.getByText("見る順にデータとセオリーを並べた画面"),
    ).toBeVisible();
    await expect(group(page).getByText("新", { exact: true })).toBeVisible();
  });

  test("思考アシストでは同じ位置に出し、説明の1行と「新」の札は出さない", async ({
    page,
  }) => {
    await open(page);
    await expect(group(page)).toBeVisible();
    await expect(
      group(page).getByRole("button", { name: /思考アシスト/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("見る順にデータとセオリーを並べた画面"),
    ).toHaveCount(0);
    await expect(group(page).getByText("新", { exact: true })).toHaveCount(0);
  });

  test("一度選んだ端末では「新」の札を出さない。履歴は置き換え（戻るで切り替え前に戻らない）", async ({
    page,
  }) => {
    await page.goto("/");
    await page.goto(`/race/${RACE_ID}`);
    await group(page)
      .getByRole("button", { name: /思考アシスト/ })
      .click();
    await expect(page).toHaveURL(/\/assist$/);
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`/race/${RACE_ID}$`));
    await page.evaluate(() =>
      localStorage.setItem("boatai-user:race-view", "race"),
    );
    await page.goto(`/race/${RACE_ID}`);
    await expect(group(page)).toBeVisible();
    await expect(group(page).getByText("新", { exact: true })).toHaveCount(0);
  });

  test("375px で横にはみ出さず、ボタンは高さ44px以上", async ({ page }) => {
    await page.goto(`/race/${RACE_ID}`);
    await expect(group(page)).toBeVisible();
    const sizes = await group(page)
      .getByRole("button")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });
});

test.describe("思考アシスト: ガイドと Cookie の同意バナー（PR5 マージ後の本番確認）", () => {
  test.use({ viewport: { width: 375, height: 812 }, cookieConsent: null });
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page, { preview: true });
  });

  test("同意バナーが出ている間も、ガイド①の「次へ」を押せる", async ({
    page,
  }) => {
    await open(page);
    await expect(page.locator(".cookie-consent")).toBeVisible();
    await page.getByRole("button", { name: "ガイド", exact: true }).click();
    await page.getByRole("button", { name: "次へ" }).click({ timeout: 5000 });
    await expect(page.getByText("1号艇は逃げられそう？")).toBeVisible();
  });
  test("同意バナーが出ている間も、固定フッターの「マークシートを開く」を押せる", async ({
    page,
  }) => {
    await open(page);
    await expect(page.locator(".cookie-consent")).toBeVisible();
    await page
      .getByRole("button", { name: "マークシートを開く" })
      .click({ timeout: 5000 });
    await expect(
      page.getByRole("dialog", { name: "マークシート" }),
    ).toBeVisible();
  });
});

test.describe("思考アシスト: BOA-808（PR4 のファン評価2周目の P2）", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("1: 図の値を押すと6艇比較になり、深掘りは開かず図の見出しが画面に残る", async ({
    page,
  }) => {
    await open(page);
    await page
      .getByRole("button", { name: "平均ST（直近30走） 0.132、6艇で比べる" })
      .click();
    await expect(page.getByRole("button", { name: /図を戻す/ })).toBeVisible();
    await expect(page.locator(".ta-deep")).toHaveCount(0);
    await expect(page.locator(".ta-board-title")).toBeInViewport();
  });

  test("1: 深掘りの中の値を押すと、深掘りは開いたまま図の見出しまで戻る", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const deep = page.locator(".ta-deep");
    await expect(deep).toBeVisible();
    await deep
      .getByRole("button", { name: /、6艇で比べる$/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: /図を戻す/ })).toBeVisible();
    await expect(deep).toBeVisible();
    await expect(page.locator(".ta-board-title")).toBeInViewport();
  });
});

test.describe("思考アシスト: BOA-809（PR5 のレビューの P3）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  for (const width of [375, 768, 1440]) {
    test(`ヘッダーの押せる範囲（44px）が重ならない（${width}px）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      // 風と潮の「傾向 ›」が並んでから測る（届く前は行が折り返さない）
      await expect(
        page.getByRole("button", { name: /^今日の風.*の過去レースの傾向$/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "潮の傾向の過去レースの傾向" }),
      ).toBeVisible();
      const over = await page.evaluate(() => {
        const hits = [...document.querySelectorAll(".ta-header button")].map(
          (el) => {
            const b = el.getBoundingClientRect();
            const w = Math.max(b.width, 44);
            const h = Math.max(b.height, 44);
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            return {
              name: el.getAttribute("aria-label") || el.textContent,
              x1: cx - w / 2,
              x2: cx + w / 2,
              y1: cy - h / 2,
              y2: cy + h / 2,
            };
          },
        );
        const out = [];
        hits.forEach((a, i) =>
          hits.slice(i + 1).forEach((b) => {
            const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
            const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
            if (ox > 0.5 && oy > 0.5) out.push(`${a.name} × ${b.name}`);
          }),
        );
        return out;
      });
      expect(over).toEqual([]);
    });
  }

  test("ガイド①の光らせた枠は、堅い？荒れる？の見出しの字にかからない", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "ガイド", exact: true }).click();
    const lit = page.locator(".ta-rough.ta-guide-lit");
    await expect(lit).toBeVisible();
    const gap = await lit.evaluate((el) => {
      const s = getComputedStyle(el);
      const inner = parseFloat(s.paddingLeft) + parseFloat(s.outlineOffset);
      return inner - parseFloat(s.outlineWidth);
    });
    // 枠の内側の端が見出しの左端（余白0）より外にある
    expect(gap).toBeGreaterThanOrEqual(0);
  });
});

test.describe("思考アシスト: BOA-808（言葉と出し分け）", () => {
  test("2: 機力の結論にオリジナル展示の一番も入る", async ({ page }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    await lensTab(page, "機力").click();
    await expect(
      page.getByText(
        "展示タイム・モーター2連率は4号艇（6.83秒・38.5%）、一周・まわり足は1号艇（37.31秒・11.49秒）が一番",
      ),
    ).toBeVisible();
  });

  test("6: 進入の過去レースの傾向が無いとき、0件の札と棒を出さない", async ({
    page,
  }) => {
    // v16 の保存が無いレースと同じく、進入の型ごとの値が無い
    await routeThinkingAssistV16(page, {
      overrides: {
        scenario: (body) => ({
          ...body,
          scenario: { ...body.scenario, cells: {} },
        }),
      },
    });
    await open(page);
    await lensTab(page, "展開").click();
    await expect(page.getByText(/^✓ 今日の展示は/)).toBeVisible();
    await expect(
      page.getByText("このレースは過去レースの傾向がまだ無い"),
    ).toBeVisible();
    await expect(page.getByText(/ 0件$/)).toHaveCount(0);
  });

  test("P3: 類似レースでよく出た3連単のオッズ・人気の時点を書く（終わったレースは「今日」と書かない）", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    await lensTab(page, "買い目").click();
    await expect(
      page.getByText(
        /^件数は類似レース\d+件のうち。オッズ・人気はこのレースの\d{1,2}:\d{2}時点で、確定オッズではない$/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /^\d+(\.\d+)?倍$/ }).first(),
    ).toBeVisible();
  });
});

test.describe("思考アシスト: BOA-808・809（2026-10-10 ユーザー決定）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("808 5: 買い目の横軸に「良い」の札を出さない（人気／人気薄だけ）", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "買い目").click();
    const axis = page.locator(".ta-board-axis");
    await expect(axis).toContainText("人気薄");
    await expect(axis.locator(".ta-good")).toHaveCount(0);
  });

  test("809: 艇ごとに件数が違う範囲の札に、その艇の艇番と級を書く", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: /^3号艇\s/ }).click();
    await expect(
      page
        .locator(".ta-deep")
        .getByText(/^全国・級の並びが同じ.*（3号艇がA1） [\d,]+件$/)
        .first(),
    ).toBeVisible({ timeout: 30000 });
  });
});

test.describe("思考アシスト: 風向を本当の方位で出す（BOA-819）", () => {
  test("徳山10R の DB「北西」は、公式の直前情報の図と同じ「北」と出す", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    const header = page.locator(".ta-header");
    await expect(header.getByText(/^風 北 /)).toBeVisible();
    await expect(header.getByText(/^風 北西/)).toHaveCount(0);
  });
});

test.describe("思考アシスト: 風のカードの追い風・向かい風（BOA-809）", () => {
  test("徳山10R（北4m）は向かい風。向かい風が強いのカードに「今日はこちら」", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    await page
      .getByRole("button", { name: /^今日の風.*の過去レースの傾向$/ })
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("今日は北4m・向かい風")).toBeVisible();
    await expect(
      sheet.getByRole("button", {
        name: /^向かい風が強い（向かい風4m以上）・今日はこちら/,
      }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /^追い風が強い（追い風4m以上） ›$/ }),
    ).toBeVisible();
    await expect(
      sheet.getByText("表は追い風・向かい風が混ざった値"),
    ).toBeVisible();
  });
});

test.describe("思考アシスト: 平均ST の期間と「このコース」（BOA-815）", () => {
  test("展開レンズ（展示前）は「このコース｜直近30走」を切り替え、横軸の名前と点の値が替わる", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    await page.getByRole("button", { name: "展示前", exact: true }).click();
    await lensTab(page, "展開").click();
    const group = page.getByRole("group", { name: "使う平均ST" });
    await expect(
      group.getByRole("button", { name: "このコース" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("平均ST（このコース・直近30走） 左ほど早い"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "平均ST（このコース・直近30走） 0.148、6艇で比べる",
      }),
    ).toBeVisible();
    await group.getByRole("button", { name: "直近30走" }).click();
    await expect(page.getByText("平均ST（直近30走） 左ほど早い")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "平均ST（直近30走） 0.132、6艇で比べる",
      }),
    ).toBeVisible();
    // 展示の後は横軸が展示ST になり、切り替えは出さない
    await page.getByRole("button", { name: "展示後", exact: true }).click();
    await expect(page.getByRole("group", { name: "使う平均ST" })).toHaveCount(
      0,
    );
  });

  test("深掘りの平均ST は期間つきの名前、このコースは走数つき", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    const deep = page.locator(".ta-deep");
    await expect(
      deep.getByText("平均ST（直近30走）", { exact: true }),
    ).toBeVisible();
    await expect(deep.getByText("このコース .148（30走）")).toBeVisible();
  });

  test("808 6: v16 の保存が無いレースは、軸レンズに平均ST を出せない理由を書く", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, {
      overrides: { facts: () => ({ status: "not_saved" }) },
    });
    await open(page);
    await expect(
      page.getByText(
        "このレースは平均ST（直近30走）を出せない（前日までの値がまだ無い）",
      ),
    ).toBeVisible();
  });
});

test.describe("思考アシスト: BOA-801（見せ方の残り）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("2: 展示ST の F は赤い枠の印と「F .01（フライング）」", async ({
    page,
  }) => {
    await open(page);
    await lensTab(page, "展開").click();
    const lane5 = page.locator(".ta-lane").nth(4);
    await expect(lane5.locator(".ta-track-dot-f")).toHaveCount(1);
    await expect(lane5.getByText("F .01（フライング）")).toBeVisible();
    await expect(page.locator(".ta-track-dot-f")).toHaveCount(1);
  });

  test("4: 堅い？荒れる？の材料にぶれ幅の凡例と全国の値", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "堅い？荒れる？の材料" }).click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByText(/棒の2本の縦線の間＝ぶれ幅（件数が少ないほど広い）/),
    ).toBeVisible();
    await expect(sheet.getByText("（全国 55%）").first()).toBeVisible();
    await expect(sheet.getByText("（全国 17%）").first()).toBeVisible();
  });

  test("9: 図の札は「モーター2連率」", async ({ page }) => {
    await open(page);
    await lensTab(page, "機力").click();
    await expect(
      page
        .locator(".ta-board")
        .getByText(/^モーター2連率 \d+\.\d%$/)
        .first(),
    ).toBeVisible();
  });
});

test.describe("思考アシスト: PC 表示（BOA-801 5、龍神ソナーと同じ決まり）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("1440px: 最大 1200px・左端 24px、図は左（480px）、深掘りは右に並ぶ。堅い？荒れる？は 480px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const box = (sel) => page.locator(sel).first().boundingBox();
    const main = await box(".ta-page");
    expect(Math.round(main.x)).toBe(24);
    expect(Math.round(main.width)).toBe(1200);
    const rough = await box(".ta-rough");
    expect(rough.width).toBeLessThanOrEqual(480);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    await expect(page.locator(".ta-deep")).toBeVisible();
    const fig = await box(".ta-split-fig");
    const side = await box(".ta-split-side");
    expect(fig.width).toBeLessThanOrEqual(480);
    // 横に並ぶ（右の列は図の右）
    expect(side.x).toBeGreaterThan(fig.x + fig.width);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });

  test("375px は今のまま1列（図の下に深掘り）", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    await expect(page.locator(".ta-deep")).toBeVisible();
    // 深掘りはなめらかに送るので縦の座標ではなく、同じ1列（左端がそろう・横に並ばない）で見る
    const board = await page.locator(".ta-board").boundingBox();
    const deep = await page.locator(".ta-deep").boundingBox();
    expect(deep.x).toBeLessThan(board.x + board.width / 2);
    expect(deep.width).toBeGreaterThan(300);
    const main = await page.locator(".ta-page").boundingBox();
    expect(Math.round(main.width)).toBe(375);
  });
});

test.describe("思考アシスト: 棒は「長いほど良い」図だけ（BOA-801 3）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("軸（全国勝率）は棒、展開・機力・買い目は点だけ", async ({ page }) => {
    await open(page);
    const bars = () => page.locator(".ta-board .ta-track-bar");
    await expect(bars()).toHaveCount(6);
    for (const lens of ["展開", "機力", "買い目"]) {
      await lensTab(page, lens).click();
      await expect(
        page.locator(".ta-board .ta-track-dot").first(),
      ).toBeVisible();
      await expect(bars()).toHaveCount(0);
    }
  });
});

test.describe("思考アシスト: 均等払戻の余り（BOA-801 6、spec FR-8・D-43）", () => {
  test("切り捨てた余りを払戻の少ない組に足し、そう1行で書く", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    await lensTab(page, "買い目").click();
    await candidate(page, 1, 1).click();
    for (const b of [2, 3, 4]) await candidate(page, b, 2).click();
    for (const b of [2, 3, 4]) await candidate(page, b, 3).click();
    await page
      .getByRole("button", { name: "マークシートを開く", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "マークシート" });
    await expect(sheet.getByText("余りは払戻の少ない組に足した")).toBeVisible();
    await expect(sheet.getByText(/・残り0円・/)).toBeVisible();
  });
});

test.describe("思考アシスト: 図の右端の「+」（BOA-801 7、spec D-43）", () => {
  test("「+」を押すとその行に1着・2着・3着の候補、開くのは1行だけ。選ぶと固定の買い目に入る", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await open(page);
    const plus = (boat) =>
      page.getByRole("button", {
        name: new RegExp(`^${boat}号艇: .*候補を選ぶ$`),
      });
    await plus(1).click();
    await expect(plus(1)).toHaveAttribute("aria-expanded", "true");
    await expect(candidate(page, 1, 1)).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "マークシート" }),
    ).toHaveCount(0);
    await plus(2).click();
    await expect(candidate(page, 1, 1)).toHaveCount(0);
    await candidate(page, 2, 1).click();
    await expect(footer(page)).toContainText("2-—-—");
    await expect(plus(2)).toHaveText("1着");
  });
});

test.describe("思考アシスト: BOA-804（PR4 のファン評価の P3）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
  });

  test("② 今節の平均着順点に、何を平均したかの一言（7走・60点÷7走）", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    await expect(
      page
        .locator(".ta-deep")
        .getByText("前日までの今節 7走の平均（60点÷7走。F・失格は0点）"),
    ).toBeVisible({ timeout: 30000 });
  });

  test("③ 全部の材料は、どの艇でも同じ並び", async ({ page }) => {
    await open(page);
    const order = async (boat) => {
      await page
        .getByRole("button", { name: new RegExp(`^${boat}号艇\\s`) })
        .click();
      await page.getByRole("button", { name: /^全部の材料/ }).click();
      const names = await page
        .locator(".ta-deep .ta-fold")
        .last()
        .locator(".ta-chip-name, .ta-chip strong, .ta-chip b")
        .allTextContents();
      return names.map((s) => s.trim()).filter(Boolean);
    };
    const one = await order(1);
    const three = await order(3);
    expect(one.length).toBeGreaterThan(3);
    expect(three).toEqual(one);
  });
});

test.describe("思考アシスト: 差がつく材料の入口1行（2026-10-11 ユーザー決定 案D）", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  const entry = (page) =>
    page.getByRole("button", { name: /^1号艇の(差がつく材料 ▲|全部の材料)/ });

  test("軸の要約に差がつく材料の箱を出さず、入口1行（▲の数・項目名）から1号艇の深掘りを開く。押し直しても閉じない", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await routeThinkingAssistV16(page);
    await open(page);
    const sum = page.locator(".ta-sum");
    await expect(
      sum.getByRole("heading", { name: /^差がつく材料（1号艇）/ }),
    ).toHaveCount(0);
    const btn = entry(page);
    await expect(btn).toHaveText(
      /^1号艇の差がつく材料 ▲3件当地勝率・平均ST（直近30走） ほか1件/,
    );
    const h = await btn.evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
    await btn.click();
    const region = page.getByRole("region", { name: "1号艇の詳しい情報" });
    const head = region.getByRole("heading", { name: "差がつく材料（1号艇）" });
    await expect(head).toBeVisible();
    await expect(head).toBeInViewport();
    await expect(
      region.getByRole("button", { name: "差がつく材料とは" }),
    ).toHaveCount(1);
    await btn.click();
    await expect(region).toBeVisible();
    await expect(
      region.getByRole("button", { name: /^全部の材料（1号艇）/ }),
    ).toHaveAttribute("aria-expanded", "false");
    // 入口から開いたのも深掘りを開いたイベントに入れる（押し直しは送らない。docs/design/thinking-assist/events.md）
    const opens = await page.evaluate(() =>
      window.__events.filter(
        (e) => e[0] === "event" && e[1] === "assist_deep_open",
      ),
    );
    expect(opens.map((e) => e[2].assist_boat)).toEqual([1]);
  });

  test("▲が無い日は「全部の材料（今日は▲なし）」で、押すと深掘りの全部の材料を開いた状態で出す", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, {
      overrides: {
        facts: (body) => {
          for (const it of Object.values(body.today.items)) it.values[0] = null;
          return body;
        },
      },
    });
    await open(page);
    const btn = entry(page);
    await expect(btn).toHaveText(/^1号艇の全部の材料（今日は▲なし）/);
    await btn.click();
    const region = page.getByRole("region", { name: "1号艇の詳しい情報" });
    const all = region.getByRole("button", { name: /^全部の材料（1号艇）/ });
    await expect(all).toHaveAttribute("aria-expanded", "true");
    await expect(all).toBeInViewport();
    await expect(
      region.getByRole("heading", { name: "差がつく材料（1号艇）" }),
    ).toHaveCount(0);
  });
});

test.describe("思考アシスト: GA4 のイベント（公開後のフォロー、docs/design/thinking-assist/events.md）", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("切り替え・レンズ・深掘り・6艇比較・シート・ガイドを送り、押し直しは送らない", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await routeThinkingAssistV16(page, { preview: true });
    const sent = () =>
      page.evaluate(() =>
        window.__events
          .filter((e) => e[0] === "event" && String(e[1]).startsWith("assist_"))
          .map((e) => [e[1], e[2]]),
      );
    await page.goto(`/race/${RACE_ID}`);
    await page
      .getByRole("group", { name: "表示" })
      .getByRole("button", { name: /思考アシスト/ })
      .click();
    await expect(page.getByRole("tablist", { name: "見方" })).toBeVisible({
      timeout: 20000,
    });
    await lensTab(page, "展開").click();
    await lensTab(page, "展開").click();
    await page.getByRole("button", { name: /^1号艇\s/ }).click();
    await page
      .getByRole("button", { name: /、6艇で比べる$/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: /図を戻す/ })).toBeVisible();
    await page
      .getByRole("button", { name: "マークシートを開く", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "マークシート" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await page.getByRole("button", { name: "ガイド", exact: true }).click();
    await page.getByRole("button", { name: "次へ" }).click();
    await expect
      .poll(async () => (await sent()).length, { timeout: 5000 })
      .toBe(7);
    const events = await sent();
    expect(events.map(([name]) => name)).toEqual([
      "assist_view_switch",
      "assist_lens_select",
      "assist_deep_open",
      "assist_metric_compare",
      "assist_sheet_open",
      "assist_guide_step",
      "assist_guide_step",
    ]);
    expect(events[0][1]).toEqual({ race_id: RACE_ID, assist_view: "assist" });
    expect(events[1][1]).toEqual({ race_id: RACE_ID, assist_lens: "flow" });
    expect(events[2][1]).toEqual({
      race_id: RACE_ID,
      assist_boat: 1,
      assist_lens: "flow",
    });
    expect(Object.keys(events[3][1]).sort()).toEqual([
      "assist_lens",
      "assist_metric",
      "race_id",
    ]);
    expect(events[4][1]).toEqual({ race_id: RACE_ID, assist_sheet: "mark" });
    expect(events.slice(5).map(([, p]) => p.assist_guide_step)).toEqual([1, 2]);
  });
});
