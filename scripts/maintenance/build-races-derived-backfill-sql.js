/**
 * BOA-630: 予測を一度も走らせていないレース（2026-09-21 の結果のバックフィルで補った1,476レース）の races の導出列のうち、
 * race_entries から決まる事実の値（1号艇の級別・勝率・モーター2連率、勝率の平均・標準偏差、モーター2連率の標準偏差）を
 * 埋める UPDATE の SQL を作る（DBは読むだけ。書き込みはユーザーが SQL Editor で実行する）。
 *
 * 式は scripts/daily/generate-predictions.js の races の行（saveToSupabase）と同じ。勝率は小数3桁、モーター2連率は
 * 小数1桁に丸めてから集計し、標準偏差は母標準偏差。列の桁（DECIMAL(5,3)・DECIMAL(5,2)）への丸めは DB の型変換に任せる。
 * 2026-10-02 に、予測のある588レース（4日分）で、保存済みの値と全6列が一致することを確かめた。
 *
 * モデルの出力（volatility_*・recommended_model・first_boat_avg_st）は埋めない（今のモデルで計算しても当時の判定ではない）。
 *
 *   node --env-file=.env.local scripts/maintenance/build-races-derived-backfill-sql.js --out=FILE.sql
 *     [--from=2026-04-01] [--to=2026-09-30]
 */
import fs from "node:fs";
import {
  fetchAll,
  isSupabaseEnabled,
  supabase,
} from "../lib/supabaseClient.js";

export const DERIVED_COLUMNS = Object.freeze([
  "first_boat_grade",
  "first_boat_win_rate",
  "first_boat_motor_2rate",
  "win_rate_avg",
  "win_rate_stddev",
  "motor_2rate_stddev",
]);

const stdDevPop = (values) => {
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(
    values.map((v) => (v - avg) ** 2).reduce((sum, v) => sum + v, 0) /
      values.length,
  );
};

/**
 * 1レースの出走（race_entries の行）から導出列を計算する。勝率・モーター2連率が欠けた艇がいれば null
 * （generate-predictions.js は toFixed で例外になり、予測を作らない）。
 *
 * @param {{boat_number: number, grade: string|null, win_rate: number|string|null, motor_2rate: number|string|null}[]} entries
 */
export function deriveRaceStats(entries) {
  if (
    entries.length === 0 ||
    entries.some((e) => e.win_rate == null || e.motor_2rate == null)
  ) {
    return null;
  }
  const sorted = [...entries].sort((a, b) => a.boat_number - b.boat_number);
  const winRates = sorted.map((e) => parseFloat(Number(e.win_rate).toFixed(3)));
  const motorRates = sorted.map((e) =>
    parseFloat(Number(e.motor_2rate).toFixed(1)),
  );
  const first = sorted.find((e) => e.boat_number === 1);
  return {
    first_boat_grade: first?.grade || null,
    first_boat_win_rate: first
      ? parseFloat(Number(first.win_rate).toFixed(3))
      : null,
    first_boat_motor_2rate: first
      ? parseFloat(Number(first.motor_2rate).toFixed(1))
      : null,
    win_rate_avg: winRates.reduce((a, b) => a + b, 0) / winRates.length,
    win_rate_stddev: stdDevPop(winRates),
    motor_2rate_stddev: stdDevPop(motorRates),
  };
}

const sqlText = (v) =>
  v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const sqlNum = (v) => (v === null ? "NULL" : String(v));

/**
 * UPDATE 文を作る。6列とも NULL の行だけを更新する（既存の値を上書きしない。再実行しても0件）。
 * @param {{race_id: string, stats: ReturnType<typeof deriveRaceStats>}[]} rows
 */
export function buildUpdateSql(rows) {
  const values = rows
    .map(
      ({ race_id, stats: s }) =>
        `  (${sqlText(race_id)}, ${sqlText(s.first_boat_grade)}, ${sqlNum(s.first_boat_win_rate)}, ${sqlNum(s.first_boat_motor_2rate)}, ${sqlNum(s.win_rate_avg)}, ${sqlNum(s.win_rate_stddev)}, ${sqlNum(s.motor_2rate_stddev)})`,
    )
    .join(",\n");
  const allNull = DERIVED_COLUMNS.map((c) => `r.${c} IS NULL`).join(" AND ");
  return `UPDATE races r SET
  first_boat_grade = v.first_boat_grade::varchar,
  first_boat_win_rate = v.first_boat_win_rate::numeric,
  first_boat_motor_2rate = v.first_boat_motor_2rate::numeric,
  win_rate_avg = v.win_rate_avg::numeric,
  win_rate_stddev = v.win_rate_stddev::numeric,
  motor_2rate_stddev = v.motor_2rate_stddev::numeric,
  updated_at = now()
FROM (VALUES
${values}
) AS v(race_id, first_boat_grade, first_boat_win_rate, first_boat_motor_2rate, win_rate_avg, win_rate_stddev, motor_2rate_stddev)
WHERE r.race_id = v.race_id
  AND ${allNull};`;
}

/** 対象: 期間内で、結果があり、予測が無く、導出列が6列とも NULL のレース（読み取りのみ） */
export async function loadTargets(client, from, to) {
  const inRange = (q) => q.gte("race_id", from).lt("race_id", `${to}~`);
  const races = await fetchAll(
    "races",
    `race_id, ${DERIVED_COLUMNS.join(", ")}`,
    (q) => inRange(q).is("first_boat_grade", null).order("race_id"),
    { throwOnError: true, client },
  );
  const ids = (rows) => new Set(rows.map((r) => r.race_id));
  const results = ids(
    await fetchAll(
      "race_results",
      "race_id",
      (q) => inRange(q).order("race_id"),
      { throwOnError: true, client },
    ),
  );
  const predicted = ids(
    await fetchAll(
      "predictions",
      "race_id",
      (q) => inRange(q).order("race_id"),
      {
        throwOnError: true,
        client,
      },
    ),
  );
  return races.filter(
    (r) =>
      results.has(r.race_id) &&
      !predicted.has(r.race_id) &&
      DERIVED_COLUMNS.every((c) => r[c] === null),
  );
}

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function main() {
  if (!isSupabaseEnabled()) throw new Error("Supabaseが設定されていません");
  const from = getArg("from") ?? "2026-04-01";
  const to = getArg("to") ?? "2026-09-30";
  const out = getArg("out");
  if (!out) throw new Error("--out=FILE.sql を指定してください");
  const targets = await loadTargets(supabase, from, to);
  // 対象のレースの出走だけを読む（期間全体の約17万行を読まない）。100レースずつ
  const entries = [];
  for (let i = 0; i < targets.length; i += 100) {
    const ids = targets.slice(i, i + 100).map((t) => t.race_id);
    entries.push(
      ...(await fetchAll(
        "race_entries",
        "race_id, boat_number, grade, win_rate, motor_2rate",
        (q) => q.in("race_id", ids).order("race_id").order("boat_number"),
        { throwOnError: true, client: supabase },
      )),
    );
  }
  const byRace = new Map();
  for (const e of entries) {
    if (!byRace.has(e.race_id)) byRace.set(e.race_id, []);
    byRace.get(e.race_id).push(e);
  }
  const rows = [];
  const skipped = [];
  for (const t of targets) {
    const stats = deriveRaceStats(byRace.get(t.race_id) ?? []);
    if (stats) rows.push({ race_id: t.race_id, stats });
    else skipped.push(t.race_id);
  }
  const byMonth = {};
  for (const r of rows) {
    const m = r.race_id.slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + 1;
  }
  fs.writeFileSync(out, `${buildUpdateSql(rows)}\n`);
  console.log(
    `対象 ${targets.length}レース（${from}〜${to}）: SQL に入れた ${rows.length}・出走の勝率等が欠けて入れなかった ${skipped.length}${skipped.length > 0 ? ` ${JSON.stringify(skipped.slice(0, 10))}` : ""}`,
  );
  console.log(`  月別: ${JSON.stringify(byMonth)} → ${out}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
