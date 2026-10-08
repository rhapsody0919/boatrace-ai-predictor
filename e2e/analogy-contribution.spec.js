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
        /で同じ組み合わせのレースは47件と少ないので、全国から集めています/,
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
