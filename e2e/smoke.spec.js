import {
  test,
  expect,
  applyCookieConsent,
  applyRecording,
  E2E_MODE,
  fetchRecorded,
} from "./fixtures.js";
import {
  ANALYSIS_FIXED_RACE_ID,
  gotoAnalysisTabOnFixedDate,
  openFixedRaceBasicTab,
  openFixedRaceBeforeStart,
} from "./smoke/helpers.js";

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

  // 結果未確定レースだけに出るAI用コピーバナーは、320px幅で
  // 「コピーボタン + キャッチコピーバッジ」が横一列に収まらずページ全体を
  // 16pxはみ出させていた（AiCopyBanner.jsx）。上の確定済みレースのテストでは
  // バナーが描画されないため、未確定レース側も押さえる
  test("基本情報タブの結果未確定レース（AI用コピーバナーあり）でも320px幅でページ全体が横スクロールしない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    // バナー背後のpingリングはCSS transformでスクロール可能領域に寄与するため、
    // 任意のアニメーションフレームで計測しないよう止める
    // （AiCopyBannerはuseReducedMotionを見てリング自体を描画しない）
    await page.emulateMedia({ reducedMotion: "reduce" });

    await openFixedRaceBeforeStart(page);

    // 未終了レースを開けた以上バナーは必ず出る。出ない場合は退行なので
    // スキップにせず失敗させる（バナーが消えると本検証が無言で骨抜きになるため）
    await expect(page.locator(".ai-copy-banner")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".race-tabs-btn.is-active")).toHaveText(
      "基本情報",
    );
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 20000,
    });

    // バナー自身が親からあふれていないこと（この修正が効いていることの直接確認）
    const bannerOverflow = await page
      .locator(".ai-copy-banner")
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(bannerOverflow).toBeLessThanOrEqual(1);

    const docOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(1);
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

  test("基本情報タブのバー展開に「条件別」タブと前期成績が出る（phase a T5-2/T5-2b）", async ({
    page,
  }) => {
    // f_count が埋まっている日（2026-09-21以降）の確定レースを直接開く。
    // 「F持ち時」「F無し時」の行は過去の走のF数に依存するため、
    // 行そのものの存在（9行）だけを見て値は問わない
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    // バーをタップすると詳細が開き、タブは3つ（直近10走/得意会場/条件別）。
    // 「今節」は6艇横断が主役になったのでレース単位の独立タブへ移した
    await page.locator(".rbit-bar-row").first().click();
    await expect(page.locator(".rbit-expanded-tab")).toHaveCount(3);

    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();

    // 行は条件ごと（全国/当地/一般戦/SG・G1/初日/最終日/波5cm以上/F持ち/Fなし）。
    // ナイターの行は出さない（開催時間帯を取得していないため）。
    // n=0 の行は畳むので（BOA-432）、この選手は SG・G1 が消えて8行になる。
    // 行数を直に固定するとn=0の有無で壊れるため、ラベルの有無で確かめる
    const rows = page.locator(".rbit-conditions-table tbody tr");
    await expect(rows.first()).toContainText("全国", { timeout: 25000 });
    const table = page.locator(".rbit-conditions-table");
    for (const label of [
      "全国",
      "当地",
      "一般戦",
      "初日",
      "最終日",
      "波5cm以上",
      "F持ち",
      "Fなし",
    ]) {
      await expect(table).toContainText(label);
    }
    // 出走のある条件しか出さない（この選手はSG・G1を走っていない）
    await expect(table).not.toContainText("SG・G1");

    // 上のバー（公式値）と数字が一致しないことを明記する
    await expect(page.locator(".rbit-conditions-note")).toContainText(
      "一致しません",
    );
    // 自社集計の勝率は1着になった割合（%）なので「1着率」と呼ぶ。下の前期欄の
    // 公式の「勝率」（点）と同じ名前で並べない（BOA-585）
    await expect(page.locator(".rbit-conditions-note")).toContainText(
      "条件ごとの1着率",
    );
    // 「前期」は指標の列に混ぜず、算出期間つきの別枠で出す（単位が点のため）
    await expect(page.locator(".rbit-period-heading")).toContainText(
      /\d{4}\/\d{2}\/\d{2}〜\d{4}\/\d{2}\/\d{2}/,
    );
    await expect(page.locator(".rbit-period-heading")).not.toContainText(
      /\d{4}-\d{2}-\d{2}/,
    );
    await expect(page.locator(".rbit-period-values")).toContainText("勝率");
    // 前期の横に出走表の値（上のバーの既定と同じ公式値）と差を添える（BOA-439）。
    // 平均STは出走表の値が無いので差を出さない。
    // ファン評価で出た3点を固定する: 出走表の勝率は期替わりで数え直されないので
    // 「今期」と呼ばない／バーを当地にしても全国のままなので「全国」と書く／
    // 差の向きを「前期から」で示す。2連対率の差はポイント差なので pt
    const periodDiffs = page.locator(".rbit-period-diff");
    await expect(periodDiffs.first()).toHaveText(
      /^（出走表・全国 \d+\.\d{2}、前期から[+−±]\d+\.\d{2}）$/,
    );
    await expect(periodDiffs.nth(1)).toHaveText(
      /^（出走表・全国 \d+\.\d%、前期から[+−±]\d+\.\dpt）$/,
    );
    await expect(page.locator(".rbit-period-note")).toHaveCount(0);
    // 前期の優出・優勝と、前期を含む直近2年（4期）の合計（BOA-326）。
    // 範囲は期の定義から決まる（レース日の前期の終わり〜その2年前の5月）
    const finals = page.locator(".rbit-period-finals");
    await expect(finals).toContainText(/優出 \d+回/);
    await expect(finals).toContainText(/優勝 \d+回/);
    await expect(page.locator(".rbit-period-recent")).toHaveText(
      /^直近2年（\d{4}\/(05|11)〜\d{4}\/(04|10)）優出 \d+回・優勝 \d+回$/,
    );

    // この表が全コース込みであることと、今日の枠での走数を常時出す
    // （ボートレースファンのレビュー指摘A: 外枠専業の選手と枠が均等に回る選手で
    //   同じ数字の意味が正反対になり、素直に読むと今日の枠と逆に評価してしまう）
    await expect(page.locator(".rbit-conditions-caveat").first()).toContainText(
      "全コース込み",
    );
    await expect(page.locator(".rbit-conditions-caveat").first()).toContainText(
      /今日と同じ\d枠での出走は過去\d+走/,
    );
    // 初日・最終日は他行と母数の期間が違う（race_conditions は 2026-02 以降）。
    // 波・F行と同じく、判定できた走数を注記に出す（BOA-499）
    await expect(
      page
        .locator(".rbit-conditions-caveat")
        .filter({ hasText: "母数が他の行と違います" }),
    ).toContainText(/初日は\d+走/);

    // F持ち時・F無し時は勝率だけだと「Fを持っている方が走る」と読めるため、
    // 指標が勝率でも平均STを併記する（同レビュー指摘C）
    await expect(page.locator(".rbit-conditions")).toContainText(
      /F持ちの平均ST .+／Fなし/,
    );

    // 毎回は要らない注記（最終日の構造差・母数が違う行）は折りたたむ。
    // 開くまで本文は出ない（同レビュー指摘B）
    // 閉じている <details> の中身はDOMには在るので、テキストではなく
    // 表示状態で見る
    const how = page.locator(".rbit-conditions-how");
    await expect(how).toBeVisible();
    await expect(how.locator("p").first()).toBeHidden();
    await how.locator("summary").click();
    await expect(how.locator("p").first()).toBeVisible();
    await expect(how).toContainText("最終日は優勝戦を含み");
    await expect(how).toContainText("母数が他の行と違います");

    // 期が替わって3か月は差を出さない（ファン評価2周目）。出走表の勝率は期の区切りで
    // 数え直されず、5月の値の大半は前期と同じ期間の成績のため
    await page.goto("/race/2026-05-02-02-04");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await page.locator(".rbit-bar-row").nth(1).click();
    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
    await expect(page.locator(".rbit-period-diff").first()).toHaveText(
      /^（出走表・全国 \d+\.\d{2}）$/,
      { timeout: 25000 },
    );
    await expect(page.locator(".rbit-period-note")).toContainText(
      "2026/08/01以降のレースで出します",
    );

    // 英語の長い文言が375pxで枠からはみ出して切れない（ファン評価3周目。
    // 括弧を折り返し禁止にしていたときは右へ32pxはみ出していた）
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "Basic Info" }).click();
    await page.locator(".rbit-bar-row").first().click();
    await page.locator(".rbit-expanded-tab").nth(2).click();
    await expect(page.locator(".rbit-period-diff").nth(1)).toBeVisible({
      timeout: 25000,
    });
    await expect(page.locator(".rbit-period-values")).toContainText(
      /Win rate \d+\.\d{2}/,
    );
    await expect(page.locator(".rbit-period-values")).not.toContainText(
      "Win pts",
    );
    const overflow = await page.evaluate(() => {
      const box = document
        .querySelector(".rbit-period")
        .getBoundingClientRect();
      return [...document.querySelectorAll(".rbit-period-diff")].map(
        (e) => e.getBoundingClientRect().right - box.right,
      );
    });
    for (const px of overflow) expect(px).toBeLessThanOrEqual(0.5);
  });

  test("勝率が全行1%未満に潰れる選手には3連対率への導線を出す（phase a T5-2、ファン視点レビュー指摘D）", async ({
    page,
  }) => {
    // 2026-09-21 桐生10R の5号艇（登番3352）は直近2年183走のうち5・6枠が178走で
    // 1着率0.5%。勝率で見ると全行1%未満に潰れるが、3連対率にすると全国41.5%と差が出る
    await page.goto("/race/2026-09-21-01-10");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    await page.locator(".rbit-bar-row").nth(4).click();
    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
    // n=0 の行は畳むため行数は選手により変わる（BOA-432）。表が出ることだけ確かめる
    await expect(
      page.locator(".rbit-conditions-table tbody tr").first(),
    ).toContainText("全国", { timeout: 25000 });

    const zero = page.locator(".rbit-conditions-zero");
    await expect(zero).toContainText("1%未満");
    await zero.locator("button").click();

    // 3連対率に切り替わり、値が出て導線自体は消える
    await expect(
      page.locator(".rbit-chip.is-active", { hasText: "3連対率" }),
    ).toBeVisible();
    await expect(page.locator(".rbit-conditions-zero")).toHaveCount(0);
    await expect(
      page.locator(".rbit-conditions-table tbody tr").first(),
    ).not.toContainText("0.0%");
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

  test("直近走の帯は、事故の走を「外」でなく公式の記号で出し、明細の括弧にグレードを付ける（BOA-604 ファン評価1周目）", async ({
    page,
  }) => {
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    // 2号艇（長岡良也）の「SG・G1」: 2/7 住之江4R は公式で F（以前は着順の欄が「外」）。
    // 艇は上のチップで切り替える（SG・G1 のボタンは選んでいる艇の1つだけ）
    await page.locator(".rwit-boat-chip").nth(1).click({ timeout: 30000 });
    await page.getByRole("button", { name: /SG・G1/ }).click();
    const f = page.locator('.rrb-item[data-race-id="2026-02-07-12-04"]');
    await expect(f.locator(".rrb-rank")).toHaveText("F", { timeout: 30000 });
    await f.click();
    await expect(page.locator(".rrb-detail").first()).toContainText("F");
    await expect(page.locator(".rrb-detail").first()).not.toContainText("外");

    // 4号艇の「SG・G1」: 3/1 鳴門3R は G1 の「一般戦」。括弧にグレードを付けて、
    // 表の「一般戦」行（一般グレードの節）と混ざって読まれないようにする
    // 艇を替えても「SG・G1」の行は開いたまま（ファン評価2周目）なので、押し直さない
    await page.locator(".rwit-boat-chip").nth(3).click();
    const g = page.locator('.rrb-item[data-race-id="2026-03-01-14-03"]');
    await g.click({ timeout: 30000 });
    await expect(page.locator(".rrb-detail").first()).toContainText(
      "（G1 一般戦）",
    );
  });

  test("枠別情報で艇を切り替えても、開いていた行（当地など）の帯は開いたまま（BOA-604 ファン評価2周目）", async ({
    page,
  }) => {
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    // 6艇の表の期間の切り替え（BOA-1294）にも「当地」のボタンがあるので、1艇ずつの表に絞る
    await page.locator(".rwit-today-table").getByRole("button", { name: /当地/ }).click({ timeout: 30000 });
    const note = page.locator(".rwit-expanded-note").first();
    await expect(note).toContainText("当地で1コース");
    // 2号艇に切り替えると、同じ「当地」の行のまま2コースの帯になる（以前は閉じた）
    await page.locator(".rwit-boat-chip").nth(1).click();
    await expect(note).toContainText("当地で2コース");
    // 引き継いだ行をもう一度押すと閉じる
    await page.locator(".rwit-today-table").getByRole("button", { name: /当地/ }).click();
    await expect(page.locator(".rwit-expanded-note")).toHaveCount(0);

    // 引き継いだ先の艇で走数0の行（4号艇の「当地」）は閉じる。ボタンにならず閉じられない
    // 「直近0走」の帯だけが残っていた（ファン評価3周目）
    await page.locator(".rwit-boat-chip").nth(0).click();
    await page.locator(".rwit-today-table").getByRole("button", { name: /当地/ }).click();
    await expect(note).toContainText("当地で1コース");
    await page.locator(".rwit-boat-chip").nth(3).click();
    await expect(page.locator(".rwit-expanded-note")).toHaveCount(0);
  });

  test("枠別情報のコース別「直近1ヶ月」の帯は、表示どおり左が古く右が新しい（BOA-601）", async ({
    page,
  }) => {
    // 2026-09-29 戸田12R の1号艇。以前は左端が最新の 9/29 12R、右端が 9/10 で、
    // 帯の上の「古い → 新しい」と逆だった
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    const btn = page.getByRole("button", { name: /直近1ヶ月/ }).first();
    await btn.waitFor({ timeout: 30000 });
    await btn.click();
    const items = page.locator(".rrb-strip").first().locator(".rrb-item");
    await expect(items.first()).toBeVisible({ timeout: 30000 });
    const ids = await items.evaluateAll((els) =>
      els.map((e) => e.dataset.raceId),
    );
    expect(ids.length).toBeGreaterThan(1);
    expect(ids).toEqual([...ids].sort());

    // 375pxでは1段の横スクロールで、開いたときに右端（最新）が見えている。
    // 以前は5本×2段に折り返し、最新の走が2段目の右下に回っていた（ファン評価1周目）
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    const mBtn = page.getByRole("button", { name: /全期間/ }).first();
    await mBtn.waitFor({ timeout: 30000 });
    await mBtn.click();
    const strip = page.locator(".rrb-strip").first();
    await expect(strip.locator(".rrb-item").first()).toBeAttached({
      timeout: 30000,
    });
    const view = await strip.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const items = [...el.querySelectorAll(".rrb-item")];
      const inView = (i) => {
        const r = i.getBoundingClientRect();
        return r.right <= box.right + 1 && r.left >= box.left - 1;
      };
      const rows = new Set(
        items.map((i) => Math.round(i.getBoundingClientRect().top)),
      );
      return { rows: rows.size, lastInView: inView(items[items.length - 1]) };
    });
    expect(view).toEqual({ rows: 1, lastInView: true });
    // 左に隠れた古い走の本数を軸に出す（3周目: 「古い」の下が一番古い走に見えた）
    await expect(page.locator(".rrb-hidden-older").first()).toHaveText(
      /左にあと\d+走/,
    );
    // 左端（いちばん古い走）までスクロールで戻れる
    const firstReachable = await strip.evaluate((el) => {
      el.scrollLeft = 0;
      const box = el.getBoundingClientRect();
      return (
        el.querySelector(".rrb-item").getBoundingClientRect().left >=
        box.left - 1
      );
    });
    expect(firstReachable).toBe(true);
    await expect(page.locator(".rrb-hidden-older")).toHaveCount(0);
    // 左端まで戻した状態で別の期間を押しても、右端（最新）が見える位置で開く
    // （ファン評価2周目: 件数と最新の走が同じ期間だと送り直されなかった）
    await page
      .getByRole("button", { name: /直近3ヶ月/ })
      .first()
      .click();
    await expect
      .poll(() =>
        page
          .locator(".rrb-strip")
          .first()
          .evaluate(
            (el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
          ),
      )
      .toBe(true);
  });

  test("基本情報の直近10走は新しい順で、同じ日の2走も R の大きい順に並ぶ（BOA-588・BOA-623）", async ({
    page,
  }) => {
    // 2026-09-29 戸田12R の1号艇: 9/27 と 9/28 に2走ずつある。以前は日付は古い順
    // なのに、同じ日の中だけ「12R → 5R」と新しい順になっていた
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const bar = page.locator(".rbit-bar-row").first();
    await bar.waitFor({ timeout: 30000 });
    await bar.click();
    const table = page.locator(".rrt-table").first();
    await table.waitFor({ timeout: 30000 });
    // 行は日付のリンク先（race_id = 日付＋会場＋R）で読む（BOA-623 で日付は月日だけになった）
    const ids = await table
      .locator(".rrt-row .rrt-link")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(-16)));
    // 同じ日が2走以上ある日が、少なくとも1つあること（前提の確認）
    const sameDay = ids.filter(
      (id, i) => i > 0 && id.slice(0, 10) === ids[i - 1].slice(0, 10),
    );
    expect(sameDay.length).toBeGreaterThan(0);
    // 表全体が「日付 → R」の新しい順（race_id の降順）。いちばん上が前走（BOA-623）。
    // 同じ日の2走で R の順が日の中だけ逆になる不具合（BOA-588）もこれで見る
    expect(ids).toEqual([...ids].sort().reverse());
  });

  test("直近10走は、表示中のレースより前の走を節の見出し行つきの6列で出し、PCでは中央に置く（BOA-623・BOA-602）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-30 児島7R の1号艇 西村拓也。以前はこのレース自身（9/30 7R）まで「直近」に入っていた
    await page.goto("/race/2026-09-30-16-07");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const bar = page.locator(".rbit-bar-row").first();
    await bar.waitFor({ timeout: 30000 });
    await bar.click();
    const table = page.locator(".rrt-table").first();
    await table.waitFor({ timeout: 30000 });
    const ids = await table
      .locator(".rrt-row .rrt-link")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(-16)));
    expect(ids.length).toBe(10);
    expect(ids.every((id) => id < "2026-09-30-16-07")).toBe(true);
    // 会場・レース名は節の見出し行に1回だけ（期間に年を出す）
    const groups = table.locator(".rrt-group");
    // 新しい順なので、最初の見出しは児島（今節）、次が徳山
    await expect(groups.first()).toContainText("児島");
    await expect(groups.nth(1)).toContainText("徳山");
    await expect(groups.nth(1)).toContainText("ダイヤモンドカップ");
    // 9/29 10R は5号艇・4コース進入で、ST は6艇中3番目。2着
    const r = table.locator("tr", {
      has: page.locator('a[href$="/race/2026-09-29-16-10"]'),
    });
    const cells = (await r.locator("td").allInnerTexts()).map((c) =>
      c.replace(/\s+/g, ""),
    );
    expect(cells.slice(2, 6)).toEqual(["5", "4", ".08(3)", "2"]);
    // いちばん上が前走（9/29 10R）。選手ページのレース一覧と同じ新しい順
    expect(ids[0]).toBe("2026-09-29-16-10");
    // 見出し行は年月だけ（日の範囲は節の開催期間に読まれるため出さない）
    await expect(groups.first()).toHaveText(/2026\/9$/);
    // ST の ( ) の意味を表の下に出す（選手ページにも同じ凡例が出る）
    await expect(page.locator(".rrt-legend").first()).toContainText(
      "6艇の中の順位",
    );
    // 単勝配当は 375px では出さない
    await expect(table.locator("th.rrt-pc")).toBeHidden();

    // PC では単勝配当を出し、表は中央に置く（左寄せで右に大きな空きを残さない）
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(table.locator("th.rrt-pc")).toBeVisible();
    const gap = await table.evaluate((tb) => {
      const t = tb.getBoundingClientRect();
      const w = tb.closest(".rrt-wrap").getBoundingClientRect();
      return { left: t.left - w.left, right: w.right - t.right };
    });
    expect(Math.abs(gap.left - gap.right)).toBeLessThanOrEqual(2);
  });

  test("英語版の375pxでも直近10走の着順が画面内に入る（BOA-623 ファン評価1周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-30 戸田9R: 決まり手「Makuri-zashi (Sweep & pass)」などの長い語で、表が
    // 414px（枠 293px）になった（1周目、1号艇）。順位不明の「Unplaced (rank unknown)」で
    // 着順の列が 190px になった（3号艇）。6艇とも見る
    await page.goto("/en/race/2026-09-30-02-09");
    await page.locator(".race-tabs-btn", { hasText: "Basic Info" }).click();
    await page.locator(".rbit-bar-row").first().waitFor({ timeout: 30000 });
    for (let i = 0; i < 6; i += 1) {
      const bar = page.locator(".rbit-bar-row").nth(i);
      await bar.click();
      const wrap = page.locator(".rrt-wrap").first();
      await wrap.waitFor({ timeout: 30000 });
      const w = await wrap.evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(w[0], `${i + 1}号艇`).toBeLessThanOrEqual(w[1]);
      // 決まり手・種別は1行に収める（2周目: 折り返すと「ウインウイン７」が1文字ずつ
      // 縦に並び、行の高さがばらばらになった）
      const subLines = await wrap
        .locator(".rrt-sub")
        .evaluateAll((els) =>
          els.map((el) =>
            Math.round(
              el.getBoundingClientRect().height /
                parseFloat(getComputedStyle(el).lineHeight || "12"),
            ),
          ),
        );
      // 決まり手（.rrt-technique）はハイフンで2行まで折り返す（3周目: 省略すると
      // 「Makuri…」で読めなかった）。括弧の説明は出さない
      expect(
        subLines.every((n) => n <= 2),
        `${i + 1}号艇`,
      ).toBe(true);
      const techniques = await wrap.locator(".rrt-technique").allInnerTexts();
      expect(
        techniques.some((x) => x.includes("(")),
        `${i + 1}号艇`,
      ).toBe(false);
      await bar.click();
    }
  });

  test("PC の選手ページのレース一覧で、種別を途中で折らず省略もしない（BOA-623 ファン評価2周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // 選手5250: 「予選特賞女子」「ＤＤ目玉女子」が「女 / 子」で折れていた
    await page.goto("/racer/5250");
    const table = page.locator(".racer-vc-race-list .rrt-table");
    await table.waitFor({ timeout: 30000 });
    const bad = await table
      .locator(".rrt-sub")
      .evaluateAll((els) =>
        els
          .filter(
            (el) =>
              el.scrollWidth > el.clientWidth + 1 ||
              el.getClientRects().length > 1 ||
              el.getBoundingClientRect().height >
                parseFloat(getComputedStyle(el).lineHeight) * 1.5,
          )
          .map((el) => el.textContent),
      );
    expect(bad).toEqual([]);
  });

  test("選手ページのレース一覧も、節の見出し行つきの6列で出す（BOA-623）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/racer/5250");
    const table = page.locator(".racer-vc-race-list .rrt-table");
    await table.waitFor({ timeout: 30000 });
    await expect(table.locator(".rrt-group").first()).toContainText("2026/");
    const wrap = await table.evaluate((tb) => {
      const w = tb.closest(".rrt-wrap");
      return [w.scrollWidth, w.clientWidth];
    });
    expect(wrap[0]).toBeLessThanOrEqual(wrap[1]);
  });

  test("結果タブに進入コースを出し、古い「精度確認中」の注記を出さない（BOA-625・BOA-811）", async ({
    page,
  }) => {
    // 2026-09-30 児島7R: 公式のスタート情報は 1-2-3-6-4-5。6号艇（峰竜太）は4コース
    await page.goto("/race/2026-09-30-16-07");
    const fig = page.locator(".rr-formation-svg");
    await expect(fig).toBeVisible({ timeout: 30000 });
    // スタート隊形の絵はコース順（上が1コース）。進入の並びの1行はこの絵に置き換えた（BOA-811）
    const order = () =>
      fig.evaluate((svg) =>
        [...svg.querySelectorAll("g[data-course]")].map((g) => g.dataset.boat),
      );
    expect(await order()).toEqual(["1", "2", "3", "6", "4", "5"]);
    // 前付けは枠なりより内側に入った6号艇だけ（押し出された4・5号艇には付けない）
    expect(
      await fig.evaluate((svg) =>
        [...svg.querySelectorAll("g[data-mae]")].map((g) => g.dataset.boat),
      ),
    ).toEqual(["6"]);
    const mine = page.locator(".rr-row", {
      has: page.locator(".rr-boat-chip", { hasText: /^6$/ }),
    });
    await expect(mine.locator(".rr-course")).toHaveText("4コース");
    // 枠番と違う進入（前付け）は強調する。枠なりの1号艇は強調しない
    await expect(mine.locator(".rr-course")).toHaveClass(/is-moved/);
    const one = page.locator(".rr-row", {
      has: page.locator(".rr-boat-chip", { hasText: /^1$/ }),
    });
    await expect(one.locator(".rr-course")).not.toHaveClass(/is-moved/);
    await expect(page.getByText("精度確認中")).toHaveCount(0);

    // 本番STの進入が無いレース（2026-09-14 徳山7R）は、Kファイルの進入で埋める（枠なり）。
    // 以前は「データがありません」と出していたが、公式には進入が出ている（ファン評価1周目）
    await page.goto("/race/2026-09-14-18-07");
    await expect(fig).toBeVisible({ timeout: 30000 });
    expect(await order()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  test("過去のレースの基本情報のバーは、そのレースより前の走で、期間もレースの日から数える（BOA-605）", async ({
    page,
  }) => {
    // 2026-09-26 津5R の1号艇（飯山泰）。このレースより前の直近1ヶ月（8/27〜）は24走。
    // 以前はこのレース自身と後日の走（5走）が入り、期間も今日から数えていた
    await page.goto("/race/2026-09-26-09-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await page.locator(".rbit-bar-row").first().waitFor({ timeout: 30000 });
    await page.locator("summary", { hasText: "期間で絞り込む" }).click();
    await page.locator(".rbit-chip", { hasText: "直近1ヶ月" }).click();
    await expect(page.locator(".rbit-bar-row").first()).toContainText("(n=24)");
  });

  test("今節タブ: en・zh-TW の375pxで6艇の表がカードからはみ出さず、必要得点に残りの走数を添える（BOA-596）", async ({
    page,
  }) => {
    // 以前は en で9px、zh-TW で20px、表がカードの右へはみ出していた
    // （列見出し「Score rate」「Series rank」と「第12名並列」「6.86（第34名）」が長い）
    await page.setViewportSize({ width: 375, height: 812 });
    for (const lang of ["en", "zh-TW"]) {
      await page.goto(`/${lang}/race/2026-09-26-13-04`);
      await page.locator(".race-tabs-btn").nth(3).click(); // 今節（基本情報・龍神ソナー・AI予想・今節）
      const table = page.locator(".rmt-compare");
      await table.waitFor({ timeout: 30000 });
      const over = await table.evaluate((t) => {
        const card = t.closest(".rmt-card") ?? t.parentElement;
        const right = card.getBoundingClientRect().right;
        return Math.max(
          ...[...t.querySelectorAll("tr")].map(
            (tr) => tr.getBoundingClientRect().right - right,
          ),
        );
      });
      expect(over).toBeLessThanOrEqual(0.5);
    }

    // 必要得点は今日の残りの予選ぶんを足した点数。早見は次の1走だけなので、
    // 2走残っていれば走数を添える（尼崎 2026-09-27 5R の塩田: 1着でも6.00で
    // 目安6.17に届かないのに、必要得点は17だけと出ていた）
    await page.goto("/race/2026-09-27-13-05");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const shiota = page
      .locator(".rmt-forecast-table tr")
      .filter({ hasText: "塩田" })
      .first();
    await expect(shiota.locator(".rmt-needed-runs")).toHaveText("今日2走で", {
      timeout: 30000,
    });
    // 以前は町田が6着でも色付きで、同じ行の「必要得点7（2走で）」と逆だった
    // （ファン評価1周目）
    const machida = page
      .locator(".rmt-forecast-table tr")
      .filter({ hasText: "町田" })
      .first();
    // 今日2走残る選手の行は色を付けない（2周目: 「7.00なのに色なし」と
    // 読まれた基準のずれをなくす）。1走だけの選手（浜野）は従来どおり
    await expect(machida.locator("td.is-in-border:not(.rmt-rate)")).toHaveCount(
      0,
    );
    // 走数は2行目に小さく出し、375pxで早見の3着まで最初の画面に入る
    await page.setViewportSize({ width: 375, height: 812 });
    const third = await page.locator(".rmt-forecast-scroll").evaluate((el) => {
      const th = el.querySelectorAll("thead th");
      const box = el.getBoundingClientRect();
      const cell = [...th].find((x) => /^3/.test(x.textContent.trim()));
      return cell ? cell.getBoundingClientRect().right - box.right : null;
    });
    expect(third).not.toBeNull();
    expect(third).toBeLessThanOrEqual(0.5);
  });

  test("今節タブのSTの前走は、直前の走がFならFと出し、Fを飛ばして1つ前の走のSTを出さない（BOA-597）", async ({
    page,
  }) => {
    // 2026-09-30 平和島11R: 古川誠之は同じ日の4RでF。以前は推移の右端と詳細が
    // 「前走 0.09」（9/29 11R の値）になっていた
    await page.goto("/race/2026-09-30-04-11");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const row = page.locator(".rmt-trend-row").filter({ hasText: "古川" });
    await expect(row.locator(".rmt-trend-last")).toHaveText("F", {
      timeout: 30000,
    });
    // 前走が F なので、1つ前の走に「前走」の大きい点（r=3.2）を付けない
    // （ファン評価1周目: 右端は F なのに大きい点が 0.09 の走に付いていた）
    await expect(row.locator('circle[r="3.2"]')).toHaveCount(0);
    const other = page.locator(".rmt-trend-row").filter({ hasNotText: "古川" });
    await expect(other.first().locator('circle[r="3.2"]')).toHaveCount(1);
    await row.click();
    await expect(page.locator(".rmt-spark-foot").first()).toContainText(
      "前走 F",
    );
    await expect(
      page.locator(".rmt-spark").first().locator('circle[r="3.2"]'),
    ).toHaveCount(0);
  });

  test("今節Fの選手は賞典除外として順位から外し、必要得点を出さない（BOA-587）", async ({
    page,
  }) => {
    // 2026-09-27 尼崎5R（4日目の予選）: 浜野孝志は前日9/26 4R（予選）でFを切っている。
    // 尼崎のこの節は公式の備考が無いので、今節Fから賞典除外と判定する
    await page.goto("/race/2026-09-27-13-05");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const hamano = page
      .locator(".rmt-compare tr")
      .filter({ hasText: "浜野" })
      .first();
    await hamano.waitFor({ timeout: 30000 });
    await expect(hamano.locator(".rmt-rank")).toHaveText("賞典除外（今節F）");
    // 得点率早見の必要得点も数字でなく賞典除外（以前は必要得点の数字を出していた）
    const forecast = page
      .locator(".rmt-forecast-table tr")
      .filter({ hasText: "浜野" })
      .first();
    await expect(forecast.locator(".rmt-needed")).toHaveText(
      "賞典除外（今節F）",
    );
    // 順位が無い（null）選手を「目安の中」と扱わない（ファン評価1周目 P0/P1）。
    // `null <= 18` が true になり、詳細に「準優の目安（18位）の中」、表の点線が
    // 浜野の下、早見の1着のセルが「届く」色になっていた
    await expect(hamano).not.toHaveClass(/is-in-border|is-border-edge/);
    await expect(forecast.locator("td.is-in-border")).toHaveCount(0);
    await hamano.click();
    await expect(page.locator(".rmt-detail-border")).not.toContainText("の中");
    await expect(page.locator(".rmt-detail-border")).toContainText("賞典除外");

    // 375pxの早見で、除外の文言1件のために必要得点の列が広がり、着順の列が
    // 画面外へ押し出されない（ファン評価2周目: 表幅398px／枠293px）
    await page.setViewportSize({ width: 375, height: 812 });
    const widths = await page
      .locator(".rmt-forecast-scroll")
      .evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(360);
  });

  test("予選が終わった後は、予選終了までのFだけで賞典除外を判定し、最終日のレースごとに順位が動かない（BOA-587）", async ({
    page,
  }) => {
    // 2026-09-24 桐生（Ｗ優勝戦の最終日）。8R の準優で武田光史がFを切っても、
    // 予選の順位は9/23で確定しているので、8R より後のレースでも人数は変わらない
    // （以前は 1〜8R が47人、9〜12R が45人になっていた）
    const totals = [];
    for (const r of ["03", "12"]) {
      await page.goto(`/race/2026-09-24-01-${r}`);
      await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
      const sub = page.locator(".rmt-sub").first();
      // Ｗ優勝戦で分けた節なので「同じ優勝戦をめざすのは◯人」と書く（BOA-660）
      await expect(sub).toContainText("同じ優勝戦をめざすのは", {
        timeout: 30000,
      });
      totals.push(
        await page.locator(".rmt-series-note, .rmt-sub").allInnerTexts(),
      );
    }
    // 予選が終わった後のレースでも、除外の選手の詳細に理由が出る（ファン評価2周目）。
    // 7R の大澤普司は 9/22（予選）でF
    await page.goto("/race/2026-09-24-01-07");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await page
      .locator(".rmt-compare tr")
      .filter({ hasText: "大澤" })
      .first()
      .click({ timeout: 30000 });
    await expect(page.locator(".rmt-detail-border")).toContainText("賞典除外");
    const total = (texts) =>
      texts.join(" ").match(/節全体は(\d+)人/)?.[1] ?? null;
    expect(total(totals[0])).not.toBeNull();
    expect(total(totals[1])).toBe(total(totals[0]));
  });

  test("「今節」タブで6艇の勝負駆けと選んだ1艇の走りが出て、節をまたがない（phase a T6-1）", async ({
    page,
  }) => {
    // 2026-09-24 桐生3R。この節は9/20から、登番4872は9/20〜9/23の6走
    await page.goto("/race/2026-09-24-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();

    // 1. 6艇横断（レース単位）。勝負駆けは相対でしか読めないので先に出す
    const compare = page.locator(".rmt-compare");
    await expect(compare).toBeVisible({ timeout: 25000 });
    await expect(compare.locator("tbody tr")).toHaveCount(6);
    // 得点率・節内順位・前検順位の3列
    await expect(page.locator(".rmt-compare thead")).toContainText("得点率");
    await expect(page.locator(".rmt-compare thead")).toContainText("節内順位");
    await expect(page.locator(".rmt-compare thead")).toContainText("前検");
    // 得点率の降順に並ぶ
    const rates = await page.locator(".rmt-rate").allInnerTexts();
    const nums = rates.map((v) => Number(v.replace(/[^0-9.]/g, "")));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
    // 節の規模と準優の目安、公式値の出典。
    // **この節（桐生 2026-09-20開催）はＷ優勝戦**で、独立した2つの勝ち上がりが
    // 同居している。以前はここが「48人」＝男子24人と女子24人の合算で、
    // 別の勝ち上がりの選手を混ぜて順位を振っていた（BOA-476／BOA-511）。
    // 表示中の6艇と同じ側だけを母集団にするので24人。さらに 9/22 5R（予選男子）で
    // Fを切った大澤普司は賞典除外として順位の対象から外し（BOA-587）、予選中の 9/22 に
    // 帰った北川・田中も予選の翌日から外すので21人（BOA-674）
    // 除外の選手も節は走っているので24人のまま、順位の対象を分けて書く。
    // Ｗ優勝戦で分けた節は「節の出場」ではなく「同じ優勝戦をめざすのは」と書く
    // （下の注記の「節全体は48人」と食い違って読めた。BOA-660）
    await expect(page.locator(".rmt-sub").first()).toContainText(
      "同じ優勝戦をめざすのは24人（順位の対象は21人",
    );
    // 人数が半分になる理由を1行で断る（黙って半分にすると「なぜ減った」になる）
    await expect(page.locator(".rmt-series-note")).toContainText(
      "勝ち上がりが2つに分かれています",
    );
    await expect(page.locator(".rmt-source")).toContainText(
      "前検タイムの出典: BOAT RACE オフィシャルウェブサイト",
    );

    // 級別は前検の行から取る（追加クエリなし）。前検は順位だけでなくタイムを出す
    await expect(compare.locator(".rmt-class").first()).toHaveText(
      /^(A1|A2|B1|B2)$/,
    );
    await expect(compare.locator(".rmt-pretest").first()).toHaveText(
      /^\d\.\d{2}（\d+位）$|^\d\.\d{2}$|^—$/,
    );

    // 行タップで下の詳細がその選手に変わる（チップまで指を動かさせない）
    const scoreLine = page.locator(".rmt-detail-score");
    await expect(scoreLine).toBeVisible({ timeout: 25000 });
    const firstScore = await scoreLine.innerText();
    await compare.locator("tbody tr").nth(2).click();
    await expect(scoreLine).not.toHaveText(firstScore, { timeout: 25000 });

    // 2. 選んだ1艇の詳細。既定は1号艇なので4号艇（登番4872）に切り替える
    await page.locator(".rmt-select-chip").nth(3).click();
    // 予選中は「今節の得点率」、予選終了後は「予選の得点率（確定）」。
    // このレース（2026-09-24 桐生3R）は9/23で予選が終わった後の一般戦
    await expect(page.locator(".rmt-detail-score")).toContainText("の得点率", {
      timeout: 25000,
    });
    // 予選が終わった後のレースでは、早見（今日の着順で得点率がどう動くか）は
    // 出さない。準優はもう終わっていて得点率で争うものが無いため
    await expect(page.locator(".rmt-forecast-table")).toHaveCount(0);
    await expect(page.locator(".rmt-forecast")).toContainText("予選は");

    // ST・展示は走順の折れ線で見せる（数字の羅列はやめた）。
    // 平均・通常値・前検タイムはグラフの見出しに寄せてある
    const sparkHeads = page.locator(".rmt-spark-head");
    await expect(sparkHeads).toHaveCount(2);
    await expect(sparkHeads.first()).toContainText("今節のST");
    await expect(sparkHeads.first()).toContainText("通常");
    await expect(sparkHeads.nth(1)).toContainText("今節の展示");
    await expect(sparkHeads.nth(1)).toContainText("前検");
    await expect(page.locator(".rmt-sparks .meet-sparkline")).toHaveCount(2);

    // 6艇の推移（同じ縦の物差しで並べる）。ST/展示を切り替えられる
    await expect(page.locator(".rmt-trend-row")).toHaveCount(6);
    // 横軸は日付（BOA-538）。範囲は「ここに出ている走」の範囲で、節の全日程ではない
    // （表示中レースの直前までしか持たない）。以前は「走った順」と断っていた
    await expect(page.locator(".rmt-trend-range")).toHaveText(
      /^横軸は日付（\d+\/\d+〜\d+\/\d+）。1日に2走した日は左右にずらし、その選手が走らなかった日は線を切っています。各行の最後の点がその選手の前走です。$/,
    );
    // 行を押すと下の詳細が変わることを、グラフ側にも書く（表側にだけあった）
    await expect(page.locator(".rmt-hint").last()).toContainText(
      "下の詳細がその選手に変わります",
    );
    await page.locator(".rmt-metric-chip", { hasText: "展示" }).click();
    await expect(
      page.locator(".rmt-metric-chip", { hasText: "展示" }),
    ).toHaveAttribute("aria-pressed", "true");

    // 日別の走り。同じ節の走しか並ばない列は省き、展示の列を足すので9列
    const rows = page.locator(".race-meet-tab .race-history-table tbody tr");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    await expect(
      page.locator(".race-meet-tab .race-history-table thead th"),
    ).toHaveCount(9);
    const cells = rows.first().locator("td");
    // 同じ節の走しか並ばないので日付は月日だけ（年は毎行同じで幅を食う）
    await expect(cells.nth(0)).toHaveText("9/20");
    await expect(cells.nth(1)).toContainText("5R");
    // 列の並び: 日付・R・着順（BOA-569 で R の右へ移した）・艇番・進入・展示・ST…
    await expect(cells.nth(4)).toHaveText("5");
    // 展示は「タイム(同レース内の順位)」。上向き/下向きの断定はしない
    await expect(cells.nth(5)).toHaveText(/^\d\.\d{2}\(\d\)$|^\d\.\d{2}$|^-$/);
    // STは「タイム(そのレース内のST順位)」。平均STだけでは「毎回相手に
    // 先んじているか」が読めないため順位を併記する
    await expect(cells.nth(6)).toHaveText(/^0\.09(\(\d\))?$/);
    // 展示の推移を「初日→直近」で断定する文言は出さない
    await expect(page.locator(".race-meet-tab")).not.toContainText("展示順位");

    // 予選中のレース（2026-09-22 桐生3R「予選男子」）では、早見を着順ごとに
    // 割って出す（1行のベタ書きだと390pxで折り返して読めない）
    await page.goto("/race/2026-09-22-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".rmt-detail-score")).toContainText(
      "今節の得点率",
      { timeout: 25000 },
    );
    // 得点率早見は公式と同じ行列（行＝艇・列＝1着〜6着）。
    // ボーダーの目安に届くセルに色が付く
    const forecast = page.locator(".rmt-forecast-table");
    await expect(forecast).toBeVisible();
    // 艇・選手 / 得点率 / 必要得点 / 1着〜6着 の9列
    await expect(forecast.locator("thead th")).toHaveCount(9);
    await expect(forecast.locator("thead")).toContainText("1着");
    await expect(forecast.locator("thead")).toContainText("6着");
    await expect(forecast.locator("thead")).toContainText("必要得点");
    await expect(forecast.locator("tbody tr")).toHaveCount(6);
    // 1着の得点率は6着より必ず高い（同じ艇の行の中で単調に下がる）
    const firstRow = forecast.locator("tbody tr").first();
    const forecastTexts = await firstRow.locator("td").allInnerTexts();
    const forecastCells = forecastTexts.slice(2).map(Number);
    expect(forecastCells).toHaveLength(6);
    expect(forecastCells[0]).toBeGreaterThan(forecastCells[5]);

    // 節の初戦では前節が混ざらず、空状態になる
    await page.goto("/race/2026-09-20-01-05");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".rmt-empty").first()).toContainText(
      "今節はまだ走っていません",
      { timeout: 25000 },
    );
  });

  test("今節タブの6艇の推移は、行のどこを押しても選手が切り替わる（BOA-550）", async ({
    page,
  }) => {
    await page.goto("/race/2026-09-24-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".rmt-trend-row")).toHaveCount(6, {
      timeout: 25000,
    });
    // 行のどこを押しても選手が切り替わる（BOA-550）。以前は艇番・選手名だけが押せて、
    // いちばん大きい的の折れ線を押しても何も起きなかった。3行目の折れ線の上を押す
    const trendRow = page.locator(".rmt-trend-row").nth(2);
    // 座標で押すと画面下の固定バーに当たることがあるので、ロケーターで押す
    // （見える位置までスクロールしてから押す）
    const spark = trendRow.locator(".meet-sparkline-wrap");
    const box = await spark.boundingBox();
    await spark.click({
      position: { x: box.width * 0.6, y: box.height / 2 },
    });
    await expect(trendRow).toHaveAttribute("aria-pressed", "true");
    // 右端の前走の値を押しても切り替わる
    const lastRow = page.locator(".rmt-trend-row").nth(4);
    await lastRow.locator(".rmt-trend-last").click();
    await expect(lastRow).toHaveAttribute("aria-pressed", "true");
    await expect(trendRow).toHaveAttribute("aria-pressed", "false");
    // 案内文も「行をタップ」にそろえる（艇番・選手名だけが押せた頃の文言が残っていた）
    await expect(page.locator(".rmt-hint").last()).toContainText(
      "行をタップすると",
    );
  });

  test("比較表の着順の見出しは、予選が終わった後は「予選の着順」になる（BOA-568）", async ({
    page,
  }) => {
    // 2026-09-29 戸田12R（準優勝戦）: 予選は 9/28 で終了。山田康二の 9/29 3R（一般戦）は
    // 得点率に数えないので並びに入らない（6走）。見出しでそれと分かるようにする
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const yamada = page.locator(".rmt-compare tr", { hasText: "山田" });
    await expect(yamada.locator(".rmt-finishes-label")).toHaveText(
      "予選の着順",
      {
        timeout: 25000,
      },
    );
    await expect(
      yamada.locator(".rmt-finishes > span:not(.rmt-finishes-label)"),
    ).toHaveCount(6);
    // 予選中のレースでは従来どおり「着順」
    await page.goto("/race/2026-09-21-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    await expect(page.locator(".rmt-finishes-label").first()).toHaveText(
      "着順",
      {
        timeout: 25000,
      },
    );
  });

  test("今節タブの6艇の推移で、各走の着順を点の下に同じ横位置で出す（BOA-537）", async ({
    page,
  }) => {
    // 2026-06-20 尼崎12R: 4号艇 谷津幸宏は 6/17 11R を欠場（着順の並び 5・欠・1・3・2・1）
    await page.goto("/race/2026-06-20-13-12");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const yatsu = rows.filter({ hasText: "谷津" });
    await expect(yatsu.locator(".meet-sparkline-label")).toHaveText([
      "5",
      "欠",
      "1",
      "3",
      "2",
      "1",
    ]);
    // 1着は強調、欠などの記号は控えめ
    await expect(yatsu.locator(".meet-sparkline-label").nth(2)).toHaveClass(
      /is-win/,
    );
    await expect(yatsu.locator(".meet-sparkline-label").nth(1)).toHaveClass(
      /is-mark/,
    );
    // 数字どうしが重ならない（各行）
    const overlaps = await rows.evaluateAll((els) =>
      els.map((r) => {
        const ls = [...r.querySelectorAll(".meet-sparkline-label")].map((x) =>
          x.getBoundingClientRect(),
        );
        let n = 0;
        for (let i = 1; i < ls.length; i += 1)
          if (ls[i].left < ls[i - 1].right) n += 1;
        return n;
      }),
    );
    expect(overlaps.every((n) => n === 0)).toBe(true);
    await expect(page.locator(".rmt-spark-note").first()).toContainText(
      "点の下の数字はその走の着順です",
    );
    await expect(page.locator(".rmt-trend-head-sub")).toHaveText(
      "点の下＝着順",
    );
  });

  test("走数が多い節でも、375pxで点の下の着順を1段で並べ、日付の目盛りも重ならない（BOA-537・BOA-538）", async ({
    page,
  }) => {
    // 2026-09-28 津11R（最終日）: 各艇10〜11走。9/21・22 の中止レースは出走表にだけ残る
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/race/2026-09-28-09-11");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const info = await rows.evaluateAll((els) =>
      els.map((r) => {
        const labels = [...r.querySelectorAll(".meet-sparkline-label")];
        const wrap = r
          .querySelector(".meet-sparkline-wrap")
          .getBoundingClientRect();
        const gaps = [];
        for (const lower of [false, true]) {
          const ls = labels
            .filter((e) => e.classList.contains("is-lower") === lower)
            .map((x) => x.getBoundingClientRect());
          for (let i = 1; i < ls.length; i += 1)
            gaps.push(ls[i].left - ls[i - 1].right);
        }
        return {
          font: labels[0]
            ? parseFloat(getComputedStyle(labels[0]).fontSize)
            : 0,
          minGap: Math.min(...gaps),
          // 最初の着順が左側3割の中にある（中止レースの空きで右に寄らない）。
          // 日付の横軸（BOA-538）では、初日に走っていない選手は2日目の位置から始まる
          firstOffsetRatio:
            (labels[0].getBoundingClientRect().left - wrap.left) / wrap.width,
          // 全走を1段に並べる（2段に振り分けると段ごとに読んで順番を読み違える）
          lines: new Set(
            labels.map((x) => Math.round(x.getBoundingClientRect().top)),
          ).size,
        };
      }),
    );
    for (const row of info) {
      // 日付の横軸では同じ日の2走を寄せる（日の区切りが見えるように）。375pxで
      // 毎日2走の行は9.5pxまで小さくなる
      expect(row.font).toBeGreaterThanOrEqual(9);
      // 日付の横軸（BOA-538）では1日2走が近づく。隣と重ならない
      expect(row.minGap).toBeGreaterThanOrEqual(2);
      expect(row.firstOffsetRatio).toBeLessThan(0.3);
      expect(row.lines).toBe(1);
    }
    // 日付の目盛り（BOA-538）: 最初の日だけ「月/日」、ほかは日だけで、隣と重ならない
    const days = await page.locator(".rmt-trend-day").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { text: e.textContent, left: r.left, right: r.right };
      }),
    );
    expect(days[0].text).toMatch(/^\d+\/\d+$/);
    expect(days.slice(1).every((d) => /^\d+$/.test(d.text))).toBe(true);
    for (let i = 1; i < days.length; i += 1)
      expect(days[i].left).toBeGreaterThan(days[i - 1].right);
  });

  test("375pxで履歴の表の着順が初期表示に入り、前走の公式の記号を言語ごとの表記で出す（BOA-569）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-06-13 浜名湖12R: 基本情報の直近10走（11列・約930px）
    await page.goto("/race/2026-06-13-06-12");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const bar = page.locator(".rbit-bar-row").first();
    await bar.waitFor({ timeout: 30000 });
    await bar.click();
    const table = page.locator(".rrt-table").first();
    await table.waitFor({ timeout: 30000 });
    // 列は「日付・R・枠番・進入・ST・着順」（BOA-623）。375px で横に送らずに全部見える
    // （以前は11列・約930pxで、着順は R の右に寄せても枠番・ST は画面外だった）
    const layout = await table.evaluate((tb) => {
      const wrap = tb.closest(".rrt-wrap");
      return {
        heads: [...tb.querySelectorAll("thead th")]
          .filter((th) => getComputedStyle(th).display !== "none")
          .map((th) => th.textContent.trim()),
        scroll: wrap.scrollWidth,
        client: wrap.clientWidth,
      };
    });
    expect(layout.heads).toEqual(["日付", "R", "枠番", "進入", "ST", "着順"]);
    expect(layout.scroll).toBeLessThanOrEqual(layout.client);

    // 英語の画面で公式の記号（エ＝エンスト）を生のまま出さない（ファン評価2周目）。
    // 2026-09-30 戸田9R: 前の走がエンスト失格の艇がいる
    await page.goto("/en/race/2026-09-30-02-09");
    await page.locator(".race-tabs-btn", { hasText: "Basic Info" }).click();
    const enRow = page
      .locator("tr", { hasText: "Last race this series" })
      .first();
    await enRow.waitFor({ timeout: 30000 });
    await expect(enRow).toContainText("Eng");
    await expect(enRow).not.toContainText("エ");
    // 記号の意味をタッチでも確かめられる（BOA-592。以前は ? が日本語ページだけで、title しか無かった）
    await enRow.locator(".term-hint__button").click();
    const enHint = page.locator(".term-hint__popover");
    await expect(enHint).toContainText("Eng");
    await expect(enHint).toContainText(/engine stall/i);
    await enRow.locator(".term-hint__button").click();
    // 同じ走を直近の出走履歴でも同じ表記にする（ファン評価3周目。以前は履歴だけ「エ」）
    await page.locator(".rbit-bar-row").nth(5).click();
    const enHistory = page.locator(".rrt-table").first();
    await enHistory.waitFor({ timeout: 30000 });
    await expect(enHistory).toContainText("Eng");
    await expect(enHistory).not.toContainText("エ");

    // 「今節の展示」が無い艇は「今節初戦」のまま。
    // 2026-09-21 津1R は節の初日
    await page.goto("/race/2026-09-21-09-01");
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    const meetRow = page.locator("tr", { hasText: "今節展示情報" }).first();
    await meetRow.waitFor({ timeout: 30000 });
    await expect(meetRow).toContainText("今節初戦");
  });

  test("データ出走表の今節の前走は前日の走も拾い、節の初日の1Rは「今節初戦」（BOA-610）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-06-22 尼崎12R（優勝戦）: 公式の直前情報の前走（同じ日の前の走）は
    // 6艇とも空。今節の前走は前日の走から出す（以前は6艇とも「今節初戦」）
    await page.goto("/race/2026-06-22-13-12");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow.waitFor({ timeout: 30000 });
    await expect(prevRow).not.toContainText("今節初戦");
    await expect(prevRow).toContainText("6/21 11R");

    // 4日目の5R（2026-09-26 津）: その日まだ走っていない5艇も前日の走を出す。
    // 1R を走った6号艇は同じ日の 1R（BOA-610。以前は5艇が「初走」）
    await page.goto("/race/2026-09-26-09-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow2 = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow2.waitFor({ timeout: 30000 });
    await expect(prevRow2).not.toContainText("今節初戦");
    await expect(prevRow2.locator("td").nth(6)).toContainText("9/26 1R");
    await expect(prevRow2.locator("td").nth(1)).toContainText("9/25 9R");

    // 2026-09-30 児島7R の1号艇 西村拓也: 9/29 10R（5号艇・4コース進入で2着）が今節の前走。
    // 公式の直前情報の前走は同じ日だけなので、以前は「今節初戦」と出ていた（BOA-610）
    await page.goto("/race/2026-09-30-16-07");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow3 = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow3.waitFor({ timeout: 30000 });
    const nishimura = prevRow3.locator("td").nth(1);
    await expect(nishimura).toContainText("2着");
    // 進入は4コース（公式のスタート情報）。枠番の5を出さない（ファン評価1周目 P0）
    await expect(nishimura).toContainText("4コース");
    await expect(nishimura).not.toContainText("5コース");
    await expect(nishimura).toContainText("9/29 10R");
    await expect(prevRow3).not.toContainText("今節初戦");

    // 節の初日の1R は全艇「今節初戦」（2026-09-21 津1R）
    await page.goto("/race/2026-09-21-09-01");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow4 = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow4.waitFor({ timeout: 30000 });
    await expect(prevRow4.locator("td", { hasText: "今節初戦" })).toHaveCount(
      6,
    );
    // 375px で「今節初／戦」と語の途中で折れない（ファン評価3周目）。
    // 折れると行内要素の矩形が2つになる
    const lineCounts = await prevRow4
      .locator("td .drt-sub")
      .evaluateAll((els) => els.map((el) => el.getClientRects().length));
    expect(lineCounts).toEqual([1, 1, 1, 1, 1, 1]);
  });

  test("データ出走表の今節の前走は中止になったレースを飛ばす（BOA-610）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-22 戸田5R の5号艇: 前日の 9/21 5R は中止（出走表の行はあるが結果が無い）。
    // 前走は 9/20 10R（4コース6着）。中止を拾うと「—」のまま残る
    await page.goto("/race/2026-09-22-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const row = page.locator("tr", { hasText: "今節の前走" }).first();
    await row.waitFor({ timeout: 30000 });
    const boat5 = row.locator("td").nth(5);
    await expect(boat5).toContainText("9/20 10R");
    await expect(boat5).toContainText("6着");
  });

  test("着順が付かない走は、推移・比較表・日別の表で同じ公式の記号になる（BOA-537 ファン評価）", async ({
    page,
  }) => {
    // 2026-09-25 桐生12R: 6号艇 嶋田有里の 9/21 11R は公式の結果が「落」
    await page.goto("/race/2026-09-25-01-12");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const shimada = rows.filter({ hasText: "嶋田" });
    await expect(shimada.locator(".meet-sparkline-label").nth(2)).toHaveText(
      "落",
    );
    // 比較表の着順の並びも「落」（以前は「失」）
    await expect(
      page
        .locator(".rmt-compare tr", { hasText: "嶋田" })
        .locator(".rmt-finishes"),
    ).toContainText("落");
    // 日別の表も「落」（以前は「着外(順位不明)」）
    await shimada.click();
    await expect(
      page.locator("tr", { hasText: "9/21" }).filter({ hasText: "11R" }),
    ).toContainText("落");
  });

  test("今節タブの6艇の推移は、1走の選手も前走の値が右端の列にそろい、選択中の行はホバーと区別できる（BOA-550 ファン評価）", async ({
    page,
  }) => {
    // 2026-09-21 桐生3R（予選2日目）: 1走しかない選手が3人いる。線が出ない行で
    // 前走の値が中央の列に詰まり、行の高さも半分になっていた
    await page.goto("/race/2026-09-21-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const boxes = await rows.evaluateAll((els) =>
      els.map((el) => {
        const last = el
          .querySelector(".rmt-trend-last")
          .getBoundingClientRect();
        return {
          hasLine: Boolean(el.querySelector(".meet-sparkline-wrap")),
          dots: el.querySelectorAll(".meet-sparkline > circle").length,
          height: Math.round(el.getBoundingClientRect().height),
          lastRight: Math.round(last.right),
        };
      }),
    );
    // 1走の行が実際にある（前提が崩れたらテストの意味が無い）。1走でも行が
    // 空白にならず、前走の点が1つだけ出る（2周目のファン評価で空白が
    // 「取れていない」と読まれた）
    expect(boxes.some((b) => b.dots === 1)).toBe(true);
    expect(boxes.every((b) => b.hasLine && b.dots >= 1)).toBe(true);
    expect(new Set(boxes.map((b) => b.lastRight)).size).toBe(1);
    expect(new Set(boxes.map((b) => b.height)).size).toBe(1);

    // 選択中の行だけ左の帯（inset の box-shadow）が付き、ホバー中の行には付かない
    await rows.nth(0).click();
    await rows.nth(1).hover();
    const shadows = await rows.evaluateAll((els) =>
      els.slice(0, 2).map((el) => getComputedStyle(el).boxShadow),
    );
    expect(shadows[0]).not.toBe("none");
    expect(shadows[1]).toBe("none");
  });

  test("F数バッジが基本情報タブとST考察カードで同じ値になり、f_countが無い過去レースでは出ない（phase a T5-3）", async ({
    page,
  }) => {
    // 2026-09-21 戸田5R: f_count は 1号艇2本・5号艇1本・6号艇1本で固定
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    const basicBadges = page.locator(".rbit-bar-row .flying-badge");
    await expect(basicBadges).toHaveCount(3);
    // F2は赤（90日のあっせん停止で意味が違う）、F1は金
    await expect(basicBadges.nth(0)).toHaveText("F2");
    await expect(basicBadges.nth(0)).toHaveClass(/is-f2/);
    await expect(basicBadges.nth(1)).toHaveText("F1");
    await expect(basicBadges.nth(1)).not.toHaveClass(/is-f2/);

    // ST考察カードのバッジも同じ出所（race_entries.f_count）に統一した
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });
    const stBadges = page.locator(".rsc-grid .flying-badge");
    await expect(stBadges).toHaveCount(3);
    await expect(stBadges.nth(0)).toHaveText("F2");
    await expect(stBadges.nth(1)).toHaveText("F1");
    // 6艇すべての出走履歴を取り終えるまで待つ。カードは1艇分でも揃えば表を出し、
    // バッジは race_entries.f_count から出るので、上の確認は履歴の取得を待たない。
    // 履歴は選手ごとに race_start_timings を1000行ずつページングしており（2年窓で
    // 1000行を超える選手がいる）、待たずに次のレースへ移ると2ページ目が録画に入らず、
    // 速い再生でだけ出て本番へ素通りしていた（BOA-556）。走数は取得前「—」、
    // 取得後は数字（0を含む）になる
    // 走数が少ない艇は⚠が付く（race-detail-ui-unify plan §6）
    await expect(page.locator(".rsc-grid .rsc-runs")).toHaveText(
      Array(6).fill(/^⚠?\d+$/),
      // 録画（本番に繋ぐ）では6選手分の2年窓を取るので、他の待ちと同じ長さにする
      { timeout: 25000 },
    );

    // f_count が無い期間（2026-09-20以前）はバッジも空欄も出さない
    await page.goto("/race/2026-09-10-01-01");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    await expect(page.locator(".flying-badge")).toHaveCount(0);
  });

  test("過去のレースでは、枠別情報の逃げ・決まり手が最新の集計（そのレースの日の時点ではない）だと明記する（BOA-608）", async ({
    page,
  }) => {
    // 会場の逃げ・決まり手は「今日から見た直近の期間」の事前集計しか無い。
    // 以前は6月のレースでも9月のレースでも同じ値が、何の断りもなく出ていた
    //
    // 「過去か当日か」はブラウザの時計で決まる。録画時刻（＝時計）は撮り直すたびに
    // 進むため、時計を 9/29 に固定する。固定しないと、9/30 以降に撮った録画では
    // 下の 9/29 のレースも「過去」になり、注記が出て落ちる（2026-10-01 の撮り直しが
    // これで不採用になった）
    await page.clock.setFixedTime(new Date("2026-09-29T15:04:00+09:00"));
    await page.goto("/race/2026-09-26-09-05");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    const note = page.getByText(
      /最新の集計です（期間 \d{4}-\d{2}-\d{2}〜\d{4}-\d{2}-\d{2}）/,
    );
    await expect(note.first()).toBeVisible({ timeout: 30000 });
    await expect(note).toHaveCount(2);

    // 注記を足しても、逃げシミュレーションの横棒と「くわしく見る」の見た目が
    // 崩れない（ファン評価1周目: CSS の後ろ半分を消して、全レースで崩れていた）
    const fill = page.locator(".nsc-fill").first();
    await expect(fill).toBeVisible();
    expect((await fill.boundingBox()).width).toBeGreaterThan(0);
    const toggleHeight = await page
      .locator(".nsc-detail-toggle")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(toggleHeight).toBeGreaterThanOrEqual(44);

    // 当日のレース（時計は上で 2026-09-29 に固定している）では出さない
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    // 注記の出る2枚（逃げシミュレーション・決まり手傾向）の中身が読み込まれてから
    // 数える。カードの枠だけ見て数えると、読み込み前の 0 件で素通りする
    await expect(page.locator(".nsc-fill").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(".rwit-tech-row").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/最新の集計です（期間/)).toHaveCount(0);
  });

  test("過去のレースの枠別情報とST考察に、そのレース自身と後日の走を入れない（BOA-603）", async ({
    page,
  }) => {
    // 津 2026-09-26 5R の1号艇（飯山泰）。以前は「直近1ヶ月」の帯の右端に
    // 9/26 5R 自身の3着と 9/28 11R の1着が入り、ST履歴の先頭も 9/28 だった
    const raceId = "2026-09-26-09-05";
    await page.goto(`/race/${raceId}`);
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    // 数字は「このレースの時点」なので、見出しも「本日」と言わない（ファン評価1周目）
    await expect(page.getByText("このレースの想定進入").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("本日の想定進入")).toHaveCount(0);
    // 選手側の値の集計範囲も画面に出す（2周目: 日付が平均の期間しか無く、
    // 選手の数字にもレース後の走が入っていると読まれた）
    await expect(
      page.getByText("選手の値は、このレースより前の走で集計しています"),
    ).toBeVisible();
    const btn = page.getByRole("button", { name: /直近1ヶ月/ }).first();
    await btn.waitFor({ timeout: 30000 });
    await btn.click();
    const items = page.locator(".rrb-strip").first().locator(".rrb-item");
    await expect(items.first()).toBeAttached({ timeout: 30000 });
    const ids = await items.evaluateAll((els) =>
      els.map((e) => e.dataset.raceId),
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id < raceId).toBe(true);

    // ST考察のST履歴（1号艇）にも、このレース以降の日付が出ない
    await page.locator(".rsc-fold-toggle").nth(1).click();
    const dates = await page
      .locator(".rsc-fold-body table tbody tr td:first-child")
      .allInnerTexts();
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d <= "2026-09-26").toBe(true);
    expect(dates).not.toContain("2026-09-28");
  });

  test("枠別情報タブのST分布・ST履歴が折りたたみで開き、平均と重ねて表示される（phase a T3-3）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });

    // 折りたたみは2つ。初期は閉じている
    await expect(page.locator(".rsc-fold-toggle")).toHaveCount(2);
    await expect(page.locator(".rsc-fold-body")).toHaveCount(0);

    // ST分布: ベースラインと同じ7ビン、選手の棒と平均の棒が各7本
    await page.locator(".rsc-fold-toggle").first().click();
    await expect(page.locator(".rsc-histogram")).toBeVisible();
    await expect(page.locator(".rsc-hist-col")).toHaveCount(7);
    await expect(page.locator(".rsc-hist-own")).toHaveCount(7);
    await expect(page.locator(".rsc-hist-base")).toHaveCount(7);

    // 母数が桁違いなので割合に正規化する（最大が100%になる）
    const maxHeight = await page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll(".rsc-hist-own, .rsc-hist-base")].map(
          (el) => parseFloat(el.style.height),
        ),
      ),
    );
    expect(Math.abs(maxHeight - 100)).toBeLessThan(0.01);

    // 艇を選ぶチップが6つあり、切り替えると内容が変わる
    await expect(page.locator(".rsc-detail-chip")).toHaveCount(6);
    const noteBefore = await page.locator(".rsc-fold-note").innerText();
    await page.locator(".rsc-detail-chip").nth(5).click();
    await expect(page.locator(".rsc-fold-note")).not.toHaveText(noteBefore);

    // ST履歴を開くとST分布は閉じる（同時には開かない）
    await page.locator(".rsc-fold-toggle").nth(1).click();
    await expect(page.locator(".rsc-history")).toBeVisible();
    await expect(page.locator(".rsc-histogram")).toHaveCount(0);

    // 列が 日付/会場/ST/ST順/着順 で、新しい順に並ぶ
    await expect(page.locator(".rsc-history thead th")).toHaveCount(5);
    const dates = await page
      .locator(".rsc-history tbody tr td:first-child")
      .allInnerTexts();
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("枠別情報タブの逃げシミュレーションで2着率の合計が100%になり、予想ではない旨が出る（phase a T3-5）", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();

    const card = page.locator(".nsc-card");
    await card.waitFor({ state: "visible", timeout: 25000 });

    // 2〜6コースの5行
    await expect(page.locator(".nsc-row")).toHaveCount(5);

    // 2着率の合計が100%（2着は必ず1艇。丸め誤差のみ許容）
    const rates = await page.locator(".nsc-rate").allInnerTexts();
    const sum = rates.reduce((a, r) => a + parseFloat(r), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.6);

    // 母数が明記される
    await expect(page.locator(".nsc-sub")).toContainText("レース");

    // 「くわしく見る」で算出方法と「予想ではない」旨が出る
    await page.locator(".nsc-detail-toggle").click();
    await expect(page.locator(".nsc-detail")).toContainText(
      "予想ではありません",
    );
  });

  test("オッズ一覧タブで券種切替・全通り常時表示・推移ドリルダウン・免責文言が表示される（BOA-311）", async ({
    page,
  }) => {
    // 全窓（60/30/15/10/5/0分前）で全券種の全通りオッズが保存された過去レース
    // （FR-4、ADR-0057稼働後の2026-09-18戸田8R）を固定で使う
    await page.goto("/race/2026-09-18-02-08");
    await page.locator(".race-tabs-btn", { hasText: "オッズ一覧" }).click({
      timeout: 20000,
    });

    // 3連単（初期表示）: 1着ごとの6ブロックに全120通りがタップ不要で並ぶ（日和と同じ構造）
    await expect(page.locator(".rol-block")).toHaveCount(6, {
      timeout: 20000,
    });
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(120);
    await expect(page.locator(".rol-disclaimer")).toContainText("主催者");

    // オッズ一覧タブ専用の内容のため、基本情報系のデータ出走表・枠別傾向・
    // 分析ツールアコーディオンは隠れる（モータ情報タブと同じ方針の再発防止）
    await expect(page.locator(".data-race-table")).toHaveCount(0);
    await expect(page.locator(".venue-tendency-panel")).toHaveCount(0);
    await expect(page.locator(".embedded-analysis-section")).toHaveCount(0);

    // 3連単: オッズをタップするとそのブロックの行の直後に推移が表示され、再タップで閉じる
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    await expect(page.locator(".rol-trend")).toBeVisible();
    await expect(page.locator(".rol-trend-item").first()).toBeVisible();
    await page.locator(".rol-odds.is-selected").click();
    await expect(page.locator(".rol-trend")).toHaveCount(0);

    // 3連複: 艇番3つの全20通りが一覧で表示される
    await page.locator(".rol-chip", { hasText: "3連複" }).click();
    await expect(page.locator(".rol-two-col-grid > .rol-odds")).toHaveCount(20);
    // 推移パネルは選択した行（1行目。列数は画面幅で2〜4列）の直後に全幅で出る。DOM では選択した要素の直後に
    // 置き、grid-auto-flow: dense で同じ行の残りが前に詰まる（BOA-530）ため、見た目の位置で確かめる
    const trioCells = page.locator(".rol-two-col-grid > .rol-odds");
    await trioCells.first().click();
    await expect(page.locator(".rol-two-col-grid > .rol-trend")).toBeVisible();
    const placement = await page
      .locator(".rol-two-col-grid")
      .evaluate((grid) => {
        const cells = [...grid.querySelectorAll(":scope > .rol-odds")].map(
          (c) => c.getBoundingClientRect(),
        );
        const trend = grid
          .querySelector(":scope > .rol-trend")
          .getBoundingClientRect();
        const firstRow = cells.filter((c) => c.top === cells[0].top);
        const rest = cells.filter((c) => c.top !== cells[0].top);
        return {
          firstRowAbove: firstRow.every((c) => c.bottom <= trend.top),
          restBelow: rest.every((c) => c.top >= trend.bottom),
          firstRowCount: firstRow.length,
        };
      });
    expect(placement.firstRowCount).toBeGreaterThanOrEqual(2);
    expect(placement.firstRowAbove).toBe(true);
    expect(placement.restBelow).toBe(true);

    // 2連単: 1着ごとの6ブロック（全30通り）。タップで推移が表示される
    await page.locator(".rol-chip", { hasText: "2連単" }).click();
    await expect(page.locator(".rol-block")).toHaveCount(6);
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(30);
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    await expect(page.locator(".rol-trend")).toBeVisible();

    // 2連複: 小さい艇番ごとの5ブロック（全15通り、最大艇番のブロックは作らない）
    await page.locator(".rol-chip", { hasText: "2連複" }).click();
    await expect(page.locator(".rol-block")).toHaveCount(5);
    await expect(page.locator(".rol-block .rol-odds")).toHaveCount(15);

    // 拡連複（レンジ値）: 推移スパークラインがNaNにならず描画される
    await page.locator(".rol-chip", { hasText: "拡連複" }).click();
    await page.locator(".rol-odds[class*='rol-heat-']").first().click();
    const points = await page
      .locator(".rol-sparkline polyline")
      .getAttribute("points");
    expect(points).not.toContain("NaN");

    // 基本情報タブへ戻ればデータ出走表が再表示される（上の非表示検証が空振りでないことの裏付け）
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
  });

  for (const [tab, selector] of [
    ["attackdefense", ".ad-section"],
    ["racecard", ".rcd-table"],
  ]) {
    test(`${tab} のディープリンクは当日一覧にない過去レースを維持する（BOA-744）`, async ({
      browser,
    }, testInfo) => {
      // 通常fixtureの録画時計を使わない。通信は録画だけで返し、外部へ出さない。
      const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
      });
      await applyCookieConsent(context, "rejected");
      const page = await context.newPage();
      const dataRequests = [];
      let venueLists = 0;
      const raceListVenues = [];
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          url.pathname === "/rest/v1/races" &&
          url.searchParams.has("race_date")
        ) {
          const venuesOnly = url.searchParams.get("select") === "venue_code";
          if (venuesOnly) venueLists++;
          else raceListVenues.push(url.searchParams.get("venue_code"));
          // 戸田も対象レースも無い一覧。空一覧による偽陽性を避ける。
          return route.fulfill({ json: venuesOnly ? [{ venue_code: 1 }] : [] });
        }
        if (
          url.pathname.startsWith("/rest/v1/") ||
          url.pathname.startsWith("/api/")
        ) {
          dataRequests.push(decodeURIComponent(url.href));
          const response = await fetchRecorded(route);
          return route.fulfill({
            status: response.status(),
            headers: response.headers(),
            body: await response.body(),
          });
        }
        if (url.origin === new URL(testInfo.project.use.baseURL).origin)
          return route.fallback();
        return route.abort();
      });
      try {
        const request = page.waitForRequest((r) =>
          decodeURIComponent(r.url()).includes(ANALYSIS_FIXED_RACE_ID),
        );
        await page.goto(
          `/winning-technique?tab=${tab}&venue_code=2&race_id=${ANALYSIS_FIXED_RACE_ID}`,
        );
        await request;
        await expect.poll(() => venueLists).toBeGreaterThan(0);
        await expect.poll(() => raceListVenues.length).toBeGreaterThan(0);
        await page.waitForLoadState("networkidle");
        expect(raceListVenues.every((venue) => venue === "eq.2")).toBeTruthy();
        await expect(
          page.locator(
            `${tab === "racecard" ? "#race-card" : "#attack-defense"}-venue-select option`,
          ),
        ).toHaveCount(1);
        // 一覧取得後も表を維持する。初回のID取得だけでは旧実装も成功し得る。
        await expect(page.locator(selector)).toBeVisible({ timeout: 20000 });
        if (tab === "racecard")
          await expect(page.locator(".rcd-table tbody tr")).toHaveCount(6);
        expect(
          dataRequests.some((url) => url.includes(ANALYSIS_FIXED_RACE_ID)),
        ).toBeTruthy();
      } finally {
        await context.close();
      }
    });
  }

  test("分析ツールの超展開データタブで固定の過去レースの実データが表示される（レースAI予想からの外出し、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    await gotoAnalysisTabOnFixedDate(page, "attackdefense");
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定の過去レースは6艇分のデータが揃っているため実テーブルが必ず出る
    // （空状態を許容しない。BOA-664）
    await expect(page.locator(".ad-section")).toBeVisible({ timeout: 20000 });
  });

  test("分析ツールの出走表データタブで固定の過去レースの実データが表示される（レースAI予想からの外出し、固定日の技法はBOA-664）", async ({
    page,
  }) => {
    await gotoAnalysisTabOnFixedDate(page, "racecard");
    await expect(page.locator(".motor-condition-container")).toBeVisible({
      timeout: 10000,
    });
    // 固定の過去レースは出走表データが確定しているため実テーブルが必ず出る
    // （空状態を許容しない。BOA-664）
    await expect(page.locator(".rcd-table")).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".rcd-table tbody tr")).toHaveCount(6);
  });
});

