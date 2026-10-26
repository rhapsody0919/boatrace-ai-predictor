/**
 * GitHub Actions の取得が、取得の非常停止（scrape_job_state.fetch_stop、マイグレーション178）で止まることの検証
 * （BOA-1145 P4a ④a、ADR-0101 決定6）。DB・ネットワークに接続しない。
 *
 *   (a) 肩代わりの判定: Vercel が止まっていて（tick_stale）肩代わりの条件を満たしても、host の行の fetch_stop が true なら肩代わりしない
 *   (b) 同じ変数の別のジョブの非常停止でも、変数ごと止める（REMOTE_VETO）
 *   (c) 読み取る列に fetch_stop を入れている（REST の select）
 *   (d) isGhaFetchStopped: 立っていれば stopped、立っていない・行なし・読み取りの失敗・鍵なしは stopped=false（止めない側）
 *   (e) scrape-scheduled・morning-init は、SKIP 変数・取得より前に isGhaFetchStopped を呼ぶ
 *
 * 実行: node scripts/maintenance/verify-gha-fetch-stop.js
 */
import fs from "node:fs";
import {
  createRestJobStateClient,
  decideFromRows,
  isGhaFetchStopped,
} from "../lib/ghaSkipGate.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const NOW = new Date("2026-10-27T03:00:00Z");
const STALE = new Date(NOW.getTime() - 30 * 60_000).toISOString();
const HOST = "host:boatrace.jp";
const silent = { log() {} };

// (a)
{
  const job = {
    job: "odds",
    mode: "live",
    last_tick_at: STALE,
    consecutive_failures: 0,
  };
  const base = decideFromRows({
    varName: "SKIP_ODDS_ON_GHA",
    rows: [job],
    now: NOW,
  });
  const stopped = decideFromRows({
    varName: "SKIP_ODDS_ON_GHA",
    rows: [job, { job: HOST, mode: "off", fetch_stop: true }],
    now: NOW,
  });
  const lowered = decideFromRows({
    varName: "SKIP_ODDS_ON_GHA",
    rows: [job, { job: HOST, mode: "off", fetch_stop: false }],
    now: NOW,
  });
  check(
    "(a) tick_stale で肩代わりする条件でも、host の fetch_stop が true なら肩代わりしない（下ろせば従来どおり肩代わり）",
    base.skip === false &&
      stopped.skip === true &&
      stopped.results?.some((r) => r.reason === "fetch_stop_no_takeover") &&
      lowered.skip === false,
    show({ base: base.reason, stopped, lowered: lowered.reason }),
  );
}

// (b)
{
  const rows = [
    {
      job: "result",
      mode: "live",
      last_tick_at: STALE,
      consecutive_failures: 0,
    },
    {
      job: "result_catchup",
      mode: "live",
      last_tick_at: STALE,
      consecutive_failures: 0,
    },
    { job: HOST, fetch_stop: true },
  ];
  const d = decideFromRows({ varName: "SKIP_RESULTS_ON_GHA", rows, now: NOW });
  check(
    "(b) 変数の対象のジョブが複数でも、非常停止なら変数ごとスキップ",
    d.skip === true,
    show(d),
  );
}

// (c)
{
  let requested;
  const client = createRestJobStateClient({
    url: "https://example.supabase.co",
    key: "test-key",
    fetchImpl: async (url) => {
      requested = new URL(url);
      return new Response("[]", { status: 200 });
    },
  });
  await client.readJobStates([HOST]);
  check(
    "(c) REST の select に fetch_stop を入れる",
    requested?.searchParams.get("select")?.split(",").includes("fetch_stop"),
    String(requested),
  );
}

// (d)
{
  const mk = (rows) => ({ readJobStates: async () => rows });
  const on = await isGhaFetchStopped({
    client: mk([{ job: HOST, fetch_stop: true }]),
    logger: silent,
  });
  const off = await isGhaFetchStopped({
    client: mk([{ job: HOST, fetch_stop: false }]),
    logger: silent,
  });
  const none = await isGhaFetchStopped({ client: mk([]), logger: silent });
  const other = await isGhaFetchStopped({
    client: mk([{ job: "host:mbrace.or.jp", fetch_stop: true }]),
    logger: silent,
  });
  const failed = await isGhaFetchStopped({
    client: {
      readJobStates: async () => {
        throw new Error("db down");
      },
    },
    logger: silent,
  });
  const noKey = await isGhaFetchStopped({ env: {}, logger: silent });
  check(
    "(d) 立っていれば stopped。立っていない・行なし・別ホスト・読み取りの失敗・鍵なしは stopped=false",
    on.stopped === true &&
      off.stopped === false &&
      none.stopped === false &&
      other.stopped === false &&
      failed.stopped === false &&
      noKey.stopped === false,
    show({ on, off, none, other, failed, noKey }),
  );
}

// (e)
for (const [file, firstFetchRe] of [
  ["../daily/scrape-scheduled.js", /getRaceSchedule\(date/],
  ["../daily/morning-init.js", /isTrueVar\("SKIP_MORNING_INIT_ON_GHA"\)\)/],
]) {
  const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const stopAt = main.indexOf("await isGhaFetchStopped()");
  const firstAt = main.search(firstFetchRe);
  check(
    `(e) ${file.replace("../daily/", "")}: SKIP 変数・取得より前に isGhaFetchStopped を呼び、止まっていれば return`,
    stopAt >= 0 &&
      firstAt > stopAt &&
      /isGhaFetchStopped\(\)\)\.stopped\) \{[\s\S]{0,120}return;/.test(main),
    show({ stopAt, firstAt }),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の失敗`);
  process.exit(1);
}
console.log("\n✅ すべて成功");
