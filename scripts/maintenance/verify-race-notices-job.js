/**
 * verify-race-notices-job.js - レース特記事項（A5）の共通ラッパ対応（BOA-353 T4b-11-1・T4b-11-2）の検証。
 * DBにも取得先にも接続しない（偽クライアント・メモリのストア・fetchの差し替え）。
 *
 *   (a) モード: off・行なしは何もしない（取得もDB書き込みもしない）。shadow は取得・解析のみで、DBへ書かない。
 *       live で書く。二重の起動（cron-job.org と Vercel Cron）は、ジョブ単位のリースで、片方が何もしない
 *   (b) DB障害を200にしない（G13）: races の取得失敗・集計行の書き込み失敗・通知の書き込み失敗は、
 *       HTTP 500（ジョブの失敗）。「開催会場なし」の成功に化けさせない
 *   (c) 全会場の取得失敗は失敗（500）。一部の会場の失敗は成功で、集計行に理由が残る。ブレーカーで
 *       取得しなかった会場は、集計行を作らない（構造変化の判定材料にしない）
 *   (d) race_notices_health は、変更のある行だけ書く（D9）。同じ内容の2回目は書き込み0件
 *   (e) 通知の書き込みは、重複を無視する upsert。二重の起動でも、同じ通知は増えない
 *   (f) 会場の並列度は上限つき。ソフトデッドラインを過ぎたら、以降の会場は取得しない
 *   (g) 従来の呼び出し（run(schedule, date)。CLI）は、オプション無しで、逐次・失敗はログのみ（挙動を変えない）
 *   (i) 夜1回: 対象日は ctx.targetDate。取得失敗・未着手の会場があれば処理済みにしない（補足の起動が取り直す）
 *   (h) 配線: api/cron/race-notices.js の maxDuration とレジストリの一致、vercel.json の cron（夜1回 JST 22:30
 *       と補足 23:00・23:30。2026-10-03 に10分ごとから変更）、cron-job.org の既存の起動と二重にならない（リース・冪等）
 *
 * 実行: node scripts/maintenance/verify-race-notices-job.js
 */
import fs from "node:fs";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { cronWiring } from "./verifyData/cronWiring.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";

import { runRaceNoticesJob } from "../lib/raceNoticesJob.js";

import { runRaceNoticesJobScenes1 } from "./verifyData/race-notices-job-scenes-1.js";
import { runRaceNoticesJobScenes2, runRaceNoticesJobScenes3 } from "./verifyData/race-notices-job-scenes-2.js";

// 検証の対象コードが出すログ（失敗のシミュレーションで出るエラーログを含む）は捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    out.log(`✅ ${label}`);
  } else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

const FIXTURES = new URL("../lib/__fixtures__/raceNotices/", import.meta.url);
const NO_NOTICES = fs.readFileSync(
  new URL("no-notices.html", FIXTURES),
  "utf8",
);
const WITH_NOTICES = fs.readFileSync(
  new URL("with-notices.html", FIXTURES),
  "utf8",
);

// ---------------------------------------------------------------------------
// 偽クライアント（PostgREST の最小限。fetchAll の range・upsert の ignoreDuplicates と select を再現する）
// ---------------------------------------------------------------------------
function createFakeClient({ tables = {}, fail = {} } = {}) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
  );
  const calls = [];
  const matches = (row, filters) =>
    filters.every(([kind, column, value]) => {
      if (kind === "eq") return row[column] === value;
      if (kind === "in") return value.includes(row[column]);
      if (kind === "like")
        return String(row[column]).startsWith(value.replace(/%$/, ""));
      if (kind === "not-null") return row[column] != null;
      return true;
    });
  const execute = (q) => {
    calls.push({ table: q.table, op: q.op, rows: q.payload, opts: q.opts });
    const failure = fail[`${q.table}:${q.op}`];
    if (failure) return { data: null, error: { message: failure } };
    const rows = (state[q.table] ??= []);
    if (q.op === "select") {
      let found = rows.filter((r) => matches(r, q.filters));
      if (q.range) found = found.slice(q.range[0], q.range[1] + 1);
      return { data: found.map((r) => ({ ...r })), error: null };
    }
    // upsert
    const keys = (q.opts?.onConflict ?? "").split(",").filter(Boolean);
    const touched = [];
    for (const row of q.payload) {
      const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) {
        if (!q.opts?.ignoreDuplicates) {
          Object.assign(existing, row);
          touched.push(existing);
        }
      } else {
        const created = { id: rows.length + 1, ...row };
        rows.push(created);
        touched.push(created);
      }
    }
    return {
      data: q.returning ? touched.map((r) => ({ id: r.id })) : null,
      error: null,
    };
  };
  const from = (table) => {
    const q = { table, op: "select", filters: [], payload: null, opts: null };
    const b = {
      select: () => {
        if (q.op !== "select") q.returning = true;
        return b;
      },
      upsert: (rows, opts) => (
        (q.op = "upsert"),
        (q.payload = rows),
        (q.opts = opts),
        b
      ),
      eq: (c, v) => (q.filters.push(["eq", c, v]), b),
      in: (c, v) => (q.filters.push(["in", c, v]), b),
      like: (c, v) => (q.filters.push(["like", c, v]), b),
      not: (c, op) => (op === "is" && q.filters.push(["not-null", c]), b),
      range: (a, z) => ((q.range = [a, z]), b),
      order: () => b,
      then: (resolve, reject) =>
        Promise.resolve(execute(q)).then(resolve, reject),
    };
    return b;
  };
  return { from, state, calls };
}

