/**
 * snsTodayPlannerParts.js から移した、型 b（course_win）の用意（撮影用ページの URL・中身の用意・出せるかの確認）。
 * 振る舞いは元のまま。snsTodayPlanner.js が同じ名前で再 export する。
 */
import { buildCourseWinSheet } from "../../src/utils/todayCourseWin.js";
import {
  buildCourseWinPost,
  checkCourseWinPost,
} from "./snsTodayCourseWinPost.js";
import { todayPostUrlOf, todayTrackingUrlOf } from "./snsTodayPlannerParts.js";

// 型 b の画像の撮影用のページ（src/pages/TodaySheet.jsx）。1080×1350 をそのままの画素で撮る
export const COURSE_WIN_SHEET_PATH = "/share/today-sheet";
export const COURSE_WIN_SHEET_ELEMENT = "[data-today-sheet]";
export const COURSE_WIN_SHEET_VIEWPORT = { width: 1080, height: 1350 };
/** 欠場・中止を1回に読むレースの数（6艇×100＝600行で、PostgREST の上限1000行の内） */
export const COURSE_WIN_STATUS_CHUNK = 100;

/** 撮影用のページの URL。渡すのは日付・送る時刻・除く行だけ（数字は渡さない。ページはサーバーの朝の一覧から作る） */
export function courseWinSheetUrlOf(siteBase, date, sendAt, skip = []) {
  const params = new URLSearchParams({ date, from: sendAt });
  if (skip.length) params.set("skip", [...skip].sort().join(","));
  return `${siteBase}${COURSE_WIN_SHEET_PATH}?${params}`;
}

/**
 * 型 b の中身（純粋でない: 欠場・中止を読む）。返り値 { ok: true, sheet, post, url, sheetUrl } か { ok: false, reason }。
 * 候補のうち送る時刻より後の締切の全員の状態を読み、欠場・中止・締切の分からない行を除いてから並べる（上限までは後ろから補う）
 */
export async function prepareCourseWinOf(
  api,
  digest,
  { date, sendAt, raceDb, t },
) {
  const notes = digest.day?.notes?.courseWin;
  const first = buildCourseWinSheet(notes, { sendAt });
  if (!first.ok) return first;
  const live = notes.candidates.filter(
    (c) =>
      typeof c.start_time === "string" && c.start_time.slice(0, 5) > sendAt,
  );
  // pickRaceStatus はレースの全艇の出走表を1回で読む。PostgREST の上限1000行（約166レース分）を超えないよう、
  // レースを COURSE_WIN_STATUS_CHUNK ずつに分けて読む（Codex の審査 P1。候補は1日に100〜130レース前後に散る）
  const raceIds = [...new Set(live.map((c) => c.race_id))];
  const statuses = [];
  for (let i = 0; i < raceIds.length; i += COURSE_WIN_STATUS_CHUNK) {
    const ids = new Set(raceIds.slice(i, i + COURSE_WIN_STATUS_CHUNK));
    statuses.push(
      ...(await api.pickRaceStatus(
        raceDb,
        live.filter((c) => ids.has(c.race_id)),
      )),
    );
  }
  const skip = statuses
    .filter((p) => p.reason)
    .map((p) => `${p.race_id}:${p.boat_number}`);
  const sheet = buildCourseWinSheet(notes, {
    sendAt,
    excluded: new Set(skip),
  });
  if (!sheet.ok) return sheet;
  const url = todayPostUrlOf(api.todayUrl, date, "b");
  const venueName = (code) => t(`venues.${code}`);
  const text = buildCourseWinPost(sheet, { venueName, url });
  const problems = checkCourseWinPost(text, sheet, {
    imageKey: sheet.key,
    url,
    venueName,
  });
  if (problems.length)
    return { ok: false, reason: `check_failed:${problems.join(",")}` };
  return {
    ok: true,
    sheet,
    url: todayTrackingUrlOf(api.todayUrl, date, "b"),
    sheetUrl: courseWinSheetUrlOf(api.siteBase, date, sendAt, skip),
    post: {
      text,
      reply: null,
      races: [],
      // 送る直前に欠場・中止を読み直す対象（画像に載る全行）
      picks: sheet.sections.flatMap((s) =>
        s.rows.map((r) => ({ race_id: r.race_id, boat_number: r.boat_number })),
      ),
    },
  };
}

/**
 * 比べの a の日にも、その日に型 b を出せたかを残す（DB を読まない分だけ。欠場の読み直しと撮影は b の日にしか分からない）。
 * 両方の日で b を出せた組だけで見る感度分析に使う（data-scientist の審査 P2-1）。返り値 { ok, reason? }
 */
export function courseWinFeasibleOf(todayUrl, digest, { date, sendAt, t }) {
  const sheet = buildCourseWinSheet(digest.day?.notes?.courseWin, { sendAt });
  if (!sheet.ok) return { ok: false, reason: sheet.reason };
  const url = todayPostUrlOf(todayUrl, date, "b");
  const venueName = (code) => t(`venues.${code}`);
  const problems = checkCourseWinPost(
    buildCourseWinPost(sheet, { venueName, url }),
    sheet,
    { imageKey: sheet.key, url, venueName },
  );
  return problems.length
    ? { ok: false, reason: `check_failed:${problems.join(",")}` }
    : { ok: true };
}
