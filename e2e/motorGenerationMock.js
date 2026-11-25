// モータ情報タブの推移の e2e で共有する偽の応答（入れ替えの日・毎日12レース・6基とも毎レース走る）。
// 世代と走は偽で決めるので本番のデータに左右されない。motor-generation-trend.spec.js と layout/motor-trend-layout.spec.js が使う
export const raceId = "2026-09-29-16-12";
export const day = (n) => new Date(Date.UTC(2026, 7, 6) + n * 86400000).toISOString().slice(0, 10);

export async function mockGeneration(page, { start = "2026-08-06", fail = false } = {}) {
  await page.route("**/rest/v1/venue_motor_start_dates*", (route) => route.fulfill({ json: [{ start_date: start }] }));
  await page.route("**/rest/v1/races*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("select") !== "race_id,race_date") return route.fallback();
    const races = [];
    for (let n = 0; day(n) <= raceId.slice(0, 10); n += 1)
      for (let no = 1; no <= 12; no += 1) races.push({ race_id: `${day(n)}-16-${String(no).padStart(2, "0")}`, race_date: day(n) });
    return route.fulfill({ json: races.filter((r) => r.race_date >= start && r.race_id < raceId) });
  });
  // 6基の走の取得（motor_number=in.）だけを偽にする。公式の率は節（7日）ごとに変わる
  await page.route((url) => url.pathname.endsWith("/race_entries") && url.search.includes("motor_number=in."), (route) => {
    if (fail) return route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"e2e","code":"XX000"}' });
    const q = new URL(route.request().url()).searchParams;
    const ids = q.get("race_id").slice(4, -1).split(",");
    const motors = q.get("motor_number").slice(4, -1).split(",").map(Number);
    return route.fulfill({
      json: ids.flatMap((id) => {
        const week = Math.floor((Date.parse(id.slice(0, 10)) - Date.parse(start)) / (7 * 86400000));
        return motors.map((m, i) => ({ race_id: id, boat_number: i + 1, motor_number: m, motor_2rate: week === 0 ? 0 : 25 + i * 3 + (week % 3), motor_3rate: week === 0 ? 0 : 45 + i * 3, player_name: `選手 ${i + 1}` }));
      }),
    });
  });
  // 会場の節（吹き出しの期間・グレード）。入れ替えの日から7日ごと
  await page.route((url) => url.pathname.endsWith("/race_series") && url.search.includes("grade"), (route) => {
    const meets = [];
    for (let k = 0; day(k * 7) <= raceId.slice(0, 10); k += 1)
      meets.push({ start_date: day(k * 7), end_date: day(k * 7 + 6), total_days: 7, grade: "ippan", title: `節${k}` });
    return route.fulfill({ json: meets.filter((m) => m.start_date >= start) });
  });
}

