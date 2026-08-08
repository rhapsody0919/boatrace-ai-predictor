/**
 * 029マイグレーション（レース分析RPC）のパリティ検証（BOA-168/BOA-169）
 *
 * RPC（サーバー側集計）と旧クライアント集計が同一結果を返すことを、
 * 複数レースで突合して確認する。
 *
 * 使い方: node scripts/analysis/verify-race-analysis-rpc.js [race_id...]
 * 引数省略時は既定の検証レースを使う
 */
import { supabase } from "../lib/supabaseClient.js";

const DEFAULT_RACE_IDS = [
  "2026-07-30-04-01",
  "2026-08-05-01-01",
  "2026-08-07-02-01",
];

const near = (a, b, eps = 1e-6) => {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) < eps;
};

// --- 旧クライアント集計の再現（フロントと同一ロジック） ---

async function legacyStPredictability(raceId) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select("boat_number, player_name, racer_id")
    .eq("race_id", raceId)
    .order("boat_number");
  if (!entries?.length) return [];
  const { data: todaysEx } = await supabase
    .from("exhibition_data")
    .select("boat_number, start_timing")
    .eq("race_id", raceId);
  const exByBoat = new Map(
    (todaysEx ?? []).map((e) => [e.boat_number, e.start_timing]),
  );
  const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
    (id) => id !== null,
  );
  const ninety = new Date();
  ninety.setDate(ninety.getDate() - 90);
  const cutoff = ninety.toISOString().split("T")[0];
  const { data: pastEntries } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, racer_id")
    .in("racer_id", racerIds)
    .gte("race_id", cutoff)
    .lt("race_id", raceId);
  const raceIds = [...new Set((pastEntries ?? []).map((e) => e.race_id))];
  const fetchAll = async (table, select) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from(table)
        .select(select)
        .in("race_id", raceIds)
        .range(from, from + 999);
      if (!data?.length) break;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  };
  const [actualRows, exRows] = await Promise.all([
    fetchAll(
      "race_start_timings",
      "race_id, boat_number, start_timing, is_flying",
    ),
    fetchAll("exhibition_data", "race_id, boat_number, start_timing"),
  ]);
  const actualByKey = new Map();
  actualRows.forEach((r) => {
    if (r.is_flying) return;
    actualByKey.set(`${r.race_id}-${r.boat_number}`, r.start_timing);
  });
  const exByKey = new Map();
  exRows.forEach((e) =>
    exByKey.set(`${e.race_id}-${e.boat_number}`, e.start_timing),
  );
  const devsByRacer = new Map();
  (pastEntries ?? []).forEach((e) => {
    const key = `${e.race_id}-${e.boat_number}`;
    const actual = actualByKey.get(key);
    const ex = exByKey.get(key);
    // 旧実装のnullバグは除外し、RPCと同じ「両方非null」条件で比較する
    if (
      actual === undefined ||
      actual === null ||
      ex === undefined ||
      ex === null
    )
      return;
    if (!devsByRacer.has(e.racer_id)) devsByRacer.set(e.racer_id, []);
    devsByRacer.get(e.racer_id).push(Math.abs(actual - ex));
  });
  return entries.map((row) => {
    const devs = devsByRacer.get(row.racer_id) ?? [];
    return {
      boat_number: row.boat_number,
      exhibition_st: exByBoat.get(row.boat_number) ?? null,
      avg_deviation: devs.length
        ? devs.reduce((s, d) => s + d, 0) / devs.length
        : null,
      sample_count: devs.length,
    };
  });
}

