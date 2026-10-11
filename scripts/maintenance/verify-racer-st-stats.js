/**
 * verify-racer-st-stats.js - 選手の平均ST等（racer_aggregated_stats、BOA-581）の
 * 取得と集計（scripts/lib/racerStStats.js）の固定入力テスト。実DBには接続しない。
 *
 * 守るもの:
 *   1. race_start_timings の取得が Supabase の1応答1000行の上限で切れず、最新の走が落ちない
 *      （修正前は race_id 200件ずつ .in() で取り、200×6=1200行が1000行で黙って切れていた）
 *   2. F の走は avg_st・avg_st_last_30・st_stddev から除かれ、flying_rate の分母には入る
 *   3. avg_st_last_30 は新しい順30回の出走の窓の中の F・L 以外の平均（v16 の st_mean30 と同じ窓、BOA-815）で、
 *      入力の並び順に依存しない。窓の中に有効な ST が3走未満なら null
 *   4. 取得エラーは例外になる（部分データで集計しない）
 */
import {
  computeRacerStStats,
  fetchRacerEntries,
  fetchStartTimingsForEntries,
} from "../lib/racerStStats.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const MAX_ROWS = 1000;

/**
 * Supabase クライアントの最小の偽物。PostgREST と同じく1応答を最大1000行に切る。
 * order が無いときは「物理順」として古い順に返す（上限で最新側が落ちる状況の再現）。
 */