test.describe("AI用にコピー機能（BOA-194: race-ai-copy）", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("結果未確定レースでバナー・インラインのコピーボタンが表示される", async ({
    page,
  }) => {
    await openFixedRaceBeforeStart(page);

    await expect(page.locator(".data-race-table")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator(".ai-copy-banner")).toBeVisible();
    await expect(page.locator(".ai-copy-btn-banner")).toBeVisible();
    await expect(page.locator(".ai-copy-btn-inline")).toBeVisible();
  });

  test("コピー直後のトーストに思考アシストへの1行が付き、6秒は消えず、押すと思考アシストへ移る（BOA-832）", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await openFixedRaceBeforeStart(page);
    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    await bannerButton.click();
    const toast = page.getByRole("status");
    await expect(toast).toContainText("コピーしました");
    const action = toast.locator(".app-toast-action");
    await expect(action).toContainText("貼る前に材料を確かめる → 思考アシスト");
    // 以前は2秒で消えた。3秒たっても出ている
    await page.waitForTimeout(3000);
    await expect(action).toBeVisible();
    // 押せる高さ（44px）と、閉じる×
    expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(toast.getByRole("button", { name: "閉じる" })).toBeVisible();
    const raceUrl = page.url();
    await action.click();
    await expect(page).toHaveURL(/\/assist$/);
    const events = await page.evaluate(() =>
      window.__events
        .filter((e) => e[0] === "event" && e[1] === "assist_view_switch")
        .map((e) => e[2].assist_entry),
    );
    expect(events).toEqual(["copy_toast"]);
    // 表示の選択は残さない。戻るでレース詳細へ
    expect(
      await page.evaluate(() => localStorage.getItem("boatai-user:race-view")),
    ).toBeNull();
    await page.goBack();
    await expect(page).toHaveURL(raceUrl);
  });

  test("トーストの×で閉じ、マウスを重ねている間は消えない（BOA-832）", async ({
    page,
  }) => {
    await openFixedRaceBeforeStart(page);
    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    await bannerButton.click();
    const toast = page.getByRole("status");
    const action = toast.locator(".app-toast-action");
    await expect(action).toBeVisible();
    await action.hover();
    await page.waitForTimeout(7000);
    await expect(action).toBeVisible();
    await toast.getByRole("button", { name: "閉じる" }).click();
    await expect(page.locator(".app-toast-action")).toHaveCount(0);
  });

  test("結果確定済みレースではコピーボタンが表示されない", async ({ page }) => {
    // unifiedモデル運用開始日（2026-08-11〜）以降の結果確定済み日付
    await page.goto("/races/2026-08-11");
    await page.locator(".venue-grid-card--open").first().click();
    await page.locator(".race-card .predict-btn").first().click();
    await expect(page.locator(".race-result")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".ai-copy-banner")).toHaveCount(0);
    await expect(page.locator(".ai-copy-btn-inline")).toHaveCount(0);
  });

  test("コピー実行後にトーストが表示され、クリップボードに整形済みMarkdownが入る", async ({
    page,
  }) => {
    await openFixedRaceBeforeStart(page);

    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await bannerButton.click();

    const toast = page.getByRole("status");
    await expect(toast).toBeVisible();
    // 思考アシストへの1行が続く（BOA-832）ので、文言の始まりで見る
    await expect(toast).toContainText("コピーしました");
    // コピーしても読んでいた位置から動かない（以前はデータ出走表へスクロールしていた。BOA-770）
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    // 見出し → レースの前提 → 表 → 注記 → 質問文 → 出典（BOA-770）。
    // 値の未解決を示す undefined/NaN が混入していないことを確認する
    expect(clipboardText).toMatch(
      /^## .+\n\n- 日付: \d{4}-\d{2}-\d{2}\n- 締切予定: /,
    );
    expect(clipboardText).toContain("- コピーした時刻: ");
    expect(clipboardText).toContain("| 項目 |");
    expect(clipboardText).toContain("項目の注記:");
    expect(clipboardText).toMatch(
      /\n出典: 龍神レーダー https:\/\/www\.boat-ai\.jp\/race\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/,
    );
    expect(clipboardText).not.toContain("undefined");
    expect(clipboardText).not.toContain("NaN");
    expect(clipboardText).not.toContain("競艇");
  });

  test("375px でもコピー後のトーストが下部ナビに隠れない", async ({ page }) => {
    // 以前はトーストの z-index（70）が RaceBottomNav（1500）より低く、スマホでは
    // 「コピーしました」が見えなかった（BOA-770 ファン評価）
    await page.setViewportSize({ width: 375, height: 800 });
    await openFixedRaceBeforeStart(page);
    const bannerButton = page.locator(".ai-copy-btn-banner");
    await expect(bannerButton).toBeVisible({ timeout: 15000 });
    await bannerButton.click();
    const toast = page.getByRole("status");
    // 思考アシストへの1行が続く（BOA-832）ので、文言の始まりで見る
    await expect(toast).toContainText("コピーしました");
    const onTop = await toast.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return el.contains(hit);
    });
    expect(onTop).toBe(true);
  });

  test("375px のプレビューで、表以外（前提の行・質問文・出典）は折り返して読める", async ({
    page,
  }) => {
    // 以前は全文を1つの <pre>（折り返しなし）で出しており、375px で質問文と
    // 出典が箱の右に切れていた（BOA-770 ファン評価2周目）
    await page.setViewportSize({ width: 375, height: 800 });
    await openFixedRaceBeforeStart(page);
    await expect(page.locator(".ai-copy-btn-banner")).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "コピーされる全文を見る" }).click();
    const preview = page.getByTestId("ai-copy-preview");
    await expect(preview).toContainText("出典: 龍神レーダー");
    const overflowing = await preview.evaluate((el) =>
      [...el.querySelectorAll("pre")]
        .filter((pre) => !pre.textContent.startsWith("|"))
        .filter((pre) => pre.scrollWidth > pre.clientWidth + 1)
        .map((pre) => pre.textContent.slice(0, 30)),
    );
    expect(overflowing).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
  });

  test("プレビューでコピーされる全文（表と出典を含む）が見られる", async ({
    page,
  }) => {
    await openFixedRaceBeforeStart(page);
    await expect(page.locator(".ai-copy-btn-banner")).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "コピーされる全文を見る" }).click();
    const preview = page.getByTestId("ai-copy-preview");
    await expect(preview).toContainText("| 項目 |");
    await expect(preview).toContainText("出典: 龍神レーダー");
    // 「データだけ」に切り替えると質問文が差し替わる
    await page.getByRole("radio", { name: "データだけ" }).click();
    await expect(preview).toContainText("このあと質問します。");
    // ページ末尾のボタンに、上で選んだ質問が添えられる（BOA-770 ファン評価）
    await expect(page.locator(".ai-copy-inline")).toContainText(
      "質問「データだけ」付きでコピーします",
    );
  });
});

