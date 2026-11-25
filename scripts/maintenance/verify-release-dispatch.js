/**
 * 本番のデプロイをまとめて出す定時の起動（scripts/lib/releaseDispatch.js、ADR-0106）の検証。GitHub・Vercel・DB には繋がない（偽の fetch）。
 *
 *   (a) 判定（decideRelease）: 同じ・サイトに関係ない差分だけ・files が空なら何もしない（リネームは旧パスも見る）／
 *       300件以上は全部見ていないので出す／master の先が10分以内なら待つ／検査が赤なら止める・走っていれば待つ／
 *       本番の版が master の祖先でなければ失敗／前に出した版より本番が古い（Instant Rollback）なら失敗／
 *       前回叩いたのに本番の版が動いていなければ stuck
 *   (b) 検査の読み方（summarizeGates・fetchGateRuns）: 出す範囲の run（skipped を除く）を見る。[automated] の skipped の run が
 *       後に来ても前の PR の失敗を素通しにしない。範囲の中に失敗が1本でもあれば red（後の run の成功では解かない）。
 *       走っている run があれば pending。範囲の外の run は見ない。範囲の一番古いコミットまで読み切れなければ red
 *   (c) 起動（createReleaseDispatchRun）: shadow は叩かない、live は Deploy Hook を POST、鍵・版・Hook が無い・HTTP 失敗は失敗、
 *       stuck は叩かずに失敗（巻き戻しと区別できない）、出した記録（released・fromSha・lastReleasedSha）を返す、比べる先は読んだ master の sha、
 *       拾い直し（UTC の分が30より前の起動）は前が「待つ」のときだけ動き、それ以外は前の記録を残す、出すべき差分が13時間残れば alerts
 *   (g) 本番の確かめの起動（releaseCheckDispatch.js）: live で Hook を叩いたら e2e-release.yml を出した master の先の sha で起こす。
 *       起こせなくても release は成功のまま、記録と alerts に残す。shadow は起こさない
 *   (d) 死活（monitor.js）: livenessStaleMin のある monitor のジョブは shadow・live の間だけ last_tick_at を見る
 *   (f) 範囲の赤を解く全件の検査（releaseFullCheck.js、verifyData/release-dispatch-scenes-3.js）: 全件の run が無ければ2本を起こして待つ・
 *       tip か S で success なら解く（S より後は push の run のまま）・base 違い等は認めない・走っていれば待つ・失敗なら止めて起こし直さない・
 *       shadow と stuck・Instant Rollback は起こさない・赤の無い範囲は全件の run の取得に左右されない
 *   (e) 配線: レジストリ、api/cron の maxDuration とモードのゲート、vercel.json の cron（定時と20分後の拾い直し）
 *
 * 使い方: node scripts/maintenance/verify-release-dispatch.js
 */
import fs from "node:fs";
import {
  COMPARE_FILES_CAP,
  RELEASE_GATE_WORKFLOWS,
  createReleaseDispatchRun,
  decideRelease,
} from "../lib/releaseDispatch.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";

import { cronWiring } from "./verifyData/cronWiring.js";
import {
  ctx,
  fakeGitHub,
  runReleaseDispatchScenes1,
  runWith,
} from "./verifyData/release-dispatch-scenes-1.js";
import {
  RELEASE_CHECK_TIMEOUT_MS,
  RELEASE_CHECK_WORKFLOW,
  dispatchReleaseCheck,
  releaseCheckTimeout,
} from "../lib/releaseCheckDispatch.js";
import { runReleaseDispatchScenes2 } from "./verifyData/release-dispatch-scenes-2.js";
import { runReleaseDispatchScenes3 } from "./verifyData/release-dispatch-scenes-3.js";

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
const MID = "c".repeat(40);
const NOW = new Date("2026-11-06T11:45:00+09:00");
const OLD_HEAD = { sha: HEAD, committedAt: "2026-11-06T10:00:00+09:00" };
const green = RELEASE_GATE_WORKFLOWS.map((workflow) => ({
  workflow,
  state: "green",
  headSha: HEAD,
}));
const ahead = (files, commitShas = [MID, HEAD]) => ({
  status: "ahead",
  files: files.map((f) => (typeof f === "string" ? { filename: f } : f)),
  commitShas,
});

