/**
 * verify-scrape-slots-sql.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-slots-sql.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let db, check, q, defs, at, lease;
let upd, o, s;

function scene1() {
  check("リースは now+90秒", lease === new Date(at("09:00")).getTime() + 90000);
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export function runScrapeSlotsSqlScenes1(env) {
  ({ db, check, q, defs, at, lease } = env);
  scene1();
}

async function scene2() {
  // 完了の条件付き更新（アプリ側）: 旧worker w1 は奪われているので0行
  upd = await q(
    `UPDATE scrape_slots SET status='done', done_at=$1::timestamptz WHERE job='odds' AND race_id='2026-09-19-01-01' AND offset_min=-60 AND claimed_by='w1' AND status='running' RETURNING race_id`,
    [at("09:02")],
  );
  check("奪取された旧workerの完了更新は0行", upd.length === 0);
  upd = await q(
    `UPDATE scrape_slots SET status='done', done_at=$1::timestamptz, outcome='ok' WHERE job='odds' AND race_id='2026-09-19-01-01' AND offset_min=-60 AND claimed_by='w2' AND status='running' RETURNING race_id`,
    [at("09:02")],
  );
  check("現在のリース保持者の完了更新は1行", upd.length === 1);
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes2(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene2();
}

async function scene3() {
  await q(
    `UPDATE scrape_slots SET status='pending', next_attempt_at=$1::timestamptz, lease_until=NULL, last_error='x' WHERE job='odds' AND race_id='2026-09-19-01-02' AND offset_min=-30 AND claimed_by='w1' AND status='running'`,
    [at("10:01")],
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes3(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene3();
}

async function scene4() {
  // limit と順序
  await db.exec("DELETE FROM scrape_slots");
  await q(
    `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz)`,
    [
      JSON.stringify([{ job: "result", offset_min: 5, grace_min: 999 }]),
      at("09:00"),
    ],
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes4(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene4();
}

async function scene5() {
  // 日付をまたぐ: JST 翌日 00:20 の claim でも前日の R3(22:45+5, grace 85 → 00:15)は expired、R3が未完了なら expired 化される
  await db.exec(
    "UPDATE scrape_slots SET status='pending', lease_until=NULL, claimed_by=NULL WHERE race_id='2026-09-19-01-03'",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes5(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene5();
}

async function scene6() {
  // 2日以上前の未完了は claim では触らない（cleanup の担当）
  await db.exec(
    "UPDATE scrape_slots SET status='pending', lease_until=NULL, claimed_by=NULL WHERE race_id='2026-09-19-01-03'",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes6(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene6();
}

async function scene7() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes7(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene7();
}

async function scene8() {
  // 02-02(10:30, 期限09:30・pending)を10:00に繰り上げ → 期限09:00に取れる（期限が前倒しされる。未来の期限は過去に）
  await db.exec(
    "UPDATE scrape_slots SET status='pending', claimed_by=NULL, lease_until=NULL WHERE race_id='2026-09-19-02-02'",
  );
  await db.exec(
    "UPDATE races SET start_time='09:30:00' WHERE race_id='2026-09-19-02-02'",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes8(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene8();
}

async function scene9() {
  // 既に done のスロットは、発走時刻が変わっても再オープンされない
  await db.exec(
    "UPDATE scrape_slots SET status='done', done_at=now() WHERE race_id='2026-09-19-02-03'",
  );
  await db.exec(
    "UPDATE races SET start_time='13:00:00' WHERE race_id='2026-09-19-02-03'",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes9(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene9();
}

async function scene10() {
  // 許容幅も新しい期限に追従する: 繰り下げた 02-01(期限10:00)は 10:03 まで有効
  await db.exec(
    "UPDATE scrape_slots SET status='pending', claimed_by=NULL, lease_until=NULL, attempts=0 WHERE race_id='2026-09-19-02-01'",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes10(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene10();
}

async function scene11() {
  await db.exec(
    "UPDATE scrape_slots SET status='pending', claimed_by=NULL, lease_until=NULL WHERE race_id='2026-09-19-02-01'",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes11(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene11();
}

async function scene12() {
  // 以降の検証のため、追加したレースを削除する（scrape_slots は ON DELETE CASCADE で消える）
  await db.exec("DELETE FROM races WHERE race_id LIKE '2026-09-19-02-%'");
  // shadow の run_mode
  await db.exec("DELETE FROM scrape_slots");
  await q(
    `SELECT ensure_scrape_slots('2026-09-19'::date, $1::jsonb, false, $2::timestamptz)`,
    [defs, at("09:00")],
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes12(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene12();
}

async function scene13() {
  // race_odds の一意索引: window_min NULL は重複可、同じ (race_id, window_min) は不可
  await db.exec(
    "INSERT INTO race_odds (race_id, captured_at) VALUES ('2026-09-19-01-01','2026-09-19 00:00+00'), ('2026-09-19-01-01','2026-09-19 00:01+00')",
  );
  check("window_min NULL の既存形式の行は重複可", true);
  await db.exec(
    "INSERT INTO race_odds (race_id, captured_at, window_min, source) VALUES ('2026-09-19-01-01','2026-09-19 00:05+00',-60,'vercel')",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes13(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene13();
}

async function scene14() {
  await db.exec(
    "INSERT INTO race_odds (race_id, captured_at, window_min, source) VALUES ('2026-09-19-01-01','2026-09-19 00:07+00',-60,'vercel') ON CONFLICT (race_id, window_min) DO UPDATE SET captured_at = EXCLUDED.captured_at",
  );
  o = await q("SELECT count(*) c FROM race_odds WHERE window_min = -60");
  check(
    "ON CONFLICT (race_id, window_min) の upsert（PostgREST同形）が同じ行を更新する",
    Number(o[0].c) === 1,
  );
  s = await q(
    "SELECT source, count(*) c FROM race_odds GROUP BY 1 ORDER BY 1",
  );
  check(
    "既存行の source は gha",
    s.find((r) => r.source === "gha")?.c == 2,
    JSON.stringify(s),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q・defs・at・lease） */
export async function runScrapeSlotsSqlScenes14(env) {
  ({ db, check, q, defs, at, lease } = env);
  await scene14();
}