test.describe("レース荒れ度ムード演出（BOA-195: race-open-animation）", () => {
  // 固定のレース（イン崩れ指数 0.97）は high。発走前の状態で開き、AI予想タブの
  // VolatilityDisplay を見る（当日の未確定レースを会場横断で探していた頃は、
  // 見つからない時間帯に skip していた。BOA-445）
  const LEVEL = "high";

  async function openVolatility(page) {
    await openFixedRaceBeforeStart(page);
    await page
      .locator(".race-tabs-btn", { hasText: "AI予想" })
      .click({ timeout: 20000 });
    await expect(page.locator(`.volatility-display-${LEVEL}`)).toBeVisible({
      timeout: 15000,
    });
  }

  test("イン崩れバッジが表示されるレースで波紋アニメーションが表示される", async ({
    page,
  }) => {
    await openVolatility(page);
    await expect(page.locator(".race-mood-effect")).toBeVisible();
    await expect(
      page.locator(".race-mood-effect .race-mood-effect-ring").first(),
    ).toBeAttached();
  });

  test("prefers-reduced-motion環境では波紋アニメーションが表示されない", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    try {
      // fixture を通らない context なので、Cookie 同意・録画の再生・時計の固定を明示的に掛ける
      await applyCookieConsent(context, "rejected");
      await applyRecording(context, testInfo);
      const page = await context.newPage();
      await openVolatility(page);
      await expect(page.locator(".race-mood-effect")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
// ピットレポート（選手コメント）セクション（BOA-379）
// 本番の匿名公開（マイグレーション086）は画面実装の後に適用するため、DBの状態に
// 依存しないよう race_pit_reports / race_pit_comments の2エンドポイントだけを
// page.routeで差し替える（他のリクエストはそのまま通す）
test.describe("レース詳細の直前情報タブ: ピットレポート", () => {
  const G1_RACE = "/race/2026-09-21-05-12"; // 多摩川G1 12R（対象レース）
  const IPPAN_RACE = "/race/2026-08-11-01-01"; // 桐生 一般戦 1R（対象外）

  const routePitReport = async (page, { report, comments }) => {
    await page.route("**/rest/v1/race_pit_reports*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(report),
      }),
    );
    await page.route("**/rest/v1/race_pit_comments*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(comments),
      }),
    );
  };

  const openBeforeInfoTab = async (page, path) => {
    await page.goto(path);
    await page.click('[role="tab"]:has-text("直前情報")');
  };

  test("コメントがあるレースで、出典・公式リンク・コメント・★が表示される", async ({
    page,
  }) => {
    await routePitReport(page, {
      report: [
        {
          status: "published",
          target_from: 7,
          target_to: 12,
          reporter_name: "テスト レポーター",
          comment_count: 2,
          created_at: "2026-09-21T06:42:00Z",
          updated_at: null,
        },
      ],
      comments: [
        {
          boat_number: 1,
          racer_id: 4371,
          comment_text: "整備をしたけど、前半レースは良くなかった。",
          confidence_stars: 1,
          previous_race_number: 7,
        },
        {
          boat_number: 3,
          racer_id: 4573,
          comment_text: "【取材者寸評】連日の部品交換で少しずつ上向き。",
          confidence_stars: null,
          previous_race_number: null,
        },
      ],
    });
    await openBeforeInfoTab(page, G1_RACE);

    const section = page.locator(".rpr-card");
    await expect(section).toBeVisible({ timeout: 20000 });
    await expect(section).toContainText(
      "出典: BOAT RACE オフィシャルウェブサイト ピットレポート",
    );
    // レポーター名は表示しない（2026-09-23のモック承認で決定）
    await expect(section).not.toContainText("テスト レポーター");
    await expect(section.locator(".rpr-source-link")).toHaveAttribute(
      "href",
      "https://www.boatrace.jp/owpc/pc/race/pitreport?rno=12&jcd=05&hd=20260921",
    );
    await expect(section).toContainText("取得: 9/21 15:42");

    // コメントのある艇だけが並ぶ（2号艇等は行ごと出さない）
    await expect(section.locator(".rpr-comment")).toHaveCount(2);
    await expect(section).toContainText(
      "整備をしたけど、前半レースは良くなかった。",
    );
    // 自信度が付かないコメント（【取材者寸評】）では★の行を出さない
    await expect(section.locator(".rpr-confidence")).toHaveCount(1);
    await expect(section.locator(".rpr-stars-filled").first()).toHaveText("★");
    await expect(section.locator(".rpr-stars-empty").first()).toHaveText("☆☆");
  });

  test("行が無いレースでは「公開待ち」カードを出す", async ({ page }) => {
    await routePitReport(page, { report: [], comments: [] });
    await openBeforeInfoTab(page, G1_RACE);

    const section = page.locator(".rpr-card");
    await expect(section).toBeVisible({ timeout: 20000 });
    await expect(section).toContainText("まだ公開されていません");
    await expect(section.locator(".rpr-comment")).toHaveCount(0);
  });

  test("匿名に権限が無い場合（086未適用）はセクションごと出さない", async ({
    page,
  }) => {
    await page.route("**/rest/v1/race_pit_reports*", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_pit_reports",
        }),
      }),
    );
    await page.route("**/rest/v1/race_pit_comments*", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_pit_comments",
        }),
      }),
    );
    await openBeforeInfoTab(page, G1_RACE);

    // 直前情報タブ自体は表示されたうえで、ピットレポートだけが出ない
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".rpr-card")).toHaveCount(0);
  });

  test("取得エラーは「未公開」「対象外」に化けさせず再読み込みを出す", async ({
    page,
  }) => {
    await page.route("**/rest/v1/race_pit_reports*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          message: "canceling statement due to statement timeout",
        }),
      }),
    );
    await page.route("**/rest/v1/race_pit_comments*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await openBeforeInfoTab(page, G1_RACE);

    const section = page.locator(".rpr-card");
    await expect(section).toBeVisible({ timeout: 20000 });
    await expect(section).toContainText("ピットレポートを読み込めませんでした");
    await expect(section.locator(".rpr-retry")).toBeVisible();
    await expect(section).not.toContainText("まだ公開されていません");
  });

  test("対象外のグレード（一般戦）では取得もセクションの描画もしない", async ({
    page,
  }) => {
    const pitRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("race_pit_")) pitRequests.push(req.url());
    });
    await openBeforeInfoTab(page, IPPAN_RACE);

    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".rpr-card")).toHaveCount(0);
    expect(pitRequests).toEqual([]);
  });
});

