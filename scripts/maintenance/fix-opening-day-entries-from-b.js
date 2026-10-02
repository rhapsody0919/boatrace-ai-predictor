#!/usr/bin/env node
/**
 * 自社データ初日（2025-12-03）の出走表の選手の列と締切時刻を、公式の番組表（Bファイル 2025-12-03）で直す SQL を作る（BOA-580）。
 *
 * 背景: 2025-12-03 の9会場（108レース・648行）は、race_entries の選手の列と races.start_time が前日 12-02 の番組だった
 * （名前 647/648・締切 102/108 が 12-02 と一致）。racer_id と race_results は 12-03 の正しい値（BOA-325 の付け替えの後、
 * K から補完・作り直し）。詳細: docs/issues/boa-580-opening-day-entries.md
 *
 * DB には読み取りだけ行い、書き込みはしない。出力する SQL はユーザーが実行する。
 *   書き込み:   docs/issues/boa-580-opening-day-entries.sql（BEGIN〜COMMIT、件数の保護つき）
 *   取り消し:   docs/issues/boa-580-opening-day-entries-rollback.sql（現在の値に戻す）
 *
 * 直す列（B と racer_profiles から）:
 *   race_entries: player_name（racer_profiles.name。B の名前は4文字で切り詰めのため）、grade、age、branch、weight_kg、
 *     hometown（racer_profiles）、win_rate、global_2rate、local_win_rate、local_2rate、motor_number、motor_2rate、
 *     boat_number_id、boat_2rate
 *   race_entries を NULL にする列（B に無く、今の値は前日の別の選手のもの）: global_3rate、local_3rate、motor_3rate、
 *     boat_3rate、f_count、l_count
 *   races: start_time（B の締切）と、出走表から導く列（first_boat_grade・first_boat_win_rate・first_boat_motor_2rate・
 *     win_rate_avg・win_rate_stddev・motor_2rate_stddev。generate-predictions.js と同じ式）
 * 触らない列: racer_id（正しい）、ai_score_*・予想（オーケストレーター判断で、予想は消さず判定もそのまま）
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/fix-opening-day-entries-from-b.js            # 差分の件数だけ（dry-run）
 *   node --env-file=.env.local scripts/maintenance/fix-opening-day-entries-from-b.js --write-sql
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readParsedDay, DEFAULT_ARCHIVE_DIR } from "./backfill-kb-gaps.js";

const DATE = "2025-12-03";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL_PATH = path.join(ROOT, "docs/issues/boa-580-opening-day-entries.sql");
const ROLLBACK_PATH = path.join(
  ROOT,
  "docs/issues/boa-580-opening-day-entries-rollback.sql",
);

export const ENTRY_COLUMNS = [
  "player_name",
  "grade",
  "age",
  "branch",
  "weight_kg",
  "hometown",
  "win_rate",
  "global_2rate",
  "local_win_rate",
  "local_2rate",
  "motor_number",
  "motor_2rate",
  "boat_number_id",
  "boat_2rate",
];
export const ENTRY_NULLED = [
  "global_3rate",
  "local_3rate",
  "motor_3rate",
  "boat_3rate",
  "f_count",
  "l_count",
];
export const RACE_COLUMNS = [
  "start_time",
  "first_boat_grade",
  "first_boat_win_rate",
  "first_boat_motor_2rate",
  "win_rate_avg",
  "win_rate_stddev",
  "motor_2rate_stddev",
];

const key = (venue, race) =>
  `${DATE}-${String(venue).padStart(2, "0")}-${String(race).padStart(2, "0")}`;
const round3 = (v) => Math.round(v * 1000) / 1000;
// モーター・ボートの2連率は、出走表のページ（他の日の race_entries の出所）が小数1桁で出す。B は2桁。
// 2025-12-04 の実測で toFixed(1) が出走表の値と 864/864（ボート 829/829）一致した（Math.round は 29件ずれる）
const rate1 = (v) =>
  v === null || v === undefined ? null : Number(v.toFixed(1));
const stddev = (vs) => {
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  return Math.sqrt(vs.reduce((a, v) => a + (v - avg) ** 2, 0) / vs.length);
};

/**
 * B の1日と racer_profiles から、正しい値を作る。
 * @returns {{entries: Map<string, object>, races: Map<string, object>}} キーは "race_id|boat_number"・race_id
 */