// ---------------------------------------------------------------- (a)
{
  const base = {
    deployedSha: DEPLOYED,
    head: OLD_HEAD,
    gates: green,
    previous: null,
    now: NOW,
  };
  const d = (over) => decideRelease({ ...base, ...over });

  check(
    d({ compare: { status: "identical", files: [], commitShas: [] } })
      .action === "none",
    "(a) 本番が master の先と同じなら何もしない",
  );
  check(
    d({ compare: ahead(["docs/a.md", "data/analysis/x.json", "README.md"]) })
      .action === "none",
    "(a) サイトに関係ない差分（docs・data/analysis・ルートの .md）だけなら何もしない",
  );
  check(
    d({ compare: ahead([]) }).action === "none",
    "(a) ahead でも files が空（変更と戻しが打ち消し合った）なら何もしない",
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
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      head: { sha: HEAD, committedAt: "2026-11-06T11:40:00+09:00" },
    }).action === "deferred",
    "(a) master の先が10分以内のコミットなら待つ（検査の run がまだ無いことがある）",
  );
  {
    // 自動 docs 再生成が先。判定は、その下の最後の人の commit の時刻
    const bot = (sha, at, over = {}) => ({
      sha,
      committedAt: at,
      authorEmail: "action@github.com",
      committerEmail: "action@github.com",
      message: "chore: 機械生成の文書を再生成 [automated]",
      ...over,
    });
    const human = (sha, at, over = {}) => ({
      sha,
      committedAt: at,
      authorEmail: "x@example.com",
      committerEmail: "noreply@github.com",
      message: "fix: 何か (#1)",
      ...over,
    });
    const AUTO = "d".repeat(40);
    const withCommits = (commits, headAt) => ({
      compare: {
        ...ahead(
          ["src/App.jsx"],
          commits.map((c) => c.sha),
        ),
        commits,
      },
      head: { sha: commits[commits.length - 1].sha, committedAt: headAt },
    });
    const FRESH_AT = "2026-11-06T11:44:00+09:00";
    const OLD_AT = "2026-11-06T11:30:00+09:00";
    check(
      d(withCommits([human(MID, OLD_AT), bot(AUTO, FRESH_AT)], FRESH_AT))
        .action === "release",
      "(a) 先が自動 commit で新しくても、下の人の commit が10分以上前なら出す",
    );
    check(
      d(withCommits([human(MID, FRESH_AT), bot(AUTO, FRESH_AT)], FRESH_AT))
        .action === "deferred",
      "(a) 先が自動 commit でも、下の人の commit が10分未満なら待つ（FRESH の目的は弱めない）",
    );
    check(
      d(withCommits([bot(MID, OLD_AT), human(AUTO, FRESH_AT)], FRESH_AT))
        .action === "deferred",
      "(a) 自動でない commit が先で新しければ待つ",
    );
    check(
      d(
        withCommits(
          [
            human(MID, OLD_AT),
            human(AUTO, FRESH_AT, { message: "fix: 偽 [automated]" }),
          ],
          FRESH_AT,
        ),
      ).action === "deferred",
      "(a) 題だけ [automated] の人の commit（committer・author が違う）は除かない",
    );
    check(
      d(
        withCommits(
          [
            human(MID, OLD_AT),
            human(AUTO, FRESH_AT, {
              authorEmail: "action@github.com",
              message: "fix: 偽 [automated]",
            }),
          ],
          FRESH_AT,
        ),
      ).action === "deferred",
      "(a) author だけ偽っても（committer が違う）除かない",
    );
    check(
      d(withCommits([bot(MID, FRESH_AT), bot(AUTO, FRESH_AT)], FRESH_AT))
        .action === "deferred",
      "(a) 範囲が全部自動なら先の時刻で判定する（今までどおり）",
    );
  }
  const blocked = d({
    compare: ahead(["src/App.jsx"]),
    gates: [
      {
        workflow: "post-merge-checks.yml",
        state: "red",
        conclusion: "failure",
        headSha: MID,
      },
      { workflow: "quality-gates.yml", state: "green", headSha: HEAD },
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
        { workflow: "post-merge-checks.yml", state: "pending", headSha: HEAD },
        { workflow: "quality-gates.yml", state: "none" },
      ],
    }).action === "deferred",
    "(a) 検査が走っていれば待つ。範囲に run が無い検査では止めない",
  );
  check(
    d({ compare: { status: "diverged", files: [], commitShas: [] } }).action ===
      "error" &&
      d({ compare: { status: "behind", files: [], commitShas: [] } }).action ===
        "error",
    "(a) 本番の版が master の祖先でない（diverged・behind）なら失敗",
  );
  const rolled = d({
    compare: ahead(["src/App.jsx"]),
    previous: { released: false, fromSha: MID, lastReleasedSha: MID },
  });
  check(
    rolled.action === "error" && rolled.reason.includes("Instant Rollback"),
    "(a) 本番の版が前に出した版より古い（前に出した版が出す範囲に入っている）なら出さずに失敗",
    JSON.stringify(rolled),
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      previous: { released: false, fromSha: MID, lastReleasedSha: DEPLOYED },
    }).action === "release",
    "(a) 前に出した版が本番そのもの（範囲の外）なら巻き戻しと見ない",
  );
  check(
    d({
      compare: ahead(["src/App.jsx"]),
      previous: { released: true, fromSha: DEPLOYED, lastReleasedSha: HEAD },
    }).stuck === true &&
      d({
        compare: ahead(["src/App.jsx"]),
        previous: { released: true, fromSha: MID },
      }).stuck === false &&
      d({
        compare: ahead(["src/App.jsx"]),
        previous: { released: false, fromSha: DEPLOYED },
      }).stuck === false,
    "(a) 前回叩いて本番の版がそのときのままなら stuck（巻き戻しより先に判定）。版が動いた・前回叩いていないなら stuck でない",
  );
}

