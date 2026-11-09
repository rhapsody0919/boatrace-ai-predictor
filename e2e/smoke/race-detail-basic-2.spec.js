import { test, expect } from "../fixtures.js";
import { openFixedRaceBeforeStart } from "./helpers.js";

test.describe("レースページ再設計（BOA-168）", () => {
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
});
