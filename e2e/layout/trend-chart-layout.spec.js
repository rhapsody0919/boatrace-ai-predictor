// 推移の並べ方と図の幅（オーナー 2026-11-25「PC 表示なのに小さいグラフ」「グラフだけ伸びても意味ない。レスポンシブに」→ 案 A）。
// 枠が 480px までは 343 の座標を枠いっぱいに拡大する今までの見え方。それより広い枠（PC）は拡大を 480/343 倍で止め、
// 座標の幅を増やして横だけ枠いっぱいに伸ばす（文字・札・縦は今の PC と同じ大きさ）。選手の走の記録は録画に無いので、作った記録で返す
import { test, expect } from "../fixtures.js";

const RACE = "/race/2026-09-21-02-05";
const day = (n) =>
  new Date(Date.UTC(2026, 8, 20) - n * 86400000).toISOString().slice(0, 10);
const runsFor = (racerId) =>
  Array.from({ length: 60 }, (_, i) => {
    const boat = 1 + ((racerId + i) % 6);
    const others = [1, 2, 3, 4, 5, 6].filter((b) => b !== boat);
    // 選手ごとに上位の多さを変え、時期で少し動かす（線が重ならないように）
    const good = (racerId % 6) + (i > 30 ? 1 : 0);
    const finish = (racerId * 7 + i * 5) % 9 < good ? 1 + (i % 3) : 4 + (i % 3);
    const ranks = [1, 2, 3, 4, 5, 6].map((r) =>
      r === finish ? boat : others.shift(),
    );
    const v = `0${1 + (i % 9)}`;
    return {
      race_id: `${day(60 - i)}-${v}-${v}`,
      boat_number: boat,
      grade: "A1",
      f_count: 0,
      race_date: day(60 - i),
      venue_code: v,
      race_grade: "一般",
      ranks,
      race_status: null,
      actual_courses: [1, 2, 3, 4, 5, 6],
      winning_technique: "逃げ",
      payout_win: 150,
      race_stage: "予選",
      race_title: "一般戦",
      wave_height: 2,
      series_day: 1,
      is_final_day: false,
      st_rows: [[boat, 0.15, false, false, null, boat]],
      exhibition_rows: [[boat, 6.8]],
    };
  });

test("推移は 1200px 以上で左に図・右に6艇の一覧、それ未満は図を枠いっぱいにして下に札、スマホの図は今までの拡大のまま", async ({
  page,
}) => {
  await page.route("**/rest/v1/rpc/get_racer_scoped_race_rows*", (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runsFor(Number(body.p_racer_id))),
    });
  });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const head = page.locator(".race-basic-info-tab .trc-head");
  await expect(head.locator(".trc-title")).toBeVisible({ timeout: 30000 });
  await page.locator(".rbit-chip", { hasText: "3連対率" }).first().click();
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  const svg = page.locator(".race-basic-info-tab .trc-svg");
  await expect(svg).toBeVisible({ timeout: 30000 });
  // 測る前の幅で描いて高さが跳ねない（幅は描く前に測る。visual-designer 11/25）
  const firstHeight = await svg.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  expect(firstHeight, "最初の描画の高さ").toBeLessThanOrEqual(340);
  // 図の置き場の幅: 1200px 以上は左の列（.race-split__main）、それ未満は推移の枠（.race-split は display: contents）
  const frameOf = (el) => {
    const main = el.closest(".race-split__main").getBoundingClientRect();
    return main.width > 0
      ? main.width
      : el.closest(".trc-wrap").getBoundingClientRect().width;
  };
  const frame = await svg.evaluate(frameOf);
  const tabWidth = await page
    .locator(".race-basic-info-tab")
    .evaluate((el) => el.getBoundingClientRect().width);
  // ResizeObserver が幅を測り終えるのを待つ（広い枠では viewBox の幅が描いた幅÷480/343 に追いつく）
  await expect
    .poll(async () =>
      svg.evaluate((el, f) => {
        const w = el.getBoundingClientRect().width;
        const vb = el.viewBox.baseVal.width;
        return f <= 480
          ? vb === 343
          : Math.abs(vb - w / (480 / 343)) <= 2 && w >= f - 2;
      }, frame),
    )
    .toBe(true);
  const m = await page.evaluate(() => {
    const svgEl = document.querySelector(".race-basic-info-tab .trc-svg");
    const box = svgEl.getBoundingClientRect();
    const tick = svgEl.querySelector(".trc-tick").getBoundingClientRect();
    const names = [
      ...document.querySelectorAll(".race-basic-info-tab .trc-boat-name"),
    ].filter((n) => n.getBoundingClientRect().width > 0);
    const list = document
      .querySelector(".race-basic-info-tab .trc-boats")
      .getBoundingClientRect();
    return {
      width: box.width,
      right: box.right,
      height: box.height,
      scale: box.width / svgEl.viewBox.baseVal.width,
      tickHeight: tick.height,
      names: names.length,
      listLeft: list.left,
      listTop: list.top,
      chartBottom: box.bottom,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  expect(m.overflow, "横スクロール").toBe(0);
  if (frame > 480) {
    expect(
      m.scale,
      "広い枠では拡大を今までの最大（480/343）で止める",
    ).toBeCloseTo(480 / 343, 1);
    expect(m.height, "縦を伸ばしすぎない").toBeLessThanOrEqual(340);
    expect(
      m.tickHeight,
      "目盛りの文字は今の PC と同じ大きさまで",
    ).toBeLessThanOrEqual(18);
  } else {
    expect(m.scale, "スマホは 343 の座標を枠いっぱいに拡大").toBeGreaterThan(
      0.9,
    );
  }
  if (tabWidth >= 1100) {
    // 1200px 以上（タブの列が約1200）: 左に図・右に6艇の一覧（艇番・選手名・値）
    expect(m.names, "右の一覧に選手名").toBe(6);
    expect(m.listLeft, "一覧は図の右").toBeGreaterThan(m.right);
    expect(m.width, "図は列の左の大半").toBeGreaterThan(tabWidth * 0.55);
  } else {
    // それ未満: 図を枠いっぱいにし、その下に札の横並び（名前は出さない）
    expect(m.names, "狭い幅は選手名を出さない").toBe(0);
    expect(m.listTop, "札は図の下").toBeGreaterThanOrEqual(m.chartBottom - 1);
    expect(m.width, "図は枠いっぱい").toBeGreaterThanOrEqual(frame - 2);
  }
});