// オリジナル展示（一周・半周ラップ・まわり足・直線、BOA-452 / phase a FR-4b）
// 本番の匿名公開（マイグレーション096）は画面実装の後に適用するため、DBの状態に
// 依存しないよう race_original_exhibition / _values の2エンドポイントだけを
// page.routeで差し替える（ピットレポートのテストと同じやり方）
test.describe("レース詳細の直前情報タブ: オリジナル展示", () => {
  const RACE = "/race/2026-09-21-05-12";

  const VALUES = [
    { boat_number: 1, kind: "一周", value: 36.91 },
    { boat_number: 1, kind: "まわり足", value: 5.66 },
    { boat_number: 1, kind: "直線", value: 7.04 },
    { boat_number: 2, kind: "一周", value: 37.27 },
    { boat_number: 2, kind: "まわり足", value: 5.5 },
    { boat_number: 2, kind: "直線", value: 6.93 },
    { boat_number: 3, kind: "一周", value: 37.13 },
    { boat_number: 3, kind: "まわり足", value: 5.53 },
    { boat_number: 3, kind: "直線", value: 6.97 },
    { boat_number: 4, kind: "一周", value: 37.63 },
    { boat_number: 4, kind: "まわり足", value: 5.67 },
    { boat_number: 4, kind: "直線", value: 7.13 },
    { boat_number: 5, kind: "一周", value: 37.09 },
    { boat_number: 5, kind: "まわり足", value: 5.4 },
    { boat_number: 5, kind: "直線", value: 7.07 },
    { boat_number: 6, kind: "一周", value: 37.44 },
    { boat_number: 6, kind: "まわり足", value: 5.13 },
    { boat_number: 6, kind: "直線", value: 7.07 },
  ];

  const routeOriginalExhibition = async (page, { header, values }) => {
    await page.route("**/rest/v1/race_original_exhibition?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(header),
      }),
    );
    await page.route("**/rest/v1/race_original_exhibition_values*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(values),
      }),
    );
  };

  const openBeforeInfoTab = async (page) => {
    await page.goto(RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  const rowByLabel = (page, label) =>
    page.locator(".drt-table tbody tr").filter({
      has: page.locator(".drt-label-full", {
        hasText: new RegExp(`^${label}$`),
      }),
    });

  test("値があるレースで、一周・まわり足・直線の行と出典・取得時刻・再配布しない旨が出る", async ({
    page,
  }) => {
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        measure_status: 1,
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES,
    });
    await openBeforeInfoTab(page);

    // 行が出て、値がスタブと一致する
    await expect(rowByLabel(page, "一周")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toContainText("36.91");
    await expect(rowByLabel(page, "まわり足")).toContainText("5.66");
    await expect(rowByLabel(page, "直線")).toContainText("7.04");
    // 一番速い艇（最小値）に印が付く: まわり足は6号艇の5.13
    await expect(
      rowByLabel(page, "まわり足").locator("td.drt-best"),
    ).toHaveText("5.13");

    // ADR-0067が求める3点（出典・取得時刻・再配布しない旨）
    const source = page.locator(".rbi-source");
    await expect(source).toBeVisible();
    await expect(source).toContainText("BOATCAST");
    await expect(source).toContainText("9/21 15:42");
    await expect(source).toContainText("再配布はしていません");
  });

  test("計測項目が少ない会場では、その項目の行だけ出す（直線が無い会場で直線の行を出さない）", async ({
    page,
  }) => {
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足",
        measure_status: 1,
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES.filter((v) => v.kind !== "直線"),
    });
    await openBeforeInfoTab(page);

    await expect(rowByLabel(page, "一周")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "まわり足")).toBeVisible();
    await expect(rowByLabel(page, "直線")).toHaveCount(0);
  });

  test("匿名に権限が無い場合（096未適用）は行も出典も出さない", async ({
    page,
  }) => {
    const denied = (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_original_exhibition",
        }),
      });
    await page.route("**/rest/v1/race_original_exhibition?*", denied);
    await page.route("**/rest/v1/race_original_exhibition_values*", denied);
    await openBeforeInfoTab(page);

    // 直前情報タブ自体は出たうえで、オリジナル展示の行と出典だけが出ない
    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    await expect(rowByLabel(page, "まわり足")).toHaveCount(0);
    await expect(rowByLabel(page, "直線")).toHaveCount(0);
    // 展示進入（BOA-485）の出典は同じブロックに出うるので、BOATCASTの出典に絞って見る
    await expect(
      page.locator(".rbi-source", { hasText: "BOATCAST" }),
    ).toHaveCount(0);
  });

  test("まだ計測されていないレースでは行も出典も出さない（「—」を並べない）", async ({
    page,
  }) => {
    await routeOriginalExhibition(page, { header: null, values: [] });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    // 展示進入（BOA-485）の出典は同じブロックに出うるので、BOATCASTの出典に絞って見る
    await expect(
      page.locator(".rbi-source", { hasText: "BOATCAST" }),
    ).toHaveCount(0);
  });

  // --- ここから /code-review の指摘に対する再現テスト（2026-09-28） ---

  test("096未適用で一度開いた後に権限が付いたら、リロード無しの再訪でも行が出る（forbiddenをキャッシュしない）", async ({
    page,
  }) => {
    // 1回目: 権限が無い（096未適用）
    const denied = (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "permission denied for table race_original_exhibition",
        }),
      });
    await page.route("**/rest/v1/race_original_exhibition?*", denied);
    await page.route("**/rest/v1/race_original_exhibition_values*", denied);
    await openBeforeInfoTab(page);
    await expect(rowByLabel(page, "一周")).toHaveCount(0);

    // 2回目: 096を適用した後を模して200を返す。forbiddenがキャッシュされていると、
    // 過去レースのキーは7日TTLなのでここで行が出ない
    //
    // denied は unroute せず、上から200のハンドラを重ねる（後から登録した page.route が
    // 先に評価され、fulfill すれば denied には回らない）。unroute で page のルートが
    // 一度0件になると、Playwright はそのとき処理中の要求を context 側（録画の再生）へ
    // 送り直す。同じ要求がクライアント側の page→context の経路でも処理され、
    // 「Route is already handled!」で落ちた（BOA-661、CIの trace で実測）
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES,
    });
    await page.goto("/");
    await openBeforeInfoTab(page);
    await expect(rowByLabel(page, "一周")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toContainText("36.91");
  });

  test("全艇が欠測（value=null）の項目は、行だけでなく出典の項目名にも出さない", async ({
    page,
  }) => {
    // 津・三国の一周のように、ファイルが `--.--` を返す項目は value=NULL で入る
    // （マイグレーション091のコメント）。行が出ないのに出典だけが名乗ると、
    // 出していない値の出典を表示することになる
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES.map((v) =>
        v.kind === "一周" ? { ...v, value: null } : v,
      ),
    });
    await openBeforeInfoTab(page);

    await expect(rowByLabel(page, "まわり足")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    const source = page.locator(".rbi-source");
    await expect(source).toBeVisible();
    await expect(source).toContainText("まわり足");
    await expect(source).not.toContainText("一周");
  });

  test("全項目が欠測なら行も出典も出さない", async ({ page }) => {
    await routeOriginalExhibition(page, {
      header: {
        item_labels: "一周|まわり足|直線",
        updated_at: "2026-09-21T06:42:00Z",
      },
      values: VALUES.map((v) => ({ ...v, value: null })),
    });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
    // 展示進入（BOA-485）の出典は同じブロックに出うるので、BOATCASTの出典に絞って見る
    await expect(
      page.locator(".rbi-source", { hasText: "BOATCAST" }),
    ).toHaveCount(0);
  });

  // **「別のレースへ移っても前のレースの値が残らない」はE2Eにしていない。**
  // raceIdとセットで持つ修正（RaceBeforeInfoTab）は入れてあるが、この不具合が
  // 顕在化するのは「未確定のレース同士を行き来する」ときだけ。確定済みの
  // レース同士だと defaultTabId が result のまま→basic→result と揺れて
  // RaceTabs がタブをリセットし、RaceBeforeInfoTab が作り直されるため、
  // 修正の有無で結果が変わらない（実測、2026-09-28）。未確定のレースを
  // 2つ用意するには「当日の未発走レース」が要り、実行時刻とDBの状態に
  // 依存してフレークになるため、テストは置かない（BOA-452のPRコメントに記録）
});

