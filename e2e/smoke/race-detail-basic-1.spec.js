// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";
import { openFixedRaceBasicTab, openFixedRaceBeforeStart } from "./helpers.js";

test.describe("レースページ再設計（BOA-168）", () => {
  test("発走前のレースでデータ出走表と「AI予想」タブ（展開予測/イン崩れ）が表示される（BOA-346）", async ({
    page,
  }) => {
    // AIデータ分析（展開予測/イン崩れ）は未来志向のUIのため結果確定済みレースでは
    // 表示しない仕様（2026-08-14）。固定のレースを発走前の状態で開く（BOA-445）
    await openFixedRaceBeforeStart(page);

    // データ出走表が主役として表示される（基本情報タブがデフォルト）
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // AIデータ分析（展開予測/イン崩れ/出現パターン）はBOA-346で独立タブ「AI予想」に
    // 格上げされた（旧AiAnalysisSectionの折りたたみは廃止、タブ選択自体が開閉を兼ねる）
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
    await expect(page.locator(".prediction-result")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".ai-analysis-header")).toHaveCount(0);
  });

  test("この会場の枠番別傾向パネルがデフォルト展開で表示され、折りたたみ操作ができる（race-detail-analysis-integration）", async ({
    page,
  }) => {
    // 結果確定済みのレースでも基本情報タブには同じパネルが出る（BOA-445）
    await openFixedRaceBasicTab(page);

    const panel = page.locator(".venue-tendency-panel");
    await expect(panel).toBeVisible({ timeout: 15000 });

    // デフォルト展開: 4行（決まり手/トップスタート率/負け決まり手/展示最速転換率）×6艇
    const content = panel.locator(".vtp-content");
    await expect(content).toBeVisible({ timeout: 10000 });
    await expect(panel.locator(".vtp-table tbody tr")).toHaveCount(4);
    await expect(panel.locator(".vtp-table thead th.vtp-boat-th")).toHaveCount(
      6,
    );

    // ヘッダクリックで折りたたみ、再クリックで再展開できる
    await panel.locator(".vtp-header").click();
    await expect(content).toHaveCount(0);
    await panel.locator(".vtp-header").click();
    await expect(panel.locator(".vtp-content")).toBeVisible({
      timeout: 10000,
    });
  });

  test("分析ツール6コンポーネントの埋め込みセクションがデフォルト閉で並び、開くと会場/レース選択プルダウン無しで実データが表示される（race-detail-analysis-integration FR-3〜9）", async ({
    page,
  }) => {
    // 結果確定済みのレースでも基本情報タブには同じ6セクションが出る（BOA-445）
    await openFixedRaceBasicTab(page);

    // 「モーター調子」はBOA-308でアコーディオンからモータ情報タブへ昇格し、
    // 重複表示を避けてアコーディオン版が撤去された（PredictionPanel.jsx冒頭の
    // コメント参照）。テストが7個のまま取り残されていたが、当日の未終了レースを
    // 探すヘルパーが常にfalseを返して無言でskipしていたため検知できていなかった
    const sections = page.locator(".embedded-analysis-section");
    await expect(sections).toHaveCount(6);

    const expectedTitles = [
      "選手調子",
      "STのズレ",
      "展示タイム推移",
      "選手別決まり手傾向",
      "回収率分析",
      "超展開データ",
    ];
    for (const title of expectedTitles) {
      await expect(sections.filter({ hasText: title })).toHaveCount(1);
    }

    // デフォルトは全セクション閉（中身は一切マウントされない）
    await expect(page.locator(".eas-content")).toHaveCount(0);

    // 1つずつ開いて、会場/レース選択プルダウンが無いこと・中身が表示されることを確認し、
    // 閉じたら再びアンマウントされることを確認する
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      const section = sections.nth(i);
      await section.locator(".eas-header").click();
      const content = section.locator(".eas-content");
      await expect(content).toBeVisible({ timeout: 15000 });
      await expect(content.locator(".controls-section")).toHaveCount(0);
      await expect(content.locator("h2")).toHaveCount(0);
      await section.locator(".eas-header").click();
      await expect(content).toHaveCount(0);
    }
  });

  test("過去日・結果確定済みレースのモータ情報タブが、無関係な「本日開催」レースにフォールバックせず当該レースのデータを表示する（race-detail-analysis-integration 回帰確認）", async ({
    page,
  }) => {
    // 過去日は「本日開催中の会場」一覧に含まれないため、embedded対応前は
    // getVenuesWithTodaysRaces()のフォールバック（list[0]）により無関係なレースの
    // データが無警告表示されていた。DataRaceTableの選手名と、モータ情報タブ
    // （BOA-308、既存のMotorConditionChartをタブ化したもの）が表示する
    // 選手名が一致することを確認する
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page).toHaveURL(/\/race\/2026-08-11-\d{2}-\d{2}$/);

    // 結果確定済みレースはタブ構成（BOA-305〜312）で「結果」タブがデフォルト
    // 表示される。DataRaceTable等の分析ツール群は結果タブ表示中は隠れる
    // （フィードバック#7）ため、基本情報タブへ切り替えてから確認する
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    // ☆ボタン（BOA-1270）の文字を拾わないよう、名前の要素（リンクまたは名前の span）だけを読む
    const expectedNames = (
      await page
        .locator('.drt-name-th > a, .drt-name-th > span[translate="no"]')
        .allTextContents()
    ).map((n) => n.trim());
    expect(expectedNames.length).toBe(6);

    // モータ情報タブはアコーディオンではなく独立タブのため、クリックで
    // 直接切り替わる（BOA-308でEmbeddedAnalysisSectionのアコーディオン版は撤去済み）
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    const motorSection = page.locator(".race-tabs-panel");
    await expect(motorSection.locator(".motor-ranking-row")).toHaveCount(6, {
      timeout: 15000,
    });
    const actualNames = (
      await motorSection
        .locator(".motor-ranking-row td:nth-child(2)")
        .allTextContents()
    ).map((n) => n.trim());
    expect(new Set(actualNames)).toEqual(new Set(expectedNames));
  });

  test("出現パターンプレビューの出現率が、本命艇が1着だった場合を分母にした値になっている（回帰確認）", async ({
    page,
  }) => {
    // 修正前は会場全体のレース数を分母にしており、本命艇の勝率が高い会場ほど
    // 実際より小さい数値になっていた（例: 勝率55%の艇なら実際の約半分）。
    // 各行の「出現回数 ÷ (出現率/100)」で逆算した分母が、同じ艇の行同士で
    // ほぼ一致することを確認する（全行が同じ分母＝該当艇の1着回数を使っている証拠）
    //
    // プレビューは発走前のレースのAI予想タブにだけ出る。固定のレースを発走前の状態で
    // 開くので、タブ・プレビュー・2行以上が出ることは前提として確かめる
    // （当日のレースを探していた頃は、出ないレースに当たると skip していた。BOA-445）
    await openFixedRaceBeforeStart(page);

    // AI予想タブ（本命艇の予想確定後に描画される、BOA-346で独立タブ化）の読み込みを待つ
    await page
      .locator(".race-tabs-btn", { hasText: "AI予想" })
      .click({ timeout: 20000 });
    await expect(page.locator(".prediction-result")).toBeVisible({
      timeout: 15000,
    });

    await page
      .locator(".expand-button", {
        hasText: "コースが1着の場合の出現パターン",
      })
      .click({ timeout: 15000 });

    const rows = page.locator(".pattern-table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    const impliedDenominators = [];
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const count = Number(
        (await row.locator("td.count").textContent()).trim(),
      );
      const rateText = (
        await row.locator("td.probability").textContent()
      ).trim();
      const rate = Number(rateText.replace("%", ""));
      expect(rate).toBeGreaterThan(0);
      impliedDenominators.push(count / (rate / 100));
    }

    const maxDenom = Math.max(...impliedDenominators);
    const minDenom = Math.min(...impliedDenominators);
    // 丸め誤差を許容しつつ、全行が同じ分母を使っていることを確認する
    expect(maxDenom - minDenom).toBeLessThan(maxDenom * 0.05);
  });

  test("過去日付ページで結果確定レースを選ぶと結果タブに着順・配当・決まり手が表示され、展開予測検証はAI予想タブに表示される（BOA-312/BOA-346）", async ({
    page,
  }) => {
    // unifiedモデル運用開始日（2026-08-11〜）以降の日付を使う。
    // それより前の日付はAI予想（topPick）が存在せず.race-resultが出ない仕様のため
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    // 結果確定済みレースはタブ構成（BOA-305〜312）で「結果」タブがデフォルト表示される。
    // BOA-346で展開予測検証・イン崩れ指数の答え合わせは「AI予想」タブへ移設されたため、
    // 結果タブ（RaceResult）は着順・配当・決まり手のみのシンプルな内容になった
    await expect(
      page.locator(".race-tabs-btn.is-active", { hasText: "結果" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".race-result")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".race-result .turn-pattern-list")).toHaveCount(
      0,
    );

    // データ出走表等の分析ツール群は結果タブ表示中は隠れる（フィードバック#7）が、
    // 基本情報タブに切り替えれば過去日付でも表示されることを確認する
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });

    // 展開予測検証（実測精度）・イン崩れ指数の答え合わせはAI予想タブに移設されている（BOA-346）
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
    await expect(page.locator(".turn-pattern-list")).toBeVisible({
      timeout: 20000,
    });

    // 「データで振り返る」（RaceReview）はBOA-312で撤去済み。的中/不的中の検証は
    // 上記のAI予想タブ（RaceAiPredictionTab）に統合されている
    await expect(page.locator(".race-review")).toHaveCount(0);
    // 旧AiAnalysisSection（折りたたみ）はBOA-346で独立タブ化に伴い撤去済み
    await expect(page.locator(".ai-analysis-header")).toHaveCount(0);
  });

  test("この日の水面傾向が結果タブ（払戻の下）と会場ページに出て、直前情報タブからは消えている（BOA-222 / phase a T4-1〜T4-4）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    // 結果確定済みレースは「結果」タブが既定で開く
    await expect(page.locator(".vds-card")).toBeVisible({ timeout: 25000 });
    // 見出し・注記は開催日基準（過去日のレースで「本日」と書かない）
    await expect(page.locator(".vds-heading")).not.toContainText("本日");
    await expect(page.locator(".vds-note")).not.toContainText("本日");
    // ラベルは実装（艇番基準）に合わせた「1号艇の逃げ率」。「イン逃げ率」ではない
    await expect(page.locator(".vds-stat-label")).toHaveCount(3);
    await expect(page.locator(".vds-card")).toContainText("1号艇の逃げ率");
    await expect(page.locator(".vds-card")).not.toContainText("イン逃げ率");

    // 払戻より後ろ（結果タブの最下部）に置かれている
    const cardAfterPayout = await page.evaluate(() => {
      const root = document.querySelector(".race-result");
      const payout = root?.querySelector(".rr-payout-table");
      const card = root?.querySelector(".vds-card");
      if (!payout || !card) return null;
      return Boolean(
        payout.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(cardAfterPayout).toBe(true);

    // 内訳は折りたたみ。開くと決まり手別・進入コース別が出る
    await expect(page.locator(".vds-detail")).toHaveCount(0);
    await page.locator(".vds-detail-toggle").click();
    await expect(page.locator(".vds-detail")).toBeVisible();
    expect(await page.locator(".vds-badge").count()).toBeGreaterThan(0);

    // 直前情報タブからは消えている（移設元のクラスも残っていない）
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    await expect(page.locator(".rbi-card").first()).toBeVisible({
      timeout: 25000,
    });
    await expect(page.locator(".vds-card")).toHaveCount(0);
    await expect(page.locator(".rbi-stat-grid")).toHaveCount(0);

    // 会場ページ（過去日）にも出る。こちらは「このレース」の節を出さない
    await page.goto("/races/2026-08-11/5");
    await expect(page.locator(".vds-card")).toBeVisible({ timeout: 25000 });
    await expect(page.locator(".vds-lede")).not.toContainText("このレース");
  });

  // 枠別情報タブはデータ出走表を隠すため、上のテストだけでは
  // 「タブ切替ストリップ・データ出走表がページ全体をはみ出させない」ことを
  // 検証できていなかった。最小幅の320pxで基本情報タブも押さえる
  test("基本情報タブでも320px幅でページ全体が横スクロールしない（横スクロールはコンテナ内に閉じる）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();

    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 20000,
    });

    // タブストリップ・データ出走表は自前のスクロールコンテナの中で横スクロールする
    for (const selector of [".race-tabs-bar", ".drt-table-wrapper"]) {
      const overflowX = await page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).overflowX);
      expect(["auto", "scroll"]).toContain(overflowX);
    }

    const docOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
  });
});