const raceRows = (date, venues) =>
  venues.map((v) => ({
    race_id: `${date}-${String(v).padStart(2, "0")}-01`,
    start_time: "10:30:00",
  }));

const FIXED_NOW = new Date("2026-09-20T14:00:00Z"); // 2026-09-20 23:00 JST（日次の指定 22:30 より後。補足の起動の時刻）
const ok = (html) => new Response(html, { status: 200 });

/** politeFetch の差し替え: 会場ごとの応答を返し、同時実行数の最大値を記録する */
function stubFetch(byVenue = {}, fallback = () => ok(NO_NOTICES)) {
  const stats = { calls: [], inFlight: 0, maxInFlight: 0 };
  const fn = async (url) => {
    const jcd = Number(new URL(url).searchParams.get("jcd"));
    stats.calls.push(jcd);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    stats.inFlight--;
    const handler = byVenue[jcd] ?? fallback;
    const result = handler(jcd);
    if (result instanceof Error) throw result;
    return result;
  };
  fn.stats = stats;
  return fn;
}

const runJob = ({ store, client, politeFetch, now = FIXED_NOW, ...rest }) =>
  runScrapeJob({
    job: "race_notices",
    store,
    run: runRaceNoticesJob,
    now: () => now,
    worker: "w-test",
    modeGated: true,
    client,
    politeFetch,
    ...rest,
  });

const liveStore = (extra = {}) =>
  createMemoryStore({
    rows: { race_notices: { job: "race_notices", mode: "live" } },
    ...extra,
  });

const writes = (client, table) =>
  client.calls.filter((c) => c.table === table && c.op === "upsert");

