import { test, expect } from "./fixtures.js";
import fs from "fs";
import zlib from "zlib";
import { contribution } from "./analogy-contribution-fixture.js";
import {
  analogyV16Facts,
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

async function openAiTab(page, n = 1) {
  await page.goto(`/race/${DATE}-09-${String(n).padStart(2, "0")}`);
  await expect(page.getByText("テスト選手1").first()).toBeVisible({
    timeout: 20000,
  });
  await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
}

const sectionOf = (page) => page.getByRole("region", { name: /龍神ソナー/ });

test.describe("アナロジー・ファインダーの節（BOA-271 v16）", () => {
  test("公開前の既定では節を出さず、v16 の API も寄与度の API も呼ばない", async ({
    page,
  }) => {
    const calls = await setup(page, { preview: false });
    await openAiTab(page);
    await expect(page.locator(".prediction-result")).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(sectionOf(page)).toHaveCount(0);
    expect(calls.facts).toBe(0);
    expect(calls.contribution).toHaveLength(0);
  });

  test("?analogy=1 を付けて開くと内部確認として節を出し、端末に覚える", async ({
    page,
  }) => {
    await setup(page, { preview: false });
    await page.goto(`/race/${DATE}-09-01?analogy=1`);
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
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
    await openAiTab(page, 2);
    await expect(sectionOf(page)).toBeVisible();
  });

  test("保存の無いレースは節の中を1行だけにする", async ({ page }) => {
    await setup(page, { facts: { status: "not_saved" } });
    await openAiTab(page);
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
    await openAiTab(page);
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
      await openAiTab(page);
      const w = windSection(page);
      await expect(
        w.getByText("今日の風（1m）に近いレースでは（今日の波1cm）"),
      ).toBeVisible();
      await expect(
        w.getByText(
          "この会場の波高は風速とほぼ同じ値で記録されるので、風で数えている",
        ),
      ).toBeVisible();
      await expect(w).toContainText("若松で風0〜1mだったレースで");
    });

    test("波高が別の情報を持つ会場で今日の区分が300件以上なら風×波で数える", async ({
      page,
    }) => {
      await setup(page, { facts: withWave(300) });
      await openAiTab(page);
      const w = windSection(page);
      await expect(
        w.getByText("今日の風・波（風1m・波1cm）に近いレースでは"),
      ).toBeVisible();
      await expect(w).toContainText(
        "若松で風0〜1m・波0〜2cmだったレースで、各艇番が1着になった割合（300レース）",
      );
      await expect(
        w.getByText(/風で数えている|風だけで数えています/),
      ).toHaveCount(0);
    });

    test("波高が別の情報を持つ会場でも今日の区分が300件未満なら風だけに戻して1行注記", async ({
      page,
    }) => {
      await setup(page, { facts: withWave(299) });
      await openAiTab(page);
      const w = windSection(page);
      await expect(
        w.getByText("今日の風（1m）に近いレースでは（今日の波1cm）"),
      ).toBeVisible();
      await expect(
        w.getByText("波で分けると299件と少ないので、風だけで数えています"),
      ).toBeVisible();
      await expect(w).toContainText("若松で風0〜1mだったレースで");
    });
  });

  test("展示で深いフライング（F.06以上）の艇がいるレースは、今日の展示の形を出さない（Q-F6）", async ({
    page,
  }) => {
    // 例のレース（若松12R）は展示で3号艇が F.09
    await setup(page);
    await openAiTab(page);
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
    test("優勝戦の日の今節の平均着順点のカードは、今日の位置の枠が無いので「枠で囲んだ棒」を言わない", async ({
      page,
    }) => {
      // 例のレース（若松12R）は優勝戦の日
      await setup(page);
      await openAiTab(page);
      const card = sectionOf(page)
        .getByRole("article")
        .filter({ hasText: "今節の平均着順点（前日まで）" });
      await expect(card).toBeVisible();
      await expect(card).not.toContainText("枠で囲んだ棒が今日の位置");
      const other = sectionOf(page)
        .getByRole("article")
        .filter({ hasText: "全国勝率" })
        .first();
      await expect(other).toContainText("枠で囲んだ棒が今日の位置");
    });

    test("説明・注記は話題ごとの見出し＋1文ずつの箇条書きで、12px 以上で出す", async ({
      page,
    }) => {
      // BOA-778 で脚注を行に分け、2026-10-06 ユーザー決定で全タブを「見出し＋箇条書き」にした
      await setup(page);
      await openAiTab(page);
      const counting = sectionOf(page)
        .locator(".af-notes")
        .filter({ has: page.locator(".af-notes-h", { hasText: "数え方" }) })
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
      await openAiTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "展開シナリオ" }).click();
      await expect(section).toContainText(
        "平均STが6艇そろわないレースを除くので、②の「どの形でも」と件数が少しずれることがある",
      );
    });

    test("ソナーの回る飾りは扇ではなく細い線", async ({ page }) => {
      await setup(page);
      await openAiTab(page);
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
      await openAiTab(page);
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
      await openAiTab(page);
      const card = sectionOf(page)
        .getByRole("article")
        .filter({ hasText: "当地勝率" })
        .first();
      await expect(card).toContainText("1号艇の今日: —（当地の記録なし）");
    });

    test("類似レースの全項目表で、展示で決まる項目の「全レースで同じ割合」は出さない", async ({
      page,
    }) => {
      await setup(page);
      await openAiTab(page);
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
      await openAiTab(page);
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
      await openAiTab(page);
      const section = sectionOf(page);
      await section.getByRole("tab", { name: "類似レース" }).click();
      await expect(section).toContainText("（結果が無い1件を除く）");
    });
  });
});
