/**
 * BOA-271 アナロジー・ファインダーの週次の学習の workflow_dispatch（scripts/lib/analogyDispatch.js、学習側 T10-7）の検証。
 * DB・GitHub には繋がない（偽の fetch）。
 *
 *   (a) 起動: URL・ref・認証ヘッダー・inputs。HTTP 失敗・トークン未設定は失敗。shadow は起動しない
 *   (b) inputs のキーが train-analogy.yml の workflow_dispatch.inputs にある（無いキーは GitHub が 422 で拒む）
 *   (c) 監視: failureAlertAfter: 1 のジョブは1回目の失敗で通知、既定のジョブは3回目まで通知しない。週1回で死活の誤報を出さない
 *   (d) 配線: レジストリ（monitor・validateRegistry）、api/cron の maxDuration と modeGated、vercel.json の cron
 *   (e) v16 の朝のバッチ（T2-5b）: analogy-v16-morning.yml を起動する。7:40 の起動だけ、出走表の段が無い今日のレース
 *       （締切まで10分以上・中止でない）があるときに起動し、ほかの起動は常に起動する。配線（レジストリ・api/cron・vercel.json）
 *
 * 使い方: node scripts/maintenance/verify-analogy-dispatch.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISPATCH_WORKFLOWS,
  createAnalogyDispatchRun,
  morningRetryNeeded,
  morningShouldDispatch,
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

const at = (hhmm) => new Date(`2026-10-04T${hhmm}:00+09:00`);
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
const ctxOf = (now, mode = "live") => ({ now: () => now, client: null, mode });
const ENV = { GITHUB_ACTIONS_DISPATCH_TOKEN: "t0ken" };
const run = (f, env = ENV) =>
  createAnalogyDispatchRun("train", { fetchImpl: f, env });

// ---------------------------------------------------------------- (a)
{
  let f = fakeFetch();
  let r = await run(f)(ctxOf(at("04:00")));
  const call = f.calls[0];
  check(
    r.report?.dispatched === true &&
      call?.url ===
        "https://api.github.com/repos/rhapsody0919/boatrace-ai-predictor/actions/workflows/train-analogy.yml/dispatches" &&
      call.init.method === "POST" &&
      call.init.headers.Authorization === "Bearer t0ken" &&
      same(JSON.parse(call.init.body), { ref: "master", inputs: {} }),
    "(a) train は train-analogy.yml を master で dispatch する（inputs は空）",
    JSON.stringify(call),
  );

  f = fakeFetch(401);
  r = await run(f)(ctxOf(at("04:00")));
  check(
    r.outcome === "error" && /HTTP 401/.test(r.error),
    "(a) dispatch の HTTP 失敗は失敗にする",
    JSON.stringify(r),
  );

  f = fakeFetch();
  r = await run(f, {})(ctxOf(at("04:00")));
  check(
    r.outcome === "error" &&
      /GITHUB_ACTIONS_DISPATCH_TOKEN/.test(r.error) &&
      f.calls.length === 0,
    "(a) トークン未設定は失敗にする",
    JSON.stringify(r),
  );

  f = fakeFetch();
  r = await run(f)(ctxOf(at("04:00"), "shadow"));
  check(
    r.report?.wouldDispatch === true && f.calls.length === 0,
    "(a) shadow は起動しない",
    JSON.stringify(r),
  );
}

// ---------------------------------------------------------------- (b)
{
  for (const def of Object.values(DISPATCH_WORKFLOWS)) {
    const wf = fs.readFileSync(
      path.join(ROOT, ".github/workflows", def.workflow),
      "utf8",
    );
    const block = /workflow_dispatch:\s*\n([\s\S]*?)\n\S/.exec(wf)?.[1] ?? "";
    const declared = [...block.matchAll(/^ {6}([a-z_]+):\s*$/gm)].map(
      (m) => m[1],
    );
    const unknown = Object.keys(def.inputs).filter(
      (k) => !declared.includes(k),
    );
    check(
      unknown.length === 0,
      `(b) ${def.workflow} の inputs のキーが workflow に宣言されている`,
      `宣言にないキー: ${unknown.join(", ")}（宣言: ${declared.join(", ")}）`,
    );
  }
}

// ---------------------------------------------------------------- (c)
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
    same(failuresOf([row("analogy_dispatch_train", 1)]), [
      "failures:analogy_dispatch_train",
    ]),
    "(c) failureAlertAfter: 1 のジョブは1回目の失敗で通知する",
  );
  check(
    same(failuresOf([row("point_rank", 2)]), []) &&
      same(failuresOf([row("point_rank", 3)]), ["failures:point_rank"]),
    "(c) 既定のジョブは3回目まで通知しない（今までどおり）",
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
    "(c) 週1回の起動で、10分ごとの死活の誤報を出さない",
  );
}

// ---------------------------------------------------------------- (d)
{
  check(
    same(validateRegistry(), []),
    "(d) validateRegistry に問題が無い",
    JSON.stringify(validateRegistry()),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const def = SCRAPE_JOBS.analogy_dispatch_train;
  check(
    def?.kind === "monitor" && def.failureAlertAfter === 1,
    "(d) analogy_dispatch_train: monitor・failureAlertAfter 1",
  );
  const src = fs.readFileSync(
    path.join(ROOT, "api/cron/analogy-dispatch-train.js"),
    "utf8",
  );
  const m = /maxDuration:\s*(\d+)/.exec(src);
  check(
    Number(m?.[1]) === def?.maxDurationSec &&
      /modeGated:\s*true/.test(src) &&
      src.includes('job: "analogy_dispatch_train"'),
    "(d) api/cron/analogy-dispatch-train.js: maxDuration がレジストリと一致し、モードのゲートを掛ける",
  );
  const crons = vercel.crons
    .filter((c) => c.path === "/api/cron/analogy-dispatch-train")
    .map((c) => c.schedule);
  check(
    same(crons, ["0 19 * * 6"]),
    "(d) vercel.json: 日曜 JST 4:00（UTC 土曜 19:00）に1本",
    JSON.stringify(crons),
  );
}

// ---------------------------------------------------------------- (e)
{
  const races = [
    {
      race_id: "2026-10-04-20-01",
      race_date: "2026-10-04",
      start_time: "07:45:00",
      cancellation_status: null,
    },
    {
      race_id: "2026-10-04-20-02",
      race_date: "2026-10-04",
      start_time: "08:30:00",
      cancellation_status: null,
    },
    {
      race_id: "2026-10-04-20-03",
      race_date: "2026-10-04",
      start_time: "09:00:00",
      cancellation_status: "confirmed",
    },
  ];
  const t = at("07:40");
  check(
    morningRetryNeeded(races, new Set(["2026-10-04-20-02"]), t) === false,
    "(e) 締切まで10分未満・中止のレースは拾い直さない",
  );
  check(
    morningRetryNeeded(races, new Set(), t) === true,
    "(e) 出走表の段が無い、締切まで10分以上のレースがあれば拾い直す",
  );
  const fakeClient = (snaps) => ({
    from: (table) => {
      const q = {
        select: () => q,
        eq: () => q,
        like: () => q,
        throwOnError: async () => ({ data: table === "races" ? races : snaps }),
      };
      return q;
    },
  });
  const runM = (f) =>
    createAnalogyDispatchRun("v16_morning", {
      fetchImpl: f,
      env: ENV,
      shouldDispatch: morningShouldDispatch,
    });
  let f = fakeFetch();
  let r = await runM(f)({ ...ctxOf(at("07:10")), client: fakeClient([]) });
  check(
    r.report?.dispatched === true &&
      f.calls[0]?.url.endsWith("/workflows/analogy-v16-morning.yml/dispatches"),
    "(e) 7:10 は常に起動する（analogy-v16-morning.yml）",
    JSON.stringify(r),
  );
  f = fakeFetch();
  r = await runM(f)({
    ...ctxOf(at("07:40")),
    client: fakeClient([{ race_id: "2026-10-04-20-02" }]),
  });
  check(
    r.report?.dispatched === false && f.calls.length === 0,
    "(e) 7:40 は全レース作成済みなら起動しない",
    JSON.stringify(r),
  );
  f = fakeFetch();
  r = await runM(f)({ ...ctxOf(at("07:40")), client: fakeClient([]) });
  check(
    r.report?.dispatched === true,
    "(e) 7:40 は出走表の段が無いレースがあれば起動する",
    JSON.stringify(r),
  );
  f = fakeFetch();
  r = await runM(f)({ ...ctxOf(at("13:40")), client: null });
  check(
    r.report?.dispatched === true,
    "(e) 13:40 は DB を見ずに起動する",
    JSON.stringify(r),
  );

  const def = SCRAPE_JOBS.analogy_dispatch_morning;
  check(
    def?.kind === "monitor" && def.failureAlertAfter === 1,
    "(e) analogy_dispatch_morning: monitor・failureAlertAfter 1",
  );
  const src = fs.readFileSync(
    path.join(ROOT, "api/cron/analogy-dispatch-morning.js"),
    "utf8",
  );
  check(
    Number(/maxDuration:\s*(\d+)/.exec(src)?.[1]) === def?.maxDurationSec &&
      /modeGated:\s*true/.test(src) &&
      src.includes('job: "analogy_dispatch_morning"'),
    "(e) api/cron/analogy-dispatch-morning.js: maxDuration がレジストリと一致し、モードのゲートを掛ける",
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons
    .filter((c) => c.path === "/api/cron/analogy-dispatch-morning")
    .map((c) => c.schedule);
  check(
    same(crons, ["10 22 * * *", "40 22 * * *", "40 0 * * *", "40 4 * * *"]),
    "(e) vercel.json: JST 7:10・7:40・9:40・13:40",
    JSON.stringify(crons),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\n✅ すべての検査が通過");
