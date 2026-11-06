/**
 * 本番のデプロイをまとめて出す定時の起動（scripts/lib/releaseDispatch.js、ADR-0106）の検証。GitHub・Vercel・DB には繋がない（偽の fetch）。
 *
 *   (a) 判定（decideRelease）: 同じなら何もしない／サイトに関係ない差分だけなら何もしない（リネームは旧パスも見る）／
 *       300件以上は全部見ていないので出す／master の検査が赤なら止める／本番の版が master の祖先でなければ失敗／
 *       前回叩いたのに本番の版が動いていなければ stuck
 *   (b) 起動（createReleaseDispatchRun）: shadow は叩かない、live は Deploy Hook を POST、鍵・版・Hook が無い・HTTP 失敗は失敗、
 *       stuck は叩き直した上で失敗、出した記録（released・fromSha）を返す
 *   (c) 配線: レジストリ（monitor・failureAlertAfter 1）、api/cron の maxDuration とモードのゲート、vercel.json の cron（JST 05:45・11:45・17:45）
 *
 * 使い方: node scripts/maintenance/verify-release-dispatch.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPARE_FILES_CAP,
  RELEASE_GATE_WORKFLOWS,
  RELEASE_HOOK_ENV,
  createReleaseDispatchRun,
  decideRelease,
} from "../lib/releaseDispatch.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";

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

const DEPLOYED = "a".repeat(40);
const HEAD = "b".repeat(40);
const green = RELEASE_GATE_WORKFLOWS.map((workflow) => ({
  workflow,
  conclusion: "success",
}));
const ahead = (files) => ({
  status: "ahead",
  files: files.map((f) => (typeof f === "string" ? { filename: f } : f)),
  headSha: HEAD,
});

// ---------------------------------------------------------------- (a)
{
  const base = { deployedSha: DEPLOYED, gates: green, previous: null };
  const d = (over) => decideRelease({ ...base, ...over });

  check(
    d({ compare: { status: "identical", files: [], headSha: DEPLOYED } })
      .action === "none",
    "(a) 本番が master の先と同じなら何もしない",
  );
  check(
    d({ compare: ahead(["docs/a.md", "data/analysis/x.json", "README.md"]) })
      .action === "none",
    "(a) サイトに関係ない差分（docs・data/analysis・ルートの .md）だけなら何もしない",
  );
  check(
    d({ compare: ahead(["docs/a.md", "src/App.jsx"]) }).action === "release",
    "(a) サイトに関わる差分（src/）が1つでもあれば出す",
  );
  check(
    d({
      compare: ahead([
        { filename: "docs/moved.js", previous_filename: "src/moved.js" },
      ]),
    }).action === "release",
    "(a) サイトのファイルを除外の場所へ移すだけのリネームは旧パスで出す",
  );
  check(
    d({
      compare: ahead(
        Array.from({ length: COMPARE_FILES_CAP }, (_, i) => `docs/${i}.md`),
      ),
    }).action === "release",
    `(a) 差分が ${COMPARE_FILES_CAP} 件以上なら全部は見ていないので出す`,
  );
  const blocked = d({
    compare: ahead(["src/App.jsx"]),
    gates: [
      { workflow: "post-merge-checks.yml", conclusion: "failure" },
      { workflow: "quality-gates.yml", conclusion: "success" },
    ],
  });
  check(
    blocked.action === "blocked" &&
      blocked.reason.includes("post-merge-checks.yml=failure"),
    "(a) master の検査が赤なら出さない（理由に workflow と結論）",
    JSON.stringify(blocked),
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      gates: [
        { workflow: "post-merge-checks.yml", conclusion: null },
        { workflow: "quality-gates.yml", conclusion: "skipped" },
      ],
    }).action === "release",
    "(a) 終わった run が無い・skipped の検査では止めない",
  );
  check(
    d({ compare: { status: "diverged", files: [], headSha: HEAD } }).action ===
      "error" &&
      d({ compare: { status: "behind", files: [], headSha: HEAD } }).action ===
        "error",
    "(a) 本番の版が master の祖先でない（diverged・behind）なら失敗",
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      previous: { released: true, fromSha: DEPLOYED },
    }).stuck === true &&
      d({
        compare: ahead(["src/App.jsx"]),
        previous: { released: true, fromSha: "c".repeat(40) },
      }).stuck === false &&
      d({
        compare: ahead(["src/App.jsx"]),
        previous: { released: false, fromSha: DEPLOYED },
      }).stuck === false,
    "(a) 前回叩いて本番の版がそのときのままなら stuck。版が動いた・前回叩いていないなら stuck でない",
  );
}

// ---------------------------------------------------------------- (b)
function fakeGitHub({
  compare = {
    status: "ahead",
    files: [{ filename: "src/App.jsx" }],
    commits: [{ sha: HEAD }],
  },
  gateConclusion = "success",
  hookStatus = 201,
  compareStatus = 200,
} = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const reply = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    if (url.includes("/compare/")) return reply(compareStatus, compare);
    if (url.includes("/actions/workflows/"))
      return reply(200, {
        workflow_runs: [{ conclusion: gateConclusion, head_sha: HEAD }],
      });
    if (url === "https://hook.example/deploy") return reply(hookStatus, {});
    return reply(404, { message: "Not Found" });
  };
  f.calls = calls;
  return f;
}
const ENV = {
  VERCEL_GIT_COMMIT_SHA: DEPLOYED,
  GITHUB_ACTIONS_DISPATCH_TOKEN: "test-token",
  [RELEASE_HOOK_ENV]: "https://hook.example/deploy",
};
const ctx = (mode, last_report = null) => ({
  mode,
  state: { last_report },
  now: () => new Date("2026-11-06T05:45:00+09:00"),
});
const hookCalls = (f) =>
  f.calls.filter((c) => c.url === "https://hook.example/deploy");

{
  const f = fakeGitHub();
  const r = await createReleaseDispatchRun({ fetchImpl: f, env: ENV })(
    ctx("live"),
  );
  const compareCall = f.calls.find((c) => c.url.includes("/compare/"));
  check(
    r.report?.released === true &&
      r.report.fromSha === DEPLOYED &&
      r.report.masterSha === HEAD &&
      hookCalls(f).length === 1 &&
      hookCalls(f)[0].init.method === "POST" &&
      compareCall.url.includes(`/compare/${DEPLOYED}...master`) &&
      compareCall.init.headers.Authorization === "Bearer test-token",
    "(b) live: 本番の版...master を比べ、Deploy Hook を POST し、出した記録（released・fromSha・masterSha）を返す",
    JSON.stringify(r),
  );
  const gateUrls = f.calls
    .filter((c) => c.url.includes("/actions/workflows/"))
    .map((c) => c.url);
  check(
    RELEASE_GATE_WORKFLOWS.every((w) =>
      gateUrls.some(
        (u) =>
          u.includes(`/actions/workflows/${w}/runs`) &&
          u.includes("branch=master") &&
          u.includes("status=completed"),
      ),
    ),
    "(b) 検査は各 workflow の master で最後に終わった run を読む",
    JSON.stringify(gateUrls),
  );
}
{
  const f = fakeGitHub();
  const r = await createReleaseDispatchRun({ fetchImpl: f, env: ENV })(
    ctx("shadow"),
  );
  check(
    r.report?.wouldRelease === true && hookCalls(f).length === 0,
    "(b) shadow: 叩かず、叩くはずだったことだけ返す",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({
    compare: { status: "identical", files: [], commits: [] },
  });
  const r = await createReleaseDispatchRun({ fetchImpl: f, env: ENV })(
    ctx("live"),
  );
  check(
    r.report?.action === "none" &&
      r.report.released === false &&
      hookCalls(f).length === 0,
    "(b) 差分が無ければ叩かず、成功（released=false）で返す",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({ gateConclusion: "failure" });
  const r = await createReleaseDispatchRun({ fetchImpl: f, env: ENV })(
    ctx("live"),
  );
  check(
    r.outcome === "error" &&
      r.error.includes("master の検査が通っていない") &&
      hookCalls(f).length === 0,
    "(b) master の検査が赤なら叩かず失敗（Slack に出る）",
    JSON.stringify(r),
  );
}
for (const [label, env, expect] of [
  [
    "版が無い",
    { ...ENV, VERCEL_GIT_COMMIT_SHA: undefined },
    "VERCEL_GIT_COMMIT_SHA",
  ],
  [
    "トークンが無い",
    { ...ENV, GITHUB_ACTIONS_DISPATCH_TOKEN: undefined },
    "GITHUB_ACTIONS_DISPATCH_TOKEN",
  ],
  ["Hook が無い", { ...ENV, [RELEASE_HOOK_ENV]: undefined }, RELEASE_HOOK_ENV],
]) {
  const f = fakeGitHub();
  const r = await createReleaseDispatchRun({ fetchImpl: f, env })(ctx("live"));
  check(
    r.outcome === "error" &&
      r.error.includes(expect) &&
      hookCalls(f).length === 0,
    `(b) ${label}なら失敗`,
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({ hookStatus: 500 });
  const r = await createReleaseDispatchRun({ fetchImpl: f, env: ENV })(
    ctx("live"),
  );
  check(
    r.outcome === "error" && r.error.includes("Deploy Hook を叩けない"),
    "(b) Deploy Hook が HTTP 失敗なら失敗",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub({ compareStatus: 401 });
  const r = await createReleaseDispatchRun({ fetchImpl: f, env: ENV })(
    ctx("live"),
  );
  check(
    r.outcome === "error" &&
      r.error.includes("GitHub を読めない") &&
      hookCalls(f).length === 0,
    "(b) GitHub を読めなければ叩かず失敗",
    JSON.stringify(r),
  );
}
{
  const f = fakeGitHub();
  const r = await createReleaseDispatchRun({ fetchImpl: f, env: ENV })(
    ctx("live", { released: true, fromSha: DEPLOYED, masterSha: HEAD }),
  );
  check(
    r.outcome === "error" &&
      r.error.includes("本番に出ていない") &&
      hookCalls(f).length === 1,
    "(b) 前回叩いたのに本番の版が動いていなければ、叩き直した上で失敗",
    JSON.stringify(r),
  );
}

// ---------------------------------------------------------------- (c)
{
  const def = SCRAPE_JOBS.release_dispatch;
  check(
    def?.kind === "monitor" &&
      def?.failureAlertAfter === 1 &&
      validateRegistry().length === 0,
    "(c) レジストリ: release_dispatch は monitor・failureAlertAfter 1",
    JSON.stringify(def),
  );
  const src = fs.readFileSync(
    path.join(ROOT, "api/cron/release-dispatch.js"),
    "utf8",
  );
  check(
    Number(/maxDuration:\s*(\d+)/.exec(src)?.[1]) === def?.maxDurationSec &&
      /modeGated:\s*true/.test(src) &&
      src.includes('job: "release_dispatch"') &&
      src.includes("createReleaseDispatchRun()"),
    "(c) api/cron/release-dispatch.js: maxDuration がレジストリと一致し、モードのゲートを掛ける",
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons
    .filter((c) => c.path === "/api/cron/release-dispatch")
    .map((c) => c.schedule);
  check(
    same(crons, ["45 2,8,20 * * *"]),
    "(c) vercel.json: UTC 02:45・08:45・20:45（JST 11:45・17:45・05:45）の1行",
    JSON.stringify(crons),
  );
}

if (failures > 0) {
  console.error(`\nverify-release-dispatch: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-release-dispatch: すべて通った");
