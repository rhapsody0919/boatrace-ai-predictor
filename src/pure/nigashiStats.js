/**
 * 逃し率（オーナー 2026-11-25）: 2〜6コースに入った走のうち、1コースの艇に逃げで1着を取られた走の割合。
 * 決まり手が「逃げ」なら勝ったのは1コースの艇なので、決まり手だけで判定する。
 * 選手ごとの値は信頼性が低く（365日で約0.17）、1着の予測にも効かない（docs/knowledge/stat-findings.md）。
 * 画面は過去の記録として k/n と率を出し、強調・並べ替え・期待との差は付けない。率は走数によらず出す（11/24 の決定）。
 *
 * 拡張子付きで import する（Node から直接 import して検証するため）。
 */
import { filterRecords } from "./basicInfoStats.js";
import { GRID_ROWS } from "./courseGridStats.js";

/**
 * 選手本人のレースより前の走（records、getRacerScopedRaceStats の行）から、進入 course で走った走と
 * そのうち逃げで1着を取られた走。期間は6艇の表の「全期間」と同じ当社データ全体（まくられ・差されのカードと同じ）
 */
export function buildNigashiBreakdown(records, course, { now } = {}) {
  const row = GRID_ROWS.find((r) => r.key === "current");
  const inCourse = filterRecords(Array.isArray(records) ? records : [], {
    venueCode: null,
    scope: row.scope,
    grade: row.grade,
    period: row.period,
    now,
  }).filter((r) => r.actualCourse === course);
  let count = 0;
  let from = null;
  let to = null;
  for (const r of inCourse) {
    if (r.winningTechnique === "逃げ") count += 1;
    if (from === null || r.date < from) from = r.date;
    if (to === null || r.date > to) to = r.date;
  }
  const n = inCourse.length;
  return {
    n,
    count,
    pct: n > 0 ? Math.round((count / n) * 100) : null,
    from,
    to,
  };
}

/**
 * 全国の逃し率の基準。venue_course_technique_baseline の race_grade='ALL' の行（会場ごと）を走数で重み付けて合わせる。
 * 定義上、2〜6コースのどの値も会場の逃げ率と同じになる（098 の注釈）。行が無ければ null
 */
export function nationalNigashiBaseline(rows) {
  const usable = (rows ?? []).filter(
    (r) => r.runs > 0 && r.nigashi_rate != null,
  );
  if (usable.length === 0) return null;
  let runs = 0;
  let weighted = 0;
  let from = null;
  let to = null;
  for (const r of usable) {
    runs += r.runs;
    weighted += Number(r.nigashi_rate) * r.runs;
    if (from === null || r.window_start < from) from = r.window_start;
    if (to === null || r.window_end > to) to = r.window_end;
  }
  return { pct: Math.round(weighted / runs), runs, from, to };
}

/**
 * 選手ページの進入コース別の逃し率（2〜6コース）。出走履歴（getRacerRaceHistory の行。entryCourse・winningTechnique・raceId）
 * から数える。進入が分からない走は数えない。走の無いコースは出さない。期間は数えた走の端（raceId の頭の日付）
 */
export function nigashiByCourse(history) {
  const byCourse = new Map();
  let from = null;
  let to = null;
  for (const row of history ?? []) {
    const c = row.entryCourse;
    if (!(c >= 2 && c <= 6)) continue;
    const g = byCourse.get(c) ?? { course: c, n: 0, count: 0 };
    g.n += 1;
    if (row.winningTechnique === "逃げ") g.count += 1;
    byCourse.set(c, g);
    const date = typeof row.raceId === "string" ? row.raceId.slice(0, 10) : null;
    if (date && (from === null || date < from)) from = date;
    if (date && (to === null || date > to)) to = date;
  }
  const rows = [...byCourse.values()]
    .sort((a, b) => a.course - b.course)
    .map((g) => ({ ...g, pct: Math.round((g.count / g.n) * 100) }));
  return { rows, from, to };
}
