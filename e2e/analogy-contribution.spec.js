import { test, expect } from "./fixtures.js";
import fs from "fs";
import zlib from "zlib";
import { contribution } from "./analogy-contribution-fixture.js";
import {
  analogyV16Facts,
  analogyV16Scenario,
  analogyV16Similar,
  routeAnalogyV16,
} from "./analogy-v16-fixture.js";

/**
 * アナロジー・ファインダーの節の smoke（BOA-271 v16）。
 *
 * v16 で節の中身を作り直した（旧 FR-1 の寄与度の画面 ContributionView は描かない。plan「フロントエンド」）ので、
 * 旧画面の検査（会場・グレード・ラウンドの条件・艇番比較の表・小標本 等）は外し、節の出し方を固定する。
 * 3タブの中身は受け入れ E2E（e2e/acceptance/analogy-finder.spec.js）、幅は e2e/layout.spec.js が見る。
 * facts・similar・scenario は例のレースの固定の応答（e2e/analogy-v16-fixture.js）、寄与度 API・予想の Edge API・
 * Supabase REST も差し替え、DB に依存しない。固定するもの:
 *   - 機能フラグの印が無ければ節を出さず、v16 の API も寄与度の API も呼ばない。?analogy=1 で出せる
 *   - 予想が無いレースでも節を出す（予想の有無と切り離す）
 *   - 保存の無いレース（status=not_saved）は節の中を1行だけにする
 *   - AIの見立ては寄与度 API を全国（venue=0・all・all）と時点（stage）で読む。展示前の集計が無ければ準備中の1文
 *   - 今日の風・波の欄は、会場ごとに風だけ／風×波で数える（spec A-9、Q-F3）
 */

const DATE = "2026-09-22";
const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  name: `テスト選手${i}`,
  grade: "B1",
  age: 30,
  winRate: 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));
const race = (n, { predictions = true } = {}) => ({
  raceId: `${DATE}-09-${String(n).padStart(2, "0")}`,
  venueCode: 9,
  venue: "津",
  raceNumber: n,
  startTime: "23:50",
  raceGrade: "G1",
  raceStage: "準優勝戦",
  cancellationStatus: null,
  entries,
  predictions: predictions
    ? {
        unified: {
          topPick: 1,
          top3: [1, 2, 3],
          confidence: 50,
          volatilityPercentile: 0.5,
          volatilityPercentileIsFallback: false,
          turnPrediction: {
            patterns: [
              { technique: "逃げ", winnerCourse: 1, probability: 0.6 },
            ],
          },
        },
      }
    : null,
  exhibitionData: [],
  result: null,
});
const edgeData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [race(1), race(2, { predictions: false })],
};

async function setup(page, { preview = true, facts = null } = {}) {
  const calls = { contribution: [], facts: 0 };
  await page.addInitScript((on) => {
    localStorage.setItem("boatai-language", "ja");
    localStorage.setItem("boatai:cookie-consent", "accepted");
    if (on) localStorage.setItem("boatai-user:analogy-finder-preview", "1");
    else localStorage.removeItem("boatai-user:analogy-finder-preview");
  }, preview);
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await routeAnalogyV16(page, { preview });
  await page.route("**/api/analogy/facts/**", (route) => {
    calls.facts += 1;
    return facts ? route.fulfill({ json: facts }) : route.fallback();
  });
  await page.route("**/api/analogy/contribution*", (route) => {
    const u = new URL(route.request().url());
    const params = Object.fromEntries(u.searchParams);
    calls.contribution.push(params);
    if (params.stage === "racecard")
      return route.fulfill({ json: { available: false, stageMissing: true } });
    return route.fulfill({
      json: contribution({
        venue: 0,
        grade: "all",
        round: "all",
        target: Number(params.target),
      }),
    });
  });
  return calls;
}

// 龍神ソナーは基本情報と AI予想の間の独立タブ（2026-10-08、承認モック sonar-tab v3）
async function openSonarTab(page, n = 1) {
  await page.goto(`/race/${DATE}-09-${String(n).padStart(2, "0")}`);
  await expect(page.getByText("テスト選手1").first()).toBeVisible({
    timeout: 20000,
  });
  await page.locator(".race-tabs-btn", { hasText: "龍神ソナー" }).click();
}

const sectionOf = (page) => page.getByRole("region", { name: /龍神ソナー/ });