async function legacyExhibitionTrend(raceId) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select("boat_number, player_name, racer_id")
    .eq("race_id", raceId)
    .order("boat_number");
  if (!entries?.length) return [];
  const { data: todaysEx } = await supabase
    .from("exhibition_data")
    .select("boat_number, exhibition_time")
    .eq("race_id", raceId);
  const exByBoat = new Map(
    (todaysEx ?? []).map((e) => [e.boat_number, e.exhibition_time]),
  );
  const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
    (id) => id !== null,
  );
  const ninety = new Date();
  ninety.setDate(ninety.getDate() - 90);
  const cutoff = ninety.toISOString().split("T")[0];
  const { data: pastEntries } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, racer_id")
    .in("racer_id", racerIds)
    .gte("race_id", cutoff)
    .lt("race_id", raceId);
  const raceIds = [...new Set((pastEntries ?? []).map((e) => e.race_id))];
  const exRows = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("exhibition_data")
      .select("race_id, boat_number, exhibition_time")
      .in("race_id", raceIds)
      .range(from, from + 999);
    if (!data?.length) break;
    exRows.push(...data);
    if (data.length < 1000) break;
  }
  const exByKey = new Map();
  exRows.forEach((e) =>
    exByKey.set(`${e.race_id}-${e.boat_number}`, e.exhibition_time),
  );
  const timesByRacer = new Map();
  (pastEntries ?? []).forEach((e) => {
    const t = exByKey.get(`${e.race_id}-${e.boat_number}`);
    if (t === undefined || t === null) return;
    if (!timesByRacer.has(e.racer_id)) timesByRacer.set(e.racer_id, []);
    timesByRacer.get(e.racer_id).push(t);
  });
  return entries.map((row) => {
    const times = timesByRacer.get(row.racer_id) ?? [];
    return {
      boat_number: row.boat_number,
      exhibition_time: exByBoat.get(row.boat_number) ?? null,
      avg_exhibition_time: times.length
        ? times.reduce((s, t) => s + t, 0) / times.length
        : null,
      sample_count: times.length,
    };
  });
}

async function legacyTechniqueProfile(raceId) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select("boat_number, player_name, racer_id")
    .eq("race_id", raceId)
    .order("boat_number");
  if (!entries?.length) return [];
  const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
    (id) => id !== null,
  );
  const ninety = new Date();
  ninety.setDate(ninety.getDate() - 90);
  const cutoff = ninety.toISOString().split("T")[0];
  const { data: pastEntries } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, racer_id")
    .in("racer_id", racerIds)
    .gte("race_id", cutoff)
    .lt("race_id", raceId);
  const raceIds = [...new Set((pastEntries ?? []).map((e) => e.race_id))];
  const results = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("race_results")
      .select("race_id, rank1, winning_technique")
      .in("race_id", raceIds)
      .range(from, from + 999);
    if (!data?.length) break;
    results.push(...data);
    if (data.length < 1000) break;
  }
  const resultById = new Map();
  results.forEach((r) => {
    if (!r.winning_technique || r.rank1 === null) return;
    resultById.set(r.race_id, r);
  });
  const countsByRacer = new Map();
  (pastEntries ?? []).forEach((e) => {
    const r = resultById.get(e.race_id);
    if (!r || r.rank1 !== e.boat_number) return;
    if (!countsByRacer.has(e.racer_id))
      countsByRacer.set(e.racer_id, new Map());
    const c = countsByRacer.get(e.racer_id);
    c.set(r.winning_technique, (c.get(r.winning_technique) ?? 0) + 1);
  });
  return entries.map((row) => {
    const counts = countsByRacer.get(row.racer_id) ?? new Map();
    const winCount = [...counts.values()].reduce((s, c) => s + c, 0);
    const techniques = [...counts.entries()]
      .map(([technique, count]) => ({
        technique,
        count,
        percentage: winCount > 0 ? (count / winCount) * 100 : 0,
      }))
      .sort(
        (a, b) => b.count - a.count || a.technique.localeCompare(b.technique),
      );
    return { boat_number: row.boat_number, win_count: winCount, techniques };
  });
}

