/**
 * verify-scrape-jobs.js の後半の場面（8/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { isClaimByOffsetMissingError } from "../../lib/scrapeJobs/schemaErrors.js";
import { createSupabaseStore } from "../../lib/scrapeJobs/store.js";

let check, same, show;

/** 元の verify の1つの塊 { } を割った 1/6 */
async function scene1() {
  const log = [];
  const makeBuilder = (table, result) => {
    const b = {
      _table: table,
      _ops: [],
    };
    for (const m of ["select", "update", "upsert", "eq", "or", "match"]) {
      b[m] = (...args) => {
        b._ops.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => {
      b._ops.push(["maybeSingle"]);
      log.push(b);
      return Promise.resolve(result(b));
    };
    b.then = (resolve, reject) => {
      log.push(b);
      return Promise.resolve(result(b)).then(resolve, reject);
    };
    return b;
  };
  const nextResult = { fn: () => ({ data: [{ race_id: "x" }], error: null }) };
  const rpcLog = [];
  const client = {
    from: (table) => makeBuilder(table, (b) => nextResult.fn(b)),
    rpc: (name, args) => {
      rpcLog.push([name, args]);
      return Promise.resolve(nextResult.fn());
    },
  };
  const store = createSupabaseStore(client);
  const now = new Date("2026-09-19T00:00:00.000Z");
  const opsOf = (b) => b._ops.map((o) => o.join(":")).join(" | ");
  // 完了: claimed_by と status=running の条件付き更新
  log.length = 0;
  const applied = await store.completeSlot(
    { job: "odds", race_id: "2026-09-19-01-01", offset_min: -60 },
    { worker: "w1", now, outcome: "ok", rowsWritten: 1, resultDigest: "d" },
  );
  const u = log[0];
  check(
    "completeSlot: scrape_slots の (job,race_id,offset_min) を、claimed_by=自分 かつ status=running のときだけ done に更新",
    applied === true &&
      u._table === "scrape_slots" &&
      u._ops.some(
        (o) => o[0] === "eq" && o[1] === "claimed_by" && o[2] === "w1",
      ) &&
      u._ops.some(
        (o) => o[0] === "eq" && o[1] === "status" && o[2] === "running",
      ) &&
      u._ops.some(
        (o) =>
          o[0] === "match" &&
          o[1].race_id === "2026-09-19-01-01" &&
          o[1].offset_min === -60 &&
          o[1].job === "odds",
      ) &&
      u._ops[0][1].status === "done" &&
      u._ops[0][1].done_at === now.toISOString() &&
      u._ops[0][1].last_error === null,
    opsOf(u),
  );
  nextResult.fn = () => ({ data: [], error: null });
  check(
    "リースを奪われていて0行更新なら false（呼び出し側が警告して、二重完了にしない）",
    (await store.completeSlot(
      { job: "odds", race_id: "r", offset_min: 0 },
      { worker: "old", now, outcome: "ok" },
    )) === false,
  );
  nextResult.fn = () => ({ data: [{ race_id: "x" }], error: null });
  return { log, nextResult, rpcLog, store, now };
}

/** 元の verify の1つの塊 { } を割った 2/6 */
async function scene2({ log, nextResult, rpcLog, store, now }) {
  // 再試行: pending に戻し next_attempt_at を設定、リースを外す
  log.length = 0;
  await store.retrySlot(
    { job: "odds", race_id: "r", offset_min: -30 },
    {
      worker: "w1",
      now,
      outcome: "no_values",
      error: "x".repeat(900),
      retryAt: new Date(now.getTime() + 60_000),
    },
  );
  const rt = log[0]._ops[0][1];
  check(
    "retrySlot: pending・next_attempt_at・lease解除・last_errorは500字に切る",
    rt.status === "pending" &&
      rt.next_attempt_at === new Date(now.getTime() + 60_000).toISOString() &&
      rt.lease_until === null &&
      rt.outcome === "no_values" &&
      rt.last_error.length === 500,
  );
  // 着手せずに返す: 試行回数を戻し、last_error は上書きしない
  log.length = 0;
  await store.retrySlot(
    { job: "odds", race_id: "r", offset_min: -30, attempts: 2 },
    { worker: "w1", now, retryAt: now, releaseAttempt: true },
  );
  const rel = log[0]._ops[0][1];
  check(
    "retrySlot(releaseAttempt): attempts を1戻し、last_error を上書きしない",
    rel.attempts === 1 && !("last_error" in rel) && rel.status === "pending",
    show(rel),
  );
  // tick: 5分以上古い場合のみ更新
  log.length = 0;
  await store.touchTick("odds", now);
  const tick = log[0];
  const orFilter = tick._ops.find((o) => o[0] === "or")?.[1] ?? "";
  check(
    "touchTick: last_tick_at が NULL か5分より古いときだけ更新する条件付き",
    orFilter ===
      `last_tick_at.is.null,last_tick_at.lt.${new Date(now.getTime() - 300_000).toISOString()}`,
    orFilter,
  );
  // ジョブ単位のリース
  log.length = 0;
  nextResult.fn = () => ({ data: [{ job: "point_rank" }], error: null });
  check(
    "acquireLease: 1行更新できれば取得",
    (await store.acquireLease("point_rank", "w1", 600, now)) === true,
  );
  const lease = log[0];
  check(
    "acquireLease: lease_until が NULL か過去のときだけ更新する条件付き",
    lease._ops.some(
      (o) =>
        o[0] === "or" &&
        o[1] === `lease_until.is.null,lease_until.lt.${now.toISOString()}`,
    ),
  );
  nextResult.fn = () => ({ data: [], error: null });
  check(
    "acquireLease: 0行なら他の実行が持っている",
    (await store.acquireLease("point_rank", "w2", 600, now)) === false,
  );
  return { nextResult, rpcLog, store };
}

/** 元の verify の1つの塊 { } を割った 3/6 */
async function scene3({ nextResult, rpcLog, store }) {
  // RPC
  rpcLog.length = 0;
  nextResult.fn = () => ({
    data: [{ race_id: "a", job: "odds", offset_min: -60 }],
    error: null,
  });
  const claimed = await store.claimSlots({
    job: "odds",
    worker: "w1",
    mode: "shadow",
  });
  const [rpcName, rpcArgs] = rpcLog[0];
  check(
    "claimSlots（上書きのあるジョブ odds）: レジストリの値（limit・リース・許容幅）と run_mode、offset ごとの許容幅の上書き {-60:30} で claim_scrape_slots_by_offset を呼ぶ",
    rpcName === "claim_scrape_slots_by_offset" &&
      rpcArgs.p_limit === SCRAPE_JOBS.odds.claimLimit &&
      rpcArgs.p_lease_sec === SCRAPE_JOBS.odds.leaseSec &&
      rpcArgs.p_grace_min === SCRAPE_JOBS.odds.graceMin &&
      same(rpcArgs.p_grace_by_offset, { "-60": 30 }) &&
      rpcArgs.p_run_mode === "shadow" &&
      rpcArgs.p_worker === "w1" &&
      !("p_now" in rpcArgs) &&
      claimed.length === 1 &&
      store.takeClaimFallback() === null,
    show(rpcArgs),
  );
  // 上書きのないジョブは、既存の claim_scrape_slots（p_grace_by_offset なし）を呼ぶ
  rpcLog.length = 0;
  await store.claimSlots({ job: "result", worker: "w1", mode: "live" });
  check(
    "claimSlots（上書きのないジョブ result）: 既存の claim_scrape_slots を、従来の引数（p_grace_by_offset なし）で呼ぶ",
    rpcLog.length === 1 &&
      rpcLog[0][0] === "claim_scrape_slots" &&
      !("p_grace_by_offset" in rpcLog[0][1]) &&
      rpcLog[0][1].p_grace_min === SCRAPE_JOBS.result.graceMin,
    show(rpcLog),
  );
  // 新関数が無い（092が未適用）: 既存の関数へフォールバックし、理由を残す（1回読むと消える）
  rpcLog.length = 0;
  nextResult.fn = () =>
    rpcLog.length === 1
      ? {
          data: null,
          error: {
            code: "PGRST202",
            message:
              "Could not find the function public.claim_scrape_slots_by_offset(p_grace_by_offset, p_grace_min) in the schema cache",
          },
        }
      : {
          data: [{ race_id: "fb", job: "odds", offset_min: -30 }],
          error: null,
        };
  const fb = await store.claimSlots({
    job: "odds",
    worker: "w1",
    mode: "live",
  });
  const fbInfo = store.takeClaimFallback();
  return { nextResult, rpcLog, store, fb, fbInfo };
}

/** 元の verify の1つの塊 { } を割った 4/6 */
function scene4({ nextResult, rpcLog, store, fb, fbInfo }) {
  check(
    "claimSlots: 新関数が無い（PGRST202・その関数名）ときだけ、既存の claim_scrape_slots へフォールバックし、理由（092が未適用・延長が効かない）を残す。理由は1回読むと消える",
    rpcLog.length === 2 &&
      rpcLog[0][0] === "claim_scrape_slots_by_offset" &&
      rpcLog[1][0] === "claim_scrape_slots" &&
      !("p_grace_by_offset" in rpcLog[1][1]) &&
      fb.length === 1 &&
      /092/.test(fbInfo?.reason ?? "") &&
      /効いていません/.test(fbInfo?.reason ?? "") &&
      store.takeClaimFallback() === null,
    show([rpcLog.map((c) => c[0]), fbInfo]),
  );
  return { nextResult, rpcLog, store };
}

/** 元の verify の1つの塊 { } を割った 5/6 */
async function scene5({ nextResult, rpcLog, store }) {
  // それ以外のエラーは、フォールバックしない（DB障害・別の関数の不在・引数エラーを握りつぶさない）
  for (const [label, error] of [
    [
      "DB障害",
      {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    ],
    [
      "別の関数の不在（PGRST202・別の名前）",
      {
        code: "PGRST202",
        message:
          "Could not find the function public.other_fn() in the schema cache",
      },
    ],
    [
      "引数エラー（P0001）",
      {
        code: "P0001",
        message: "claim_scrape_slots_by_offset: 引数が不正です",
      },
    ],
  ]) {
    rpcLog.length = 0;
    nextResult.fn = () => ({ data: null, error });
    let threw = "";
    try {
      await store.claimSlots({ job: "odds", worker: "w1", mode: "live" });
    } catch (e) {
      threw = e.message;
    }
    check(
      `claimSlots: ${label}はフォールバックせず、意味のあるメッセージで例外にする（既存の関数を呼ばない）`,
      rpcLog.length === 1 &&
        /スロットの取得\(claim_scrape_slots_by_offset, odds\)に失敗しました/.test(
          threw,
        ) &&
        store.takeClaimFallback() === null,
      show([rpcLog.map((c) => c[0]), threw]),
    );
  }
  check(
    "isClaimByOffsetMissingError: PGRST202・42883 でその関数名を含むものだけ（部分一致・別の名前・null は false）",
    isClaimByOffsetMissingError({
      code: "42883",
      message: "function claim_scrape_slots_by_offset(text) does not exist",
    }) &&
      !isClaimByOffsetMissingError({
        code: "PGRST202",
        message: "Could not find the function public.claim_scrape_slots(p_job)",
      }) &&
      !isClaimByOffsetMissingError({
        code: "PGRST202",
        message: "public.claim_scrape_slots_by_offset_v2",
      }) &&
      !isClaimByOffsetMissingError(null),
  );
  nextResult.fn = () => ({
    data: [{ race_id: "x", job: "odds", offset_min: -60 }],
    error: null,
  });
  rpcLog.length = 0;
  nextResult.fn = () => ({ data: 12, error: null });
  const created = await store.ensureSlots({
    date: "2026-09-19",
    jobs: ["odds"],
  });
  check(
    "ensureSlots: ensure_scrape_slots に、ジョブ×窓の定義を渡し、期限を過ぎたスロットは作らない",
    created === 12 &&
      rpcLog[0][0] === "ensure_scrape_slots" &&
      rpcLog[0][1].p_skip_lapsed === true &&
      rpcLog[0][1].p_defs.length === 6,
    show(rpcLog[0]),
  );
  return { nextResult, store };
}

/** 元の verify の1つの塊 { } を割った 6/6 */
async function scene6({ nextResult, store }) {
  // スキーマ未適用は readState だけが available=false にする。それ以外のエラーは投げる
  nextResult.fn = () => ({
    data: null,
    error: {
      code: "PGRST205",
      message:
        "Could not find the table 'public.scrape_job_state' in the schema cache",
    },
  });
  check(
    "readState: テーブルが無ければ available=false",
    (await store.readState("odds")).available === false,
  );
  nextResult.fn = () => ({
    data: null,
    error: { code: "57014", message: "statement timeout" },
  });
  let threw;
  try {
    await store.readState("odds");
  } catch (e) {
    threw = e;
  }
  check(
    "readState: その他のDBエラーは意味のあるメッセージ付きで投げる",
    threw &&
      /ジョブ状態\(odds\)の読み取りに失敗しました: statement timeout/.test(
        threw.message,
      ),
  );
  nextResult.fn = () => ({
    data: null,
    error: {
      code: "42501",
      message: "permission denied for function claim_scrape_slots",
    },
  });
  let threw2;
  try {
    await store.claimSlots({ job: "odds", worker: "w", mode: "live" });
  } catch (e) {
    threw2 = e;
  }
  check(
    "claim のエラー（権限等）は握りつぶさず投げる",
    threw2 && /claim_scrape_slots/.test(threw2.message),
  );
}

async function scene7() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    const s4 = scene4(s3);
    const s5 = await scene5(s4);
    await scene6(s5);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・show） */
export async function runScrapeJobsScenes8(env) {
  ({ check, same, show } = env);
  await scene7();
}