export function buildExpected(bDay, profiles) {
  const entries = new Map();
  const races = new Map();
  for (const v of bDay.venues) {
    for (const r of v.races) {
      const raceId = key(v.venue_code, r.race_number);
      for (const e of r.entries) {
        const p = profiles.get(e.racer_id);
        entries.set(`${raceId}|${e.boat_number}`, {
          racer_id: e.racer_id,
          player_name: p?.name ?? e.name,
          grade: e.class,
          age: e.age,
          branch: e.branch,
          weight_kg: e.weight,
          hometown: p?.hometown ?? null,
          win_rate: e.national_win_rate,
          global_2rate: e.national_2rate,
          local_win_rate: e.local_win_rate,
          local_2rate: e.local_2rate,
          motor_number: e.motor_number,
          motor_2rate: rate1(e.motor_2rate),
          boat_number_id: e.boat_id,
          boat_2rate: rate1(e.boat_2rate),
        });
      }
      const first = r.entries.find((e) => e.boat_number === 1);
      const winRates = r.entries.map((e) => e.national_win_rate);
      const motorRates = r.entries.map((e) => rate1(e.motor_2rate));
      races.set(raceId, {
        start_time: r.deadline_time ? `${r.deadline_time}:00` : null,
        first_boat_grade: first?.class ?? null,
        first_boat_win_rate: first?.national_win_rate ?? null,
        first_boat_motor_2rate: first ? rate1(first.motor_2rate) : null,
        win_rate_avg: round3(
          winRates.reduce((a, b) => a + b, 0) / winRates.length,
        ),
        win_rate_stddev: round3(stddev(winRates)),
        motor_2rate_stddev: round3(stddev(motorRates)),
      });
    }
  }
  return { entries, races };
}

const norm = (v) =>
  v === null || v === undefined
    ? null
    : typeof v === "number"
      ? Number(v)
      : String(v);
const differs = (a, b) =>
  typeof b === "number" && a !== null && a !== undefined
    ? Math.abs(Number(a) - b) > 1e-9
    : norm(a) !== norm(b);

/**
 * DB の行と正しい値の差分。racer_id が B と違う行があれば、前提が崩れているので例外にする。
 */
export function planFix(dbEntries, dbRaces, expected) {
  const entryRows = [];
  const columnDiffs = {};
  const racerIdMismatch = [];
  for (const row of dbEntries) {
    const want = expected.entries.get(`${row.race_id}|${row.boat_number}`);
    if (!want) continue;
    if (want.racer_id !== row.racer_id) {
      racerIdMismatch.push(`${row.race_id}|${row.boat_number}`);
      continue;
    }
    const changed = [
      ...ENTRY_COLUMNS.filter((c) => differs(row[c], want[c])),
      ...ENTRY_NULLED.filter((c) => row[c] !== null && row[c] !== undefined),
    ];
    for (const c of changed) columnDiffs[c] = (columnDiffs[c] ?? 0) + 1;
    if (changed.length > 0) entryRows.push({ before: row, after: want });
  }
  if (racerIdMismatch.length > 0)
    throw new Error(
      `racer_id が B と違う行が ${racerIdMismatch.length} 件（前提が崩れている）: ${racerIdMismatch.slice(0, 5).join(", ")}`,
    );
  const raceRows = [];
  const raceDiffs = {};
  for (const row of dbRaces) {
    const want = expected.races.get(row.race_id);
    if (!want) continue;
    const changed = RACE_COLUMNS.filter((c) => differs(row[c], want[c]));
    for (const c of changed) raceDiffs[c] = (raceDiffs[c] ?? 0) + 1;
    if (changed.length > 0) raceRows.push({ before: row, after: want });
  }
  return { entryRows, raceRows, columnDiffs, raceDiffs };
}

const lit = (v) =>
  v === null || v === undefined
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : `'${String(v).replace(/'/g, "''")}'`;

const ENTRY_TYPES = {
  player_name: "text",
  grade: "text",
  age: "integer",
  branch: "text",
  weight_kg: "numeric",
  hometown: "text",
  win_rate: "numeric",
  global_2rate: "numeric",
  local_win_rate: "numeric",
  local_2rate: "numeric",
  motor_number: "integer",
  motor_2rate: "numeric",
  boat_number_id: "integer",
  boat_2rate: "numeric",
  global_3rate: "numeric",
  local_3rate: "numeric",
  motor_3rate: "numeric",
  boat_3rate: "numeric",
  f_count: "integer",
  l_count: "integer",
};
const RACE_TYPES = {
  start_time: "time",
  first_boat_grade: "text",
  first_boat_win_rate: "numeric",
  first_boat_motor_2rate: "numeric",
  win_rate_avg: "numeric",
  win_rate_stddev: "numeric",
  motor_2rate_stddev: "numeric",
};

