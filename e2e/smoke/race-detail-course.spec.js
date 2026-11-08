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
});
