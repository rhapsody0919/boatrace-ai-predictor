#!/usr/bin/env node
/**
 * BOA-1280: 逃がし率・被まくられ率の効き目の検証の材料を、本番 DB から読み取りだけで取る（claude_ro、READ ONLY、最後に ROLLBACK）。
 *
 *   node --env-file=.env.local scripts/analysis/nigashi-makurare/fetch-runs.mjs [--to 2026-11-03] [--out data/analysis/nigashi-makurare/work]
 *
 * 出力: <out>/runs.tsv（1行1艇。gitignore）。列 race_id, d, venue, bn, racer, course, win_rate, cls, winner_bn, second_bn, tech
 * - 2019-04-01〜2025-12-02 は kb_archive_races/boats（has_result）、2025-12-03〜 は races/race_results/race_entries
 *   （ft01-wall-grid と同じ境目）
 * - 本体の除外は 098 の compute_racer_course_technique_stats の base と同じ: 決まり手が空・中止・不成立・欠場・racer_id なし。
 *   race_status は normal と partial_refund を入れる（no_race は決まり手が空なので自然に落ちる）
 * - 長期の除外: technique が空、1着艇が無い、course が空（欠場など）
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { checkRoUrl, RO_ROLE } from "../../lib/roQuery.js";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const KB_START = 2019, KB_END = "2025-12-02";
const TO = arg("--to", "2026-11-03");
const OUT = arg("--out", "data/analysis/nigashi-makurare/work");
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "runs.tsv");
const ws = fs.createWriteStream(file);
ws.write("race_id\td\tvenue\tbn\tracer\tcourse\twin_rate\tcls\twinner_bn\tsecond_bn\ttech\n");

const client = new pg.Client({ connectionString: checkRoUrl(process.env.SUPABASE_RO_DB_URL), ssl: { rejectUnauthorized: false }, application_name: "boa1280-nigashi" });
await client.connect();
let total = 0;
const put = (rows) => {
  for (const r of rows) ws.write([r.race_id, r.d, r.venue, r.bn, r.racer, r.course, r.w ?? "", r.cls ?? "", r.wbn, r.sbn ?? "", r.tech].join("\t") + "\n");
  total += rows.length;
};
try {
  await client.query("BEGIN READ ONLY");
  const who = (await client.query("select current_user u")).rows[0].u;
  if (who !== RO_ROLE) throw new Error(`接続ロールが ${who}（${RO_ROLE} でない）`);
  await client.query("SET LOCAL statement_timeout = '300s'");
  // 長期: 半年ごとに分けて取る
  const spans = [];
  for (let y = KB_START; y <= 2025; y++) spans.push([`${y}-01-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-12-31`]);
  for (const [a, b0] of spans) {
    const b = b0 > KB_END ? KB_END : b0;
    if (a > b) continue;
    const { rows } = await client.query(`
      with w as (select race_id, min(boat_number) filter (where finish_rank = 1) wbn, min(boat_number) filter (where finish_rank = 2) sbn from kb_archive_boats group by race_id)
      select r.race_id, r.race_date::text d, r.venue_code venue, b.boat_number bn, b.racer_id racer, b.course,
             b.national_win_rate w, b.class cls, w.wbn, w.sbn, r.technique tech
      from kb_archive_races r join kb_archive_boats b on b.race_id = r.race_id join w on w.race_id = r.race_id and w.wbn is not null
      where r.has_result and r.technique is not null and r.technique <> '' and b.course is not null and b.racer_id is not null
        and r.race_date between $1::date and $2::date`, [a, b]);
    put(rows);
    console.error(`kb ${a}..${b}: ${rows.length}`);
  }
  const { rows } = await client.query(`
    select ra.race_id, ra.race_date::text d, ra.venue_code venue, e.boat_number bn, e.racer_id racer,
      case e.boat_number when 1 then rr.actual_course_1 when 2 then rr.actual_course_2 when 3 then rr.actual_course_3
        when 4 then rr.actual_course_4 when 5 then rr.actual_course_5 when 6 then rr.actual_course_6 end course,
      e.win_rate w, e.grade cls, rr.rank1 wbn, rr.rank2 sbn, rr.winning_technique tech
    from races ra join race_results rr on rr.race_id = ra.race_id join race_entries e on e.race_id = ra.race_id
    where ra.race_date > $1::date and ra.race_date <= $2::date
      and rr.actual_course_1 is not null and rr.winning_technique is not null and rr.winning_technique <> ''
      and coalesce(rr.is_cancelled, false) = false and coalesce(rr.is_no_race, false) = false
      and ra.cancellation_status is null and coalesce(e.is_absent, false) = false and e.racer_id is not null`, [KB_END, TO]);
  put(rows.filter((r) => r.course != null));
  console.error(`main: ${rows.length}`);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
await new Promise((res) => ws.end(res));
console.error(`wrote ${total} rows -> ${file}`);