// 展示進入（スタート展示のコース、BOA-485）。exhibition_data の列は
// getRaceMotorMaintenanceBreakdown の1回の取得に足している（クエリ本数を増やさない）。
// DBの状態に依存しないよう、そのリクエスト（select に exhibition_course を含むもの）
// だけを page.route で差し替える
test.describe("レース詳細の直前情報タブ: 展示進入", () => {
  const RACE = "/race/2026-09-21-05-12";
  // 取得開始（2026-09-21）より前のレース。展示進入の値は1つも入っていない
  const RACE_BEFORE_START = "/race/2026-09-18-05-01";

  const row = (boat, course, extra = {}) => ({
    boat_number: boat,
    tilt: -0.5,
    adjustment_weight: 0,
    propeller_change: null,
    parts_changed: null,
    today_weight: 52.0,
    prev_race_no: null,
    prev_entry_course: null,
    prev_start_timing: null,
    prev_finish_rank: null,
    exhibition_course: course,
    is_absent: false,
    updated_at: "2026-09-21T07:12:56Z",
    ...extra,
  });

  const routeMaintenance = async (page, fulfill) => {
    await page.route("**/rest/v1/exhibition_data?*", (route) => {
      if (!route.request().url().includes("exhibition_course"))
        return route.fallback();
      return fulfill(route);
    });
  };

  const stubRows = (rows) => (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });

  const openBeforeInfoTab = async (page, url = RACE) => {
    await page.goto(url);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  const courseRow = (page) =>
    page.locator(".drt-table tbody tr").filter({
      has: page.locator(".drt-label-full", { hasText: /^展示進入$/ }),
    });

  test("枠番と違うコースに入った艇だけ強調し、内へ/外へを添え、出典を表の下に1回出す", async ({
    page,
  }) => {
    // 3号艇が5コース、4号艇が3コース、5号艇が4コース（2026-09-26 徳山7Rの実データと同じ並び）
    await routeMaintenance(
      page,
      stubRows([
        row(1, 1),
        row(2, 2),
        row(3, 5),
        row(4, 3),
        row(5, 4),
        row(6, 6),
      ]),
    );
    await openBeforeInfoTab(page);

    const cells = courseRow(page).locator("td.drt-cell");
    await expect(cells).toHaveCount(6, { timeout: 20000 });
    await expect(cells.nth(0)).toHaveText("1コース");
    await expect(cells.nth(0)).not.toHaveClass(/drt-entry-moved/);
    await expect(cells.nth(2)).toContainText("5コース");
    await expect(cells.nth(2)).toContainText("外へ");
    await expect(cells.nth(2)).toHaveClass(/drt-entry-moved/);
    await expect(cells.nth(3)).toContainText("3コース");
    await expect(cells.nth(3)).toContainText("内へ");
    await expect(page.locator(".drt-entry-moved")).toHaveCount(3);

    // ADR-0067の3点（出典・取得時刻・再配布しない旨）が1ブロックだけ
    const source = page.locator(".rbi-source");
    await expect(source).toHaveCount(1);
    await expect(source).toContainText("BOAT RACE オフィシャルウェブサイト");
    await expect(source).toContainText("9/21 16:12");
    await expect(source).toContainText("再配布はしていません");
    await expect(
      page.getByTestId("exhibition-course-out-of-range"),
    ).toHaveCount(0);
  });

  test("欠場艇は「欠場」と出し、コースの「—」と区別する", async ({ page }) => {
    await routeMaintenance(
      page,
      stubRows([
        row(1, 1),
        row(2, 2),
        row(3, 3),
        row(4, 4),
        row(5, null, { is_absent: true }),
        row(6, 5),
      ]),
    );
    await openBeforeInfoTab(page);

    const cells = courseRow(page).locator("td.drt-cell");
    await expect(cells.nth(4)).toHaveText("欠場", { timeout: 20000 });
    await expect(cells.nth(5)).toContainText("5コース");
  });

  test("取得開始前のレースでは行を出さず、表示対象外である旨を注記する", async ({
    page,
  }) => {
    await openBeforeInfoTab(page, RACE_BEFORE_START);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByTestId("exhibition-course-out-of-range"),
    ).toBeVisible();
    await expect(courseRow(page)).toHaveCount(0);
    await expect(
      page.locator(".rbi-source", {
        hasText: "BOAT RACE オフィシャルウェブサイト",
      }),
    ).toHaveCount(0);
  });

  test("取得に失敗したら「データなし」に化けさせず、失敗を表示する", async ({
    page,
  }) => {
    await routeMaintenance(page, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "stub failure" }),
      }),
    );
    await openBeforeInfoTab(page);

    await expect(page.locator(".inline-fetch-error")).toBeVisible({
      timeout: 20000,
    });
    // 行は残る（対象期間のレース）。値は出さない
    await expect(courseRow(page)).toHaveCount(1);
    await expect(
      page.locator(".rbi-source", { hasText: "BOAT RACE" }),
    ).toHaveCount(0);
  });
});

