/**
 * verify-scrape-slots-sql.js - マイグレーション075（予定表 scrape_slots・ジョブ状態 scrape_job_state・
 * RPC ensure_scrape_slots / claim_scrape_slots・race_odds の window_min/source）と、092
 * （claim_scrape_slots_by_offset。offset ごとの許容幅の上書き。BOA-386・完了の定義Bの見直し）の検証。
 *
 * 本番DBには触れず、インメモリのPostgreSQL（PGlite）に最小の races・race_odds を作ってマイグレーションを適用し、
 * RPCの意味論（期限・許容幅・リース・奪取・冪等・確定中止・日付またぎ・limit・順序）を、時刻を p_now で固定して確認する。
 *
 * 実行: npm run verify:scrape-slots-sql（PGlite は devDependencies に入っており npm ci で入る）。
 *   PRごとの Quality Gates CI（npm run verify:ci）でも実行される
 *
 * 確認できないこと: FOR UPDATE SKIP LOCKED の並行実行（PGliteは単一接続）。二重claimの並行検証は、
 * DDLの本番適用後に、tasks.md T4a-10 の手順（別途）で行う。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runScrapeSlotsSqlScenes1,
  runScrapeSlotsSqlScenes2,
  runScrapeSlotsSqlScenes3,
  runScrapeSlotsSqlScenes4,
  runScrapeSlotsSqlScenes5,
  runScrapeSlotsSqlScenes6,
  runScrapeSlotsSqlScenes7,
  runScrapeSlotsSqlScenes8,
  runScrapeSlotsSqlScenes9,
  runScrapeSlotsSqlScenes10,
  runScrapeSlotsSqlScenes11,
  runScrapeSlotsSqlScenes12,
  runScrapeSlotsSqlScenes13,
  runScrapeSlotsSqlScenes14,
} from "./verifyData/scrape-slots-sql-scenes-1.js";
import { runScrapeSlotsSqlScenes15 } from "./verifyData/scrape-slots-sql-scenes-2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
  __dirname,
  "../../docs/db-migration/075_scrape_slots_and_job_state.sql",
);
const MIGRATION_092 = path.join(
  __dirname,
  "../../docs/db-migration/092_claim_scrape_slots_by_offset.sql",
);

let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.error(
    "@electric-sql/pglite が見つかりません。次を実行してから再実行してください:\n  npm i --no-save @electric-sql/pglite",
  );
  process.exit(2);
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE races (race_id varchar(20) primary key, race_date date not null, venue_code smallint not null, race_number smallint not null, start_time time, cancellation_status text);
CREATE TABLE race_odds (race_id varchar(20) references races(race_id) on delete cascade, captured_at timestamptz not null, odds_win_1 numeric, primary key (race_id, captured_at));
`);
const migrationSql = fs.readFileSync(MIGRATION, "utf8");
await db.exec("BEGIN;\n" + migrationSql + "\nCOMMIT;");
// 冪等（再適用しても失敗しない）
await db.exec("BEGIN;\n" + migrationSql + "\nCOMMIT;");
const migration092Sql = fs.readFileSync(MIGRATION_092, "utf8");
await db.exec("BEGIN;\n" + migration092Sql + "\nCOMMIT;");
await db.exec("BEGIN;\n" + migration092Sql + "\nCOMMIT;");

let fail = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log("OK  " + label);
  else {
    fail++;
    console.log("NG  " + label + " " + detail);
  }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;

// 2026-09-19 (JST) のレース: 1R 10:00, 2R 10:30, 3R 22:45（夜間）, 4R start_time NULL, 5R 確定中止 11:00
await db.exec(`
INSERT INTO races (race_id, race_date, venue_code, race_number, start_time, cancellation_status) VALUES
 ('2026-09-19-01-01','2026-09-19',1,1,'10:00:00',NULL),
 ('2026-09-19-01-02','2026-09-19',1,2,'10:30:00','tentative'),
 ('2026-09-19-01-03','2026-09-19',1,3,'22:45:00',NULL),
 ('2026-09-19-01-04','2026-09-19',1,4,NULL,NULL),
 ('2026-09-19-01-05','2026-09-19',1,5,'11:00:00','confirmed');
`);
const defs = JSON.stringify([
  { job: "odds", offset_min: -60, grace_min: 3 },
  { job: "odds", offset_min: -30, grace_min: 3 },
  { job: "result", offset_min: 5, grace_min: 85 },
]);
// JST 09:00 = UTC 00:00
const at = (hhmmJst) => `2026-09-19T${hhmmJst}:00+09:00`;

// ensure: p_skip_lapsed=false は全レース(start_time有り4件)×3定義=12
let n = (
  await q(
    `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz) AS n`,
    [defs, at("09:00")],
  )
)[0].n;
check(
  "ensure 全件作成（start_time NULLを除く4レース×3定義=12）",
  n === 12,
  `n=${n}`,
);
n = (
  await q(
    `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz) AS n`,
    [defs, at("09:00")],
  )
)[0].n;
check("ensure 再実行は0件（冪等）", n === 0, `n=${n}`);

// skip_lapsed: 別日の races を使わず、削除して作り直す
await db.exec("DELETE FROM scrape_slots");
n = (
  await q(
    `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, true, $2::timestamptz) AS n`,
    [defs, at("10:40")],
  )
)[0].n;
// 10:40時点: R1(10:00) odds-60 期限9:00+3=9:03 過去→skip、odds-30(9:30+3)過去→skip、result(10:05+85=11:30)未来→作る
// R2(10:30) odds-60(9:30+3)過去、odds-30(10:00+3)過去、result(10:35+85)→作る
// R3(22:45) 全て未来→3、R5(11:00) odds-60(10:00+3) 過去、odds-30(10:30+3) 過去→skip、result作る
check(
  "ensure skip_lapsed=true は期限+許容幅が過ぎたスロットを作らない",
  n === 1 + 1 + 3 + 1,
  `n=${n}`,
);

// --- claim ---
await db.exec("DELETE FROM scrape_slots");
await q(
  `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz)`,
  [defs, at("09:00")],
);

const claim = (
  job,
  t,
  worker = "w1",
  limit = 10,
  lease = 90,
  grace = 3,
  mode = "live",
) =>
  q(
    `SELECT race_id, offset_min, attempts, status, claimed_by, run_mode, lease_until, first_attempt_at FROM claim_scrape_slots($1,$2,$3,$4,$5,$6,$7::timestamptz)`,
    [job, limit, lease, worker, grace, mode, at(t)],
  );

let rows = await claim("odds", "08:59");
check("期限前は何も取らない", rows.length === 0, JSON.stringify(rows));

// 09:00 (R1のodds-60期限=09:00ちょうど。R2の-60=09:30)
rows = await claim("odds", "09:00");
check(
  "期限ちょうどで取れる（R1 -60）",
  rows.length === 1 &&
    rows[0].race_id === "2026-09-19-01-01" &&
    rows[0].offset_min === -60 &&
    rows[0].attempts === 1 &&
    rows[0].status === "running" &&
    rows[0].claimed_by === "w1",
  JSON.stringify(rows),
);
const lease = new Date(rows[0].lease_until).getTime();

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
runScrapeSlotsSqlScenes1({ db, check, q, defs, at, lease });

rows = await claim("odds", "09:00", "w2");
check(
  "同一時刻の別workerは取れない（running・リース中）",
  rows.length === 0,
  JSON.stringify(rows),
);

rows = await claim("odds", "09:01", "w2");
check("リース内(09:01)の別workerは取れない", rows.length === 0);

rows = await claim("odds", "09:02", "w2");
check(
  "リース切れ(90秒後)の running は別workerが奪取し attempts=2",
  rows.length === 1 &&
    rows[0].attempts === 2 &&
    rows[0].claimed_by === "w2" &&
    rows[0].first_attempt_at !== null,
  JSON.stringify(rows),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes2({ db, check, q, defs, at, lease });

// 許容幅超過は expired: R1 -60 は done。R2 -60 (09:30+3=09:33) を 09:34 に claim → expired、取れない
rows = await claim("odds", "09:34");
check(
  "許容幅超過(09:34)のR2 -60は取れず、-30(10:00期限)は未到来",
  rows.length === 0,
  JSON.stringify(rows),
);
let st = await q(
  `SELECT status, attempts FROM scrape_slots WHERE job='odds' AND race_id='2026-09-19-01-02' AND offset_min=-60`,
);
check(
  "R2 -60 は expired（attempts=0＝未実行）",
  st[0].status === "expired" && st[0].attempts === 0,
  JSON.stringify(st),
);
st = await q(
  `SELECT status, outcome FROM scrape_slots WHERE job='odds' AND race_id='2026-09-19-01-01' AND offset_min=-60`,
);
check("done は expired 化されない", st[0].status === "done");

// 確定中止: R5(11:00) は claim で cancelled_race になる（期限前でも）
st = await q(
  `SELECT status, outcome FROM scrape_slots WHERE job='odds' AND race_id='2026-09-19-01-05'`,
);
check(
  "確定中止のレースは cancelled_race で終端",
  st.length === 2 &&
    st.every((r) => r.status === "done" && r.outcome === "cancelled_race"),
  JSON.stringify(st),
);

// 再試行: R2 -30 (期限10:00): 10:00 に取り、失敗→pending+next_attempt_at=10:01、10:00:30 では取れない、10:01 で取れる
rows = await claim("odds", "10:00");
check(
  "R2 -30 を10:00に取る",
  rows.length === 1 &&
    rows[0].race_id === "2026-09-19-01-02" &&
    rows[0].offset_min === -30,
  JSON.stringify(rows),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes3({ db, check, q, defs, at, lease });
rows = await q(
  `SELECT * FROM claim_scrape_slots('odds',10,90,'w1',3,'live',$1::timestamptz)`,
  ["2026-09-19T10:00:30+09:00"],
);
check("next_attempt_at 前は取れない", rows.length === 0);
rows = await claim("odds", "10:01");
check(
  "next_attempt_at 到達で再取得、attempts=2",
  rows.length === 1 && rows[0].attempts === 2,
  JSON.stringify(rows),
);

// 許容幅(3分): 10:03 を超える 10:04 では expired（リースが切れていれば。ここは 10:01+90s=10:02:30 で切れている）
rows = await claim("odds", "10:04");
st = await q(
  `SELECT status FROM scrape_slots WHERE job='odds' AND race_id='2026-09-19-01-02' AND offset_min=-30`,
);
check(
  "リース切れ・許容幅超過の running は expired",
  rows.length === 0 && st[0].status === "expired",
  JSON.stringify(st),
);

// 許容幅内でも、リース有効な running は expired にしない（処理中）
rows = await claim("result", "10:05", "w1", 10, 300, 85);
check(
  "result 10:05: R1(10:00+5)のみ取れる（R2は10:35）",
  rows.length === 1 && rows[0].race_id === "2026-09-19-01-01",
  JSON.stringify(rows),
);
rows = await claim("result", "11:30", "w9", 10, 300, 85);
// R1 は 10:05+85=11:30 が許容幅の終端（>= now で有効）。リース(10:05+300s)切れの running → 奪取される
check(
  "許容幅の終端ちょうど(11:30)は有効で、リース切れrunningを奪取",
  rows.some((r) => r.race_id === "2026-09-19-01-01"),
  JSON.stringify(rows),
);
// 有効なリース中の running は、許容幅を超えても expired にされない
rows = await claim("result", "12:31", "w9", 10, 300, 85); // 11:30+300s=11:35 でリース切れ→12:31では許容幅超過 → expired
st = await q(
  `SELECT status FROM scrape_slots WHERE job='result' AND race_id='2026-09-19-01-01'`,
);
check(
  "リース切れ・許容幅超過の running は expired",
  st[0].status === "expired",
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes4({ db, check, q, defs, at, lease });
rows = await claim("result", "23:30", "w1", 2, 300, 999);
check(
  "limit=2 で期限の早い順に2件（R1, R2）",
  rows.length === 2 &&
    rows[0].race_id === "2026-09-19-01-01" &&
    rows[1].race_id === "2026-09-19-01-02",
  JSON.stringify(rows.map((r) => r.race_id)),
);
rows = await claim("result", "23:30", "w2", 2, 300, 999);
check(
  "残りは、走行中を除き R3 のみ（R5は確定中止で終端済み）",
  rows.length === 1 && rows[0].race_id === "2026-09-19-01-03",
  JSON.stringify(rows.map((r) => r.race_id)),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes5({ db, check, q, defs, at, lease });
rows = await q(
  `SELECT * FROM claim_scrape_slots('result',10,300,'w3',85,'live',$1::timestamptz)`,
  ["2026-09-20T00:20:00+09:00"],
);
st = await q(
  `SELECT status FROM scrape_slots WHERE race_id='2026-09-19-01-03'`,
);
check(
  "日付をまたいだ翌日00:20でも前日分を expired にする",
  st[0].status === "expired",
  JSON.stringify(st),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes6({ db, check, q, defs, at, lease });
rows = await q(
  `SELECT * FROM claim_scrape_slots('result',10,300,'w3',85,'live',$1::timestamptz)`,
  ["2026-09-21T09:00:00+09:00"],
);
st = await q(
  `SELECT status FROM scrape_slots WHERE race_id='2026-09-19-01-03'`,
);
check(
  "2日以上前の未完了は claim の走査対象外（pendingのまま）",
  st[0].status === "pending" && rows.length === 0,
  JSON.stringify(st),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes7({ db, check, q, defs, at, lease });
rows = (await claim("odds", "09:00")).filter((r) =>
  r.race_id.startsWith("2026-09-19-02-"),
);
check(
  "発走の繰り下げ: 元の期限(09:00)には、繰り下げたレースを取らない（期限が10:00に追従）",
  !rows.some((r) => r.race_id === "2026-09-19-02-01"),
  JSON.stringify(rows.map((r) => r.race_id)),
);
rows = (await claim("odds", "10:00")).filter((r) =>
  r.race_id.startsWith("2026-09-19-02-"),
);
check(
  "発走の繰り下げ: 新しい期限(10:00)に取れる",
  rows.some((r) => r.race_id === "2026-09-19-02-01"),
  JSON.stringify(rows.map((r) => r.race_id)),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes8({ db, check, q, defs, at, lease }); // 期限08:30
rows = (await claim("odds", "08:31", "w9", 10, 90, 3)).filter(
  (r) => r.race_id === "2026-09-19-02-02",
);
check(
  "発走の繰り上げ: 新しい期限(08:30)に取れる（期限が前倒しに追従）",
  rows.length === 1,
  JSON.stringify(rows),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes9({ db, check, q, defs, at, lease });
rows = await q(
  "SELECT * FROM claim_scrape_slots('odds',10,90,'w9',3,'live',$1::timestamptz)",
  [at("12:00")],
);
st = await q(
  "SELECT status FROM scrape_slots WHERE race_id='2026-09-19-02-03'",
);
check(
  "既に done のスロットは、発走時刻が変わっても再オープンしない（既知の限界）",
  st[0].status === "done" &&
    !rows.some((r) => r.race_id === "2026-09-19-02-03"),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes10({ db, check, q, defs, at, lease });
rows = (await claim("odds", "10:03", "w9", 10, 90, 3)).filter(
  (r) => r.race_id === "2026-09-19-02-01",
);
check(
  "許容幅も新しい期限に追従する（期限10:00+3分=10:03は有効）",
  rows.length === 1,
  JSON.stringify(rows),
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes11({ db, check, q, defs, at, lease });
rows = (await claim("odds", "10:04", "w9", 10, 90, 3)).filter(
  (r) => r.race_id === "2026-09-19-02-01",
);
st = await q(
  "SELECT status FROM scrape_slots WHERE race_id='2026-09-19-02-01'",
);
check(
  "許容幅を超える(10:04)と expired",
  rows.length === 0 && st[0].status === "expired",
);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes12({ db, check, q, defs, at, lease });
rows = await claim("odds", "09:00", "s1", 10, 90, 3, "shadow");
check(
  "shadow で claim すると run_mode=shadow",
  rows.length === 1 && rows[0].run_mode === "shadow",
);

// 引数の検証
let err = null;
try {
  await claim("odds", "09:00", "x", 0);
} catch (e) {
  err = e;
}
check("limit=0 は例外", err !== null);
err = null;
try {
  await claim("odds", "09:00", "x", 1, 90, 3, "prod");
} catch (e) {
  err = e;
}
check("不正な run_mode は例外", err !== null);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js） ----
await runScrapeSlotsSqlScenes13({ db, check, q, defs, at, lease });
err = null;
try {
  await db.exec(
    "INSERT INTO race_odds (race_id, captured_at, window_min, source) VALUES ('2026-09-19-01-01','2026-09-19 00:06+00',-60,'vercel')",
  );
} catch (e) {
  err = e;
}
check("同じ (race_id, window_min) は一意制約違反", err !== null);

// ---- 後半の場面（verifyData/scrape-slots-sql-scenes-1.js・scrape-slots-sql-scenes-2.js） ----
await runScrapeSlotsSqlScenes14({ db, check, q, defs, at, lease });
await runScrapeSlotsSqlScenes15({ db, check, q });
err = null;
try {
  await db.exec(`INSERT INTO t_partial (race_id, captured_at, window_min, source) VALUES ('a', now() + interval '1 min', -60, 'vercel')
                 ON CONFLICT (race_id, window_min) DO UPDATE SET captured_at = EXCLUDED.captured_at`);
} catch (e) {
  err = e;
}
check(
  "（参考）部分一意索引は ON CONFLICT (race_id, window_min) で推論されない",
  err !== null &&
    /no unique or exclusion constraint matching/.test(err.message),
  err ? err.message : "推論できてしまった",
);

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