function fakeClient(tables, { failTable = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, filters: [], orders: [], range: null };
      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          state.filters.push((r) => r[col] === val);
          return builder;
        },
        in(col, vals) {
          const set = new Set(vals);
          state.filters.push((r) => set.has(r[col]));
          return builder;
        },
        order(col, { ascending = true } = {}) {
          state.orders.push({ col, ascending });
          return builder;
        },
        range(from, to) {
          state.range = [from, to];
          return builder;
        },
        then(resolve, reject) {
          calls.push(state);
          if (table === failTable) {
            return Promise.resolve({
              data: null,
              error: { message: "boom" },
            }).then(resolve, reject);
          }
          let rows = (tables[table] ?? []).filter((r) =>
            state.filters.every((f) => f(r)),
          );
          if (state.orders.length > 0) {
            rows = [...rows].sort((a, b) => {
              for (const { col, ascending } of state.orders) {
                if (a[col] < b[col]) return ascending ? -1 : 1;
                if (a[col] > b[col]) return ascending ? 1 : -1;
              }
              return 0;
            });
          }
          const [from, to] = state.range ?? [0, rows.length - 1];
          const data = rows.slice(from, Math.min(to + 1, from + MAX_ROWS));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

// --- フィクスチャ: 選手9999が250日連続で出走（1日1走、6艇立て） ---
const RACER = 9999;
const DAYS = 250;
const entries = [];
const timings = [];
const start = Date.UTC(2026, 0, 1);
for (let d = 0; d < DAYS; d += 1) {
  const date = new Date(start + d * 86400000).toISOString().slice(0, 10);
  const raceId = `${date}-12-01`;
  for (let boat = 1; boat <= 6; boat += 1) {
    const isRacer = boat === (d % 6) + 1;
    entries.push({
      race_id: raceId,
      boat_number: boat,
      racer_id: isRacer ? RACER : 1000 + boat,
    });
    // 選手9999の ST: 古い200走は 0.15、最新50走は 0.20
    const st = isRacer ? (d >= DAYS - 50 ? 0.2 : 0.15) : 0.17;
    timings.push({
      race_id: raceId,
      boat_number: boat,
      start_timing: st,
      is_flying: false,
    });
  }
}
const latestRaceId = entries[entries.length - 1].race_id;

// --- 1. 1000行を超えても最新の走が落ちない ---
{
  const client = fakeClient({
    race_entries: entries,
    race_start_timings: timings,
  });
  const racerEntries = await fetchRacerEntries(client, RACER);
  check(
    "出走は全250走を取得する",
    racerEntries.length === DAYS,
    `実際: ${racerEntries.length}`,
  );
  const fetched = await fetchStartTimingsForEntries(client, racerEntries);
  check(
    "race_start_timings は 250レース×6艇=1500行を全件取得する",
    fetched.length === DAYS * 6,
    `実際: ${fetched.length}`,
  );
  check(
    "最新レースの行が取得結果に含まれる",
    fetched.some((t) => t.race_id === latestRaceId),
  );
  const timingCalls = client.calls.filter(
    (c) => c.table === "race_start_timings",
  );
  check(
    "race_start_timings の各取得に order が付いている（BOA-595 と同じ問題を持ち込まない）",
    timingCalls.every((c) => c.orders.length > 0),
  );

  const stats = computeRacerStStats(racerEntries, fetched);
  check(
    "total_races=250",
    stats.total_races === DAYS,
    `実際: ${stats.total_races}`,
  );
  check(
    "avg_st_last_30 は最新30走（全て0.20）の平均",
    stats.avg_st_last_30 === 0.2,
    `実際: ${stats.avg_st_last_30}`,
  );
  const expectedAvg = Number(((200 * 0.15 + 50 * 0.2) / 250).toFixed(3));
  check(
    "avg_st は全250走の平均",
    stats.avg_st === expectedAvg,
    `期待: ${expectedAvg} 実際: ${stats.avg_st}`,
  );
}

// --- 2. F は平均・標準偏差から除き、flying_rate の分母には入れる ---
{
  const e = [
    { race_id: "2026-06-01-12-01", boat_number: 1 },
    { race_id: "2026-06-02-12-01", boat_number: 2 },
    { race_id: "2026-06-03-12-01", boat_number: 3 },
    { race_id: "2026-06-04-12-01", boat_number: 4 },
    { race_id: "2026-06-05-12-01", boat_number: 5 },
  ];
  const t = [
    {
      race_id: "2026-06-01-12-01",
      boat_number: 1,
      start_timing: "0.20",
      is_flying: false,
    },
    {
      race_id: "2026-06-02-12-01",
      boat_number: 2,
      start_timing: "0.10",
      is_flying: false,
    },
    {
      race_id: "2026-06-03-12-01",
      boat_number: 3,
      start_timing: "0.03",
      is_flying: true,
    }, // F.03
    {
      race_id: "2026-06-04-12-01",
      boat_number: 4,
      start_timing: null,
      is_flying: false,
    }, // L・欠場
    {
      race_id: "2026-06-05-12-01",
      boat_number: 5,
      start_timing: "0.15",
      is_flying: false,
    },
    // 同じレースの他艇（選手の出走ではない）は無視される
    {
      race_id: "2026-06-05-12-01",
      boat_number: 6,
      start_timing: "0.01",
      is_flying: true,
    },
  ];
  const s = computeRacerStStats(e, t);
  check("F を除いた avg_st=0.150", s.avg_st === 0.15, `実際: ${s.avg_st}`);
  check(
    "F を除いた avg_st_last_30=0.150",
    s.avg_st_last_30 === 0.15,
    `実際: ${s.avg_st_last_30}`,
  );
  // 0.20, 0.10, 0.15 の母標準偏差 = 0.0408...
  check(
    "F を除いた st_stddev=0.041",
    s.st_stddev === 0.041,
    `実際: ${s.st_stddev}`,
  );
  check(
    "total_races は F・ST欠損を含む5走",
    s.total_races === 5,
    `実際: ${s.total_races}`,
  );
  check("flying_rate=1/5", s.flying_rate === 0.2, `実際: ${s.flying_rate}`);

  const onlyF = computeRacerStStats(e.slice(2, 3), t);
  check(
    "F だけの選手は平均が null で flying_rate=1",
    onlyF.avg_st === null &&
      onlyF.avg_st_last_30 === null &&
      onlyF.st_stddev === null &&
      onlyF.flying_rate === 1,
    JSON.stringify(onlyF),
  );
  check("該当する ST が無ければ null", computeRacerStStats(e, []) === null);
}

// --- 3. 直近30走は F 以外の直近30走で、入力の並び順に依存しない ---
{
  const e = [];
  const t = [];
  for (let d = 0; d < 40; d += 1) {
    const raceId = `2026-07-${String(d + 1).padStart(2, "0")}-12-01`;
    e.push({ race_id: raceId, boat_number: 1 });
    // 最新（d=39）は F、それ以外は古い10走が 0.30、新しい29走が 0.10
    const isF = d === 39;
    t.push({
      race_id: raceId,
      boat_number: 1,
      start_timing: isF ? 0.02 : d < 10 ? 0.3 : 0.1,
      is_flying: isF,
    });
  }
  const shuffled = [...t].sort(
    (a, b) =>
      (a.race_id.charCodeAt(9) % 3) - (b.race_id.charCodeAt(9) % 3) ||
      a.race_id.localeCompare(b.race_id),
  );
  const s = computeRacerStStats(e, shuffled);
  // 窓は新しい順の30回の出走 = d=39..10。F（d=39）は平均から外すが窓の1枠は使う
  // → d=38..10 の 0.10 が29走。修正前（F 以外の30走）は d=9 の 0.30 が入り 0.107 だった
  check(
    "avg_st_last_30 は新しい順30回の出走の窓から F を外した平均（v16 と同じ窓）",
    s.avg_st_last_30 === 0.1,
    `期待: 0.1 実際: ${s.avg_st_last_30}`,
  );
}

// --- 3b. L（出遅れ）は ST が記録されていても平均から外す。窓の中の有効な ST が3走未満なら null ---
{
  const mk = (d, st, extra = {}) => ({
    race_id: `2026-08-0${d}-12-01`,
    boat_number: 1,
    start_timing: st,
    is_flying: false,
    ...extra,
  });
  const e = [1, 2, 3, 4].map((d) => ({
    race_id: `2026-08-0${d}-12-01`,
    boat_number: 1,
  }));
  const t = [
    mk(1, 0.2),
    mk(2, 0.1),
    mk(3, 1.16, { is_late_start: true, official_finish_code: "L1" }),
    mk(4, 0.15),
  ];
  const s = computeRacerStStats(e, t);
  check(
    "L1 の ST 1.16 は直近30走の平均に入らない（0.20・0.10・0.15 の平均 0.150）",
    s.avg_st_last_30 === 0.15,
    `実際: ${s.avg_st_last_30}`,
  );
  const two = computeRacerStStats(e.slice(0, 3), t);
  check(
    "窓の中の有効な ST が2走なら直近30走は null（v16 の min_periods=3）",
    two.avg_st_last_30 === null,
    `実際: ${two.avg_st_last_30}`,
  );
}

// --- 4. 取得エラーは例外にする ---
{
  const client = fakeClient(
    { race_entries: entries },
    { failTable: "race_start_timings" },
  );
  const racerEntries = await fetchRacerEntries(client, RACER);
  let threw = false;
  try {
    await fetchStartTimingsForEntries(client, racerEntries);
  } catch {
    threw = true;
  }
  check("race_start_timings の取得エラーは例外になる", threw);

  let threwEntries = false;
  try {
    await fetchRacerEntries(
      fakeClient({}, { failTable: "race_entries" }),
      RACER,
    );
  } catch {
    threwEntries = true;
  }
  check("race_entries の取得エラーは例外になる", threwEntries);
}

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全て成功");