// この枠からの進入コース（BOA-485 案A）。旧「平均進入順」（全枠を混ぜた平均で、
// 1号艇でも3.16になっていた）を置き換えた。題材はユーザー指摘の実レース
// 2026-09-26-08-02。集計はこのレースより前に絞るので、後のレースが増えても値は動かない
test.describe("レース詳細の直前情報タブ: この枠からの進入コース", () => {
  const RACE = "/race/2026-09-26-08-02";

  const openBeforeInfoTab = async (page) => {
    await page.goto(RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  test("艇ごとに同じ枠からの進入の横棒と枠なり%・走数を出し、平均進入順の行は出さない", async ({
    page,
  }) => {
    await openBeforeInfoTab(page);

    const card = page.getByTestId("entry-course-dist");
    await expect(card).toBeVisible({ timeout: 20000 });
    // 1号艇は1枠から常に1コース（前づけされていない）
    const boat1 = page.getByTestId("entry-course-dist-1");
    await expect(boat1).toContainText("枠なり 100%", { timeout: 30000 });
    await expect(boat1).toContainText(/1枠で\d+走/);
    await expect(boat1.locator(".ecd-seg")).toHaveCount(1);
    // 4号艇は4枠から内（2・3コース）に入ったことがある＝前づけ%が出る
    const boat4 = page.getByTestId("entry-course-dist-4");
    await expect(boat4).toContainText(/前づけ \d+%/);
    expect(await boat4.locator(".ecd-seg").count()).toBeGreaterThan(1);

    // 旧行は表から消えている
    await expect(
      page.locator(".drt-table .drt-label-full", { hasText: "平均進入順" }),
    ).toHaveCount(0);
    // 注記は集計期間の実態（2025年12月以降）を書く。「過去2年間の集計」とは言わない
    await expect(card).toContainText("2025年12月以降");
    await expect(page.locator(".rbi-note").first()).not.toContainText(
      "過去2年間の集計",
    );
  });

  test("選手の出走履歴の取得に失敗したら「出走なし」に化けさせず、再読み込みを出す", async ({
    page,
  }) => {
    // getRacerScopedRaceStats の race_results 取得（actual_course を含む）だけを落とす
    await page.route("**/rest/v1/race_results?*", (route) => {
      const url = decodeURIComponent(route.request().url());
      if (!url.includes("actual_course_1") || !url.includes("payout_win"))
        return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "stub failure" }),
      });
    });
    await openBeforeInfoTab(page);

    const card = page.getByTestId("entry-course-dist");
    await expect(card.locator(".inline-fetch-error")).toBeVisible({
      timeout: 30000,
    });
    await expect(card).not.toContainText("この枠での出走なし");
    await expect(card.locator(".ecd-seg")).toHaveCount(0);
  });

  // /code-review の指摘の再現テスト（2026-09-28）。読み込み中の判定に
  // レース単位の failed を混ぜていたため、1艇が先に失敗すると、まだ取得中の
  // 他艇まで「—」になり、失敗・データなしと見分けがつかなかった
  test("1艇だけ取得に失敗しても、まだ取得中の他艇は読み込み中のまま表示する", async ({
    page,
  }) => {
    // 1号艇（登番3833）の出走履歴だけ即失敗、他の艇は応答を遅らせる
    await page.route("**/rest/v1/race_entries?*", async (route) => {
      const url = decodeURIComponent(route.request().url());
      if (!url.includes("f_count")) return route.fallback();
      if (url.includes("racer_id=eq.3833"))
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "stub failure" }),
        });
      await new Promise((resolve) => setTimeout(resolve, 15000));
      return route.fallback().catch(() => {});
    });
    await openBeforeInfoTab(page);

    const card = page.getByTestId("entry-course-dist");
    await expect(card.locator(".inline-fetch-error")).toBeVisible({
      timeout: 30000,
    });
    // 失敗した1号艇は「—」、取得中の2号艇はスケルトン
    await expect(
      page.getByTestId("entry-course-dist-1").locator(".ecd-bar-empty"),
    ).toHaveText("—");
    const skeleton = page
      .getByTestId("entry-course-dist-2")
      .locator(".drt-skeleton");
    await expect(skeleton).toBeVisible();
    // スケルトンは棒と同じ幅を占める（表セル用の2.5em固定のままだと40pxの
    // 小さな塊になり、読み込み後に行の見た目が大きく変わる）
    expect((await skeleton.boundingBox()).width).toBeGreaterThan(120);
  });
});

