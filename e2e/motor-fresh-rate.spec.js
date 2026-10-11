import { test, expect } from "./fixtures.js";

/**
 * 新しいモーターの最初の開催で、モータ情報の一覧が全艇 0.0% にならない（BOA-830、
 * 2026-10-11 ユーザー決定「艇ごとに、公式が0のときだけ自前の値」）。
 *
 * 常滑は 2026-10-06 にモーターを入れ替え、10/06〜10/11 の公式の出走表のモーター2連率は全艇 0。
 * 以前は過去レースの一覧が公式の値をそのまま出し、全行 0.0%・機力指数「-」だった。
 *
 * どのレースも録画（2026-10-02）より後なので、本番へ素通しになる。時計は 2026-10-12 に固定する
 * （過去レースとして開く）。当日のレースの確認だけ 2026-10-11 の朝にする。
 */

const PAST_CLOCK = new Date("2026-10-12T09:00:00+09:00");

// 録画に無いレースで、機力指数の計算が6艇×2回分の問い合わせを本番へ素通しする。
// 本番の応答が遅いと既定の60秒を超えることがある（手元の実測で1件あたり最大約70秒）
test.describe.configure({ timeout: 150000 });

async function openMotorTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
  const table = page.locator(".mcc-list-table").first();
  await expect(table).toBeVisible({ timeout: 90000 });
  return table;
}

// 艇番の行（枠のチップの数字で探す）
const boatRow = (table, boat) =>
  table
    .locator("tbody tr")
    .filter({
      has: table
        .page()
        .locator(".rr-boat-chip", { hasText: new RegExp(`^${boat}$`) }),
    });

test("常滑 10/06 7R: 0走は「まだ走っていません」、1走で2着以内0回は「0%（1走）」、2着以内ありは自前の値に「※」、帯を出す", async ({
  page,
}) => {
  await page.clock.setFixedTime(PAST_CLOCK);
  const table = await openMotorTab(page, "2026-10-06-08-07");

  await expect(page.locator(".motor-fresh-banner")).toHaveText(
    "常滑は10月6日にモーターが新しくなりました。公式の2連率は次の節から入ります。それまでは、龍神レーダーがこの場での走りから出した数字を出します",
  );
  // 1号艇 20号機: この世代でこのレースより前に0走
  await expect(boatRow(table, 1).locator(".motor-rate-bar-cell")).toHaveText(
    "まだ走っていません",
  );
  // 6号艇 35号機: 1走で2着以内0回
  await expect(boatRow(table, 6).locator(".motor-rate-bar-cell")).toHaveText(
    "0%（1走）",
  );
  // 3号艇 57号機: 1走で2着以内1回 → 自前の 100.0% に「※」
  const own = boatRow(table, 3).locator(".motor-rate-bar-cell");
  await expect(own).toContainText("100.0%");
  const mark = own.locator(".motor-fresh-own-mark");
  await expect(mark).toBeVisible();
  // 全行 0.0% にならない
  await expect(
    table.locator(".motor-rate-bar-cell", { hasText: /^0\.0%$/ }),
  ).toHaveCount(0);
  // 機力指数も自前（3号艇は「-」でない）
  await expect(boatRow(table, 3).locator(".power-index")).not.toHaveText("-");
  // 「集計前」の印は出さない
  await expect(table).not.toContainText("集計前");

  // 「※」を押すと、行のドリルダウンは開かず、表の下に出どころが出る
  await mark.click();
  await expect(table).toBeVisible();
  await expect(page.locator(".motor-fresh-own-note")).toHaveText(
    "3号艇: 公式の2連率がまだ出ていないモーターです。このレースより前の、この場での走り（1走）から出した2連率です",
  );
});

test("唐津 9/30 3R: 公式が出ている艇は公式に「前の節までの走り（N走）」、公式0の艇だけ自前、帯は出さない", async ({
  page,
}) => {
  await page.clock.setFixedTime(PAST_CLOCK);
  const table = await openMotorTab(page, "2026-09-30-23-03");

  await expect(page.locator(".motor-fresh-banner")).toHaveCount(0);
  // 1号艇 10号機: 公式 55.56（前の節まで9走）
  const official = boatRow(table, 1).locator(".motor-rate-bar-cell");
  await expect(official).toContainText("55.6%");
  await expect(official.locator(".motor-fresh-prior-runs")).toHaveText(
    "前の節までの走り（9走）で出た数字",
  );
  // 3号艇 7号機: 公式2連率0・8走で2着以内0回。3連率は公式（28.57）のまま
  await expect(boatRow(table, 3).locator(".motor-rate-bar-cell")).toHaveText(
    "0%（8走）",
  );
  await expect(boatRow(table, 3)).toContainText("28.6");
  // 4号艇 53号機: 公式0・0走
  await expect(boatRow(table, 4).locator(".motor-rate-bar-cell")).toHaveText(
    "まだ走っていません",
  );
});

test("当日のレースも同じ決まり: 常滑 10/11 の公式0の艇に自前の値を出す", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-11T08:00:00+09:00"));
  const table = await openMotorTab(page, "2026-10-11-08-05");

  await expect(page.locator(".motor-fresh-banner")).toBeVisible();
  await expect(
    table.locator(".motor-rate-bar-cell", { hasText: /^0\.0%$/ }),
  ).toHaveCount(0);
  // 4号艇 25号機: この世代で2着以内あり → 自前の値に「※」
  await expect(
    boatRow(table, 4).locator(".motor-rate-bar-cell .motor-fresh-own-mark"),
  ).toBeVisible();
});
