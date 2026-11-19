/**
 * snsTodayPlanner.js の runTodayPlan から移した、画像まわり（/today の表示確認・型 b の撮影・型 a の龍神ソナーの図）。
 * 振る舞いは元のまま。
 */
import { firstLine } from "./snsTodayPlannerParts.js";
import {
  COURSE_WIN_SHEET_ELEMENT,
  COURSE_WIN_SHEET_VIEWPORT,
} from "./snsTodayPlannerCourseWin.js";

// X の画像は1枚 5 MB まで（承認の関数 160 と同じ）。超えたら撮れなかった扱い
export const MAX_IMAGE_BYTES = 5_000_000;

// 失敗の理由に添える起動の様子（残りの Chromium・空きメモリ）。本番の関数のログを見ずに切り分けるため（2026-10-18）
export const launchInfoOf = (headless) => () =>
  headless.launchInfo ? ` [${headless.launchInfo()}]` : "";

/** リンク先（/today）が未ログインで見えることを確かめる（送る直前の検査と同じ印）。見えなければ投げる */
export async function assertTodayPageReady(headless, markers, info, api) {
  const { todayUrl: TODAY_URL, screenKey: TODAY_SCREEN_KEY } = api;
  const page = await headless
    .inspect({
      url: TODAY_URL,
      context: { storageState: null },
      requiredSelectors: markers[TODAY_SCREEN_KEY],
    })
    .catch((error) => {
      throw new Error(`${firstLine(error.message)}${info()}`);
    });
  if (
    page.finalUrl !== TODAY_URL ||
    !markers[TODAY_SCREEN_KEY].every((m) => page.visibleSelectors?.includes(m))
  )
    throw new Error("today_page_not_ready");
}

/** 型 b の画像: 撮影用のページ1枚。ページが出した指紋が計画の物と同じとき（同じ行・同じ窓）だけ撮れる */
export async function shootCourseWinSheet(headless, courseWin) {
  const shot = await headless.screenshot({
    url: courseWin.sheetUrl,
    requiredSelectors: [`[data-today-sheet-key="${courseWin.sheet.key}"]`],
    viewport: COURSE_WIN_SHEET_VIEWPORT,
    deviceScaleFactor: 1,
    element: COURSE_WIN_SHEET_ELEMENT,
    // label は渡さない。snsHeadless は label を要素の先頭に焼き込み、下余白が 64px を割る（コードレビューの P1）
  });
  if (shot.png.byteLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  return [shot.png];
}