// 前検タイム・公式2連率（節時点）をモータ情報タブに出す（BOA-451 / phase a FR-4a）
test.describe("レース詳細のモータ情報タブ: 前検タイムと公式2連率", () => {
  const RACE = "/race/2026-09-21-05-12";

  const openMotorTab = async (page) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    await expect(page.locator(".motor-ranking-table").first()).toBeVisible({
      timeout: 30000,
    });
  };

  test("前検の行が取れている節では「前検」列に秒数と節内順位が出て、出典が添えられる", async ({
    page,
  }) => {
    let racerIds = [];
    // 表示中レースの出走選手の登番を拾って、その選手ぶんの前検を返す
    await page.route("**/rest/v1/motor_pretest_stats*", async (route) => {
      const url = new URL(route.request().url());
      // 実レスポンスを一度取って登番を得る（節の全選手ぶんが返る）。
      // route.fetch() は録画を通らないため fetchRecorded を使う
      const response = await fetchRecorded(route);
      const rows = await response.json().catch(() => []);
      racerIds = Array.isArray(rows) ? rows.map((r) => r.racer_id) : [];
      const stub = racerIds.map((racerId, i) => ({
        racer_id: racerId,
        race_date:
          url.searchParams.get("race_date")?.slice(-10) ?? "2026-09-21",
        pretest_time: 6.6 + i * 0.01,
        pretest_rank: i + 1,
        racer_class: "A1",
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(stub),
      });
    });
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).toContainText("前検");
    // 過去レースは2連率の列そのものが出走表時点の公式値なので、同じ値の列を2本並べない
    // （BOA-329、2026-09-29 ユーザー判断(c)）。BOA-428 で、残す1本の見出しを当日と同じ
    // 「公式2連率（節時点）」にした（承認済みのモック）。期間で集計した2連率の列は出さない
    await expect(
      table.locator("thead th", { hasText: "公式2連率" }),
    ).toHaveCount(1);
    await expect(table.locator("thead")).not.toContainText(
      /2連率（(過去|直近)/,
    );
    // 6艇のどれかに前検の秒数（6.60〜6.9x）が出ている
    await expect(table.locator("td.motor-pretest-cell").first()).toHaveText(
      /\d\.\d{2}/,
    );
    await expect(page.locator(".motor-official-source-note")).toContainText(
      "BOAT RACE オフィシャルウェブサイト",
    );
  });

  test("節に前検の行が無い開催では「前検」列ごと出さない（「-」を6つ並べない）", async ({
    page,
  }) => {
    await page.route("**/rest/v1/motor_pretest_stats*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).not.toContainText("前検");
    await expect(table.locator("td.motor-pretest-cell")).toHaveCount(0);
    // 過去レースでは2連率の列が race_entries 由来の公式値で、前検が無くても出る。
    // 期間の切り替えは出さず、公式値である旨の注記に置き換える（BOA-329）
    // 1本だけの2連率の列は、BOA-428 から見出しが「公式2連率（節時点）」
    await expect(
      table.locator("thead th", { hasText: "公式2連率" }),
    ).toHaveCount(1);
    await expect(table.locator("thead")).not.toContainText(
      /2連率（(過去|直近)/,
    );
    await expect(page.locator(".period-toggle")).toHaveCount(0);
    await expect(
      page.getByText("出走表時点の公式値で表示しています"),
    ).toBeVisible();
  });

  test("旧形状のキャッシュが残っていても「前検」列が出る（キャッシュキーの版を上げている）", async ({
    page,
  }) => {
    // BOA-264 で 1着率・優出数を足したときと同じ事故。返り値に
    // フィールドを足したのにキャッシュキーの版を上げないと、過去レースは
    // 7日TTLの旧キャッシュが新フィールド無しの形で返り、列が消える
    await page.addInitScript(() => {
      const stale = [1, 2, 3, 4, 5, 6].map((n) => ({
        boat_number: n,
        player_name: `旧キャッシュ${n}`,
        motor_number: n,
        motor_2rate: 30,
        motor_3rate: 40,
        power_index: 0,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: 10,
      }));
      [90, 30].forEach((days) => {
        try {
          window.localStorage.setItem(
            `boatai:race-motor-breakdown-v3-5-${days}-2026-09-21-05-12`,
            JSON.stringify({ data: stale, timestamp: Date.now() }),
          );
        } catch {
          /* private window 等ではスキップ */
        }
      });
    });
    await openMotorTab(page);

    const table = page.locator(".motor-ranking-table").first();
    await expect(table.locator("thead")).toContainText("前検");
    await expect(table).not.toContainText("旧キャッシュ1");
  });
});

// 今節展示情報のオリジナル展示（BOA-473）と、連対率の桁（BOA-474）
//
// 「展示情報」表のオリジナル展示（BOA-452）は `race_id=eq.<id>` で1レース分を引き、
// 「今節展示情報」（BOA-473）は `race_id=in.(...)` で節ぶんをまとめて引く。
// 同じテーブルなのでクエリ文字列で振り分けてスタブする
test.describe("レース詳細の直前情報タブ: 今節のオリジナル展示", () => {
  const RACE = "/race/2026-09-21-05-12";

  // **要求された race_id から値を組み立てる**。選手の実際の節は実データ次第なので、
  // 固定のレースIDを返すと画面側のlookup（`${raceId}-${boatNumber}`）が空振りする。
  // 種別ごとに定数を返すので、前走も節平均も同じ値になる
  const KIND_VALUE = { 一周: 37.0, まわり足: 5.8, 直線: 7.2 };
  const meetBodyFor = (url) => {
    const ids = (decodeURIComponent(url).match(/race_id=in\.\(([^)]*)\)/) ??
      [])[1];
    if (!ids) return [];
    return ids
      .split(",")
      .map((id) => id.replace(/^"|"$/g, ""))
      .flatMap((raceId) =>
        [1, 2, 3, 4, 5, 6].flatMap((boat) =>
          Object.entries(KIND_VALUE).map(([kind, value]) => ({
            race_id: raceId,
            boat_number: boat,
            kind,
            value,
          })),
        ),
      );
  };

  const routeValues = async (page, { meet, single }) => {
    await page.route("**/rest/v1/race_original_exhibition_values*", (route) => {
      const url = route.request().url();
      const isMeet = decodeURIComponent(url).includes("race_id=in.");
      const spec = isMeet ? meet : single;
      if (spec === "forbidden") {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            code: "42501",
            message: "permission denied for table",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(spec === "derive" ? meetBodyFor(url) : spec),
      });
    });
    await page.route("**/rest/v1/race_original_exhibition?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          item_labels: "一周|まわり足|直線",
          updated_at: "2026-09-21T06:42:00Z",
        }),
      }),
    );
  };

  const openBeforeInfoTab = async (page) => {
    await page.goto(RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  const rowByLabel = (page, label) =>
    page.locator(".drt-table tbody tr").filter({
      has: page.locator(".drt-label-full", {
        hasText: new RegExp(`^${label}$`),
      }),
    });

  test("節に値があると、今節一周・今節まわり足・今節直線の行が前走と平均で出る", async ({
    page,
  }) => {
    await routeValues(page, { meet: "derive", single: [] });
    await openBeforeInfoTab(page);

    // 種別ごとに定数を返しているので、前走も節平均も同じ値になる
    await expect(rowByLabel(page, "今節一周")).toBeVisible({ timeout: 30000 });
    await expect(rowByLabel(page, "今節一周")).toContainText("37.00");
    await expect(rowByLabel(page, "今節まわり足")).toContainText("5.80");
    await expect(rowByLabel(page, "今節直線")).toContainText("7.20");
    // 節に値が無い種別（半周ラップ）の行は作らない
    await expect(rowByLabel(page, "今節半周ラップ")).toHaveCount(0);
  });

  test("節に値が無ければ今節の行を出さない（「—」を並べない）", async ({
    page,
  }) => {
    await routeValues(page, { meet: [], single: [] });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "今節一周")).toHaveCount(0);
    await expect(rowByLabel(page, "今節まわり足")).toHaveCount(0);
    await expect(rowByLabel(page, "今節直線")).toHaveCount(0);
  });

  test("匿名に権限が無い場合（096未適用）は今節の行も出さない", async ({
    page,
  }) => {
    await routeValues(page, { meet: "forbidden", single: "forbidden" });
    await openBeforeInfoTab(page);

    await expect(page.locator(".drt-table")).toBeVisible({ timeout: 20000 });
    await expect(rowByLabel(page, "今節一周")).toHaveCount(0);
    // 「展示情報」表のオリジナル展示（BOA-452）も出ない
    await expect(rowByLabel(page, "一周")).toHaveCount(0);
  });

  test("節ぶんの取得は、6選手が出揃ってから1通りのID集合でしか走らない", async ({
    page,
  }) => {
    const meetRequests = [];
    await page.route("**/rest/v1/race_original_exhibition_values*", (route) => {
      const url = decodeURIComponent(route.request().url());
      if (url.includes("race_id=in.")) meetRequests.push(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          url.includes("race_id=in.") ? meetBodyFor(url) : [],
        ),
      });
    });
    await openBeforeInfoTab(page);
    await expect(rowByLabel(page, "今節一周")).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(3000);

    // **HTTPの本数ではなく「要求したID集合が何通りあるか」を見る**。
    // fetchAllByIn は1000行ごとに .range() でページングするので、長い節
    // （12R×7日＝最大84レース → 84×6艇×3項目＝1,512行）では正当に2本以上になる。
    // 守りたいのは「選手ごとに投げていない」「集合が育つたびに投げ直していない」
    // ことなので、race_id=in.(...) の中身の種類が1通りであることを見る
    const distinctIdSets = new Set(
      meetRequests.map(
        (u) => (u.match(/race_id=in\.\(([^)]*)\)/) ?? [])[1] ?? "",
      ),
    );
    expect(distinctIdSets.size).toBe(1);
  });
});

