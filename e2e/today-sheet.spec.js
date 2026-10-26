import { test, expect } from "./fixtures.js";
import {
  buildCourseWinNotes,
  buildCourseWinSheet,
} from "../src/utils/todayCourseWin.js";

/**
 * /today の X 投稿の型 b の画像の撮影用のページ（/share/today-sheet、src/pages/TodaySheet.jsx）。
 * - 出来上がりの指紋（data-today-sheet-key）は計画（buildCourseWinSheet）と同じ。計画はこの指紋が出たときだけ撮る
 * - 行の数が 2〜5 のどの日も、1080×1350 の中に収まり（下余白 64px 以上）、行の左側（締切・艇番・名前・級）が横にはみ出さない
 *   （visual-designer の審査 P1-1。最長の名前の日で確かめる）
 * - 1行の日・材料の無い日・URL の形が違う日は画像を出さない（計画は型 a で送る）
 * 朝の一覧の応答は録画ではなく、この試験の中で作る（数字は手で置いた見本）
 */
const D = "2026-10-26";
const W = { window_start: "2025-12-02", window_end: "2026-10-24" };
const GRADE = [
  ["A1", 1, 16129, 11456],
  ["A2", 1, 13822, 8353],
  ["B1", 1, 19169, 7685],
  ["A1", 4, 11658, 1867],
  ["A2", 4, 11845, 1474],
].map(([grade, course, runs, wins]) => ({
  scope: "grade",
  grade,
  course,
  runs,
  wins,
  ...W,
}));
const PEOPLE = [
  [`${D}-04-12`, 4, 12, "16:14:00", 1, 1, "A1", "高橋　竜矢", 47, 42],
  [`${D}-24-10`, 24, 10, "19:36:00", 1, 2, "A1", "西村　拓也", 56, 47],
  // 最長の名前（姓3字＋名4字）・最長の会場名
  [`${D}-11-12`, 11, 12, "16:40:00", 1, 3, "B1", "長谷川　雄一郎太", 52, 33],
  [`${D}-06-12`, 6, 12, "16:23:00", 4, 4, "A2", "山下　大輝", 45, 14],
  [`${D}-12-11`, 12, 11, "20:41:00", 4, 5, "A1", "佐々木　康幸", 58, 15],
];
function notesOf(people) {
  return buildCourseWinNotes({
    races: people.map(([race_id, venue_code, race_number, start_time]) => ({
      race_id,
      venue_code,
      race_number,
      start_time,
    })),
    entries: people.map(
      ([race_id, , , , boat_number, racer_id, grade, player_name]) => ({
        race_id,
        boat_number,
        racer_id,
        grade,
        player_name,
      }),
    ),
    rpcRows: [
      ...GRADE,
      ...people.map(([, , , , boat, racer_id, , , runs, wins]) => ({
        scope: "racer",
        racer_id,
        course: boat,
        runs,
        wins,
        off_frame_runs: 0,
        ...W,
      })),
    ],
    until: "2026-10-24",
  });
}
async function open(page, courseWin, query = `date=${D}&from=08:00`) {
  await page.setViewportSize({ width: 1080, height: 1350 });
  await page.route("**/rest/v1/morning_digest_days*", (route) =>
    route.fulfill({
      json: {
        digest_date: D,
        generated_at: `${D}T05:30:00Z`,
        venue_count: 12,
        race_count: 144,
        ...W,
        window_days: 327,
        notes: { courseWin },
      },
    }),
  );
  await page.route("**/rest/v1/morning_digest_rows*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto(`/share/today-sheet?${query}`);
}

for (const picks of [
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3],
  [0, 1, 2],
  [2, 3],
]) {
  test(`/share/today-sheet: ${picks.length}行の日も 1080×1350 に収まり、指紋は計画と同じ`, async ({
    page,
  }) => {
    const notes = notesOf(picks.map((i) => PEOPLE[i]));
    const sheet = buildCourseWinSheet(notes, { sendAt: "08:00" });
    expect(sheet.ok).toBe(true);
    await open(page, notes);
    const root = page.locator(`[data-today-sheet-key="${sheet.key}"]`);
    await expect(root).toBeVisible({ timeout: 30000 });
    const m = await page.evaluate(() => {
      const el = document.querySelector("[data-today-sheet]");
      const r = el.getBoundingClientRect();
      const brand = el
        .querySelector(".today-sheet__brand")
        .getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        bottomGap: r.bottom - brand.bottom,
        rows: el.querySelectorAll(".today-sheet__row").length,
        overflow: [...el.querySelectorAll(".today-sheet__row-left")].some(
          (n) => n.scrollWidth > n.clientWidth + 1,
        ),
        robots: document.querySelector('meta[name="robots"]')?.content ?? "",
      };
    });
    expect(m.width).toBe(1080);
    expect(m.height).toBe(1350);
    expect(m.rows).toBe(picks.length);
    expect(m.bottomGap).toBeGreaterThanOrEqual(64);
    expect(m.overflow).toBe(false);
    expect(m.robots).toContain("noindex");
    // 本文の人（1コースの段の1行目）の件数の書き方は本文と同じ「N回中M回」
    const f = sheet.featured;
    await expect(root).toContainText(`${f.runs}回中${f.wins}回`);
  });
}

test("/share/today-sheet: 1行の日・材料の無い日・URL の形が違う日は画像を出さない", async ({
  page,
}) => {
  await open(page, notesOf([PEOPLE[0]]));
  await expect(page.locator('[data-today-sheet-error="one_row"]')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator("[data-today-sheet]")).toHaveCount(0);
  // 朝の一覧は画面のキャッシュ（localStorage）に残るので、次の応答を読ませる前に消す
  await page.evaluate(() => localStorage.clear());
  await page.unrouteAll();
  await open(page, { v: 1, status: "unavailable", reason: "rpc_missing" });
  await expect(
    page.locator('[data-today-sheet-error="rpc_missing"]'),
  ).toBeVisible({ timeout: 30000 });
  // 朝の一覧は画面のキャッシュ（localStorage）に残るので、次の応答を読ませる前に消す
  await page.evaluate(() => localStorage.clear());
  await page.unrouteAll();
  await open(page, notesOf(PEOPLE), `date=${D}&from=8:00`);
  await expect(page.locator('[data-today-sheet-error="params"]')).toBeVisible({
    timeout: 30000,
  });
});
