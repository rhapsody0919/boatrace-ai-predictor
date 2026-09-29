/**
 * verify-meet-series-split.mjs — 男女Ｗ優勝戦の節の切り分けを本番全件で検算する
 * （BOA-511 / BOA-476）。
 *
 * 画面が使う `splitMeetSeries` をそのまま通し、次を確かめる。
 *
 *   1. `race_title` に「Ｗ優勝戦」を含む節がいくつあり、すべて2つに割れるか
 *   2. **桐生 2026-09-20開催の男女ラベルと一致するか**（6節で唯一の正解データ。
 *      `race_stage` に「予選男子」「予選女子」等の接尾がある）
 *   3. 準優が両シリーズに割れるか（片側に寄っていないか）
 *   4. Ｗ優勝戦でない節に誤って適用されないか
 *
 * 実Supabaseに繋ぐので tier=manual。形だけの回帰は
 * `scripts/maintenance/verify-series-points-stage-rules.js`（tier=ci）が担う。
 *
 *   node --env-file=.env.local scripts/verification/verify-meet-series-split.mjs
 */
import { supabase } from "../lib/supabaseClient.js";
import {
  splitMeetSeries,
  semifinalRaceIdsOf,
  semifinalSlotsOf,
} from "../../src/components/race/seriesPoints.js";
import { findMeetStartDate } from "../../src/utils/meetGrouping.js";

/**
 * `race_id` のキーセットページングで全件取る。
 * `race_id` が一意でないテーブルでは末尾の中途半端なグループを捨てる
 * （1000は6の倍数ではないので、そのまま切ると1レースぶんが欠ける）。
 */
async function fetchAll(table, cols, { uniqueRaceId = true } = {}) {
  const out = [];
  let cursor = "";
  for (;;) {
    let data = null;
    let error = null;
    for (let i = 0; i < 6; i += 1) {
      ({ data, error } = await supabase
        .from(table)
        .select(cols)
        .gt("race_id", cursor)
        .order("race_id", { ascending: true })
        .limit(1000));
      if (!error) break;
      // supabaseClient は15秒で中断する（undici のハング対策）。素直に再試行する
      console.error(`  retry ${table} @${cursor}: ${error.message}`);
    }
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    let rows = data;
    if (!uniqueRaceId && data.length === 1000) {
      const last = data[data.length - 1].race_id;
      rows = data.filter((r) => r.race_id !== last);
      if (rows.length === 0)
        throw new Error(`1レースで1000行を超えた: ${last}`);
    }
    out.push(...rows);
    cursor = rows[rows.length - 1].race_id;
    if (data.length < 1000) break;
  }
  return out;
}

console.log("取得中…");
const cond = await fetchAll(
  "race_conditions",
  "race_id, race_stage, race_title, series_day, is_final_day",
);
const ent = await fetchAll("race_entries", "race_id, racer_id", {
  uniqueRaceId: false,
});
console.log(`race_conditions=${cond.length} race_entries=${ent.length}\n`);

const racersByRace = new Map();
for (const e of ent) {
  if (!racersByRace.has(e.race_id)) racersByRace.set(e.race_id, []);
  if (e.racer_id != null) racersByRace.get(e.race_id).push(e.racer_id);
}

// 節に切る（`findMeetStartDate` と同じ規則）
const byVenue = new Map();
for (const c of cond) {
  const vv = c.race_id.slice(11, 13);
  const d = c.race_id.slice(0, 10);
  if (!byVenue.has(vv)) byVenue.set(vv, new Map());
  const m = byVenue.get(vv);
  const cur = m.get(d) ?? { seriesDay: null, isFinalDay: false, rows: [] };
  if (
    c.series_day != null &&
    (cur.seriesDay == null || c.series_day < cur.seriesDay)
  )
    cur.seriesDay = c.series_day;
  if (c.is_final_day) cur.isFinalDay = true;
  cur.rows.push(c);
  m.set(d, cur);
}
const meets = [];
for (const [vv, m] of byVenue) {
  const dates = [...m.keys()].sort();
  const input = dates.map((d) => ({
    date: d,
    seriesDay: m.get(d).seriesDay,
    isFinalDay: m.get(d).isFinalDay,
  }));
  const groups = new Map();
  for (const d of dates) {
    const start = findMeetStartDate(input, d) ?? d;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push(d);
  }
  for (const [start, ds] of groups)
    meets.push({ venue: vv, start, rows: ds.flatMap((d) => m.get(d).rows) });
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`❌ ${msg}`);
};