// ---- 後半の場面（verifyData/release-dispatch-scenes-1〜3.js） ----
await runReleaseDispatchScenes1({ check, DEPLOYED, HEAD, MID, NOW, OLD_HEAD });
await runReleaseDispatchScenes2({ check, DEPLOYED, HEAD, MID, NOW });
// 範囲の赤を解く全件の検査（releaseFullCheck.js）
await runReleaseDispatchScenes3({ check, DEPLOYED, HEAD, MID, NOW, OLD_HEAD });

// ---------------------------------------------------------------- (g)
{
  const startUrl =
    `/actions/workflows/${RELEASE_CHECK_WORKFLOW}/dis` + "patches";
  const okF = fakeGitHub();
  const ok = await runWith(okF, ctx("live"));
  const call = okF.calls.find((c) => c.url.endsWith(startUrl));
  check(
    ok.report?.released === true &&
      call?.init.method === "POST" &&
      same(JSON.parse(call.init.body), {
        ref: "master",
        inputs: { sha: HEAD },
      }) &&
      call.init.signal instanceof AbortSignal &&
      ok.report.releaseCheck?.dispatched === true &&
      ok.report.alerts.length === 0,
    "(g) live: Hook の後に e2e-release.yml を ref master・inputs.sha＝読んだ master の先で起こし、時間を切る",
    JSON.stringify(ok.report?.releaseCheck),
  );
  const base = fakeGitHub();
  const failF = async (url, init) =>
    url.endsWith(startUrl)
      ? { ok: false, status: 500, text: async () => "boom" }
      : base(url, init);
  const failed = await runWith(failF, ctx("live"));
  check(
    failed.outcome !== "error" &&
      failed.report?.released === true &&
      failed.report.releaseCheck?.dispatched === false &&
      failed.report.releaseCheck.error.includes("HTTP 500") &&
      failed.report.alerts.some((a) => a.key === "release_check_dispatch"),
    "(g) 起こせなくても release は成功のまま、releaseCheck と alerts に残す",
    JSON.stringify(failed),
  );
  const shadowF = fakeGitHub();
  const shadow = await runWith(shadowF, ctx("shadow"));
  check(
    shadow.report?.wouldRelease === true &&
      !shadowF.calls.some((c) => c.url.endsWith(startUrl)),
    "(g) shadow は確かめを起こさない",
    JSON.stringify(shadowF.calls.map((c) => c.url)),
  );
  check(
    releaseCheckTimeout(1000, 1000) === RELEASE_CHECK_TIMEOUT_MS &&
      releaseCheckTimeout(0, 45 * 1000) === 7 * 1000 &&
      releaseCheckTimeout(undefined) === RELEASE_CHECK_TIMEOUT_MS,
    "(g) 起こす待ちは15秒までで、関数の60秒から8秒の余白と使った時間を引いた分まで",
  );
  const late = await dispatchReleaseCheck({
    fetchImpl: async () => {
      throw new Error("呼ばれないはず");
    },
    token: "t",
    sha: HEAD,
    startedAt: Date.now() - 55 * 1000,
  });
  check(
    late.dispatched === false && late.error.includes("残りが少ない"),
    "(g) 残りが2秒より少なければ起こさず、理由を残す",
    JSON.stringify(late),
  );
}