/** UPDATE ... FROM (VALUES ...) を、件数の保護つきで作る（rollback と共用） */
export function renderUpdates(entryValues, raceValues, { title }) {
  const eCols = [...ENTRY_COLUMNS, ...ENTRY_NULLED];
  const eVals = entryValues
    .map(
      (r) =>
        `  (${lit(r.race_id)}, ${r.boat_number}, ${r.racer_id}, ${eCols.map((c) => `${lit(r[c])}::${ENTRY_TYPES[c]}`).join(", ")})`,
    )
    .join(",\n");
  const rVals = raceValues
    .map(
      (r) =>
        `  (${lit(r.race_id)}, ${RACE_COLUMNS.map((c) => `${lit(r[c])}::${RACE_TYPES[c]}`).join(", ")})`,
    )
    .join(",\n");
  return `-- ${title}
-- 生成: scripts/maintenance/fix-opening-day-entries-from-b.js（手で編集しない）
-- race_entries ${entryValues.length}行・races ${raceValues.length}行。件数が違えば全体を取り消す（RAISE で ROLLBACK）
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  UPDATE race_entries e SET
${eCols.map((c) => `    ${c} = v.${c},`).join("\n")}
    updated_at = now()
  FROM (VALUES
${eVals}
  ) AS v(race_id, boat_number, racer_id, ${eCols.join(", ")})
  WHERE e.race_id = v.race_id AND e.boat_number = v.boat_number AND e.racer_id = v.racer_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> ${entryValues.length} THEN
    RAISE EXCEPTION 'race_entries の更新が % 行（期待 ${entryValues.length}）。取り消します', n;
  END IF;

  UPDATE races r SET
${RACE_COLUMNS.map((c) => `    ${c} = v.${c},`).join("\n")}
    updated_at = now()
  FROM (VALUES
${rVals}
  ) AS v(race_id, ${RACE_COLUMNS.join(", ")})
  WHERE r.race_id = v.race_id AND r.race_date = '${DATE}';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> ${raceValues.length} THEN
    RAISE EXCEPTION 'races の更新が % 行（期待 ${raceValues.length}）。取り消します', n;
  END IF;
END $$;
COMMIT;
`;
}

async function fetchAll(client, table, select, build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(
      client.from(table).select(select),
    ).range(from, from + 999);
    if (error) throw new Error(`${table} の取得に失敗: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function main() {
  const writeSql = process.argv.includes("--write-sql");
  const day = readParsedDay(DEFAULT_ARCHIVE_DIR, DATE);
  if (!day?.b)
    throw new Error(`${DATE} の B（解析済み）がアーカイブにありません`);
  const { supabase } = await import("../lib/supabaseClient.js");
  const dbEntries = await fetchAll(
    supabase,
    "race_entries",
    [
      "race_id",
      "boat_number",
      "racer_id",
      ...ENTRY_COLUMNS,
      ...ENTRY_NULLED,
    ].join(","),
    (q) => q.like("race_id", `${DATE}-%`).order("race_id").order("boat_number"),
  );
  const dbRaces = await fetchAll(
    supabase,
    "races",
    ["race_id", ...RACE_COLUMNS].join(","),
    (q) => q.eq("race_date", DATE).order("race_id"),
  );
  const ids = [...new Set(dbEntries.map((r) => r.racer_id).filter(Boolean))];
  const profiles = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("racer_profiles")
      .select("racer_id,name,hometown")
      .in("racer_id", ids.slice(i, i + 200));
    if (error) throw new Error(`racer_profiles の取得に失敗: ${error.message}`);
    for (const p of data) profiles.set(p.racer_id, p);
  }
  const missingProfiles = ids.filter((id) => !profiles.has(id));
  // racer_profiles に無い選手は、B の名前（4文字で切り詰めの場合あり）を使う
  if (missingProfiles.length > 0)
    console.warn(
      `racer_profiles に無い選手 ${missingProfiles.length} 人（B の名前を使う）: ${missingProfiles.join(", ")}`,
    );

  const expected = buildExpected(day.b, profiles);
  const plan = planFix(dbEntries, dbRaces, expected);
  console.log(
    JSON.stringify(
      {
        dbEntries: dbEntries.length,
        dbRaces: dbRaces.length,
        entriesToUpdate: plan.entryRows.length,
        racesToUpdate: plan.raceRows.length,
        entryColumnDiffs: plan.columnDiffs,
        raceColumnDiffs: plan.raceDiffs,
      },
      null,
      2,
    ),
  );
  if (!writeSql) return;

  const after = plan.entryRows.map(({ before, after: a }) => ({
    race_id: before.race_id,
    boat_number: before.boat_number,
    racer_id: before.racer_id,
    ...a,
    ...Object.fromEntries(ENTRY_NULLED.map((c) => [c, null])),
  }));
  const raceAfter = plan.raceRows.map(({ before, after: a }) => ({
    race_id: before.race_id,
    ...a,
  }));
  fs.writeFileSync(
    SQL_PATH,
    renderUpdates(after, raceAfter, {
      title: `BOA-580: ${DATE} の出走表の選手の列と締切時刻を、公式の番組表（B ${DATE}）で直す`,
    }),
  );
  fs.writeFileSync(
    ROLLBACK_PATH,
    renderUpdates(
      plan.entryRows.map(({ before }) => before),
      plan.raceRows.map(({ before }) => before),
      { title: `BOA-580 の取り消し: 書き込み前（生成時点）の値に戻す` },
    ),
  );
  console.log(
    `書き出し: ${path.relative(ROOT, SQL_PATH)}, ${path.relative(ROOT, ROLLBACK_PATH)}`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((e) => {
    console.error(`エラー: ${e.message}`);
    process.exitCode = 1;
  });
}
