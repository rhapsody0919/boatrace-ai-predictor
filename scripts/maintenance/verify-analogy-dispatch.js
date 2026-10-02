/**
 * BOA-271 アナロジー・ファインダーの workflow_dispatch の起動（scripts/lib/analogyDispatch.js、学習側 T10-7）の検証。
 * DB・GitHub には繋がない（偽のクライアントと偽の fetch）。
 *
 *   (a) 対象レースの規則が daily_features.py の select_targets と同じ（締切10分前・中止・欠場・発走時刻なし）
 *   (b) 7:00〜7:59 の起動だけが拾い直し（6:40・9:40・13:40 は無条件に起動）
 *   (c) 拾い直し: 対象0件は失敗（充足としない）、欠けが無ければ起動しない、欠けがあれば起動する
 *   (d) 起動: URL・ref・認証ヘッダー。HTTP 失敗・トークン未設定は失敗。shadow は起動しない
 *   (e) 監視: failureAlertAfter: 1 のジョブは1回目の失敗で通知、既定のジョブは3回目まで通知しない
 *   (f) 配線: レジストリ（monitor・validateRegistry）、api/cron の maxDuration と modeGated、vercel.json の cron
 *
 * 使い方: node scripts/maintenance/verify-analogy-dispatch.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAnalogyDispatchRun,
  isRecheckRun,
  selectTargets,
} from "../lib/analogyDispatch.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { evaluateJobStates } from "../lib/scrapeJobs/monitor.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DATE = "2026-10-04";
const at = (hhmm) => new Date(`${DATE}T${hhmm}:00+09:00`);
const race = (no, start, extra = {}) => ({
  race_id: `${DATE}-01-${String(no).padStart(2, "0")}`,
  race_date: DATE,
  start_time: start,
  cancellation_status: null,
  ...extra,
});

// ---------------------------------------------------------------- (a)
{
  const races = [
    race(1, "07:29"), // 締切まで9分 → 外す
    race(2, "07:30"), // ちょうど10分 → 入れる
    race(3, "08:00", { cancellation_status: "confirmed" }),
    race(4, "08:30"), // 欠場が分かっている → 外す
    race(5, null),
    race(6, "09:00", { cancellation_status: "suspected" }),
  ];
  const got = selectTargets(races, new Set([races[3].race_id]), at("07:20"));
  check(
    same(got, [races[1].race_id, races[5].race_id]),
    "(a) 対象は締切10分以上前・中止でない・欠場なし・発走時刻あり（daily_features.py と同じ）",
    JSON.stringify(got),
  );
}

// ---------------------------------------------------------------- (b)
{
  const cases = [
    ["06:40", false],
    ["06:59", false],
    ["07:00", true],
    ["07:20", true],
    ["07:59", true],
    ["08:00", false],
    ["09:40", false],
    ["13:40", false],
  ];
  const bad = cases.filter(([t, want]) => isRecheckRun(at(t)) !== want);
  check(
    bad.length === 0,
    "(b) 拾い直しは JST 7:00〜7:59 の起動だけ",
    JSON.stringify(bad),
  );
}

// ---------------------------------------------------------------- 偽のクライアント・fetch
function fakeClient({ races = [], absent = [], features = [] }) {
  const reads = [];
  const tables = {
    races,
    race_entries: absent,
    analogy_race_features: features,
  };
  return {
    reads,
    from(table) {
      reads.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        like: () => q,
        order: () => q,
        range: async (from, to) => ({
          data: tables[table].slice(from, to + 1),
          error: null,
        }),
      };
      return q;
    },
  };
}
function fakeFetch(status = 204) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => "Bad credentials",
    };
  };
  f.calls = calls;
  return f;
}
const ctxOf = (now, client, mode = "live") => ({
  now: () => now,
  client,
  mode,
});
const ENV = { GITHUB_ACTIONS_DISPATCH_TOKEN: "t0ken" };

// ---------------------------------------------------------------- (c)
{
  const run = (fetchImpl) =>
    createAnalogyDispatchRun("dailyFeatures", { fetchImpl, env: ENV });
  const races = [race(1, "09:00"), race(2, "09:30")];

  let f = fakeFetch();
  let r = await run(f)(ctxOf(at("07:20"), fakeClient({ races: [] })));
  check(
    r.outcome === "error" && /0件/.test(r.error) && f.calls.length === 0,
    "(c) 7:20 に対象0件は失敗（充足としない）・起動しない",
    JSON.stringify(r),
  );

  f = fakeFetch();
  const full = races.flatMap((x) =>
    [1, 2, 3, 4, 5, 6].map((b) => ({ race_id: x.race_id, boat_number: b })),
  );
  r = await run(f)(ctxOf(at("07:20"), fakeClient({ races, features: full })));
  check(
    r.outcome === undefined &&
      r.report.dispatched === false &&
      f.calls.length === 0,
    "(c) 7:20 に欠けが無ければ起動しない",
    JSON.stringify(r),
  );

  f = fakeFetch();
  r = await run(f)(
    ctxOf(at("07:20"), fakeClient({ races, features: full.slice(0, 6) })),
  );
  check(
    r.report?.dispatched === true &&
      r.report.missing === 1 &&
      f.calls.length === 1,
    "(c) 7:20 に行の無いレースがあれば起動する",
    JSON.stringify(r),
  );

  f = fakeFetch();
  const client = fakeClient({ races: [] });
  r = await run(f)(ctxOf(at("06:40"), client));
  check(
    r.report?.dispatched === true &&
      f.calls.length === 1 &&
      client.reads.length === 0,
    "(c) 6:40 は DB を読まずに無条件に起動する",
    JSON.stringify(r),
  );
}

// ---------------------------------------------------------------- (d)
{
  let f = fakeFetch();
  let r = await createAnalogyDispatchRun("train", { fetchImpl: f, env: ENV })(
    ctxOf(at("04:00"), fakeClient({})),
  );
  const call = f.calls[0];
  check(
    r.report?.dispatched === true &&
      call?.url ===
        "https://api.github.com/repos/rhapsody0919/boatrace-ai-predictor/actions/workflows/train-analogy.yml/dispatches" &&
      call.init.method === "POST" &&
      call.init.headers.Authorization === "Bearer t0ken" &&
      JSON.parse(call.init.body).ref === "master",
    "(d) train は train-analogy.yml を master で dispatch する",
    JSON.stringify(call),
  );

  f = fakeFetch(401);
  r = await createAnalogyDispatchRun("train", { fetchImpl: f, env: ENV })(
    ctxOf(at("04:00"), fakeClient({})),
  );
  check(
    r.outcome === "error" && /HTTP 401/.test(r.error),
    "(d) dispatch の HTTP 失敗は失敗にする",
    JSON.stringify(r),
  );

  f = fakeFetch();
  r = await createAnalogyDispatchRun("train", { fetchImpl: f, env: {} })(
    ctxOf(at("04:00"), fakeClient({})),
  );
  check(
    r.outcome === "error" &&
      /GITHUB_ACTIONS_DISPATCH_TOKEN/.test(r.error) &&
      f.calls.length === 0,
    "(d) トークン未設定は失敗にする",
    JSON.stringify(r),
  );

  f = fakeFetch();
  r = await createAnalogyDispatchRun("dailyFeatures", {
    fetchImpl: f,
    env: ENV,
  })(ctxOf(at("06:40"), fakeClient({}), "shadow"));
  check(
    r.report?.wouldDispatch === true && f.calls.length === 0,
    "(d) shadow は起動しない",
    JSON.stringify(r),
  );
}

// ---------------------------------------------------------------- (e)
{
  const now = at("10:00");
  const row = (job, n) => ({
    job,
    mode: "live",
    consecutive_failures: n,
    last_error: "HTTP 401",
    last_tick_at: now.toISOString(),
  });
  const failuresOf = (rows) =>
    evaluateJobStates(rows, now)
      .filter((a) => a.kind === "failures")
      .map((a) => a.key);
  check(
    same(failuresOf([row("analogy_dispatch_features", 1)]), [
      "failures:analogy_dispatch_features",
    ]),
    "(e) failureAlertAfter: 1 のジョブは1回目の失敗で通知する",
  );
  check(
    same(failuresOf([row("point_rank", 2)]), []) &&
      same(failuresOf([row("point_rank", 3)]), ["failures:point_rank"]),
    "(e) 既定のジョブは3回目まで通知しない（今までどおり）",
  );
  const liveness = evaluateJobStates(
    [
      {
        job: "analogy_dispatch_train",
        mode: "live",
        consecutive_failures: 0,
        last_tick_at: null,
      },
    ],
    now,
  ).filter((a) => a.kind === "liveness");
  check(
    liveness.length === 0,
    "(e) 週1回の起動で、10分ごとの死活の誤報を出さない",
  );
}

// ---------------------------------------------------------------- (f)
{
  check(
    same(validateRegistry(), []),
    "(f) validateRegistry に問題が無い",
    JSON.stringify(validateRegistry()),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = (p) =>
    vercel.crons
      .filter((c) => c.path === p)
      .map((c) => c.schedule)
      .sort();
  for (const [file, job, schedules] of [
    ["analogy-dispatch-train", "analogy_dispatch_train", ["0 19 * * 6"]],
    [
      "analogy-dispatch-features",
      "analogy_dispatch_features",
      ["20 22 * * *", "40 21,0,4 * * *"],
    ],
  ]) {
    const def = SCRAPE_JOBS[job];
    check(
      def?.kind === "monitor" && def.failureAlertAfter === 1,
      `(f) ${job}: monitor・failureAlertAfter 1`,
    );
    const src = fs.readFileSync(path.join(ROOT, `api/cron/${file}.js`), "utf8");
    const m = /maxDuration:\s*(\d+)/.exec(src);
    check(
      Number(m?.[1]) === def?.maxDurationSec &&
        /modeGated:\s*true/.test(src) &&
        src.includes(`job: "${job}"`),
      `(f) api/cron/${file}.js: maxDuration がレジストリと一致し、モードのゲートを掛ける`,
    );
    check(
      same(crons(`/api/cron/${file}`), schedules),
      `(f) vercel.json: ${file} の cron が ${schedules.join(" / ")}`,
      JSON.stringify(crons(`/api/cron/${file}`)),
    );
  }
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\n✅ すべての検査が通過");