// ---------------------------------------------------------------- (e)
{
  const def = SCRAPE_JOBS.release_dispatch;
  check(
    def?.kind === "monitor" &&
      def?.failureAlertAfter === 1 &&
      def?.livenessStaleMin === 13 * 60 &&
      validateRegistry().length === 0,
    "(e) レジストリ: release_dispatch は monitor・failureAlertAfter 1・livenessStaleMin 13時間",
    JSON.stringify(def),
  );
  // api の本文の字は読まず、export（config）と、共通ラッパへ渡した引数で見る。
  // run は毎回作る関数なので、createReleaseDispatchRun() が作る物と同じ関数か（同じ本文か）で見る
  const api = await cronWiring(
    () => import("../../api/cron/release-dispatch.js"),
  );
  const opts = api.made[0]?.options;
  check(
    api.config?.maxDuration === def?.maxDurationSec &&
      api.made.length === 1 &&
      opts.modeGated === true &&
      opts.job === "release_dispatch" &&
      String(opts.run) === String(createReleaseDispatchRun()) &&
      api.handler === api.made[0].handler,
    "(e) api/cron/release-dispatch.js: maxDuration がレジストリと一致し、job 名 release_dispatch・createReleaseDispatchRun() の run で登録し、モードのゲートを掛ける",
    JSON.stringify([api.config, opts?.job, opts?.modeGated]),
  );
  const vercel = JSON.parse(
    fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  const crons = vercel.crons
    .filter((c) => c.path.startsWith("/api/cron/release-dispatch"))
    .map((c) => [c.path, c.schedule]);
  check(
    same(crons, [
      ["/api/cron/release-dispatch", "45 2,8,20 * * *"],
      ["/api/cron/release-dispatch", "5 3,9,21 * * *"],
    ]),
    "(e) vercel.json: 定時 UTC 02:45・08:45・20:45（JST 11:45・17:45・05:45）と、20分後の拾い直し",
    JSON.stringify(crons),
  );
  // master の push ごとの本番デプロイを止める（ADR-0106 の PR 2）。本番を出すのは上の定時の Deploy Hook だけになる
  check(
    vercel.git?.deploymentEnabled?.master === false,
    "(e) vercel.json: git.deploymentEnabled.master が false（push ごとに本番を出さない）",
    JSON.stringify(vercel.git?.deploymentEnabled),
  );
}

if (failures > 0) {
  console.error(`\nverify-release-dispatch: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-release-dispatch: すべて通った");
