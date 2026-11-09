import { test, expect } from "../fixtures.js";

test.describe("レースページ再設計（BOA-168）", () => {
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
});