test.describe("レース詳細のモータ情報タブ: 連対率の桁（BOA-474）", () => {
  test("2連率・公式2連率・3連率をすべて小数1桁で出す", async ({ page }) => {
    await page.goto("/race/2026-09-21-05-12");
    await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
    const table = page.locator(".motor-ranking-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });

    // 同じ節・同じモーターでも、当日の出走表更新が走る前の行は1桁で入っている。
    // 2桁で出すと同じモーターが 54.80 と 54.84 に見えるため1桁に揃えた
    // 列は位置でなく見出しで引く。会場内順位の列（BOA-428、「2位/65」）は会場のスナップショットが
    // あるときだけ出るので、位置で決め打ちすると録画の日によって別の列を読む（BOA-929）
    // 見出しと本体は同じ1回の evaluate で読む。会場内順位の列は一覧表を出したあとに
    // スナップショットの取得を待って差し込まれる（MotorConditionChart の setVenueRanks）。
    // 見出しを数えたあとで列が増えると、nth-child で読む列が1つ右へずれ、「3位/65」を
    // 2連率として読んでいた（2026-10-26、e2e-shard で繰り返し落ちた）
    const cells = await table.evaluate((tableEl) => {
      const heads = [...tableEl.querySelectorAll("thead th")];
      const rateIndexes = heads
        .map((th, i) => ({
          i,
          text: th.textContent.trim(),
          venueRank: th.classList.contains("motor-venue-rank-head"),
        }))
        .filter((h) => /連率/.test(h.text) && !h.venueRank)
        .map((h) => h.i);
      const rows = [...tableEl.querySelectorAll("tbody tr")].map((tr) => [
        ...tr.children,
      ]);
      return {
        headCount: heads.length,
        rateIndexes,
        rows: rows.map((tds) => ({
          width: tds.length,
          texts: rateIndexes.map((i) => ({
            column: i + 1,
            header: heads[i].textContent.trim(),
            text: (tds[i]?.innerText ?? "").trim(),
          })),
        })),
      };
    });
    expect(cells.rateIndexes.length).toBeGreaterThan(0);
    expect(cells.rows.length).toBeGreaterThan(0);
    for (const row of cells.rows) {
      // 本体の列の数が見出しと違えば、位置で引いた値は別の列のもの
      expect(row.width, "見出しと本体の列の数").toBe(cells.headCount);
      for (const { column, header, text } of row.texts) {
        // セルには数値のあとに注記・札（「前の節までの走り（N走）で出た数字」「初下ろし」等）が
        // 付くことがある。桁を見るのは先頭の数値だけ
        const value = text.match(/^\d+(?:\.\d+)?/)?.[0];
        if (value === undefined) continue;
        expect(value, `${column}列目（${header}）: ${text}`).toMatch(
          /^\d+\.\d$/,
        );
      }
    }
  });
});

// 展示前の体重（BOA-484）。展示前は exhibition_data の行がまだ無いため、
// 出走表の体重（race_entries.weight_kg）を直前情報タブに出し、チルトは展示後に
// 公開される旨を添える。DBの状態に依存しないよう、直前情報の設定値の取得
// （exhibition_data の select に tilt を含むもの）と出走表の体重の取得だけを差し替える
test.describe("レース詳細の直前情報タブ: 展示前の体重", () => {
  const RACE = "/race/2026-09-21-05-12";
  const ENTRY_WEIGHTS = [1, 2, 3, 4, 5, 6].map((n) => ({
    boat_number: n,
    weight_kg: 50 + n,
  }));

  const isMaintenance = (url) =>
    url.pathname.endsWith("/rest/v1/exhibition_data") &&
    (url.searchParams.get("select") ?? "").includes("tilt");
  const isEntryWeights = (url) =>
    url.pathname.endsWith("/rest/v1/race_entries") &&
    url.searchParams.get("select") === "boat_number,weight_kg";

  const fulfillJson =
    (body, status = 200) =>
    (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

  const openBeforeInfoTab = async (page) => {
    await page.goto(RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    await expect(page.locator(".race-before-info-tab")).toBeVisible({
      timeout: 20000,
    });
  };

  const rowByLabel = (page, label) =>
    page.locator(".drt-table tbody tr").filter({
      has: page.locator(".drt-label-full", {
        hasText: new RegExp(`^${label}$`),
      }),
    });

  // 展示前の注記は確定済みのレースには出さない。確定済みの過去レースを
  // 「未確定」に見せるため、予想データの応答から結果（rank1 を持つ result）を外す
  // （Edge API・RPC のどちらの経路でも効くよう、応答のJSONを走査する）
  const stripResults = (value) => {
    if (Array.isArray(value)) return value.map(stripResults);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) =>
          k === "result" && v && typeof v === "object" && v.rank1 != null
            ? [k, null]
            : [k, stripResults(v)],
        ),
      );
    }
    return value;
  };
  const routeUnfinished = async (page) => {
    const handler = async (route) => {
      try {
        // route.fetch() は録画を通らないため fetchRecorded を使う（e2e/fixtures.js）
        const response = await fetchRecorded(route);
        const json = stripResults(await response.json());
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          json,
        });
      } catch (error) {
        // 録画に無い要求は本番へ素通しして応答を待つ（ADR-0077 の A改）。
        // アサーションが先に終わってページが閉じた後の失敗は、テストの結果ではない
        if (route.request().frame().page().isClosed()) return;
        throw error;
      }
    };
    await page.route("**/api/predictions/**", handler);
    await page.route("**/rest/v1/rpc/get_predictions*", handler);
  };

  // routeUnfinished の route.fetch は本物の応答を待つため、アサーションが先に終わると
  // テスト終了時にまだ応答待ちのリクエストが残り、「page closed」でテストが失敗扱いになる
  // （2026-09-28実測。アサーションは全て通っていた）。終了時に待ちを捨てる。
  // 録画の再生（replay）では fetchRecorded が待たずに返るうえ、ここで page のルートを
  // 外すと context 側の routeFromHAR と競合して「Route is already handled!」で落ちる
  // （BOA-466で実測）ため、replay では外さない。本番へ出る live と録画中（record）は従来どおり
  test.afterEach(async ({ page }) => {
    if (E2E_MODE !== "replay") {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("展示前（exhibition_data が空）は出走表の体重を出し、チルトは展示後に公開される旨を添える", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    const weightRow = rowByLabel(page, "当日体重");
    await expect(weightRow).toBeVisible({ timeout: 20000 });
    await expect(weightRow.locator("td.drt-cell")).toHaveText([
      "51.0kg",
      "52.0kg",
      "53.0kg",
      "54.0kg",
      "55.0kg",
      "56.0kg",
    ]);
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toContainText(
      "チルトは展示航走の後に公開されます",
    );
  });

  test("展示後は exhibition_data の当日体重を優先し、展示前の注記を出さない", async ({
    page,
  }) => {
    const maintenance = [1, 2, 3, 4, 5, 6].map((n) => ({
      boat_number: n,
      tilt: -0.5,
      adjustment_weight: n === 1 ? 0.5 : 0,
      propeller_change: null,
      parts_changed: null,
      today_weight: n === 1 ? 51.5 : 50 + n,
      prev_race_no: null,
      prev_entry_course: null,
      prev_start_timing: null,
      prev_finish_rank: null,
    }));
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson(maintenance));
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    const weightRow = rowByLabel(page, "当日体重");
    await expect(weightRow).toBeVisible({ timeout: 20000 });
    // 1号艇は出走表（51.0）ではなく直前情報（51.5）の値
    await expect(weightRow.locator("td.drt-cell").first()).toHaveText("51.5kg");
    await expect(rowByLabel(page, "チルト")).toContainText("-0.5");
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  // BOA-497: 展示前の途中の結果をキャッシュしない。以前は当日分30分・過去分7日、
  // localStorage に残り、展示後に値が入っても再訪問・リロードで「—」のまま出た
  const maintenanceRow = (n, exhibited) => ({
    boat_number: n,
    exhibition_time: exhibited ? 6.7 : null,
    tilt: exhibited ? -0.5 : null,
    adjustment_weight: 0,
    propeller_change: null,
    parts_changed: null,
    today_weight: 50 + n,
    prev_race_no: null,
    prev_entry_course: null,
    prev_start_timing: null,
    prev_finish_rank: null,
    exhibition_course: exhibited ? n : null,
    is_absent: false,
    updated_at: "2026-09-21T07:12:56Z",
  });
  const tiltCells = (page) => rowByLabel(page, "チルト").locator("td.drt-cell");

  test("展示前（体重だけの行）に開いた後、展示後に開き直すとチルトが出る", async ({
    page,
  }) => {
    let exhibited = false;
    let requests = 0;
    await page.route(isMaintenance, (route) => {
      requests += 1;
      return fulfillJson(
        [1, 2, 3, 4, 5, 6].map((n) => maintenanceRow(n, exhibited)),
      )(route);
    });
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).first()).toHaveText("—", { timeout: 20000 });

    exhibited = true;
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).first()).toContainText("-0.5", {
      timeout: 20000,
    });
    expect(requests).toBeGreaterThanOrEqual(2);
  });

  test("一部の艇だけ展示タイムが入った途中の結果もキャッシュせず、揃った後はキャッシュする", async ({
    page,
  }) => {
    let stage = "partial";
    let requests = 0;
    await page.route(isMaintenance, (route) => {
      requests += 1;
      return fulfillJson(
        [1, 2, 3, 4, 5, 6].map((n) =>
          maintenanceRow(n, stage === "complete" || n <= 3),
        ),
      )(route);
    });
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).nth(3)).toHaveText("—", { timeout: 20000 });

    stage = "complete";
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).nth(3)).toContainText("-0.5", {
      timeout: 20000,
    });

    // 揃った結果は保存される: 応答を途中の状態へ戻しても、開き直しで値が残り、取り直さない
    const afterComplete = requests;
    stage = "partial";
    await openBeforeInfoTab(page);
    await expect(tiltCells(page).nth(3)).toContainText("-0.5", {
      timeout: 20000,
    });
    expect(requests).toBe(afterComplete);
  });

  test("出走表の体重の取得に失敗したら、未公開と区別して取得失敗を出す", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(
      isEntryWeights,
      fulfillJson({ code: "57014", message: "canceling statement" }, 500),
    );
    await openBeforeInfoTab(page);

    await expect(
      page.locator(".inline-fetch-error", {
        hasText: "出走表の体重を取得できませんでした",
      }),
    ).toBeVisible({ timeout: 20000 });
    // 値が無いので展示前の注記は出さない
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  test("体重が未公開（出走表・直前情報とも空）なら注記も取得失敗も出さない", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(
      isEntryWeights,
      fulfillJson(ENTRY_WEIGHTS.map((r) => ({ ...r, weight_kg: null }))),
    );
    await openBeforeInfoTab(page);

    const weightRow = rowByLabel(page, "当日体重");
    await expect(weightRow).toBeVisible({ timeout: 20000 });
    await expect(weightRow.locator("td.drt-cell").first()).toHaveText("—");
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
    await expect(
      page.locator(".inline-fetch-error", {
        hasText: "出走表の体重を取得できませんでした",
      }),
    ).toHaveCount(0);
  });

  // --- ここから /code-review の指摘に対する再現テスト（2026-09-28） ---

  test("当日体重は基本情報タブ（データ出走表）にも残る（直前情報タブへ移さない）", async ({
    page,
  }) => {
    const maintenance = [1, 2, 3, 4, 5, 6].map((n) => ({
      boat_number: n,
      tilt: 0,
      adjustment_weight: 0,
      propeller_change: null,
      parts_changed: null,
      today_weight: 50 + n,
      prev_race_no: null,
      prev_entry_course: null,
      prev_start_timing: null,
      prev_finish_rank: null,
    }));
    await page.route(isMaintenance, fulfillJson(maintenance));
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const basicRow = page
      .locator(".data-race-table .drt-table tbody tr")
      .filter({
        has: page.locator(".drt-label-full", { hasText: /^当日体重$/ }),
      });
    await expect(basicRow).toBeVisible({ timeout: 20000 });
    await expect(basicRow.locator("td.drt-cell").first()).toHaveText("51.0kg");
  });

  test("直前情報の設定値の取得に失敗したときは、取得失敗を「チルト未公開」の注記に化けさせない", async ({
    page,
  }) => {
    await routeUnfinished(page);
    await page.route(
      isMaintenance,
      fulfillJson({ code: "57014", message: "canceling statement" }, 500),
    );
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    // 体重は出走表の値で出る
    await expect(
      rowByLabel(page, "当日体重").locator("td.drt-cell").first(),
    ).toHaveText("51.0kg", { timeout: 20000 });
    await expect(page.locator(".inline-fetch-error").first()).toBeVisible();
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  test("確定済みのレースでは、直前情報が入らなかったときも展示前の注記を出さない", async ({
    page,
  }) => {
    // routeUnfinished を使わない＝結果ありの確定済みレース
    await page.route(isMaintenance, fulfillJson([]));
    await page.route(isEntryWeights, fulfillJson(ENTRY_WEIGHTS));
    await openBeforeInfoTab(page);

    await expect(
      rowByLabel(page, "当日体重").locator("td.drt-cell").first(),
    ).toHaveText("51.0kg", { timeout: 20000 });
    await expect(page.getByTestId("rbi-pre-exhibition-note")).toHaveCount(0);
  });

  test("全艇に直前情報の体重があれば、出走表の体重の取得失敗は出さない（表示に影響しない）", async ({
    page,
  }) => {
    const maintenance = [1, 2, 3, 4, 5, 6].map((n) => ({
      boat_number: n,
      tilt: 0,
      adjustment_weight: 0,
      propeller_change: null,
      parts_changed: null,
      today_weight: 50 + n,
      prev_race_no: null,
      prev_entry_course: null,
      prev_start_timing: null,
      prev_finish_rank: null,
    }));
    await page.route(isMaintenance, fulfillJson(maintenance));
    await page.route(
      isEntryWeights,
      fulfillJson({ code: "57014", message: "canceling statement" }, 500),
    );
    await openBeforeInfoTab(page);

    await expect(
      rowByLabel(page, "当日体重").locator("td.drt-cell").first(),
    ).toHaveText("51.0kg", { timeout: 20000 });
    await expect(
      page.locator(".inline-fetch-error", {
        hasText: "出走表の体重を取得できませんでした",
      }),
    ).toHaveCount(0);
  });
});

test.describe("レース詳細の見出し: 開催の何日目か（BOA-488）", () => {
  // race_conditions.series_day / is_final_day の実データ（確定済みの過去レース）。
  // 2026-09-22 常滑は節の初日、2026-09-26 常滑は5日目、2026-09-24 戸田は7日目で最終日
  for (const [raceId, label] of [
    ["2026-09-22-08-02", "初日"],
    ["2026-09-26-08-02", "5日目"],
    ["2026-09-24-02-02", "最終日"],
  ]) {
    test(`${raceId} の見出しに「${label}」が出る`, async ({ page }) => {
      await page.goto(`/race/${raceId}`);
      const badge = page.locator(".page-header h1 .race-detail-series-day");
      await expect(badge).toHaveText(label, { timeout: 25000 });
    });
  }

  test("英語版では訳語で出る", async ({ page }) => {
    await page.goto("/en/race/2026-09-24-02-02");
    await expect(
      page.locator(".page-header h1 .race-detail-series-day"),
    ).toHaveText("Last day", { timeout: 25000 });
  });
});

test.describe("レース詳細の見出し: グレードとレース種別（BOA-509）", () => {
  // 実データ（確定済みの過去レース）。2026-09-27 若松12RはG1ヤングダービーの優勝戦、
  // 戸田は一般（ippan）の「ＴＡＭＲＯＮＣＵＰ」で、2Rが予選・5Rが企画レース「ウインウイン５」
  const h1 = (page) => page.locator(".page-header h1");
  const kicker = (page) => page.locator(".race-detail-kicker");

  test("G1優勝戦: グレードバッジ・節タイトル・優勝戦チップが出る", async ({
    page,
  }) => {
    await page.goto("/race/2026-09-27-20-12");
    await expect(h1(page).locator(".race-detail-stage")).toHaveText(/優勝戦/, {
      timeout: 25000,
    });
    await expect(h1(page).locator(".race-detail-stage--final")).toBeVisible();
    await expect(kicker(page).locator(".race-detail-grade")).toHaveText("G1");
    // 全角英数は NFKC で半角にする（DBは「第１３回ヤングダービー」）
    await expect(kicker(page)).toContainText("第13回ヤングダービー");
    // 種別チップは h1 のアクセシブルネームに含まれる
    await expect(
      page.getByRole("heading", { level: 1, name: /若松 12R.*優勝戦/ }),
    ).toBeVisible();
  });

  test("分類できない企画レース名は公式表記のまま出す", async ({ page }) => {
    await page.goto("/race/2026-09-27-02-05");
    const chip = h1(page).locator(".race-detail-stage");
    await expect(chip).toHaveText("ウインウイン5", { timeout: 25000 });
    await expect(chip).toHaveClass(/race-detail-stage--raw/);
    await expect(chip).toHaveAttribute("translate", "no");
    // 種別名と見分けがつかないため、何の名前かをツールチップで補う（ファン評価 P2）
    await expect(chip).toHaveAttribute("title", "会場独自のレース名");
  });

  // ファン評価 P1: 予選期間の「予選特賞」と予選落ち組の「一般特選」を
  // 同じ「特別戦」にまとめない（得点率に入るかどうかが逆になるため）
  for (const [raceId, label, official] of [
    ["2026-09-20-03-09", "予選特別戦", "予選特賞"],
    ["2026-09-25-10-09", "一般特選", null],
    ["2026-09-20-14-10", "選抜戦", null],
    // ファン評価3周目: 予選期間の「予選選抜」は最終日の選抜戦と分ける
    ["2026-09-17-15-11", "予選特別戦", "予選選抜"],
    // 男女Ｗ優勝戦の準優勝戦は「Ｗ準優戦前半」（「勝」が無い）。以前は「会場独自の
    // レース名」として原文のまま出ていた（BOA-728）
    ["2026-03-24-05-03", "🥈 準優勝戦", "W準優戦前半"],
  ]) {
    test(`${raceId} の種別は「${label}」`, async ({ page }) => {
      await page.goto(`/race/${raceId}`);
      const chip = h1(page).locator(".race-detail-stage");
      await expect(chip).toHaveText(label, { timeout: 25000 });
      if (official) {
        await expect(chip).toHaveAttribute("title", `公式表記: ${official}`);
      }
    });
  }

  test("一般（ippan）はグレードバッジを出さず、節タイトルだけ出す", async ({
    page,
  }) => {
    await page.goto("/race/2026-09-27-02-02");
    await expect(h1(page).locator(".race-detail-stage")).toHaveText("予選", {
      timeout: 25000,
    });
    await expect(kicker(page)).toContainText("TAMRONCUP");
    await expect(kicker(page).locator(".race-detail-grade")).toHaveCount(0);
  });

  test("race_conditions 欠損レースは節タイトルを同会場の他レースで補い、種別は出さない", async ({
    page,
  }) => {
    // 2026-09-04 浜名湖9R は race_conditions に series_day=6 だけが入り、
    // is_final_day・race_title・race_stage が null だった（BOA-347）。本番の
    // race_conditions.race_stage がその後「一般」に補完され前提が崩れたため
    // （BOA-688）、画面が読むのは /rest/v1/race_conditions ではなく
    // /api/predictions/{date}（Edge API、get_predictions_by_date RPC が
    // race_conditions を raceStage/isFinalDay/raceTitle として返す）なので、
    // その応答だけを差し替えてこのレースの欠損を再現する。同じ日の他レースは
    // 実データのまま（kicker・最終日の補完元として使う。useDatePredictions が
    // 同じ会場の他レースから値を拾う）
    await page.route("**/api/predictions/2026-09-04*", async (route) => {
      try {
        // route.fetch() は録画を通らないため fetchRecorded を使う（ADR-0077）
        const response = await fetchRecorded(route);
        const body = await response.json();
        const races = (body.races || []).map((race) =>
          race.raceId === "2026-09-04-06-09"
            ? { ...race, raceStage: null, isFinalDay: null, raceTitle: null }
            : race,
        );
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          json: { ...body, races },
        });
      } catch (e) {
        // 本番データの定期実行（E2E_LIVE=1）では fetchRecorded が本番の応答を待つ。アサーションが
        // 先に通ってページが閉じた後に2回目の取得の応答が届き、「Target page, context or browser
        // has been closed」で失敗扱いになっていた（e2e-live.yml、10/02〜10/18 の15回すべて。
        // アサーションは全部通っていた。BOA-1163）。ページが閉じた後の失敗だけ無視する
        if (page.isClosed() || /has been closed/.test(String(e?.message)))
          return;
        throw e;
      }
    });
    await page.goto("/race/2026-09-04-06-09");
    await expect(kicker(page)).toContainText("クラウンメロン杯", {
      timeout: 25000,
    });
    await expect(h1(page).locator(".race-detail-stage")).toHaveCount(0);
    // is_final_day も項目ごとに補う（ファン評価2周目 P1、「6日目」と出ていた）
    await expect(h1(page).locator(".race-detail-series-day")).toHaveText(
      "最終日",
    );
  });

  test("英語版は分類名を訳し、公式表記はツールチップに残す", async ({
    page,
  }) => {
    await page.goto("/en/race/2026-09-27-20-12");
    const chip = h1(page).locator(".race-detail-stage");
    await expect(chip).toHaveText(/Final/, { timeout: 25000 });
    await expect(chip).toHaveAttribute("title", /優勝戦/);
    await expect(
      kicker(page).locator(".race-detail-kicker__title"),
    ).toHaveAttribute("translate", "no");
  });
});
