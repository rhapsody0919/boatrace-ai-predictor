/**
 * getRacerScopedRaceStats（選手ごとのレースより前の走）が読む経路を page.route で差し替える
 * （BOA-1294・BOA-1331 の再現テスト）。6艇の全選手に同じ走を返す。走は1号艇（艇番1）で出た形にする。
 *
 * runs: [{ date: "YYYY-MM-DD", venue: 2, rr: 1, course: 1, rank1: 1, technique: "逃げ" }]
 * fail: true なら選手の出走（race_entries の f_count 付きの読み）を 500 にする。
 *
 * 経路は2つで、どちらにも同じ走を返す:
 * - RPC get_racer_scoped_race_rows（マイグレーション 203。1走1行）。本番に当たった後はこちらだけが呼ばれる
 * - 203 が無いときに落ちる6表の読み: race_entries（racer_id、select に f_count）
 *   → races・race_results・race_start_timings・exhibition_data・race_conditions（race_id の in()）。
 *   自分の作った race_id を含む要求だけに答え、それ以外は録画の再生へ回す（route.fallback）。
 * 出走6艇の欄の「イン屋」の札の RPC（get_racer_front_taking_counts）は、走が全部1号艇（母数に入らない）なので空で答える。
 */
const RACE_ID = /\d{4}-\d{2}-\d{2}-\d{2}-\d{2}/g;

// race_results の1行。1号艇の実進入コースを r.course に、1着を r.rank1 にする
function resultOf(r) {
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
}

export async function stubRacerScopedRuns(page, runs, { fail = false } = {}) {
  const rows = runs.map((r) => ({
    ...r,
    raceId: `${r.date}-${String(r.venue).padStart(2, "0")}-${String(r.rr ?? 1).padStart(2, "0")}`,
  }));
  const byId = new Map(rows.map((r) => [r.raceId, r]));
  const failure = { status: 500, json: { message: "stub failure" } };
  await page.route("**/rest/v1/rpc/get_racer_front_taking_counts*", (route) =>
    route.fulfill(fail ? failure : { json: [] }),
  );
  await page.route("**/rest/v1/rpc/get_racer_scoped_race_rows*", (route) => {
    if (fail) return route.fulfill(failure);
    return route.fulfill({
      json: [...rows]
        .sort((a, b) => a.raceId.localeCompare(b.raceId))
        .map((r) => {
          const result = resultOf(r);
          return {
            race_id: r.raceId,
            boat_number: 1,
            grade: "A1",
            f_count: 0,
            race_date: r.date,
            venue_code: r.venue,
            race_grade: "一般",
            ranks: [1, 2, 3, 4, 5, 6].map((n) => result[`rank${n}`]),
            race_status: result.race_status,
            winning_technique: result.winning_technique,
            payout_win: result.payout_win,
            actual_courses: [1, 2, 3, 4, 5, 6].map(
              (b) => result[`actual_course_${b}`],
            ),
            race_stage: null,
            race_title: null,
            wave_height: null,
            series_day: null,
            is_final_day: null,
            st_rows: null,
            exhibition_rows: null,
          };
        }),
    });
  });
  await page.route("**/rest/v1/race_entries?*", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!url.includes("f_count") || !url.includes("racer_id=eq."))
      return route.fallback();
    if (fail) return route.fulfill(failure);
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
  await answer("race_results", resultOf);
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
