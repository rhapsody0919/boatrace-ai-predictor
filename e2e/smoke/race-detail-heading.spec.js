// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect, fetchRecorded } from "../fixtures.js";

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
