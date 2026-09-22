/**
 * verify-scrape-slots-sql.js - マイグレーション075（予定表 scrape_slots・ジョブ状態 scrape_job_state・
 * RPC ensure_scrape_slots / claim_scrape_slots・race_odds の window_min/source）と、092
 * （claim_scrape_slots_by_offset。offset ごとの許容幅の上書き。BOA-386・完了の定義Bの見直し）の検証。
 *
 * 本番DBには触れず、インメモリのPostgreSQL（PGlite）に最小の races・race_odds を作ってマイグレーションを適用し、
 * RPCの意味論（期限・許容幅・リース・奪取・冪等・確定中止・日付またぎ・limit・順序）を、時刻を p_now で固定して確認する。
 *
 * 実行: PGlite は devDependencies に入れていない（この検証のためだけの重い依存のため）。
 *   npm i --no-save @electric-sql/pglite && node scripts/maintenance/verify-scrape-slots-sql.js
 *
 * 確認できないこと: FOR UPDATE SKIP LOCKED の並行実行（PGliteは単一接続）。二重claimの並行検証は、
 * DDLの本番適用後に、tasks.md T4a-10 の手順（別途）で行う。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
check("リースは now+90秒", lease === new Date(at("09:00")).getTime() + 90000);

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

// 完了の条件付き更新（アプリ側）: 旧worker w1 は奪われているので0行
let upd = await q(
  `UPDATE scrape_slots SET status='done', done_at=$1::timestamptz WHERE job='odds' AND race_id='2026-09-19-01-01' AND offset_min=-60 AND claimed_by='w1' AND status='running' RETURNING race_id`,
  [at("09:02")],
);
check("奪取された旧workerの完了更新は0行", upd.length === 0);
upd = await q(
  `UPDATE scrape_slots SET status='done', done_at=$1::timestamptz, outcome='ok' WHERE job='odds' AND race_id='2026-09-19-01-01' AND offset_min=-60 AND claimed_by='w2' AND status='running' RETURNING race_id`,
  [at("09:02")],
);
check("現在のリース保持者の完了更新は1行", upd.length === 1);

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
await q(
  `UPDATE scrape_slots SET status='pending', next_attempt_at=$1::timestamptz, lease_until=NULL, last_error='x' WHERE job='odds' AND race_id='2026-09-19-01-02' AND offset_min=-30 AND claimed_by='w1' AND status='running'`,
  [at("10:01")],
);
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

// limit と順序
await db.exec("DELETE FROM scrape_slots");
await q(
  `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz)`,
  [
    JSON.stringify([{ job: "result", offset_min: 5, grace_min: 999 }]),
    at("09:00"),
  ],
);
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

// 日付をまたぐ: JST 翌日 00:20 の claim でも前日の R3(22:45+5, grace 85 → 00:15)は expired、R3が未完了なら expired 化される
await db.exec(
  "UPDATE scrape_slots SET status='pending', lease_until=NULL, claimed_by=NULL WHERE race_id='2026-09-19-01-03'",
);
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

// 2日以上前の未完了は claim では触らない（cleanup の担当）
await db.exec(
  "UPDATE scrape_slots SET status='pending', lease_until=NULL, claimed_by=NULL WHERE race_id='2026-09-19-01-03'",
);
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

// 発走時刻の変更（順延・繰り下げ）への追従: 期限は保存せず races.start_time から都度計算するため、
// まだ done でないスロットは、発走時刻の変更に追従する。既に done のスロットは再オープンしない（既知の限界）
await db.exec("DELETE FROM scrape_slots");
await db.exec(`
  INSERT INTO races (race_id, race_date, venue_code, race_number, start_time) VALUES
   ('2026-09-19-02-01','2026-09-19',2,1,'10:00:00'),
   ('2026-09-19-02-02','2026-09-19',2,2,'10:30:00'),
   ('2026-09-19-02-03','2026-09-19',2,3,'11:00:00');
`);
await q(
  `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz)`,
  [
    JSON.stringify([{ job: "odds", offset_min: -60, grace_min: 3 }]),
    at("08:00"),
  ],
);
// 02-01(10:00, 期限09:00)を11:00に繰り下げ → 09:00には取れず、10:00に取れる
await db.exec(
  "UPDATE races SET start_time='11:00:00' WHERE race_id='2026-09-19-02-01'",
);
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
// 02-02(10:30, 期限09:30・pending)を10:00に繰り上げ → 期限09:00に取れる（期限が前倒しされる。未来の期限は過去に）
await db.exec(
  "UPDATE scrape_slots SET status='pending', claimed_by=NULL, lease_until=NULL WHERE race_id='2026-09-19-02-02'",
);
await db.exec(
  "UPDATE races SET start_time='09:30:00' WHERE race_id='2026-09-19-02-02'",
); // 期限08:30
rows = (await claim("odds", "08:31", "w9", 10, 90, 3)).filter(
  (r) => r.race_id === "2026-09-19-02-02",
);
check(
  "発走の繰り上げ: 新しい期限(08:30)に取れる（期限が前倒しに追従）",
  rows.length === 1,
  JSON.stringify(rows),
);
// 既に done のスロットは、発走時刻が変わっても再オープンされない
await db.exec(
  "UPDATE scrape_slots SET status='done', done_at=now() WHERE race_id='2026-09-19-02-03'",
);
await db.exec(
  "UPDATE races SET start_time='13:00:00' WHERE race_id='2026-09-19-02-03'",
);
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
// 許容幅も新しい期限に追従する: 繰り下げた 02-01(期限10:00)は 10:03 まで有効
await db.exec(
  "UPDATE scrape_slots SET status='pending', claimed_by=NULL, lease_until=NULL, attempts=0 WHERE race_id='2026-09-19-02-01'",
);
rows = (await claim("odds", "10:03", "w9", 10, 90, 3)).filter(
  (r) => r.race_id === "2026-09-19-02-01",
);
check(
  "許容幅も新しい期限に追従する（期限10:00+3分=10:03は有効）",
  rows.length === 1,
  JSON.stringify(rows),
);
await db.exec(
  "UPDATE scrape_slots SET status='pending', claimed_by=NULL, lease_until=NULL WHERE race_id='2026-09-19-02-01'",
);
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

// 以降の検証のため、追加したレースを削除する（scrape_slots は ON DELETE CASCADE で消える）
await db.exec("DELETE FROM races WHERE race_id LIKE '2026-09-19-02-%'");

// shadow の run_mode
await db.exec("DELETE FROM scrape_slots");
await q(
  `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz)`,
  [defs, at("09:00")],
);
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

// race_odds の一意索引: window_min NULL は重複可、同じ (race_id, window_min) は不可
await db.exec(
  "INSERT INTO race_odds (race_id, captured_at) VALUES ('2026-09-19-01-01','2026-09-19 00:00+00'), ('2026-09-19-01-01','2026-09-19 00:01+00')",
);
check("window_min NULL の既存形式の行は重複可", true);
await db.exec(
  "INSERT INTO race_odds (race_id, captured_at, window_min, source) VALUES ('2026-09-19-01-01','2026-09-19 00:05+00',-60,'vercel')",
);
err = null;
try {
  await db.exec(
    "INSERT INTO race_odds (race_id, captured_at, window_min, source) VALUES ('2026-09-19-01-01','2026-09-19 00:06+00',-60,'vercel')",
  );
} catch (e) {
  err = e;
}
check("同じ (race_id, window_min) は一意制約違反", err !== null);
await db.exec(
  "INSERT INTO race_odds (race_id, captured_at, window_min, source) VALUES ('2026-09-19-01-01','2026-09-19 00:07+00',-60,'vercel') ON CONFLICT (race_id, window_min) DO UPDATE SET captured_at = EXCLUDED.captured_at",
);
const o = await q("SELECT count(*) c FROM race_odds WHERE window_min = -60");
check(
  "ON CONFLICT (race_id, window_min) の upsert（PostgREST同形）が同じ行を更新する",
  Number(o[0].c) === 1,
);
const s = await q(
  "SELECT source, count(*) c FROM race_odds GROUP BY 1 ORDER BY 1",
);
check(
  "既存行の source は gha",
  s.find((r) => r.source === "gha")?.c == 2,
  JSON.stringify(s),
);

// --- 展示の窓の外の補完のスロット（BOA-382）: レジストリの実際の定義（slotDefsFor）で、-33 と +10 の2本を作り、
//     窓（+10〜+36）・再試行の待ち・確定中止・期限切れを、RPCで確認する（RPC自体は変えていない）
{
  const { slotDefsFor, SCRAPE_JOBS } =
    await import("../lib/scrapeJobs/registry.js");
  const ex = SCRAPE_JOBS.exhibition;
  const exDefs = JSON.stringify(slotDefsFor(["exhibition"]));
  const t = (hhmm) => `2026-09-22T${hhmm}:00+09:00`;
  const claimEx = (hhmm, worker = "wx") =>
    q(
      `SELECT race_id, offset_min, attempts, status FROM claim_scrape_slots('exhibition',$1,$2,$3,$4,'live',$5::timestamptz) ORDER BY race_id, offset_min`,
      [ex.claimLimit, ex.leaseSec, worker, ex.graceMin, t(hhmm)],
    );
  const slotOf = async (raceId, offset) =>
    (
      await q(
        `SELECT status, outcome, attempts FROM scrape_slots WHERE job='exhibition' AND race_id=$1 AND offset_min=$2`,
        [raceId, offset],
      )
    )[0];
  await db.exec("DELETE FROM scrape_slots");
  // 5R 17:02（通常）、6R 17:30（確定中止）、7R 18:00（中止の疑い。tentative）
  await db.exec(`
  INSERT INTO races (race_id, race_date, venue_code, race_number, start_time, cancellation_status) VALUES
   ('2026-09-22-12-05','2026-09-22',12,5,'17:02:00',NULL),
   ('2026-09-22-12-06','2026-09-22',12,6,'17:30:00','confirmed'),
   ('2026-09-22-12-07','2026-09-22',12,7,'18:00:00','tentative');
  `);
  const made = (
    await q(
      `SELECT ensure_scrape_slots('2026-09-22'::date, $1::jsonb, false, $2::timestamptz) AS n`,
      [exDefs, t("09:00")],
    )
  )[0].n;
  check(
    "展示: ensure は、3レース×2本（-33 と 10）＝6スロットを作る",
    made === 6,
    `n=${made}`,
  );

  let got = await claimEx("17:11");
  check(
    "展示: 発走の9分後（17:11）は、5R の -33（許容幅の26分を超え expired）も、補完（+10）も取らない。確定中止の6Rは cancelled_race で終端し、取らない",
    got.length === 0 &&
      (await slotOf("2026-09-22-12-05", -33)).status === "expired" &&
      (await slotOf("2026-09-22-12-06", -33)).outcome === "cancelled_race" &&
      (await slotOf("2026-09-22-12-06", 10)).outcome === "cancelled_race",
    JSON.stringify(got),
  );
  got = await claimEx("17:12");
  check(
    "展示: 発走の10分後（17:12）に、5R の補完（+10）を取る（attempts=1）。中止の疑い（tentative）の7Rは、まだ期限前で取らない",
    got.length === 1 &&
      got[0].race_id === "2026-09-22-12-05" &&
      got[0].offset_min === 10 &&
      got[0].attempts === 1,
    JSON.stringify(got),
  );
  // 補完の再試行（ハンドラーが返す retryAt＝claim の約590秒後）まで、取らない
  await q(
    `UPDATE scrape_slots SET status='pending', lease_until=NULL, next_attempt_at=$1::timestamptz WHERE job='exhibition' AND race_id='2026-09-22-12-05' AND offset_min=10`,
    ["2026-09-22T17:21:50+09:00"],
  );
  got = await claimEx("17:21");
  check(
    "展示: 再試行の時刻（17:21:50）の前は、補完を取らない",
    got.length === 0,
    JSON.stringify(got),
  );
  got = await claimEx("17:22");
  check(
    "展示: 再試行の時刻を過ぎたら、補完を取る（attempts=2）",
    got.length === 1 &&
      got[0].race_id === "2026-09-22-12-05" &&
      got[0].offset_min === 10 &&
      got[0].attempts === 2,
    JSON.stringify(got),
  );
  // 窓の終わり（+10+26＝発走の36分後＝17:38）: 期限+許容幅を過ぎた補完は expired
  await q(
    `UPDATE scrape_slots SET status='pending', lease_until=NULL, next_attempt_at=NULL WHERE job='exhibition' AND race_id='2026-09-22-12-05' AND offset_min=10`,
  );
  got = await claimEx("17:39");
  check(
    "展示: 発走の37分後（17:39）は、期限+許容幅（+10+26）を過ぎた5Rの補完を取らず、expired にする（7Rの -33 は窓の中のため取る）",
    got.every((r) => r.race_id !== "2026-09-22-12-05") &&
      (await slotOf("2026-09-22-12-05", 10)).status === "expired",
    JSON.stringify(got),
  );
}

// ---------------------------------------------------------------------------
// 092: claim_scrape_slots_by_offset の差分テスト（既存の claim_scrape_slots と、同じ本体であることの確認）
// ---------------------------------------------------------------------------
{
  // ジョブ名だけ変えた3組（odds_a=既存関数、odds_b=新関数・上書きなし、odds_c=新関数・-60を30分に上書き）を、
  // 同じレース・同じ予定表で走らせ、odds_a と odds_b が常に同じ結果になる（p_grace_by_offset='{}'の等価性）ことと、
  // odds_c だけ -60 が延長され、他のoffsetはodds_aと同じになることを確認する
  await db.exec("DELETE FROM scrape_slots");
  await db.exec("DELETE FROM races");
  await db.exec(`
    INSERT INTO races (race_id, race_date, venue_code, race_number, start_time, cancellation_status) VALUES
     ('2026-09-22-09-01','2026-09-22',9,1,'10:00:00',NULL),
     ('2026-09-22-09-02','2026-09-22',9,2,'10:30:00',NULL),
     ('2026-09-22-09-03','2026-09-22',9,3,'11:00:00','confirmed'),
     ('2026-09-22-09-04','2026-09-22',9,4,'11:30:00',NULL);
  `);
  const defsFor = (job) =>
    JSON.stringify([
      { job, offset_min: -60, grace_min: 3 },
      { job, offset_min: -30, grace_min: 3 },
      { job, offset_min: -15, grace_min: 3 },
    ]);
  const t0 = "2026-09-22T09:00:00+09:00";
  for (const job of ["odds_a", "odds_b", "odds_c"]) {
    await q(
      `SELECT ensure_scrape_slots('2026-09-22'::date, $1::jsonb, false, $2::timestamptz)`,
      [defsFor(job), t0],
    );
  }
  const strip = (rows) =>
    rows
      .map(({ job: _job, created_at: _createdAt, ...rest }) => rest)
      .sort((a, b) =>
        `${a.race_id}|${a.offset_min}`.localeCompare(
          `${b.race_id}|${b.offset_min}`,
        ),
      );
  const claimOld = (job, t, worker, limit = 10, lease = 90, grace = 3) =>
    q(
      `SELECT * FROM claim_scrape_slots($1,$2,$3,$4,$5,'live',$6::timestamptz)`,
      [job, limit, lease, worker, grace, t],
    );
  const claimNew = (
    job,
    t,
    worker,
    limit = 10,
    lease = 90,
    grace = 3,
    byOffset = "{}",
  ) =>
    q(
      `SELECT * FROM claim_scrape_slots_by_offset($1,$2,$3,$4,$5,'live',$6::timestamptz,$7::jsonb)`,
      [job, limit, lease, worker, grace, t, byOffset],
    );
  // シナリオ: 期限前→期限ちょうど→リース内の別worker→リース切れの奪取→許容幅超過のexpired→確定中止の終端、を同じ順で流す
  const scenario = async (claimFn, job) => {
    const out = [];
    out.push(await claimFn(job, "08:59", "w1")); // 期限前: 何も取らない
    out.push(await claimFn(job, "09:00", "w1")); // R1 -60 を取る
    out.push(await claimFn(job, "09:00", "w2")); // リース中の別workerは取れない
    out.push(await claimFn(job, "09:02", "w2")); // リース切れ(90秒後)を奪取
    out.push(await claimFn(job, "09:34", "w3")); // R1 -60 は既に処理中/完了、R2 -60(09:33許容幅) は超過→expired
    out.push(await claimFn(job, "10:00", "w4")); // R2 -30 を取る。R3は確定中止で終端済み、R4 -60(10:33)はまだ先
    return out;
  };
  const at2 = (hhmm) => `2026-09-22T${hhmm}:00+09:00`;
  const claimOldAt = (job, hhmm, worker) => claimOld(job, at2(hhmm), worker);
  const claimNewAt = (job, hhmm, worker, byOffset) =>
    claimNew(job, at2(hhmm), worker, 10, 90, 3, byOffset);

  const seqA = await scenario(claimOldAt, "odds_a");
  const seqB = await scenario(
    (job, t, w) => claimNewAt(job, t, w, "{}"),
    "odds_b",
  );
  check(
    "差分テスト: p_grace_by_offset='{}' のとき、claim_scrape_slots_by_offset は claim_scrape_slots と、同じ予定表・同じ時刻で、同じ結果（claim対象・返す行の内容）を返す（期限切れ・許容幅内・リース・奪取の各シナリオ）",
    JSON.stringify(seqA.map(strip)) === JSON.stringify(seqB.map(strip)),
    JSON.stringify({ a: seqA.map(strip), b: seqB.map(strip) }),
  );
  const stateA = strip(
    await q(
      `SELECT job, race_id, offset_min, status, outcome, attempts FROM scrape_slots WHERE job='odds_a' ORDER BY race_id, offset_min`,
    ),
  );
  const stateB = strip(
    await q(
      `SELECT job, race_id, offset_min, status, outcome, attempts FROM scrape_slots WHERE job='odds_b' ORDER BY race_id, offset_min`,
    ),
  );
  check(
    "差分テスト: 同じシナリオの後、予定表（scrape_slots）の最終状態（status・outcome・attempts）も、旧関数と新関数（上書きなし）で一致する",
    JSON.stringify(stateA) === JSON.stringify(stateB),
    JSON.stringify({ a: stateA, b: stateB }),
  );

  // odds_c: -60 だけ許容幅を30分に上書き（{"-60":30}）。-60 は延長され、-30・-15 は odds_a と同じ挙動になる
  const seqC = await scenario(
    (job, t, w) => claimNewAt(job, t, w, '{"-60": 30}'),
    "odds_c",
  );
  // 09:34時点（stepインデックス4）: odds_a は R2 -60 を expired にするが、odds_c は許容幅30分（期限09:30+30=10:00）内でまだ有効
  const r2at934C = seqC[4].find(
    (r) => r.race_id === "2026-09-22-09-02" && r.offset_min === -60,
  );
  check(
    "-60の上書き（{-60:30}）: 09:34時点で、R2の-60（期限09:30）は、許容幅30分（10:00まで）の内のため、期限切れにならず claim される（旧関数・上書きなしなら expired）",
    r2at934C !== undefined && r2at934C.status === "running",
    JSON.stringify(seqC[4]),
  );
  const r2StatusA = (
    await q(
      `SELECT status FROM scrape_slots WHERE job='odds_a' AND race_id='2026-09-22-09-02' AND offset_min=-60`,
    )
  )[0].status;
  check(
    "-60の上書きの対照（odds_a・上書きなし）: 同じ09:34時点で、R2の-60は許容幅3分を超えて expired になっている",
    r2StatusA === "expired",
    r2StatusA,
  );
  // -30・-15（上書きの対象外）は、odds_a と odds_c で同じ結果になる（他の窓を変えない）
  const otherA = strip(
    await q(
      `SELECT job, race_id, offset_min, status, outcome, attempts FROM scrape_slots WHERE job='odds_a' AND offset_min <> -60 ORDER BY race_id, offset_min`,
    ),
  );
  const otherC = strip(
    await q(
      `SELECT job, race_id, offset_min, status, outcome, attempts FROM scrape_slots WHERE job='odds_c' AND offset_min <> -60 ORDER BY race_id, offset_min`,
    ),
  );
  check(
    "-60の上書き: 他の窓（-30・-15）は、odds_a（旧関数）と odds_c（上書きあり）で同じ結果になる（延長は-60だけ）",
    JSON.stringify(otherA) === JSON.stringify(otherC),
    JSON.stringify({ a: otherA, c: otherC }),
  );

  // 延長後の許容幅（10:00）を過ぎ、かつリースも切れれば、odds_c の R2 -60 も expired になる（無限に延長しない。
  // 10:00の呼び出し自体は、期限+許容幅ちょうどのため再claimしてリースを更新するので、そのリースが切れる10:02で確認する）
  await claimNewAt("odds_c", "10:02", "w5", '{"-60": 30}');
  const r2FinalC = (
    await q(
      `SELECT status FROM scrape_slots WHERE job='odds_c' AND race_id='2026-09-22-09-02' AND offset_min=-60`,
    )
  )[0];
  check(
    "-60の上書き: 延長後の許容幅（10:00）を過ぎれば、リース切れの running は expired になる（無限に延長しない）",
    r2FinalC.status === "expired",
    JSON.stringify(r2FinalC),
  );

  // 権限: claim_scrape_slots_by_offset は service_role のみ実行できる（claim_scrape_slots と同じ）
  const priv = (
    await q(
      `SELECT has_function_privilege('anon','claim_scrape_slots_by_offset(text,integer,integer,text,integer,text,timestamptz,jsonb)','EXECUTE') AS anon_exec,
            has_function_privilege('authenticated','claim_scrape_slots_by_offset(text,integer,integer,text,integer,text,timestamptz,jsonb)','EXECUTE') AS auth_exec,
            has_function_privilege('service_role','claim_scrape_slots_by_offset(text,integer,integer,text,integer,text,timestamptz,jsonb)','EXECUTE') AS service_exec`,
    )
  )[0];
  check(
    "権限: claim_scrape_slots_by_offset は、anon・authenticated は実行できず、service_role だけ実行できる（既存の claim_scrape_slots と同じ）",
    priv.anon_exec === false &&
      priv.auth_exec === false &&
      priv.service_exec === true,
    JSON.stringify(priv),
  );

  // 不正な p_grace_by_offset は例外にする
  let badErr = null;
  try {
    await claimNewAt("odds_c", "09:00", "w9", '{"abc": 3}');
  } catch (e) {
    badErr = e;
  }
  check(
    "不正な p_grace_by_offset（キーが整数でない）は例外にする",
    badErr !== null && /p_grace_by_offset/.test(badErr.message),
    badErr ? badErr.message : "例外にならなかった",
  );
}

// 部分一意索引では PostgREST の upsert（ON CONFLICT (cols)、WHERE句なし）が推論できないことの確認
// （075が race_odds の一意索引を部分索引にしない理由）
await db.exec(`
CREATE TABLE t_partial (race_id text, captured_at timestamptz, window_min smallint, source text default 'gha', primary key (race_id, captured_at));
CREATE UNIQUE INDEX uq_partial ON t_partial (race_id, window_min) WHERE source = 'vercel' AND window_min IS NOT NULL;
INSERT INTO t_partial (race_id, captured_at, window_min, source) VALUES ('a', now(), -60, 'vercel');
`);
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