async function legacyReturnRate(raceId) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select("boat_number, player_name, racer_id")
    .eq("race_id", raceId)
    .order("boat_number");
  if (!entries?.length) return [];
  const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
    (id) => id !== null,
  );
  const c180 = new Date();
  c180.setDate(c180.getDate() - 180);
  const cutoff = c180.toISOString().split("T")[0];
  const past = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("race_entries")
      .select("race_id, boat_number, racer_id")
      .in("racer_id", racerIds)
      .gte("race_id", cutoff)
      .lt("race_id", raceId)
      .range(from, from + 999);
    if (!data?.length) break;
    past.push(...data);
    if (data.length < 1000) break;
  }
  const raceIds = [...new Set(past.map((e) => e.race_id))];
  const results = [];
  for (let i = 0; i < raceIds.length; i += 500) {
    const { data } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, is_cancelled, is_no_race",
      )
      .in("race_id", raceIds.slice(i, i + 500));
    results.push(...(data ?? []));
  }
  const resultById = new Map(results.map((r) => [r.race_id, r]));
  const stats = new Map();
  past.forEach((e) => {
    const r = resultById.get(e.race_id);
    if (!r || r.is_cancelled || r.is_no_race) return;
    const key = `${e.racer_id}-${e.boat_number}`;
    if (!stats.has(key)) stats.set(key, { n: 0, win: 0, place: 0 });
    const s = stats.get(key);
    s.n += 1;
    if (r.rank1 === e.boat_number) {
      s.win += r.payout_win ?? 0;
      s.place += r.payout_place_1 ?? 0;
    } else if (r.rank2 === e.boat_number) {
      s.place += r.payout_place_2 ?? 0;
    }
  });
  return entries.map((row) => {
    const s = stats.get(`${row.racer_id}-${row.boat_number}`);
    return {
      boat_number: row.boat_number,
      sample_count: s?.n ?? 0,
      win_return_rate: s?.n ? (s.win / (s.n * 100)) * 100 : null,
      place_return_rate: s?.n ? (s.place / (s.n * 100)) * 100 : null,
    };
  });
}

// --- 突合 ---

const CHECKS = [
  {
    rpc: "get_race_st_predictability",
    legacy: legacyStPredictability,
    compare: (a, b) =>
      a.boat_number === b.boat_number &&
      near(a.exhibition_st, b.exhibition_st) &&
      near(a.avg_deviation, b.avg_deviation) &&
      a.sample_count === b.sample_count,
  },
  {
    rpc: "get_race_exhibition_trend",
    legacy: legacyExhibitionTrend,
    compare: (a, b) =>
      a.boat_number === b.boat_number &&
      near(a.exhibition_time, b.exhibition_time) &&
      near(a.avg_exhibition_time, b.avg_exhibition_time) &&
      a.sample_count === b.sample_count,
  },
  {
    rpc: "get_race_technique_profile",
    legacy: legacyTechniqueProfile,
    // 同数タイの並び順は旧実装が非決定的（Map挿入順）だったため、
    // 並び順ではなく「決まり手→件数・割合」の集合として比較する
    compare: (a, b) => {
      if (a.boat_number !== b.boat_number) return false;
      if (a.win_count !== b.win_count) return false;
      if (a.techniques.length !== b.techniques.length) return false;
      const byName = new Map(b.techniques.map((t) => [t.technique, t]));
      return a.techniques.every((t) => {
        const u = byName.get(t.technique);
        return u && t.count === u.count && near(t.percentage, u.percentage);
      });
    },
  },
  {
    rpc: "get_race_return_rate",
    legacy: legacyReturnRate,
    compare: (a, b) =>
      a.boat_number === b.boat_number &&
      a.sample_count === b.sample_count &&
      near(a.win_return_rate, b.win_return_rate) &&
      near(a.place_return_rate, b.place_return_rate),
  },
];

const raceIds = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_RACE_IDS;

let failed = 0;
for (const raceId of raceIds) {
  console.log(`\n=== ${raceId} ===`);
  for (const check of CHECKS) {
    const { data: rpcData, error } = await supabase.rpc(check.rpc, {
      p_race_id: raceId,
    });
    if (error) {
      console.log(`❌ ${check.rpc}: RPCエラー: ${error.message}`);
      failed++;
      continue;
    }
    const legacyData = await check.legacy(raceId);
    if (rpcData.length !== legacyData.length) {
      console.log(
        `❌ ${check.rpc}: 行数不一致 rpc=${rpcData.length} legacy=${legacyData.length}`,
      );
      failed++;
      continue;
    }
    const mismatches = rpcData.filter(
      (row, i) => !check.compare(row, legacyData[i]),
    );
    if (mismatches.length) {
      console.log(`❌ ${check.rpc}: ${mismatches.length}艇で不一致`);
      console.log("  rpc:", JSON.stringify(mismatches[0]));
      console.log(
        "  legacy:",
        JSON.stringify(
          legacyData.find((l) => l.boat_number === mismatches[0].boat_number),
        ),
      );
      failed++;
    } else {
      console.log(`✅ ${check.rpc}: 全${rpcData.length}艇一致`);
    }
  }
}
console.log(failed === 0 ? "\n✅ 全チェック一致" : `\n❌ ${failed}件の不一致`);
process.exit(failed === 0 ? 0 : 1);
