/**
 * getRacerScopedRaceStats（選手ごとのレースより前の走）が読む経路を page.route で差し替える
 * （BOA-1294・BOA-1331 の再現テスト）。6艇の全選手に同じ走を返す。走は1号艇（艇番1）で出た形にする。
 *
 * runs: [{ date: "YYYY-MM-DD", venue: 2, rr: 1, course: 1, rank1: 1, technique: "逃げ" }]
 * fail: true なら選手の出走（race_entries の f_count 付きの読み）を 500 にする。
 *
 * 経路: supabaseDataService.getRacerScopedRaceStats → race_entries（racer_id、select に f_count）
 * → races・race_results・race_start_timings・exhibition_data・race_conditions（race_id の in()）。
 * 自分の作った race_id を含む要求だけに答え、それ以外は録画の再生へ回す（route.fallback）。
 */
const RACE_ID = /\d{4}-\d{2}-\d{2}-\d{2}-\d{2}/g;

export async function stubRacerScopedRuns(page, runs, { fail = false } = {}) {
  const rows = runs.map((r) => ({
    ...r,
    raceId: `${r.date}-${String(r.venue).padStart(2, "0")}-${String(r.rr ?? 1).padStart(2, "0")}`,
  }));
  const byId = new Map(rows.map((r) => [r.raceId, r]));
  await page.route("**/rest/v1/race_entries?*", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!url.includes("f_count") || !url.includes("racer_id=eq."))
      return route.fallback();
    if (fail)
      return route.fulfill({ status: 500, json: { message: "stub failure" } });
    return route.fulfill({
      json: rows.map((r) => ({
        race_id: r.raceId,
        boat_number: 1,
        grade: "A1",
        f_count: 0,
      })),
    });
  });
  const answer = (table, build) =>
    page.route(`**/rest/v1/${table}?*`, (route) => {
      const url = decodeURIComponent(route.request().url());
      const ids = (url.match(RACE_ID) ?? []).filter((id) => byId.has(id));
      if (ids.length === 0) return route.fallback();
      return route.fulfill({
        json: ids.map((id) => build(byId.get(id))).filter(Boolean),
      });
    });
  await answer("races", (r) => ({
    race_id: r.raceId,
    race_date: r.date,
    venue_code: r.venue,
    race_grade: "一般",
  }));
  await answer("race_results", (r) => {
    // 1号艇の実進入コースを r.course に。ほかの艇は残りのコースを順に当てる
    const others = [1, 2, 3, 4, 5, 6].filter((c) => c !== r.course);
    const courses = { 1: r.course };
    for (let boat = 2; boat <= 6; boat++) courses[boat] = others[boat - 2];
    const order = [r.rank1, ...[1, 2, 3, 4, 5, 6].filter((b) => b !== r.rank1)];
    return {
      race_id: r.raceId,
      rank1: order[0],
      rank2: order[1],
      rank3: order[2],
      rank4: order[3],
      rank5: order[4],
      rank6: order[5],
      race_status: null,
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((b) => [`actual_course_${b}`, courses[b]]),
      ),
      winning_technique: r.technique,
      payout_win: 200,
    };
  });
  for (const table of [
    "race_start_timings",
    "exhibition_data",
    "race_conditions",
  ]) {
    await answer(table, () => null);
  }
}

/** n 走の日付（2026-01-05 から1日ずつ。表示のレース 2026-09-27 より前） */
export function runDates(n) {
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10),
  );
}