// ---------------------------------------------------------------------------
// (a) モード・二重起動
// ---------------------------------------------------------------------------
{
  const date = "2026-09-20";
  const client = createFakeClient({
    tables: { races: raceRows(date, [1, 2, 3]), racer_profiles: [] },
  });

  // off
  const offStore = createMemoryStore({
    rows: { race_notices: { job: "race_notices", mode: "off" } },
  });
  const offFetch = stubFetch();
  const off = await runJob({ store: offStore, client, politeFetch: offFetch });
  check(
    "off: 何もしない（200・skipped。取得もDBの読み書きもしない）",
    off.status === 200 &&
      off.body.skipped === "mode_off" &&
      offFetch.stats.calls.length === 0 &&
      client.calls.length === 0,
    show({
      status: off.status,
      body: off.body,
      fetches: offFetch.stats.calls.length,
      dbCalls: client.calls.length,
    }),
  );

  // 行なし
  const noRowStore = createMemoryStore();
  const noRow = await runJob({
    store: noRowStore,
    client,
    politeFetch: offFetch,
  });
  check(
    "ジョブ状態の行が無い: off として何もしない（行を作るだけ）",
    noRow.body.skipped === "mode_off" &&
      offFetch.stats.calls.length === 0 &&
      client.calls.length === 0 &&
      noRowStore.state.get("race_notices")?.mode === "off",
  );

  // shadow: 取得・解析のみ
  const shadowClient = createFakeClient({
    tables: { races: raceRows("2017-12-24", [12]), racer_profiles: [] },
  });
  const shadowStore = createMemoryStore({
    rows: { race_notices: { job: "race_notices", mode: "shadow" } },
  });
  const shadowFetch = stubFetch({}, () => ok(WITH_NOTICES));
  const shadow = await runJob({
    store: shadowStore,
    client: shadowClient,
    politeFetch: shadowFetch,
    now: new Date("2017-12-24T14:00:00Z"), // 23:00 JST（指定 22:30 より後）
  });
  const report = shadowStore.state.get("race_notices").last_report;
  check(
    "shadow: 取得・解析はする（9件の通知を解析）が、race_special_notes・race_notices_health へ書かない。解析結果のダイジェストを記録する",
    shadow.status === 200 &&
      shadowFetch.stats.calls.length === 1 &&
      report?.notesParsed === 9 &&
      report?.notesInserted === 0 &&
      report?.healthWritten === 0 &&
      typeof report?.digest === "string" &&
      !shadowClient.calls.some((c) => c.op === "upsert"),
    show({ status: shadow.status, report }),
  );

  check(
    "解析できない行が無いときは、監視への通知（last_report.alerts）を出さない（BOA-373）",
    report?.rowsUnparsed === 0 && report?.alerts === undefined,
    show(report),
  );

  // BOA-373: 通知の表に行があるのに解析できない（想定外の書式）。「通知なし」と区別し、監視へ通知する
  const brokenStore = createMemoryStore({
    rows: { race_notices: { job: "race_notices", mode: "shadow" } },
  });
  const brokenHtml = WITH_NOTICES.replace(">12/19</th>", ">十二月十九日</th>");
  const broken = await runJob({
    store: brokenStore,
    client: createFakeClient({
      tables: { races: raceRows("2017-12-24", [12]), racer_profiles: [] },
    }),
    politeFetch: stubFetch({}, () => ok(brokenHtml)),
    now: new Date("2017-12-24T14:00:00Z"), // 23:00 JST（指定 22:30 より後）
  });
  const brokenReport = brokenStore.state.get("race_notices").last_report;
  check(
    "解析できない行: 実行は成功のまま（読めた8件は扱う）、rowsUnparsed と会場を記録し、last_report.alerts で監視へ通知する（BOA-373）",
    broken.status === 200 &&
      brokenReport?.notesParsed === 8 &&
      brokenReport?.rowsUnparsed === 1 &&
      brokenReport?.venuesWithUnparsedRows?.[0]?.venueCode === 12 &&
      brokenReport?.alerts?.length === 1 &&
      brokenReport.alerts[0].key === "rows_unparsed" &&
      /会場12: 1行/.test(brokenReport.alerts[0].text),
    show({ status: broken.status, brokenReport }),
  );

  // live（通知あり）: 書く
  const liveClient = createFakeClient({
    tables: { races: raceRows("2017-12-24", [12]), racer_profiles: [] },
  });
  const liveFetch = stubFetch({}, () => ok(WITH_NOTICES));
  const live = await runJob({
    store: liveStore(),
    client: liveClient,
    politeFetch: liveFetch,
    now: new Date("2017-12-24T14:00:00Z"), // 23:00 JST（指定 22:30 より後）
  });
  const noteWrite = writes(liveClient, "race_special_notes")[0];
  check(
    "live: 解析した通知9件を、重複を無視する upsert（onConflict=venue_code,race_date,category,detail_text,racer_name）に渡し、集計行を1件書く。同日・同内容の別選手の2件（待機行動違反・落水失格の各1組）も、選手名で区別され9件とも保存される（BOA-371・マイグレーション093で解消）",
    live.status === 200 &&
      noteWrite?.rows.length === 9 &&
      noteWrite.opts.ignoreDuplicates === true &&
      noteWrite.opts.onConflict ===
        "venue_code,race_date,category,detail_text,racer_name" &&
      live.body.notesParsed === 9 &&
      live.body.notesInserted === 9 &&
      liveClient.state.race_notices_health.length === 1,
    show(live.body),
  );
  check(
    "shadow のダイジェストと live のダイジェストは、同じ解析結果で一致する（shadow で解析の一致を確認できる）",
    live.body.digest === report.digest,
    `${live.body.digest} / ${report.digest}`,
  );

  // 二重の起動（cron-job.org と Vercel Cron）: リースを持っている間は、もう一方は何もしない
  const heldStore = liveStore({ leaseHeld: true });
  const heldFetch = stubFetch();
  const heldClient = createFakeClient({
    tables: { races: raceRows(date, [1, 2, 3]), racer_profiles: [] },
  });
  const held = await runJob({
    store: heldStore,
    client: heldClient,
    politeFetch: heldFetch,
  });
  check(
    "二重の起動: リースを他の実行が持っていれば、何もしない（取得もDB書き込みもしない）",
    held.body.skipped === "lease_held" &&
      heldFetch.stats.calls.length === 0 &&
      !heldClient.calls.some((c) => c.op === "upsert"),
    show(held.body),
  );

  // 二重の起動が「同時」に来た場合（cron-job.org と Vercel Cron が同じ分に叩く）。実際のリースと同じく、
  // 取得した実行がある間は、もう一方は取れない
  const shared = createFakeClient({
    tables: { races: raceRows(date, [1, 2, 3]), racer_profiles: [] },
  });
  const sharedStore = liveStore();
  const realAcquire = sharedStore.acquireLease;
  sharedStore.acquireLease = async (job, worker, leaseSec, now) => {
    if (sharedStore.state.get(job).claimed_by) return false;
    return realAcquire(job, worker, leaseSec, now);
  };
  const sharedFetch = stubFetch();
  const [a, b] = await Promise.all([
    runJob({ store: sharedStore, client: shared, politeFetch: sharedFetch }),
    runJob({ store: sharedStore, client: shared, politeFetch: sharedFetch }),
  ]);
  const skipped = [a, b].filter((r) => r.body.skipped === "lease_held");
  check(
    "二重の起動（同時）: 片方だけが処理し（各会場を1回だけ取得）、もう一方は lease_held で何もしない。処理が済んだ後、リースは解放される",
    skipped.length === 1 &&
      sharedFetch.stats.calls.length === 3 &&
      writes(shared, "race_notices_health").length === 1 &&
      sharedStore.state.get("race_notices").claimed_by === null,
    show({
      skipped: skipped.length,
      fetches: sharedFetch.stats.calls.length,
      healthWrites: writes(shared, "race_notices_health").length,
    }),
  );
}

