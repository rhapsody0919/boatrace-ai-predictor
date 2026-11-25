/**
 * verify-job-watch.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-job-watch.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  classifyLog,
  decideRun,
  secretsOutsideCanary,
} from "../../lib/jobWatch.js";

let check, config, yml, nameOf, WORKFLOW_FILES;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const jw = yml(".github/workflows/job-watch.yml").replace(/^\s*#.*\n/gm, "");
  const jobs = Object.fromEntries(
    [
      ...jw
        .slice(jw.indexOf("\njobs:\n"))
        .matchAll(
          /^ {2}([a-z-]+):\n([\s\S]*?)(?=^ {2}[a-z-]+:\n|(?![\s\S]))/gm,
        ),
    ].map((m) => [m[1], m[2]]),
  );
  check(
    "job は scan と rerun",
    JSON.stringify(Object.keys(jobs)) === '["scan","rerun"]',
  );
  check("workflow の permissions は空", /^permissions: \{\}$/m.test(jw));
  check(
    "actions: write は rerun の job だけ",
    /actions: write/.test(jobs.rerun) && !/actions: write/.test(jobs.scan),
  );
  check(
    "scan は actions: read・issues: write",
    /actions: read/.test(jobs.scan) && /issues: write/.test(jobs.scan),
  );
  check(
    "workflow_run は master だけ",
    /workflow_run:\n {4}types: \[completed\]\n {4}branches: \[master\]/.test(
      jw,
    ),
  );
  // 起動を絞る（docs/design/ci-minutes-reduction/design.md 4.2 D）
  check(
    "scan は見張る run が成功以外のときと、カナリア（path で判定）の成功のときだけ起きる",
    /github\.event\.workflow_run\.conclusion != 'success' \|\|\s+github\.event\.workflow_run\.path == '\.github\/workflows\/key-canary\.yml'/.test(
      jobs.scan,
    ),
  );
  // カナリアの path（job-watch.js の CANARY_PATH）は verifyData/job-watch-scan.js が export で見る
  check(
    "毎時の schedule があり、scan は schedule でも起きる",
    /^ {2}schedule:\n {4}- cron: '(?!0 )\d{1,2} \* \* \* \*'$/m.test(jw) &&
      /github\.event_name == 'schedule'/.test(jobs.scan),
  );
  check(
    "schedule は workflow_dispatch の後（workflows: の一覧の切り出しを壊さない）",
    jw.indexOf("workflows:") < jw.indexOf("workflow_dispatch:") &&
      jw.indexOf("workflow_dispatch:") < jw.indexOf("\n  schedule:"),
  );
  check(
    "concurrency は scan の job にあり、workflow の単位に無い。skip になる起動は自分だけの group（待ちの scan を置き換えない）",
    !/^concurrency:/m.test(jw) &&
      /^ {4}concurrency:\n {6}group: >-\n[\s\S]*?format\('job-watch-skip-\{0\}', github\.run_id\) \|\| 'job-watch' \}\}\n {6}cancel-in-progress: false$/m.test(
        jobs.scan,
      ) &&
      !/concurrency:/.test(jobs.rerun),
  );
  // scan の側（push の run も数える・閉じた Issue の印も数える）は verifyData/job-watch-scan.js が偽の GitHub で回して見る
  check(
    "job-watch.yml: scan は push で動く見張りの対象（Post-merge Checks 等）の run でも起きる",
    /github\.event\.workflow_run\.event == 'push'/.test(jobs.scan),
  );
  return { jobs };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ jobs }) {
  // master の run だけを取る・既に書いた run の job を読み直さないは verifyData/job-watch-scan.js
  check(
    "同じリポジトリの run だけ",
    /workflow_run\.head_repository\.full_name == github\.repository/.test(
      jobs.scan,
    ),
  );
  for (const f of [
    ".github/workflows/job-watch.yml",
    ".github/workflows/key-canary.yml",
  ]) {
    const t = yml(f).replace(/^\s*#.*\n/gm, "");
    const runBlocks = [
      ...t.matchAll(
        /^( +)run: ([\s\S]*?)(?=^\1(?:- |[a-z-]+:)|^ {0,4}[a-z-]+:|(?![\s\S]))/gm,
      ),
    ].map((m) => m[2]);
    check(
      `${f}: run に \${{ }} を書かない`,
      runBlocks.length > 0 && runBlocks.every((r) => !r.includes("${{")),
    );
    check(
      `${f}: action は SHA で固定`,
      [...t.matchAll(/uses: (\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])),
    );
    check(
      `${f}: checkout に資格情報を残さない`,
      (t.match(/uses: actions\/checkout/g) ?? []).length ===
        (t.match(/persist-credentials: false/g) ?? []).length,
    );
  }
  const canary = yml(".github/workflows/key-canary.yml");
  check(
    "カナリアは prod-jobs と ryujin-bot の両方で読む",
    /environment: prod-jobs/.test(canary) &&
      /environment: ryujin-bot/.test(canary),
  );
  check(
    "カナリアは書き込み・送信をしない（GET の読み取りと Linear の viewer だけ）",
    !/-X (POST|PATCH|DELETE|PUT)|SLACK_WEBHOOK_URL|VERCEL_DEPLOY_HOOK/.test(
      canary,
    ),
  );
  check(
    "カナリアの 401 は鍵の誤りに分類される",
    classifyLog("::error::Supabase が HTTP 401 を返した（Invalid API key）") ===
      "config",
  );
}

function scene3() {
  {
    const uses = WORKFLOW_FILES.filter((f) => /\.ya?ml$/.test(f))
      .map((f) => `.github/workflows/${f}`)
      .filter((f) =>
        /^\s+environment:\s*(?:prod-jobs|ryujin-bot|ryujin-maker)\s*$|^\s+name:\s*(?:prod-jobs|ryujin-bot|ryujin-maker)\s*$/m.test(
          yml(f),
        ),
      );
    // 鍵を使わないが、master での失敗を知らせたい workflow（理由つき）。今は Quality Gates だけ
    // （docs/design/codex-direct-pr/design.md §5.4。範囲A の自動マージの後の検査）
    const extra = config.watchedExtra ?? [];
    check(
      "watchedExtra の各行に path と理由がある",
      extra.every(
        (e) =>
          typeof e.path === "string" &&
          typeof e.reason === "string" &&
          e.reason.length > 0,
      ),
    );
    const expected = [
      ...uses,
      ".github/workflows/key-canary.yml",
      ...extra.map((e) => e.path),
    ].sort();
    const watched = [...config.watched].sort();
    check(
      "prod-jobs・ryujin-bot・ryujin-maker を使う workflow は全部見張りの一覧にある（漏れも余りも無い）",
      JSON.stringify(watched) === JSON.stringify([...new Set(expected)]),
      `一覧に無い: ${expected.filter((f) => !watched.includes(f)).join(", ")} / 余分: ${watched.filter((f) => !expected.includes(f)).join(", ")}`,
    );
    check(
      "見張り自身は見張りの一覧に無い（ループを防ぐ）",
      !config.watched.includes(".github/workflows/job-watch.yml"),
    );
    const jw = yml(".github/workflows/job-watch.yml");
    const listed = [
      ...jw
        .slice(jw.indexOf("workflows:"), jw.indexOf("workflow_dispatch:"))
        .matchAll(/^ {6}- (.+)$/gm),
    ]
      .map((m) => m[1].trim())
      .sort();
    const names = config.watched.map(nameOf).sort();
    check(
      "job-watch.yml の workflows は、見張りの一覧の workflow の名前と一致する",
      JSON.stringify(listed) === JSON.stringify(names),
      `yml に無い: ${names.filter((n) => !listed.includes(n)).join(", ")} / 余分: ${listed.filter((n) => !names.includes(n)).join(", ")}`,
    );
    check("試運転の印 dryRun は真偽", typeof config.dryRun === "boolean");
    check(
      "許可の一覧は見張りの一覧の中だけ",
      config.rerunAllowed.every((f) => config.watched.includes(f)),
    );
    const forbidden = [
      "db-apply.yml", // 本番 DB の適用（ADR-0097、失敗したら止める）
      "campaign-pipeline.yml", // 送信
      "collect-racer-news.yml", // master への push
      "e2e-live.yml", // 本番への通信の検査
      "post-merge-checks.yml", // push の検査
      "update-sitemap.yml", // master への push と deploy
      "scrape-scheduled.yml", // 10分ごと（次の定期実行で戻る。concurrency の待ちを奪う）
      "key-canary.yml", // 30分ごと
    ];
    check(
      "許可の一覧に、送信・push・db-apply・頻繁な job を入れない",
      !config.rerunAllowed.some((f) =>
        forbidden.some((x) => f.endsWith(`/${x}`)),
      ),
      config.rerunAllowed
        .filter((f) => forbidden.some((x) => f.endsWith(`/${x}`)))
        .join(", "),
    );
    const pushers = config.rerunAllowed.filter((f) =>
      /environment:\s*ryujin-bot/.test(yml(f)),
    );
    check(
      "許可の一覧に、master へ push する（ryujin-bot を使う）workflow を入れない",
      pushers.length === 0,
      pushers.join(", "),
    );
  }
  {
    const s1 = scene1();
    scene2(s1);
  }
}

/** カナリアが見ない鍵（GOOGLE_SERVICE_ACCOUNT_KEY 等）の誤りは、カナリアが緑でも直ったと言えない（2026-11-25） */
function sceneUncoveredKeys() {
  const wf = ".github/workflows/update-outcome-distribution.yml";
  const ctx = {
    rerunAllowed: new Set([wf]),
    now: new Date("2026-10-20T03:00:00Z"),
  };
  const run = (o) => ({
    id: 1,
    path: wf,
    attempt: 1,
    createdAt: "2026-10-19T15:30:00Z",
    category: "config",
    newerRun: false,
    ...o,
  });
  const outside = { outsideCanary: ["GOOGLE_SERVICE_ACCOUNT_KEY"] };
  check(
    "カナリアが見ない鍵の誤りは、カナリアが緑でも緑でなくても key-issue-uncovered（失敗の Issue に逃がさない）",
    decideRun(run(outside), { ...ctx, canaryOkAfter: true }).action ===
      "key-issue-uncovered" &&
      decideRun(run(outside), { ...ctx, canaryOkAfter: false }).action ===
        "key-issue-uncovered",
  );
  check(
    "範囲外の鍵が空なら従来どおり（カナリアが緑なら failure-issue・緑でなければ key-issue）",
    decideRun(run({ outsideCanary: [] }), { ...ctx, canaryOkAfter: true })
      .action === "failure-issue" &&
      decideRun(run({ outsideCanary: [] }), ctx).action === "key-issue",
  );
  check(
    "範囲外の鍵があっても、config 以外の分類は変えない（一時的な失敗は rerun）",
    decideRun(run({ category: "transient", outsideCanary: ["X"] }), ctx)
      .action === "rerun",
  );
  const canary = yml(".github/workflows/key-canary.yml");
  const gsc = secretsOutsideCanary(
    yml(".github/workflows/growth-gsc-daily.yml"),
    canary,
  );
  check(
    "secretsOutsideCanary: growth-gsc-daily.yml は GSC の2つの鍵がカナリアの範囲外（SUPABASE_* は含まない）",
    gsc.includes("GOOGLE_SERVICE_ACCOUNT_KEY") &&
      gsc.includes("SEARCH_CONSOLE_SITE_URL") &&
      !gsc.some((n) => n.startsWith("SUPABASE_")),
    gsc.join(","),
  );
  const two = (i) =>
    `jobs:\n${i}gate:\n${i}  s: \${{ secrets.SLACK_WEBHOOK_URL }}\n${i}collect:\n${i}  k: \${{ secrets.GOOGLE_SERVICE_ACCOUNT_KEY }}\n`;
  check(
    "secretsOutsideCanary: 失敗した job の段だけで数える（gate の SLACK_WEBHOOK_URL は数えない）",
    secretsOutsideCanary(two("  "), canary, ["collect"]).join(",") ===
      "GOOGLE_SERVICE_ACCOUNT_KEY" &&
      secretsOutsideCanary(
        yml(".github/workflows/growth-gsc-daily.yml"),
        canary,
        ["gate"],
      ).length === 0,
  );
  check(
    "secretsOutsideCanary: 字下げが崩れて段が読めない YAML は、workflow の全体で数える（閉じない側に倒す）",
    secretsOutsideCanary(two(" "), canary, ["collect"]).join(",") ===
      "GOOGLE_SERVICE_ACCOUNT_KEY,SLACK_WEBHOOK_URL",
  );
  check(
    "secretsOutsideCanary: カナリア自身は空",
    secretsOutsideCanary(canary, canary).length === 0,
  );
  check(
    "secretsOutsideCanary: GITHUB_TOKEN・コメントの中の書き方は数えない",
    secretsOutsideCanary(
      "# ${{ secrets.COMMENTED }}\nenv:\n  T: ${{ secrets.GITHUB_TOKEN }}\n  K: ${{secrets.REAL_KEY}}\n",
      "env:\n  S: ${{ secrets.SUPABASE_URL }}\n",
    ).join(",") === "REAL_KEY",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・config・yml・nameOf・WORKFLOW_FILES） */
export function runJobWatchScenes1(env) {
  ({ check, config, yml, nameOf, WORKFLOW_FILES } = env);
  scene3();
  sceneUncoveredKeys();
}
