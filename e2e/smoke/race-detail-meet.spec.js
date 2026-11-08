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
});