// ---- 後半の場面（verifyData/race-notices-job-scenes-1.js・race-notices-job-scenes-2.js） ----
await runRaceNoticesJobScenes1({ check, show, WITH_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore, writes });
await runRaceNoticesJobScenes2({ out, check, show, NO_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore });

// ---------------------------------------------------------------------------
// (h) 配線
// ---------------------------------------------------------------------------
{
  const def = SCRAPE_JOBS.race_notices;
  check(
    "レジストリ: race_notices は日次（22:30指定。2026-10-03 に10分ごとから夜1回へ）で、取得先ホスト boatrace.jp のブレーカーを見る。リースは補足の起動の間隔（30分）より短い",
    def?.kind === "daily" &&
      def.targetTimeJst === "22:30" &&
      def.hosts?.includes("boatrace.jp") &&
      def.leaseSec < 1800,
    show(def),
  );
  // api の本文の字は読まず、export（config・default）と、共通ラッパへ渡した引数で見る
  const api = await cronWiring(() => import("../../api/cron/race-notices.js"));
  check(
    "api/cron/race-notices.js: config.maxDuration がレジストリの maxDurationSec と一致する",
    api.config?.maxDuration === def.maxDurationSec,
    show(api.config),
  );
  // 共通ラッパのハンドラーは処理の完了後に応答する（waitUntil で先に返さない）
  check(
    "api/cron/race-notices.js: 共通ラッパを job 名 race_notices・runRaceNoticesJob で1回通し、その戻りを default export にする",
    api.made.length === 1 &&
      api.made[0].options.job === "race_notices" &&
      api.made[0].options.run === runRaceNoticesJob &&
      api.handler === api.made[0].handler,
    show(api.made.map((m) => m.options.job)),
  );

  const vercel = JSON.parse(
    fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  const crons = vercel.crons.filter((c) => c.path === "/api/cron/race-notices");
  // UTC→JSTの起動時刻（分）に換算する
  const expand = (field, max) => {
    const out = new Set();
    for (const part of field.split(",")) {
      const [range, step] = part.split("/");
      const [lo, hi] =
        range === "*"
          ? [0, max]
          : range.includes("-")
            ? range.split("-").map(Number)
            : [Number(range), step ? max : Number(range)];
      for (let v = lo; v <= hi; v += step ? Number(step) : 1) out.add(v);
    }
    return out;
  };
  const times = [];
  for (const cron of crons) {
    const [min, hour] = (cron.schedule ?? "").split(" ");
    for (const h of expand(hour ?? "", 23))
      for (const m of expand(min ?? "", 59))
        times.push(((h + 9) % 24) * 60 + m);
  }
  times.sort((a, b) => a - b);
  const hhmm = (t) =>
    `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  check(
    `vercel.json: /api/cron/race-notices は夜1回（JST 22:30）と補足（23:00・23:30）の3回だけ（${times.map(hhmm).join("・")}）。どれも指定時刻 22:30 から同じ対象日に解決される（日付をまたがない）`,
    JSON.stringify(times.map(hhmm)) === '["22:30","23:00","23:30"]' &&
      times.every((t) => t >= 22 * 60 + 30 && t < 24 * 60),
    times.map(hhmm).join(","),
  );
  // リージョンは、2026-09-20にユーザー承認のうえ、api/cron/*のみsyd1へ変更済み（PR #747）。
  // 全関数に効くトップレベルの regions は使わない（画面用のAPIは対象外）
  const cronFunctions = vercel.functions?.["api/cron/*.js"];
  check(
    "vercel.json: api/cron/*.js のみ syd1（トップレベルの regions は使わない）",
    !("regions" in vercel) &&
      Array.isArray(cronFunctions?.regions) &&
      cronFunctions.regions.length === 1 &&
      cronFunctions.regions[0] === "syd1",
  );
}

if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/race-notices-job-scenes-2.js） ----
runRaceNoticesJobScenes3({ out, check, show, NO_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore });
