#!/usr/bin/env node
/**
 * イン屋（前付け）指標の材料: 選手×出走の「艇番・実際の進入コース」を本番から読み取りだけで取る（2026-11-03、オーナー依頼）。
 *   node --env-file=.env.local scripts/analysis/inya-racer/fetch-starts.mjs [--out data/analysis/inya-racer/work]
 * - 2019-04-01〜2025-12-02: kb_archive_boats.course（公式 K ファイル）
 * - 2025-12-03〜: race_entries.racer_id × race_results.actual_course_N（N=艇番）。course_1〜6 は使わない（data-columns.md）
 * - 進入が無い艇（欠場・L 等で NULL・0）は落とす。レースの側の情報（1号艇の1着・枠なり）は本体期間だけ races.json に出す
 * - 中止（is_cancelled・cancellation_status）・不成立（race_status='no_race'）は除く
 * 接続は claude_ro、READ ONLY のトランザクション、最後に ROLLBACK
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { checkRoUrl, RO_ROLE } from "../../lib/roQuery.js";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "data/analysis/inya-racer/work";
const KB_FROM = "2019-04-01", KB_END = "2025-12-02";

const c = new pg.Client({ connectionString: checkRoUrl(process.env.SUPABASE_RO_DB_URL), ssl: { rejectUnauthorized: false }, application_name: "inya-racer" });
await c.connect();
const starts = []; // [racer_id, yyyymmdd(int), venue(int), boat, course]
const races = [];
const names = {}; // racer_id -> {name, grade, branch}  // 本体期間: [race_id, date, venue, grade, boat1_win(0/1), courses[6] (艇番順), racer_ids[6], winrates[6]]
try {
  await c.query("BEGIN READ ONLY");
  const who = (await c.query("select current_user u")).rows[0].u;
  if (who !== RO_ROLE) throw new Error(`接続ロールが ${who}（${RO_ROLE} でない）`);
  await c.query("SET LOCAL statement_timeout = '120s'");
  // kb: 月ごとに取る
  for (let d = new Date(`${KB_FROM}T00:00:00Z`); d <= new Date(`${KB_END}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) {
    const from = d.toISOString().slice(0, 10);
    const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1);
    const to = e.toISOString().slice(0, 10);
    const { rows } = await c.query(`select b.racer_id id, to_char(r.race_date,'YYYYMMDD')::int d, r.venue_code::int v, b.boat_number bn, b.course co
      from kb_archive_races r join kb_archive_boats b on b.race_id = r.race_id
      where r.race_date >= $1::date and r.race_date < $2::date and r.race_date <= $3::date and r.has_result
        and b.course between 1 and 6 and b.racer_id is not null`, [from, to, KB_END]);
    for (const x of rows) starts.push([Number(x.id), x.d, x.v, x.bn, x.co]);
    process.stderr.write(`${from} ${rows.length}\n`);
  }
  const { rows: m } = await c.query(`select r.race_id, to_char(r.race_date,'YYYYMMDD')::int d, r.venue_code::int v, r.race_grade g,
      rr.rank1, rr.actual_course_1 a1, rr.actual_course_2 a2, rr.actual_course_3 a3, rr.actual_course_4 a4, rr.actual_course_5 a5, rr.actual_course_6 a6,
      array_agg(e.racer_id order by e.boat_number) ids, array_agg(e.boat_number order by e.boat_number) bns,
      array_agg(e.win_rate order by e.boat_number) wr
    from races r join race_results rr on rr.race_id = r.race_id join race_entries e on e.race_id = r.race_id
    where r.race_date > $1::date and coalesce(rr.is_cancelled,false) = false and r.cancellation_status is null
      and coalesce(rr.race_status,'normal') <> 'no_race'
    group by 1,2,3,4,5,6,7,8,9,10,11`, [KB_END]);
  for (const x of m) {
    const co = [x.a1, x.a2, x.a3, x.a4, x.a5, x.a6];
    const ids = Array(6).fill(null), wr = Array(6).fill(null);
    x.bns.forEach((bn, i) => { ids[bn - 1] = x.ids[i] == null ? null : Number(x.ids[i]); wr[bn - 1] = x.wr[i] == null ? null : Number(x.wr[i]); });
    for (let b = 1; b <= 6; b++) if (ids[b - 1] != null && co[b - 1] >= 1 && co[b - 1] <= 6) starts.push([ids[b - 1], x.d, x.v, b, co[b - 1]]);
    races.push([x.race_id, x.d, x.v, x.g, x.rank1 == null ? null : Number(x.rank1) === 1 ? 1 : 0, co, ids, wr]);
  }
  // 名前・級: 本体期間の最新の出走の player_name・grade
  const { rows: nm } = await c.query(`select distinct on (e.racer_id) e.racer_id id, e.player_name n, e.grade g, e.branch b
    from race_entries e join races r on r.race_id = e.race_id where e.racer_id is not null and r.race_date > $1::date
    order by e.racer_id, r.race_date desc`, [KB_END]);
  for (const x of nm) names[Number(x.id)] = { name: x.n, grade: x.g, branch: x.b };
} finally {
  await c.query("ROLLBACK").catch(() => {});
  await c.end();
}
fs.mkdirSync(OUT, { recursive: true });
const meta = { fetchedAt: new Date().toISOString(), kb: [KB_FROM, KB_END], main: `>${KB_END}`, starts: starts.length, races: races.length };
fs.writeFileSync(path.join(OUT, "starts.json"), JSON.stringify({ meta, starts }));
fs.writeFileSync(path.join(OUT, "races.json"), JSON.stringify({ meta, races }));
fs.writeFileSync(path.join(OUT, "names.json"), JSON.stringify({ meta, names }));
console.log(JSON.stringify(meta));