test.describe("アナロジー・ファインダーの節（BOA-271 v16）", () => {
  test("公開後（ANALOGY_FINDER_PUBLIC=true）は、内部確認の印が無くても節を出す", async ({
    page,
  }) => {
    // 2026-10-08 ユーザー決定で公開。戻すときは featureFlags.js の ANALOGY_FINDER_PUBLIC を false にする
    const calls = await setup(page, { preview: false });
    await openSonarTab(page);
    await expect(sectionOf(page)).toBeVisible();
    await expect.poll(() => calls.facts).toBeGreaterThan(0);
  });

  test("節の表示（レースごとに1回）とタブの切り替えを計測する（GA4 の予約語を使わない）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await setup(page);
    await openSonarTab(page);
    const section = sectionOf(page);
    await expect(section.getByRole("tablist")).toBeVisible();
    await section.getByRole("tab", { name: "類似レース" }).click();
    await section.getByRole("tab", { name: "展開シナリオ" }).click();
    const events = await page.evaluate(() =>
      window.__events.filter(
        (e) => e[0] === "event" && String(e[1]).startsWith("analogy_"),
      ),
    );
    const views = events.filter((e) => e[1] === "analogy_section_view");
    expect(views).toHaveLength(1);
    expect(Object.keys(views[0][2]).sort()).toEqual([
      "analogy_stage",
      "race_id",
    ]);
    expect(
      events
        .filter((e) => e[1] === "analogy_tab_select")
        .map((e) => e[2].analogy_tab),
    ).toEqual(["similar", "scenario"]);
    for (const e of events)
      for (const k of Object.keys(e[2]))
        expect([
          "source",
          "medium",
          "campaign",
          "term",
          "content",
          "id",
        ]).not.toContain(k);
  });

  test("節が画面に入ったら1回、条件を変えたら操作の名前で計測する（選択中の押し直しは数えない）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await setup(page);
    await openSonarTab(page);
    const section = sectionOf(page);
    await expect(section.getByRole("tablist")).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    const named = (name) =>
      page.evaluate(
        (n) => window.__events.filter((e) => e[0] === "event" && e[1] === n),
        name,
      );
    await expect
      .poll(async () => (await named("analogy_section_visible")).length)
      .toBe(1);
    const [visible] = await named("analogy_section_visible");
    expect(Object.keys(visible[2]).sort()).toEqual([
      "analogy_stage",
      "race_id",
    ]);
    // 見た時刻を覚える（7日以内の再訪を数えるため）
    expect(
      Number(
        await page.evaluate(() =>
          localStorage.getItem("boatai-user:analogy-last-seen"),
        ),
      ),
    ).toBeGreaterThan(0);

    const target = section.getByRole("group").filter({ hasText: "2着以内" });
    await target.getByRole("button", { name: "1着", exact: true }).click(); // 選択中の押し直し
    await target.getByRole("button", { name: "2着以内", exact: true }).click();
    await section.getByRole("tab", { name: "類似レース" }).click(); // タブは analogy_tab_select だけ
    const changes = await named("analogy_control_change");
    expect(changes.map((e) => e[2])).toEqual([
      {
        race_id: `${DATE}-09-01`,
        analogy_tab: "facts",
        analogy_control: "target",
      },
    ]);
    // 画面に入ったのは1回だけ（タブを切り替えても増えない）
    expect(await named("analogy_section_visible")).toHaveLength(1);
  });

  test("七角形の操作は操作の名前で数え、主役を押し直して何も変わらないときは数えない（レビュー指摘）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await setup(page);
    await openSonarTab(page);
    const section = sectionOf(page);
    const controls = () =>
      page.evaluate(() =>
        window.__events
          .filter((e) => e[0] === "event" && e[1] === "analogy_control_change")
          .map((e) => e[2].analogy_control),
      );
    await section.getByRole("button", { name: /1号艇（A1）/ }).click(); // 主役だけが太いときの押し直し（変化なし）
    await section.getByRole("button", { name: /4号艇（A1）/ }).click(); // 2艇目を太く
    await section.getByRole("button", { name: /4号艇（A1）/ }).click(); // 太い艇を外す（変化あり）
    const item = section.getByRole("button", { name: /全国勝率の6艇の表/ });
    await item.focus();
    await page.keyboard.press("Enter"); // SVG の項目名もキーで開ける
    await expect(section.getByTestId("analogy-radar-table")).toBeVisible();
    expect(await controls()).toEqual([
      "facts_radar_boat",
      "facts_radar_boat",
      "facts_radar_item",
    ]);
  });

  test("七角形は凡例で2艇まで太くして比べ、3艇目で先に押した艇が戻り、太い艇を押し直すと外れる（2026-10-09 ユーザー決定）", async ({
    page,
  }) => {
    await setup(page);
    await openSonarTab(page);
    const section = sectionOf(page);
    const legend = (b) =>
      section.getByRole("button", {
        name: new RegExp(`^${b}\\s*${b}号艇（A1）`),
      });
    const pressed = async () => {
      const out = [];
      for (const b of [1, 2, 3, 4, 5, 6])
        if ((await legend(b).getAttribute("aria-pressed")) === "true")
          out.push(b);
      return out;
    };
    await expect(
      section.getByRole("button", { name: "主役＋2艇" }),
    ).toHaveCount(0);
    expect(await pressed()).toEqual([1]); // 最初は主役
    await legend(4).click();
    expect(await pressed()).toEqual([1, 4]); // 主役と2艇目
    await legend(6).click();
    expect(await pressed()).toEqual([4, 6]); // 3艇目で先に押した主役が戻る
    await expect(section.locator(".af-hep-typ")).toContainText("6号艇"); // 点線は最後に押した艇
    await legend(4).click();
    expect(await pressed()).toEqual([6]); // 太い艇を押し直すと外れる
    await legend(6).click();
    expect(await pressed()).toEqual([1]); // 0艇になったら主役に戻る
  });

  test("前回ソナーを見て7日以内なら、開いた最初に再訪を1回送る（再読み込みでは送らない）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = JSON.parse(sessionStorage.getItem("__ev") ?? "[]");
      window.gtag = (...args) => {
        window.__events.push(args);
        sessionStorage.setItem("__ev", JSON.stringify(window.__events));
      };
      if (!sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem("__seeded", "1");
        localStorage.setItem(
          "boatai-user:analogy-last-seen",
          String(Date.now() - 3 * 24 * 60 * 60 * 1000 - 60 * 1000),
        );
      }
    });
    await setup(page);
    await page.goto(`/race/${DATE}-09-01`);
    await expect(page.getByText("テスト選手1").first()).toBeVisible({
      timeout: 20000,
    });
    const returns = () =>
      page.evaluate(() =>
        window.__events.filter(
          (e) => e[0] === "event" && e[1] === "analogy_return_visit",
        ),
      );
    await expect.poll(async () => (await returns()).length).toBe(1);
    expect((await returns())[0][2]).toEqual({ analogy_days_since: 3 });
    await page.reload();
    await expect(page.getByText("テスト選手1").first()).toBeVisible({
      timeout: 20000,
    });
    await page.waitForTimeout(1500); // page_view の確定待ち（PAGE_VIEW_SETTLE_MS）
    expect(await returns()).toHaveLength(1);
  });

  test("見てから30分以内に開いたタブは同じ来訪として再訪を送らない（レビュー指摘）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
      localStorage.setItem(
        "boatai-user:analogy-last-seen",
        String(Date.now() - 5 * 60 * 1000),
      );
    });
    await setup(page);
    await page.goto(`/race/${DATE}-09-01`);
    await expect(page.getByText("テスト選手1").first()).toBeVisible({
      timeout: 20000,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__events.filter((e) => e[1] === "page_view").length,
        ),
      )
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() =>
        window.__events.filter((e) => e[1] === "analogy_return_visit"),
      ),
    ).toHaveLength(0);
  });

  test("ソナーの扇は選択を外す押し直しとキーボードの操作も条件変更に数える（レビュー指摘）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await setup(page);
    await openSonarTab(page);
    const section = sectionOf(page);
    await section.getByRole("tab", { name: "類似レース" }).click();
    const sector = section.getByRole("button", {
      name: /^1号艇が勝ったレース/,
    });
    // 点が密な扇の真ん中は点のタップになる（近い点を並べる）ので、図の外の艇番を押す（承認モック sonar-tab v3）
    const badge = section.getByTestId("analogy-sonar-boat-1");
    await badge.click(); // 選ぶ
    await expect(sector).toHaveAttribute("aria-pressed", "true");
    await badge.click(); // 外す（押し直し）
    await expect(sector).toHaveAttribute("aria-pressed", "false");
    await sector.focus();
    await page.keyboard.press("Enter"); // キーボードで選ぶ
    const controls = await page.evaluate(() =>
      window.__events
        .filter((e) => e[1] === "analogy_control_change")
        .map((e) => e[2].analogy_control),
    );
    expect(controls).toEqual(["similar_boat", "similar_boat", "similar_boat"]);
  });

  test("?tab=sonar のリンクで開いたら race_tab_initial を1回送る。素の URL では送らない", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await setup(page);
    const initials = () =>
      page.evaluate(() =>
        window.__events
          .filter((e) => e[0] === "event" && e[1] === "race_tab_initial")
          .map((e) => e[2]),
      );
    await page.goto(`/race/${DATE}-09-01?tab=sonar`);
    await expect(sectionOf(page)).toBeVisible({ timeout: 20000 });
    expect(await initials()).toEqual([{ tab_id: "sonar" }]);
    await page.goto(`/race/${DATE}-09-02`);
    await expect(page.getByText("テスト選手1").first()).toBeVisible({
      timeout: 20000,
    });
    expect(await initials()).toEqual([]);
  });

  test.describe("別タブ化（2026-10-08、承認モック sonar-tab v3）", () => {
    test("タブは基本情報と AI予想の間。AI予想タブにはソナーを描かず、一番下の案内1行でソナーのタブへ移る", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.__events = [];
        window.gtag = (...args) => window.__events.push(args);
      });
      await setup(page);
      await page.goto(`/race/${DATE}-09-01?tab=aiPrediction`);
      const link = page.getByTestId("ai-tab-sonar-link");
      await expect(link).toBeVisible({ timeout: 20000 });
      const tabs = await page.locator(".race-tabs-btn").allInnerTexts();
      expect(tabs.slice(0, 3)).toEqual(["基本情報", "龍神ソナー", "AI予想"]);
      await expect(sectionOf(page)).toHaveCount(0);
      await link.click();
      await expect(sectionOf(page)).toBeVisible();
      await expect(
        page.locator(".race-tabs-btn", { hasText: "龍神ソナー" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(/[?&]tab=sonar(&|$)/);
      const selects = await page.evaluate(() =>
        window.__events
          .filter((e) => e[0] === "event" && e[1] === "race_tab_select")
          .map((e) => e[2].tab_id),
      );
      expect(selects).toEqual(["sonar"]);
    });

    test("移す前の投稿のリンク ?tab=aiPrediction&sonar=similar は、ソナーのタブの類似レースで開く", async ({
      page,
    }) => {
      await setup(page);
      await page.goto(`/race/${DATE}-09-01?tab=aiPrediction&sonar=similar`);
      const section = sectionOf(page);
      await expect(section).toBeVisible({ timeout: 20000 });
      await expect(
        section.getByRole("tab", { name: "類似レース" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(/[?&]tab=sonar(&|$)/);
    });

    test("?sonar= は1回だけ効く。ほかのタブから戻ると内部タブは選び直さない。不正な値は差がつく材料", async ({
      page,
    }) => {
      await setup(page);
      await page.goto(`/race/${DATE}-09-01?tab=sonar&sonar=scenario`);
      const section = sectionOf(page);
      await expect(
        section.getByRole("tab", { name: "展開シナリオ" }),
      ).toHaveAttribute("aria-selected", "true");
      await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
      await page.locator(".race-tabs-btn", { hasText: "龍神ソナー" }).click();
      await expect(
        section.getByRole("tab", { name: "差がつく材料" }),
      ).toHaveAttribute("aria-selected", "true");
      await page.goto(`/race/${DATE}-09-02?tab=sonar&sonar=odds`);
      await expect(
        sectionOf(page).getByRole("tab", { name: "差がつく材料" }),
      ).toHaveAttribute("aria-selected", "true");
    });

    test("節の表示はタブを開き直しても同じレースでは1回だけ送る", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.__events = [];
        window.gtag = (...args) => window.__events.push(args);
      });
      await setup(page);
      await openSonarTab(page);
      await expect(sectionOf(page).getByRole("tablist")).toBeVisible();
      await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
      await page.locator(".race-tabs-btn", { hasText: "龍神ソナー" }).click();
      await expect(sectionOf(page).getByRole("tablist")).toBeVisible();
      const views = await page.evaluate(
        () =>
          window.__events.filter(
            (e) => e[0] === "event" && e[1] === "analogy_section_view",
          ).length,
      );
      expect(views).toBe(1);
    });

    test("展開シナリオで全国の全レース・G1 を選んでも、範囲の説明に i18n のキーを出さない（code-review 指摘）", async ({
      page,
    }) => {
      await setup(page);
      const base = analogyV16Scenario();
      await page.route("**/api/analogy/scenario/**", (route) => {
        const scope = new URL(route.request().url()).searchParams.get("scope");
        return route.fulfill({
          json: { ...base, scope: scope ?? base.scope, vc_fell_back: null },
        });
      });
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "展開シナリオ" }).click();
      const group = section.getByRole("group", { name: "集めたレース" });
      for (const name of [/全国の全レース/, /G1/]) {
        await group.getByRole("button", { name }).click();
        await expect(group.getByRole("button", { name })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(section).not.toContainText("aiPredictionTab.");
        await expect(section.getByTestId("analogy-scope-combo")).toHaveCount(0);
      }
    });

    test("艇を替えると、カードの開閉を「差が大きい」の上位2枚だけ開くに合わせ直す（code-review 指摘、BOA-805）", async ({
      page,
    }) => {
      await setup(page);
      await openSonarTab(page);
      const section = sectionOf(page);
      // ボート2連率は畳んだ「着順との関係が小さい項目」の中なので外す
      const cards = section.locator(
        ".af-cards > [data-testid='analogy-fact-card']",
      );
      await expect(cards.first()).toBeVisible();
      // 開閉を手で全部逆にしてから艇を替える
      for (const c of await cards.all()) await c.locator("summary").click();
      await section.locator(".af-boat-btn").nth(1).click();
      await expect(section.locator(".af-boat-btn").nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // 並び順（差がはっきりしている順）で「差が大きい」の先頭2枚だけが開く
      let largeSeen = 0;
      for (const c of await cards.all()) {
        const large =
          (await c.locator(".af-card-judge").innerText()).trim() ===
          "差が大きい";
        const want = large && largeSeen < 2;
        if (large) largeSeen += 1;
        expect(await c.evaluate((el) => el.open)).toBe(want);
      }
      expect(
        await cards.evaluateAll((els) => els.filter((e) => e.open).length),
      ).toBeLessThanOrEqual(2);
      // 時点を切り替えて展示タイムのカードが増減しても、開くのは2枚まで（code-review 指摘、BOA-805）
      const stageBtn = section.getByRole("button", {
        name: "展示前（出走表）",
      });
      if (await stageBtn.count()) {
        await stageBtn.click();
        await section
          .getByRole("button", { name: "展示後（直前情報も）" })
          .click();
        expect(
          await cards.evaluateAll((els) => els.filter((e) => e.open).length),
        ).toBeLessThanOrEqual(2);
      }
    });

    test("はっきりしないカードの札に、差のポイントと件数を書く（BOA-805）", async ({
      page,
    }) => {
      await setup(page);
      await openSonarTab(page);
      // ボート2連率は畳んだ折りたたみの中なので外す
      const judges = await sectionOf(page)
        .locator(".af-cards > [data-testid='analogy-fact-card'] .af-card-judge")
        .allInnerTexts();
      expect(judges.length).toBeGreaterThan(0);
      for (const j of judges)
        expect(j.trim()).toMatch(
          /^(差が大きい|差がある|差は小さい|差はほとんど無い（ぶれ幅が重なる）|差は\d+ポイントあるが、(ぶれ幅が重なる|件数が少ない（[\d,]+件）)|比べられない（当てはまるレースが無い）)/,
        );
    });

    test("長押しの吹き出しは図の外をタップすると閉じる（code-review 指摘）", async ({
      page,
    }) => {
      await setup(page);
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "類似レース" }).click();
      const sonar = section.getByTestId("analogy-sonar");
      const first = sonar.locator("circle[aria-label]").first();
      await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const dot = await first.boundingBox();
      await sonar.dispatchEvent("pointerdown", {
        pointerType: "touch",
        clientX: dot.x + dot.width / 2,
        clientY: dot.y + dot.height / 2,
        bubbles: true,
      });
      const tip = section.getByTestId("analogy-sonar-tip");
      await expect(tip).toBeVisible();
      await sonar.dispatchEvent("pointerup", { pointerType: "touch" });
      await section
        .getByTestId("analogy-sonar-legend")
        .dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
      await expect(tip).toHaveCount(0);
      // 図の外の艇番で扇を選んだときも閉じる（ファン評価2周目 指摘6）
      await sonar.dispatchEvent("pointerdown", {
        pointerType: "touch",
        clientX: dot.x + dot.width / 2,
        clientY: dot.y + dot.height / 2,
        bubbles: true,
      });
      await expect(tip).toBeVisible();
      await sonar.dispatchEvent("pointerup", { pointerType: "touch" });
      await section.getByTestId("analogy-sonar-boat-3").click();
      await expect(tip).toHaveCount(0);
    });

    test("英語の展開シナリオで、スリット図の凡例の文字が重ならない（ファン評価1周目 指摘3）", async ({
      page,
    }) => {
      await setup(page);
      await page.addInitScript(() =>
        localStorage.setItem("boatai-language", "en"),
      );
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(`/en/race/${DATE}-09-01?tab=sonar&sonar=scenario`);
      const svg = page.locator(".af-hint-pic svg");
      await expect(svg).toBeVisible({ timeout: 20000 });
      const overlaps = await svg.evaluate((el) => {
        const boxes = [...el.querySelectorAll("text")]
          .map((t) => ({ s: t.textContent, r: t.getBoundingClientRect() }))
          .filter((b) => /Dotted|Faster|length|Slit/.test(b.s));
        const hit = (a, b) =>
          a.left < b.right &&
          b.left < a.right &&
          a.top < b.bottom &&
          b.top < a.bottom;
        const out = [];
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++)
            if (hit(boxes[i].r, boxes[j].r))
              out.push(`${boxes[i].s} / ${boxes[j].s}`);
        return { n: boxes.length, out };
      });
      expect(overlaps.n).toBe(4);
      expect(overlaps.out).toEqual([]);
    });

    test("ソナーの点はタップで近い点を最大5件並べ、長押しで吹き出しを出す。点の操作も条件変更に数える", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        window.__events = [];
        window.gtag = (...args) => window.__events.push(args);
      });
      await setup(page);
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "類似レース" }).click();
      const sonar = section.getByTestId("analogy-sonar");
      await expect(sonar).toBeVisible();
      // 点の1つの上（点は小さいままで、当たり判定だけ指の大きさ）
      const first = sonar.locator("circle[aria-label]").first();
      // 上に固定した内部タブ・ヘッダーの下に隠れないよう、点を画面の真ん中へ
      await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const dot = await first.boundingBox();
      const at = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
      await page.mouse.click(at.x, at.y);
      const picks = section.getByTestId("analogy-sonar-pick");
      await expect(picks.first()).toBeVisible();
      expect(await picks.count()).toBeLessThanOrEqual(5);
      // マウスを重ねて出た吹き出しを消してから、長押し（指）。0.4秒で吹き出し
      await page.mouse.move(0, 0);
      await expect(section.getByTestId("analogy-sonar-tip")).toHaveCount(0);
      await sonar.dispatchEvent("pointerdown", {
        pointerType: "touch",
        clientX: at.x,
        clientY: at.y,
        bubbles: true,
      });
      await expect(section.getByTestId("analogy-sonar-tip")).toBeVisible();
      await sonar.dispatchEvent("pointerup", { pointerType: "touch" });
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.__events
              .filter((e) => e[1] === "analogy_control_change")
              .map((e) => e[2].analogy_control),
          ),
        )
        .toEqual(["similar_point", "similar_point_hold"]);
    });
  });

  test.describe("画面の中の声（モック承認 2026-10-08、マイグレーション143）", () => {
    async function routeFeedback(page, { status = 201, body = "" } = {}) {
      const posts = [];
      await page.route("**/rest/v1/analogy_feedback*", (route) => {
        posts.push(route.request().postDataJSON());
        return route.fulfill({ status, body });
      });
      return posts;
    }
    const feedbackOf = (page) => page.getByTestId("analogy-feedback");

    test("1段目で vote、2段目の「送る」で detail を保存し、お礼に替わる。再訪してもお礼だけ", async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.addInitScript(() => {
        window.__events = [];
        window.gtag = (...args) => window.__events.push(args);
      });
      await setup(page);
      const posts = await routeFeedback(page);
      await openSonarTab(page);
      const fb = feedbackOf(page);
      await expect(
        fb.getByText("龍神ソナーは予想の材料になりましたか？"),
      ).toBeVisible();
      await expect(
        fb.getByText("匿名で送られ、公開されません。読むのは運営だけです"),
      ).toBeVisible();
      await fb.getByRole("button", { name: "物足りない" }).click();
      await expect.poll(() => posts.length).toBe(1);
      const [vote] = posts;
      expect(vote).toMatchObject({
        kind: "vote",
        race_id: `${DATE}-09-01`,
        verdict: "lacking",
        reasons: null,
        comment: null,
        analogy_tab: "facts",
        lang: "ja",
      });
      expect(vote.client_key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      await fb.getByLabel("件数が少ない").check();
      await fb.getByLabel("その他").check();
      await fb
        .getByRole("textbox")
        .fill("  風向きと水位もそろえて数えてほしい  ");
      await expect(fb.getByText("21 / 200")).toBeVisible();
      await fb.getByRole("button", { name: "送る" }).click();
      await expect(
        fb.getByText("受け取りました。次の改善に使います"),
      ).toBeVisible();
      expect(posts).toHaveLength(2);
      expect(posts[1]).toMatchObject({
        kind: "detail",
        verdict: "lacking",
        reasons: ["few_races", "other"],
        comment: "風向きと水位もそろえて数えてほしい",
        client_key: vote.client_key,
      });
      const names = await page.evaluate(() =>
        window.__events
          .filter((e) => String(e[1]).startsWith("analogy_feedback_"))
          .map((e) => [e[1], Object.keys(e[2]).sort().join(",")]),
      );
      // 「見えた」は IntersectionObserver なので、押す前後どちらに来るかは決まらない
      expect(names.sort()).toEqual([
        ["analogy_feedback_send", "analogy_verdict,race_id"],
        ["analogy_feedback_view", "race_id"],
        ["analogy_feedback_vote", "analogy_verdict,race_id"],
      ]);

      await openSonarTab(page); // 開き直す（localStorage は残る）
      await expect(
        feedbackOf(page).getByText("受け取りました。次の改善に使います"),
      ).toBeVisible();
      await expect(
        feedbackOf(page).getByRole("button", { name: "なった" }),
      ).toHaveCount(0);
    });

    test("「なった」を選び直しても vote は1回だけ。detail は送った時点の評価で、一言が空なら NULL", async ({
      page,
    }) => {
      await setup(page);
      const posts = await routeFeedback(page);
      await openSonarTab(page);
      const fb = feedbackOf(page);
      await fb.getByRole("button", { name: "物足りない" }).click();
      await fb.getByRole("button", { name: "なった" }).click();
      await expect(fb.getByText("どこが使えましたか？（任意）")).toBeVisible();
      await expect(fb.getByRole("checkbox")).toHaveCount(0);
      await fb.getByRole("button", { name: "送る" }).click();
      await expect(
        fb.getByText("受け取りました。次の改善に使います"),
      ).toBeVisible();
      expect(posts.map((p) => [p.kind, p.verdict])).toEqual([
        ["vote", "lacking"],
        ["detail", "useful"],
      ]);
      expect(posts[1]).toMatchObject({ reasons: null, comment: null });
    });

    test("同じブラウザの2行目（UNIQUE 違反 23505）は受け取り済みとして扱う", async ({
      page,
    }) => {
      await setup(page);
      await routeFeedback(page, {
        status: 409,
        body: JSON.stringify({
          code: "23505",
          message: "duplicate key value violates unique constraint",
        }),
      });
      await openSonarTab(page);
      const fb = feedbackOf(page);
      await fb.getByRole("button", { name: "なった" }).click();
      await fb.getByRole("button", { name: "送る" }).click();
      await expect(
        fb.getByText("受け取りました。次の改善に使います"),
      ).toBeVisible();
    });

    test("送れなかったら理由を出し、お礼に替えない（握りつぶさない）", async ({
      page,
    }) => {
      await setup(page);
      await routeFeedback(page, {
        status: 500,
        body: JSON.stringify({ code: "P0001", message: "too many" }),
      });
      await openSonarTab(page);
      const fb = feedbackOf(page);
      await fb.getByRole("button", { name: "なった" }).click();
      await expect(
        fb.getByText("送れませんでした。時間をおいてもう一度押してください"),
      ).toBeVisible();
      await fb.getByRole("button", { name: "送る" }).click();
      await expect(
        fb.getByText("送れませんでした。時間をおいてもう一度押してください"),
      ).toBeVisible();
      await expect(
        fb.getByText("受け取りました。次の改善に使います"),
      ).toHaveCount(0);
    });

    test("保存の無いレースでは出さない", async ({ page }) => {
      await setup(page, {
        facts: { race_id: `${DATE}-09-01`, status: "not_saved" },
      });
      await openSonarTab(page);
      await expect(sectionOf(page)).toBeVisible();
      await expect(feedbackOf(page)).toHaveCount(0);
    });
  });

  test("?analogy=1 を付けて開くと内部確認として節を出し、端末に覚える", async ({
    page,
  }) => {
    await setup(page, { preview: false });
    await page.goto(`/race/${DATE}-09-01?analogy=1`);
    await page.locator(".race-tabs-btn", { hasText: "龍神ソナー" }).click();
    await expect(sectionOf(page)).toBeVisible();
    await expect(sectionOf(page).getByRole("tablist")).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("boatai-user:analogy-finder-preview"),
      ),
    ).toBe("1");
  });

  test("予想が無いレースでも節を出す", async ({ page }) => {
    await setup(page);
    await openSonarTab(page, 2);
    await expect(sectionOf(page)).toBeVisible();
  });

  test("保存の無いレースは節の中を1行だけにする", async ({ page }) => {
    await setup(page, { facts: { status: "not_saved" } });
    await openSonarTab(page);
    const section = sectionOf(page);
    await expect(
      section.getByText("このレースは、表示できるデータがありません"),
    ).toBeVisible();
    await expect(section.getByRole("tablist")).toHaveCount(0);
  });

  test("AIの見立ては全国の値を時点つきで読み、展示前の集計が無ければ準備中の1文だけ", async ({
    page,
  }) => {
    const calls = await setup(page);
    await openSonarTab(page);
    const section = sectionOf(page);
    await section
      .getByText(
        "AIの見立て（補助）: ほかの項目をそろえたうえで、どの項目が効くか",
      )
      .click();
    await expect.poll(() => calls.contribution.length).toBeGreaterThan(0);
    expect(calls.contribution[0]).toMatchObject({
      venue: "0",
      grade: "all",
      round: "all",
      target: "1",
      stage: "exhibition",
    });
    await section.getByRole("button", { name: "展示前（出走表）" }).click();
    await expect(
      section.getByText(
        "展示前のAIの見立ては準備中。展示後に切り替えると見られる",
      ),
    ).toBeVisible();
    expect(await section.innerText()).not.toMatch(/寄与度|モデル|競艇/);
  });

  test.describe("今日の風・波の欄（spec A-9、Q-F3）", () => {
    // 例のレース（若松12R）は今日の風1m・波1cm → 風の区分 0-1・波の区分 0-2
    const VA = "VA:20";
    const withWave = (n) => {
      const f = analogyV16Facts();
      const va = f.facts[VA];
      va.wave_mode = { corr: 0.52, n: 15000, use_wave: true };
      for (let b = 1; b <= 6; b++)
        for (const t of ["win", "top2", "top3"])
          va.wind_wave["0-1"]["0-2"][String(b)][t] = [Math.min(n, 100), n];
      return f;
    };
    const windSection = (page) => sectionOf(page).locator(".af-wind");

    test("波高が風速とほぼ同じ会場は風だけで数え、見出しに今日の波を添える", async ({
      page,
    }) => {
      await setup(page);
      await openSonarTab(page);
      const w = windSection(page);
      await expect(
        w.getByText(
          "今日の風（1m）に近いレースでは（今日の波1cm。風・波は展示の時点）",
        ),
      ).toBeVisible();
      await expect(
        w.getByText(
          "この会場の波高は風速とほぼ同じ値で記録されるので、風で分けている",
        ),
      ).toBeVisible();
      await expect(w).toContainText("若松で風0〜1mだったレースで");
    });

    test("波高が別の情報を持つ会場で今日の区分が300件以上なら風×波で数える", async ({
      page,
    }) => {
      await setup(page, { facts: withWave(300) });
      await openSonarTab(page);
      const w = windSection(page);
      await expect(
        w.getByText("今日の風・波（風1m・波1cm）に近いレースでは"),
      ).toBeVisible();
      await expect(w).toContainText(
        "若松で風0〜1m・波0〜2cmだったレースで、各艇番が1着になった割合（300レース）",
      );
      await expect(
        w.getByText(/風で分けている|風だけで分けています/),
      ).toHaveCount(0);
    });

    test("波高が別の情報を持つ会場でも今日の区分が300件未満なら風だけに戻して1行注記", async ({
      page,
    }) => {
      await setup(page, { facts: withWave(299) });
      await openSonarTab(page);
      const w = windSection(page);
      await expect(
        w.getByText(
          "今日の風（1m）に近いレースでは（今日の波1cm。風・波は展示の時点）",
        ),
      ).toBeVisible();
      await expect(
        w.getByText("波で分けると299件と少ないので、風だけで分けています"),
      ).toBeVisible();
      await expect(w).toContainText("若松で風0〜1mだったレースで");
    });
  });

  test("展示で深いフライング（F.06以上）の艇がいるレースは、今日の展示の形を出さない（Q-F6）", async ({
    page,
  }) => {
    // 例のレース（若松12R）は展示で3号艇が F.09
    await setup(page);
    await openSonarTab(page);
    const section = sectionOf(page);
    await section.getByRole("tab", { name: "展開シナリオ" }).click();
    await expect(
      section.getByText(
        /参考: 今日の展示の形は出していない（展示で深いフライング（F\.06以上）/,
      ),
    ).toBeVisible();
    await expect(
      section.getByText(/参考: 今日の展示の形は(?!出していない)/),
    ).toHaveCount(0);
  });

  test.describe("ファン評価3周目の P3（BOA-778）", () => {
    test("優勝戦の日の今節の平均着順点のカードは、今日の位置の枠と件数の行を出さない", async ({
      page,
    }) => {
      // 例のレース（若松12R）は優勝戦の日。「枠で囲んだ棒…」の見方は凡例に1回だけになった（承認モック sonar-tab v3）
      await setup(page);
      await openSonarTab(page);
      const cards = sectionOf(page).getByTestId("analogy-fact-card");
      const card = cards.filter({ hasText: "今節の平均着順点（前日まで）" });
      await expect(card).toBeVisible();
      if ((await card.getAttribute("open")) === null)
        await card.locator("summary").click();
      await expect(card).toHaveAttribute("open", "");
      await expect(card.locator(".af-strip-col.is-today")).toHaveCount(0);
      await expect(card.getByTestId("analogy-today-hit")).toHaveCount(0);
      const other = cards.filter({ hasText: "全国勝率" }).first();
      if ((await other.getAttribute("open")) === null)
        await other.locator("summary").click();
      await expect(other.locator(".af-strip-col.is-today")).toHaveCount(1);
      await expect(other.getByTestId("analogy-today-hit")).toBeVisible();
      await expect(sectionOf(page)).toContainText("今日の順位");
    });

    test("説明・注記は話題ごとの見出し＋1文ずつの箇条書きで、12px 以上で出す", async ({
      page,
    }) => {
      // BOA-778 で脚注を行に分け、2026-10-06 ユーザー決定で全タブを「見出し＋箇条書き」にした
      await setup(page);
      await openSonarTab(page);
      // 割合の出し方・注意は一番下の折りたたみ（承認モック sonar-tab v3）
      await sectionOf(page)
        .getByTestId("analogy-notes-fold")
        .first()
        .locator("summary")
        .click();
      const counting = sectionOf(page)
        .locator(".af-notes")
        .filter({
          has: page.locator(".af-notes-h", { hasText: "割合の出し方" }),
        })
        .first();
      await expect(counting.locator("li").first()).toBeVisible();
      await expect
        .poll(() => counting.locator("li").count())
        .toBeGreaterThanOrEqual(2);
      const size = await counting
        .locator("ul")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(12);
      // 1つの li に2文が入らない（「。」で区切った1文ずつ）
      for (const li of await counting.locator("li").allInnerTexts())
        expect((li.match(/。/g) ?? []).length).toBeLessThanOrEqual(1);
    });

    test("2〜6号艇の率は、その艇の級をそろえた範囲の件数で出し、6艇を足しても100%にならないと書く（BOA-806）", async ({
      page,
    }) => {
      await setup(page);
      const base = analogyV16Scenario();
      const urls = [];
      // 4号艇は級をそろえた範囲で件数200（1着50・2着30・3着20）、5号艇は③のすぐ外の艇の1着だけ持つ
      const four = Object.fromEntries(
        Object.entries(base.scenario.cells).map(([e, { forms }]) => [
          e,
          Object.fromEntries(
            Object.keys(forms).map((f) => [f, [200, 50, 30, 20]]),
          ),
        ]),
      );
      const kado = base.scenario.attack.kado;
      const boats = {
        2: null,
        3: null,
        4: {
          scope: "VC:20:6-0-0-0:4A1",
          data: {
            cells: four,
            attack: {
              kado: {
                ...kado,
                all: { ...kado.all, n: 154, att_win: [77, 154] },
              },
            },
            winner: {},
          },
          reference: null,
        },
        5: {
          scope: "VC:20:6-0-0-0:5A1",
          data: { cells: {}, attack: {}, winner: { kado: [11, 100] } },
          reference: null,
        },
        6: null,
      };
      await page.route("**/api/analogy/scenario/**", (route) => {
        urls.push(route.request().url());
        return route.fulfill({ json: { ...base, boats } });
      });
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "展開シナリオ" }).click();
      await expect(section).toContainText("6艇を足しても100%にならない");
      await expect(section).toContainText("25%（50/200）");
      await expect(section).toContainText("50%（100/200）");
      expect(urls.length).toBeGreaterThan(0);
      expect(
        urls.every((u) => new URL(u).searchParams.get("boats") === "1"),
      ).toBe(true);
      // 流れ図・3連単は1号艇の範囲のままなので、その旨を書く（レビュー指摘）
      await expect(section).toContainText(
        "着順の流れと3連単は、1号艇の級別をそろえたレース",
      );
      await section
        .getByRole("button", { name: /^カド一撃/ })
        .first()
        .click();
      await expect(section).toContainText("77/154レース");
      await expect(section).toContainText("すぐ外の5号艇の1着 11%");
      await expect(section).toContainText(
        "4号艇の級別を今日とそろえたレース（154件）",
      );
    });

    test("6艇とも同じ級で攻める艇の範囲が1号艇と同じレースなら、③の「範囲が違う」注記を出さない（BOA-806 レビュー指摘）", async ({
      page,
    }) => {
      await setup(page);
      const base = analogyV16Scenario();
      const kado = base.scenario.attack.kado;
      // 若松・6艇ともA1: 4号艇の範囲は1号艇の範囲と同じレース（件数も同じ）
      const boats = {
        2: null,
        3: null,
        4: {
          scope: "VC:20:6-0-0-0:4A1",
          data: { cells: {}, attack: { kado }, winner: {} },
          reference: null,
        },
        5: null,
        6: null,
      };
      await page.route("**/api/analogy/scenario/**", (route) =>
        route.fulfill({ json: { ...base, boats } }),
      );
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "展開シナリオ" }).click();
      await section
        .getByRole("button", { name: /^カド一撃/ })
        .first()
        .click();
      await expect(section.getByText("攻める艇:")).toBeVisible();
      await expect(section).not.toContainText(
        "4号艇の級別を今日とそろえたレース",
      );
    });

    test("七角形の表で見た3号艇の展示タイムは、3号艇を一番上で選んだときと同じ数字（2026-10-09 ユーザー指摘）", async ({
      page,
    }) => {
      // 3号艇の集めたレースだけ値を変え、1号艇の集めたレースの3号艇の列と違う数字にする
      // （以前の「比べる艇」は1号艇の集めたレースで出していたので、ここで食い違った）
      const facts = analogyV16Facts();
      const k3 = facts.today.scope_keys["3"].VC;
      for (const r of ["1", "2", "3", "4", "5", "6"])
        facts.facts[k3].by["3"].exh_time[r].win = [1, 50];
      await setup(page, { facts });
      await openSonarTab(page);
      const section = sectionOf(page);
      const exhCard = section.locator(
        ".af-cards > [data-testid='analogy-fact-card'][data-key='exh_time']",
      );
      // 一番上で3号艇を選んだときのカードの今日の行
      await section.locator(".af-boat-btn").nth(2).click();
      if (!(await exhCard.evaluate((e) => e.open)))
        await exhCard.locator("summary").click();
      const top = await exhCard.getByTestId("analogy-today-hit").innerText();
      expect(top).toContain("2%（1/50件");
      // 1号艇を一番上にして、七角形の展示タイムを押した表の3号艇の行
      await section.locator(".af-boat-btn").nth(0).click();
      await section
        .getByRole("button", { name: /展示タイムの6艇の表/ })
        .click();
      const at = section
        .getByTestId("analogy-radar-table")
        .locator("tr[data-boat='3'] [data-testid='analogy-radar-at']");
      await expect(at).toHaveText("2% 1/50件");
      // 凡例で3号艇を押して太くしても、同じ表の数字は変わらない
      await section.getByRole("button", { name: /3号艇（A1）/ }).click();
      await expect(at).toHaveText("2% 1/50件");
      // 「全レース」の率は、上の大きい数字（主役＝1号艇）と同じ桁（レビュー指摘: 表だけ整数だった）
      const big = await section.locator(".af-big b").first().innerText();
      await expect(
        section
          .getByTestId("analogy-radar-table")
          .locator("tr[data-boat='1'] td")
          .last(),
      ).toHaveText(big);
    });

    test("手がかりの件数が②の件数とずれる理由を書く", async ({ page }) => {
      await setup(page);
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "展開シナリオ" }).click();
      await expect(section).toContainText(
        "平均STが6艇そろわないレースを除くので、②の「どの形でも」と件数が少しずれることがある",
      );
    });

    test("ソナーの回る飾りは扇ではなく細い線", async ({ page }) => {
      await setup(page);
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "類似レース" }).click();
      const sweep = section.locator(".af-sweep");
      await expect(sweep.locator("line")).toHaveCount(1);
      await expect(sweep.locator("path")).toHaveCount(0);
    });
  });

  test.describe("AIの見立て（T5-2、本番の版 2026-10-06 の応答）", () => {
    const outlook = JSON.parse(
      zlib.gunzipSync(
        fs.readFileSync(
          new URL("./analogy-outlook-fixture.json.gz", import.meta.url),
        ),
      ),
    );
    const openOutlook = async (page, stage) => {
      await setup(page);
      await page.route("**/api/analogy/contribution*", (route) => {
        const st = new URL(route.request().url()).searchParams.get("stage");
        return route.fulfill({
          json: outlook[st === "racecard" ? "racecard" : "exhibition"],
        });
      });
      await openSonarTab(page);
      const section = sectionOf(page);
      if (stage === "racecard")
        await section.getByRole("button", { name: "展示前（出走表）" }).click();
      await section.locator(".af-boat-btn").nth(1).click();
      const ai = section.locator(".af-ai");
      await ai.locator("summary").first().click();
      await ai.locator(".af-ai-theme").evaluateAll((ds) =>
        ds.forEach((d) => {
          d.open = true;
        }),
      );
      return ai;
    };

    test("展示後は7テーマで、項目ごとの向きとカテゴリの上がる・下がるを出す", async ({
      page,
    }) => {
      const ai = await openOutlook(page, "exhibition");
      await expect(ai.locator(".af-ai-theme")).toHaveCount(7);
      await expect(ai).toContainText(
        "6艇の中で全国勝率が高いほど見込みが上がる",
      );
      await expect(ai).toContainText(
        "6艇の中で展示タイムが速いほど見込みが上がる",
      );
      // グレードは SG・G1・G2…の順、ラウンドは予選・準優勝戦・優勝戦・一般戦などの順に並べる
      await expect(ai).toContainText("上がる: SG・G1・G2／下がる: —");
      await expect(ai).toContainText(
        "上がる: 予選／下がる: 準優勝戦・優勝戦・一般戦など",
      );
      await expect(ai).toContainText("1号艇が強いかどうかで変わる");
      await expect(ai).not.toContainText(/寄与度|モデル/);
    });

    test("展示前は、その段に無いテーマ（天候・水面）を出さない", async ({
      page,
    }) => {
      const ai = await openOutlook(page, "racecard");
      await expect(ai.locator(".af-ai-theme")).toHaveCount(6);
      await expect(ai).not.toContainText("天候・水面");
      await expect(ai).not.toContainText("展示タイム");
    });

    test("項目の割合はテーマの % に合計がそろう（グループが1つのテーマはテーマと同じ値）", async ({
      page,
    }) => {
      // 展示前の「スタート・展示」は平均STだけ。内訳の share（0.077）とテーマの割合（0.097）は分母が違うので、
      // そのまま出すと 8% と 10% で合わなかった（学習側の回答 2026-10-06）
      const ai = await openOutlook(page, "racecard");
      const theme = ai.locator(".af-ai-theme", { hasText: "スタート・展示" });
      const themePct = await theme.locator("summary .af-num").innerText();
      await expect(theme.locator(".af-ai-item .af-num")).toHaveText([themePct]);
      for (const th of await ai.locator(".af-ai-theme").all()) {
        const total = parseInt(
          await th.locator("summary .af-num").innerText(),
          10,
        );
        const items = await th.locator(".af-ai-item .af-num").allInnerTexts();
        expect(items.reduce((a, x) => a + parseInt(x, 10), 0)).toBe(total);
      }
    });
  });

  test.describe("ファン評価4周目（実データ、2026-10-07 ユーザー決定）", () => {
    test("当地勝率 0.00 の艇は「当地の記録なし」で、6艇中の順位を付けない", async ({
      page,
    }) => {
      const f = analogyV16Facts();
      f.today.items.loc_win.values[0] = 0;
      await setup(page, { facts: f });
      await openSonarTab(page);
      const card = sectionOf(page)
        .getByTestId("analogy-fact-card")
        .filter({ hasText: "当地勝率" })
        .first();
      if ((await card.getAttribute("open")) === null)
        await card.locator("summary").click();
      await expect(card).toContainText("1号艇の今日: —（当地の記録なし）");
    });

    test("類似レースの全項目表で、展示で決まる項目の「全レースで同じ割合」は出さない", async ({
      page,
    }) => {
      await setup(page);
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "類似レース" }).click();
      await section
        .locator("details")
        .evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
      const row = section.locator("table.af-like-table tr", {
        hasText: "天候",
      });
      await expect(row).toHaveCount(1);
      await expect(row.locator("td").last()).toHaveText("—");
    });

    test("展示後の段が数え直した応答（pool_rate_exhibition）なら、展示の項目の割合も出す", async ({
      page,
    }) => {
      await setup(page);
      const sim = analogyV16Similar("exhibition");
      sim.similar.pool_rate = { ...sim.similar.pool_rate, weather: 0.61 };
      sim.similar.pool_rate_exhibition = true;
      await page.route("**/api/analogy/similar/**", (route) =>
        route.fulfill({ json: sim }),
      );
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "類似レース" }).click();
      await section
        .locator("details")
        .evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
      const row = section.locator("table.af-like-table tr", {
        hasText: "天候",
      });
      await expect(row.locator("td").last()).toHaveText("61%");
    });

    test("結果の無い類似レースを決まり方から外したら、その件数を書く", async ({
      page,
    }) => {
      await setup(page);
      const sim = analogyV16Similar("exhibition");
      sim.similar.neighbors[0].finish = null;
      // 後から登録した route が先に効く
      await page.route("**/api/analogy/similar/**", (route) =>
        route.fulfill({ json: sim }),
      );
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "類似レース" }).click();
      await expect(section).toContainText("（結果が無い1件を除く）");
    });
  });

  test.describe("公開前の点検（Codex、2026-10-07）", () => {
    test("タブ3で既定が全国に替わったときは理由の1行を出し、範囲を選び直したら消す", async ({
      page,
    }) => {
      await setup(page);
      const fell = analogyV16Scenario();
      fell.vc_fell_back = 47;
      const picked = analogyV16Scenario();
      picked.vc_fell_back = null;
      await page.route("**/api/analogy/scenario/**", (route) =>
        route.fulfill({
          json: new URL(route.request().url()).searchParams.get("scope")
            ? picked
            : fell,
        }),
      );
      await openSonarTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "展開シナリオ" }).click();
      const line = section.getByText(
        /で同じ組み合わせのレース（返還を除く）は47件と少ないので、全国から集めています/,
      );
      await expect(line).toBeVisible();
      await section
        .getByRole("group", { name: "集めたレース" })
        .getByRole("button")
        .first()
        .click();
      await expect(line).toHaveCount(0);
    });
  });
});
