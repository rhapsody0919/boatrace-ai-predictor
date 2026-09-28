/**
 * verify-semifinal-slots.mjs — 準優の枠数を本番の全節で検算する（BOA-490）。
 *
 * 画面が使う `semifinalSlotsOf` をそのまま通し、次の3つを確かめる。
 *
 *   1. 枠数が変わる節が、中止順延で準優が2日ぶん残る節だけであること
 *   2. 準優に「過去日なのに結果も中止フラグも無い」ものが無いこと
 *      （＝中止フラグが取りこぼしていない。この前提が崩れると枠数が過大に戻る）
 *   3. 中止フラグの誤検出（`confirmed` なのに結果がある）が準優に及んでいないこと
 *
 * 実Supabaseに繋ぐので tier=manual。形だけの回帰は
 * `scripts/maintenance/verify-series-points-stage-rules.js`（tier=ci）が担う。
 *
 *   node --env-file=.env.local scripts/verification/verify-semifinal-slots.mjs
 */
import { supabase } from "../lib/supabaseClient.js";
import {
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

const today = new Date().toISOString().slice(0, 10);
console.log(`取得中（本日 ${today}）…`);
const cond = await fetchAll(
  "race_conditions",
  "race_id, race_stage, series_day, is_final_day",
);
const races = await fetchAll("races", "race_id, cancellation_status");
const results = await fetchAll("race_results", "race_id, rank1");
const ran = new Set(
  results.filter((r) => r.rank1 != null).map((r) => r.race_id),
);
const cancelled = new Set(
  races
    .filter((r) => r.cancellation_status === "confirmed")
    .map((r) => r.race_id),
);
console.log(
  `race_conditions=${cond.length} races=${races.length} 結果あり=${ran.size} 中止=${cancelled.size}\n`,
);

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`❌ ${msg}`);
};

// ---- 2. 中止フラグの取りこぼし -------------------------------------------------
const semisAll = cond.filter(
  (c) => semifinalRaceIdsOf([c]).length > 0 && c.race_id.slice(0, 10) < today,
);
const unexplained = semisAll.filter(
  (c) => !ran.has(c.race_id) && !cancelled.has(c.race_id),
);
if (unexplained.length === 0) {
  console.log(
    `✅ 過去日の準優 ${semisAll.length}本に「結果も中止フラグも無い」ものは無い`,
  );
} else {
  fail(
    `過去日の準優 ${semisAll.length}本のうち ${unexplained.length}本が「結果も中止フラグも無い」。中止フラグが取りこぼしている可能性がある`,
  );
  for (const c of unexplained.slice(0, 10))
    console.error(`     ${c.race_id} 「${c.race_stage}」`);
}

// ---- 3. 中止フラグの誤検出が準優に及んでいないか -------------------------------
const falseCancelled = [...cancelled].filter((id) => ran.has(id));
const falseCancelledSemis = falseCancelled.filter(
  (id) => semisAll.some((c) => c.race_id === id) || false,
);
console.log(
  `${falseCancelledSemis.length === 0 ? "✅" : "⚠️ "} 中止フラグが立っているのに結果があるレース ${falseCancelled.length}本（BOA-512）。うち準優 ${falseCancelledSemis.length}本`,
);
if (falseCancelledSemis.length > 0)
  console.log(
    "     準優に及んでいるが、判定は「中止フラグ **かつ** 結果なし」なので枠数には影響しない",
  );

// ---- 1. 枠数が変わる節 ---------------------------------------------------------
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
let meetCount = 0;
const changed = [];
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
  for (const [start, ds] of groups) {
    meetCount += 1;
    const rows = ds.flatMap((d) => m.get(d).rows);
    const before = semifinalRaceIdsOf(rows).length * 6 || null;
    const after = semifinalSlotsOf(rows, {
      cancelledRaceIds: cancelled,
      ranRaceIds: ran,
    });
    if (before !== after) changed.push({ venue: vv, start, before, after });
  }
}
changed.sort((a, b) => a.start.localeCompare(b.start));
console.log(`\n節 ${meetCount}／枠数が変わる節 ${changed.length}`);
for (const c of changed)
  console.log(
    `  会場${c.venue} ${c.start}: ${c.before}枠 → ${c.after === null ? "null（画面は既定の18枠）" : `${c.after}枠`}`,
  );

// 変わった節はすべて「中止の準優を含む」はず（それ以外の理由で変わってはいけない）
for (const c of changed) {
  const m = byVenue.get(c.venue);
  const rows = [...m.keys()]
    .filter((d) => d >= c.start)
    .flatMap((d) => m.get(d).rows);
  const semis = semifinalRaceIdsOf(rows);
  const dropped = semis.filter((id) => cancelled.has(id) && !ran.has(id));
  if (dropped.length === 0)
    fail(`会場${c.venue} ${c.start}: 枠数が変わったのに中止の準優が無い`);
}
if (changed.length > 0 && failures === 0)
  console.log("✅ 変わった節はすべて中止の準優を含む");

console.log(failures === 0 ? "\n全件パス" : `\n失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
