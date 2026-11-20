/**
 * verify-scrape-slots-sql.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-slots-sql.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let db, check, q;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const { slotDefsFor, SCRAPE_JOBS } =
    await import("../../lib/scrapeJobs/registry.js");
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
    "展示: ensure は、3レース×3本（体重だけの -60、-33、補完の 10）＝9スロットを作る",
    made === 9,
    `n=${made}`,
  );
  // 体重だけの窓（-60。BOA-500）: 5R（17:02発走）の -60 の窓は 16:02〜16:28。-33 の窓（16:29〜）と重ならない
  let got = await claimEx("16:03");
  check(
    "展示: 発走の59分前（16:03）に、5R の体重だけの窓（-60）を取る。-33 はまだ取らない。確定中止の6Rは取らない",
    got.length === 1 &&
      got[0].race_id === "2026-09-22-12-05" &&
      got[0].offset_min === -60 &&
      got[0].attempts === 1,
    JSON.stringify(got),
  );
  // 体重が未公開のまま窓の終わりまで再試行した状態（pending）で、-33 の窓が始まる
  await q(
    `UPDATE scrape_slots SET status='pending', lease_until=NULL, next_attempt_at=NULL WHERE job='exhibition' AND race_id='2026-09-22-12-05' AND offset_min=-60`,
  );
  got = await claimEx("16:29");
  check(
    "展示: 発走の33分前（16:29）は、5R の -33 を取り、-60（期限+許容幅26分＝16:28 を過ぎた）は取らずに expired にする（1レースで2つの窓が同時に動かない）",
    got.length === 1 &&
      got[0].race_id === "2026-09-22-12-05" &&
      got[0].offset_min === -33 &&
      (await slotOf("2026-09-22-12-05", -60)).status === "expired",
    JSON.stringify(got),
  );
  // 以降の補完（+10）の検証のため、5R の -33 を未処理に戻す
  await q(
    `UPDATE scrape_slots SET status='pending', lease_until=NULL, next_attempt_at=NULL, attempts=0 WHERE job='exhibition' AND race_id='2026-09-22-12-05' AND offset_min=-33`,
  );
  got = await claimEx("17:11");
  return { claimEx, slotOf, got };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ claimEx, slotOf, got }) {
  check(
    "展示: 発走の9分後（17:11）は、5R の -33（許容幅の26分を超え expired）も、補完（+10）も取らない。確定中止の6Rは cancelled_race で終端し、取らない。7R（18:00発走）の体重だけの窓（-60。17:00〜17:26）は取る",
    got.length === 1 &&
      got[0].race_id === "2026-09-22-12-07" &&
      got[0].offset_min === -60 &&
      (await slotOf("2026-09-22-12-05", -33)).status === "expired" &&
      (await slotOf("2026-09-22-12-06", -33)).outcome === "cancelled_race" &&
      (await slotOf("2026-09-22-12-06", 10)).outcome === "cancelled_race" &&
      (await slotOf("2026-09-22-12-06", -60)).outcome === "cancelled_race",
    JSON.stringify(got),
  );
  // 7R の体重だけの窓は、体重を取れて完了したとする（以降の補完の検証に混ざらないように）
  await q(
    `UPDATE scrape_slots SET status='done', lease_until=NULL WHERE job='exhibition' AND race_id='2026-09-22-12-07' AND offset_min=-60`,
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

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene3() {
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
  return { strip, scenario, claimNewAt, seqA, seqB };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene4({ strip, scenario, claimNewAt, seqA, seqB }) {
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
  return { claimNewAt, r2FinalC };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene5({ claimNewAt, r2FinalC }) {
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

async function scene6() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  {
    const s1 = await scene3();
    const s2 = await scene4(s1);
    await scene5(s2);
  }
  // 部分一意索引では PostgREST の upsert（ON CONFLICT (cols)、WHERE句なし）が推論できないことの確認
  // （075が race_odds の一意索引を部分索引にしない理由）
  await db.exec(`
  CREATE TABLE t_partial (race_id text, captured_at timestamptz, window_min smallint, source text default 'gha', primary key (race_id, captured_at));
  CREATE UNIQUE INDEX uq_partial ON t_partial (race_id, window_min) WHERE source = 'vercel' AND window_min IS NOT NULL;
  INSERT INTO t_partial (race_id, captured_at, window_min, source) VALUES ('a', now(), -60, 'vercel');
  `);
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・check・q） */
export async function runScrapeSlotsSqlScenes15(env) {
  ({ db, check, q } = env);
  await scene6();
}