const isW = (rows) => rows.some((r) => /[ＷW]優勝戦/u.test(r.race_title ?? ""));

const wMeets = meets.filter((m) => isW(m.rows));
const nonW = meets.filter((m) => !isW(m.rows));
console.log(`節 ${meets.length}／Ｗ優勝戦の節 ${wMeets.length}\n`);

// ---- 1〜3: Ｗ優勝戦の節 ---------------------------------------------------------
for (const meet of wMeets.sort((a, b) => a.start.localeCompare(b.start))) {
  const comps = splitMeetSeries(meet.rows, racersByRace);
  if (!comps) {
    fail(`会場${meet.venue} ${meet.start}: Ｗ優勝戦なのに2つに割れなかった`);
    continue;
  }
  const semis = semifinalRaceIdsOf(meet.rows);
  const semiSplit = comps.map(
    (c) =>
      semis.filter((sid) => (racersByRace.get(sid) ?? []).some((r) => c.has(r)))
        .length,
  );
  if (semiSplit.some((n) => n === 0))
    fail(
      `会場${meet.venue} ${meet.start}: 準優が片側に寄っている（${semiSplit.join("/")}本）`,
    );

  // 桐生の男女ラベルとの照合（6節で唯一の正解データ）
  let label = "";
  if (meet.rows.some((r) => /[男女]子/u.test(r.race_stage ?? ""))) {
    const male = new Set();
    const female = new Set();
    for (const r of meet.rows) {
      const st = r.race_stage ?? "";
      const rs = racersByRace.get(r.race_id) ?? [];
      if (st.includes("男子")) rs.forEach((x) => male.add(x));
      else if (st.includes("女子")) rs.forEach((x) => female.add(x));
    }
    const counts = comps.map((c) => ({
      m: [...c].filter((r) => male.has(r)).length,
      f: [...c].filter((r) => female.has(r)).length,
    }));
    label = ` | ラベル照合 ${counts.map((c) => `男${c.m}/女${c.f}`).join(" と ")}`;
    // どちらの成分も男女が混ざっていなければ一致とみなす
    const clean = counts.every((c) => c.m === 0 || c.f === 0);
    if (!clean)
      fail(
        `会場${meet.venue} ${meet.start}: 男女ラベルと一致しない（${label}）`,
      );
  }
  // **枠数は本数×6ではなく実人数**。多摩川のＷ準優戦は同じ12名が2回走るヒートで、
  // 本数で数えると各側24枠になるが、実際に準優を走るのは12名（BOA-511の
  // データ精度検証で判明）。側ごとに数えて出す
  const slots = comps.map((c) => {
    const sideRows = meet.rows.filter((r) =>
      (racersByRace.get(r.race_id) ?? []).some((x) => c.has(x)),
    );
    return semifinalSlotsOf(sideRows, { racersByRace });
  });
  for (const [i, n] of slots.entries()) {
    const races = semis.filter((sid) =>
      (racersByRace.get(sid) ?? []).some((r) => comps[i].has(r)),
    ).length;
    if (n !== null && n > comps[i].size)
      fail(
        `会場${meet.venue} ${meet.start}: 枠数${n}が側の人数${comps[i].size}を超えている（準優${races}本）`,
      );
  }
  console.log(
    `  会場${meet.venue} ${meet.start}: ${comps.map((c) => c.size).join(" / ")}人、準優 ${semiSplit.join("/")}本、枠数 ${slots.join("/")}${label}`,
  );
}

// ---- 4: 誤適用 -----------------------------------------------------------------
const wrong = nonW.filter(
  (m) => splitMeetSeries(m.rows, racersByRace) !== null,
);
if (wrong.length === 0) {
  console.log(`\n✅ Ｗ優勝戦でない ${nonW.length}節には1件も適用されない`);
} else {
  fail(`Ｗ優勝戦でないのに適用される節が ${wrong.length}件ある`);
  for (const w of wrong.slice(0, 10))
    console.error(`     会場${w.venue} ${w.start}`);
}

console.log(failures === 0 ? "\n全件パス" : `\n失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
