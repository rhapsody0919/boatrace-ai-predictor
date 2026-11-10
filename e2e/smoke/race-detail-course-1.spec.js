// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";

test.describe("レースページ再設計（BOA-168）", () => {

  test("枠別情報タブの既定ビューが今日の想定コース×3指標で、全コース比較は折りたたみから開ける（BOA-307 / phase a T3-1）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    // 他のタブ同様、枠別情報タブ表示中はデータ出走表等の分析ツール群を隠す
    await expect(page.locator(".data-race-table")).toHaveCount(0);

    await expect(page.locator(".rwit-boat-chip")).toHaveCount(6);

    // 既定ビュー: 今日の想定コース1本 × 1着率/2連対率/3連対率 + 走数
    // 当社データの6行（全期間〜SG・G1）の前に、公式の「直近3期」の1行（BOA-1295）
    await expect(page.locator(".rwit-today-row")).toHaveCount(7, {
      timeout: 20000,
    });
    await expect(
      page.locator(".rwit-today-row").first().locator("th"),
    ).toHaveText("直近3期");
    await expect(page.locator(".rwit-today-metric-th")).toHaveCount(3);
    await expect(page.locator(".rwit-today-course")).toContainText("1コース");
    // 枠なり進入の仮定であることを明記する（進入は本番まで確定しない）
    await expect(page.locator(".rwit-today-assumption")).toContainText(
      "枠なり",
    );
    // 当サイトの全期間を公式の今期と区別する（BOA-733）。
    await expect(
      page.getByRole("button", { name: "全期間" }).first(),
    ).toBeVisible();
    await expect(page.locator(".rwit-caveat").first()).toContainText(
      "「全期間」",
    );
    await expect(page.locator(".rwit-caveat").first()).not.toContainText(
      "「今期」",
    );
    // 「全期間」の注記は実データの開始月を書く。取得窓（730日）だけを見て
    // 「過去2年分」と言わない（BOA-503。実データは2025年12月以降）
    await expect(page.locator(".rwit-caveat").first()).toContainText(
      "2025年12月以降、最大過去2年",
    );
    await expect(page.locator(".rwit-caveat").first()).not.toContainText(
      "過去2年分",
    );

    // 指標チップは既定では出さない（既定ビューは3指標を同時に出すため不要）。
    // toBeHidden()は要素が存在しない場合も通るため、存在することも確かめる
    await expect(page.locator(".rwit-metric-row")).toHaveCount(1);
    await expect(page.locator(".rwit-metric-row")).toBeHidden();

    // 行をタップすると直近10走の帯（RecentRunsBar）が開く
    await page.locator(".rwit-today-label-button").first().click();
    await expect(page.locator(".rwit-expanded")).toBeVisible();
    await expect(page.locator(".rrb-item").first()).toBeVisible({
      timeout: 20000,
    });
    expect(await page.locator(".rrb-item").count()).toBeLessThanOrEqual(10);
    // ST順位を「(N位)」形式で併記する（phase a T3-4）。STが取れている走には
    // 必ず順位が付き、STが無い走（「—」）には付かない。
    // 先頭の1走だけを見ると、本番データの補完で直近10走の窓がずれたときに
    // 先頭がSTの無い走になって落ちる（2026-10-01、5/23 の進入コースが後から
    // 入り、窓の先頭が ST の無い 3/27 になった）
    const stCells = await page.locator(".rrb-item").evaluateAll((items) =>
      items.map((el) => ({
        st: el.querySelector(".rrb-st")?.textContent ?? "",
        rank: el.querySelector(".rrb-st-rank")?.textContent ?? "",
      })),
    );
    const withSt = stCells.filter((c) => /^\.\d{2}$/.test(c.st));
    expect(withSt.length).toBeGreaterThan(0);
    for (const c of withSt) expect(c.rank).toMatch(/^\(\d位\)$/);
    for (const c of stCells.filter((c) => c.st === "—"))
      expect(c.rank).toBe("");
    await expect(
      page.locator(".rrb-st-rank", { hasText: /^\(\d位\)$/ }).first(),
    ).toBeVisible();

    // もう一度タップすると閉じる
    await page.locator(".rwit-today-label-button").first().click();
    await expect(page.locator(".rwit-expanded")).toHaveCount(0);

    // 選手を切り替えると想定コースも移る
    await page.locator(".rwit-boat-chip").nth(2).click();
    await expect(page.locator(".rwit-today-course")).toContainText("3コース", {
      timeout: 20000,
    });
    // 履歴の取得を待つ（新人等で0件だと以降のセレクタが消え、原因の分からない
    // タイムアウトになるため、ここで表の存在を確かめて切り分けを効かせる）
    await expect(page.locator(".rwit-today-table")).toBeVisible({
      timeout: 20000,
    });

    // 全コース比較は既定で閉じており、折りたたみを開くと6×6のグリッドが出る
    await expect(page.locator(".rwit-grid")).toHaveCount(1);
    await expect(page.locator(".rwit-grid")).toBeHidden();
    await page.locator(".rwit-fold-summary").click();
    await expect(page.locator(".rwit-grid")).toBeVisible();
    await expect(page.locator(".rwit-grid tbody tr")).toHaveCount(6);
    await expect(
      page.locator(".rwit-grid thead th.rwit-grid-course-th"),
    ).toHaveCount(6);
    // 指標チップは折りたたみの中にあり、切り替えてもグリッドの形は維持される
    await expect(page.locator(".rwit-metric-row")).toBeVisible();
    await page.locator(".rwit-chip", { hasText: "3連対率" }).click();
    await expect(page.locator(".rwit-grid tbody tr")).toHaveCount(6);

    // 決まり手傾向カード（会場全体の全艇合算）が表示される
    await expect(page.locator(".rwit-tech-row").first()).toBeVisible({
      timeout: 20000,
    });

    // ページ全体は横スクロールしない（横スクロールはグリッド内だけに閉じる）
    const docOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });

  test("枠別情報タブの既定ビューは韓国語でも全期間を公式の今期と区別する（BOA-733）", async ({
    page,
  }) => {
    await page.goto("/ko/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "번호별 정보" }).click();
    await expect(
      page.getByRole("button", { name: "전체 기간" }).first(),
    ).toBeVisible();
    const caveat = page.locator(".rwit-caveat").first();
    await expect(caveat).toContainText("'전체 기간'");
    await expect(caveat).not.toContainText("이번 기'");
  });

  test("枠別情報タブのST考察カードが、同コース・同級別の平均との差つきで表示される（phase a T3-2）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    // 094（st_course_baseline）が未適用の環境ではセクションごと出さない設計なので、
    // カードが出ない場合はこのテストをスキップする（本番・CIは適用済み）
    const card = page.locator(".rsc-card");
    await card.waitFor({ state: "visible", timeout: 25000 });

    // 5行（級別/走数/安定率/抜出/出遅率）× 6艇
    await expect(page.locator(".rsc-grid tbody tr")).toHaveCount(5);
    await expect(page.locator(".rsc-grid thead th.rsc-boat-th")).toHaveCount(6);

    // 集計期間が実測値で表示される（「直近1年」のような固定文言にしない）
    await expect(
      page.locator(".rsc-window:not(.rsc-own-window)"),
    ).toContainText(/\d{4}-\d{2}-\d{2}/);

    // 差が表示され、方向（良い/悪い）で色分けされる。
    // どちらの向きが何件出るかは対象レースの選手次第なので、件数の内訳は問わない
    // （本番Supabase直結でDB状態に左右されるため）
    const diffCount = await page.locator(".rsc-diff").count();
    expect(diffCount).toBeGreaterThan(0);
    const colored =
      (await page.locator(".rsc-diff.is-better").count()) +
      (await page.locator(".rsc-diff.is-worse").count());
    expect(colored).toBeGreaterThan(0);

    // 抜出は実回数で出し、率（%）は画面に出さない。1コースは「—」
    const breakoutRow = page.locator(".rsc-grid tbody tr").nth(3);
    await expect(breakoutRow).toContainText("回");
    await expect(breakoutRow).not.toContainText("%");
    await expect(breakoutRow.locator("td").first()).toContainText("内側なし");
  });

  test("グレード・期間で絞り込むと、指標のチップは「勝率」ではなく「1着率」になる（BOA-585）", async ({
    page,
  }) => {
    // 絞り込み中のバーは自社集計の1着になった割合（%）で、公式の勝率（点）ではない
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    const chips = page.locator(".rbit-chip");
    await expect(chips.first()).toHaveText("勝率");
    await page.locator(".rbit-chip", { hasText: "一般戦" }).first().click();
    await expect(chips.first()).toHaveText("1着率");
    await expect(page.locator(".rbit-metric-caveat")).toContainText("1着率");
    // 絞り込み中は上のバーも自社集計なので、条件別の注記は「公式値とは一致しない」と書かない
    // （#1069 ファン評価2周目）
    await page.locator(".rbit-bar-row").first().click();
    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
    const note = page.locator(".rbit-conditions-note");
    await expect(note).toContainText("絞り込みにかかわらず全期間", {
      timeout: 25000,
    });
    await expect(note).not.toContainText("公式値");
  });

  test("得意会場のランキングにも、自社集計の1着率である旨を書く（#1069 ファン評価1周目）", async ({
    page,
  }) => {
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    await page.locator(".rbit-bar-row").first().click();
    await page.locator(".rbit-expanded-tab", { hasText: "得意会場" }).click();
    await expect(page.locator(".rbit-venue-metric-label")).toHaveText(
      "1着率のランキング",
      { timeout: 25000 },
    );
    await expect(page.locator(".rbit-venue-note")).toContainText("当社集計");
  });

  test("条件別の「波5cm以上」は江戸川の走を除き、その旨を注記する（BOA-584）", async ({
    page,
  }) => {
    // 江戸川は波高を5cm刻みで記録し、静水面でも5cm。全国合算に混ぜると「荒れ」が水増しされる。
    // 2026-09-21 戸田5R の2号艇は、取得できる期間に江戸川の走がある
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    await page.locator(".rbit-bar-row").nth(1).click();
    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
    const how = page.locator(".rbit-conditions-how");
    await expect(how).toBeVisible({ timeout: 25000 });
    await how.locator("summary").click();
    await expect(how).toContainText(
      /「波5cm以上」からは、江戸川の走（\d+走）を除いています/,
    );
  });

  test("枠別情報の直近走の帯は、各走の月日を出し、押すと会場・Rが出る。見出しは行の条件と実際の走数（BOA-604）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-29 戸田12R の1号艇。以前は見出しが行によらず「直近10走」、日付・会場は
    // title 属性（raceId のまま）にしか無く、タッチ端末では出なかった
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    const btn = page.getByRole("button", { name: /直近1ヶ月/ }).first();
    await btn.waitFor({ timeout: 30000 });
    await btn.click();
    const items = page.locator(".rrb-strip").first().locator(".rrb-item");
    await expect(items.first()).toBeAttached({ timeout: 30000 });
    const count = await items.count();
    // 見出しに行の条件と実際の走数
    await expect(page.locator(".rwit-expanded-note").first()).toContainText(
      `直近1ヶ月で`,
    );
    await expect(page.locator(".rwit-expanded-note").first()).toContainText(
      `直近${count}走`,
    );
    // タイルのいちばん上に月日
    await expect(items.first().locator(".rrb-date")).toHaveText(/^\d+\/\d+$/);
    // 最初は最新（右端）を選び、帯の下に会場・R を出す。左端を押すと切り替わる
    const detail = page.locator(".rrb-detail").first();
    const lastId = await items.last().getAttribute("data-race-id");
    await expect(detail).toContainText(
      `${Number(lastId.slice(5, 7))}/${Number(lastId.slice(8, 10))} `,
    );
    await expect(detail).toContainText(`${Number(lastId.slice(14, 16))}R`);
    const firstId = await items.first().getAttribute("data-race-id");
    await items.first().click();
    await expect(detail).toContainText(
      `${Number(firstId.slice(5, 7))}/${Number(firstId.slice(8, 10))} `,
    );
    await expect(items.first()).toHaveAttribute("aria-pressed", "true");
  });
});
