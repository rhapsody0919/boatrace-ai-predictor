#!/usr/bin/env node
/**
 * verify-job-watch.js - 定期の job の見張り（.github/workflows/job-watch.yml・key-canary.yml・scripts/watch/job-watch.json・
 * scripts/lib/jobWatch.js、ADR-0097 の追記「定期の job の見張り」）の検証。
 *
 * 確認する観点:
 *   1. 失敗のログの分類（鍵・設定／外部の 403・429・503／一時的／その他）
 *   2. 1本の失敗の扱い（rerun は許可の一覧・1回目・同じ日・後の run が無いときだけ）と、鍵が直った後の追い上げ
 *   3. Issue の印（同じ run を2回書かない）
 *   4. 登録の漏れ: Environment prod-jobs・ryujin-bot を使う workflow は全部見張りの一覧にあり、job-watch.yml の workflows に名前で並ぶ
 *   5. 許可の一覧: 見張りの一覧の中だけ。送信・master への push・db-apply・審査・10分ごとの job は入れない
 *   6. 配線: actions: write は rerun の job だけ、run に ${{ }} を書かない、action は SHA で固定、資格情報を残さない
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyLog,
  decideRun,
  handledMarkers,
  jstDate,
  recoveryReruns,
  runMarker,
} from "../lib/jobWatch.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WF = path.join(ROOT, ".github/workflows");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 1. 分類
{
  const cases = [
    ["エラー: レース結果取得エラー: Invalid API key", "config"],
    ["::error::Supabase が HTTP 401 を返した（Invalid API key）", "config"],
    [
      "::error::SUPABASE_URL か SUPABASE_SERVICE_KEY が無い（Environment prod-jobs の secret 未設定）",
      "config",
    ],
    ["HttpError: Bad credentials", "config"],
    ["Error: 403 Forbidden (api.github.com)", "config"],
    ["error: permission denied for table races", "config"],
    [
      "fetch https://www.boatrace.jp/owpc/pc/race/... failed: 403",
      "external-block",
    ],
    ["boatrace.jp から 429 が返った。取得を止める", "external-block"],
    ["::error::Supabase が HTTP 503 を返した", "transient"],
    ["Error: read ECONNRESET", "transient"],
    ["TypeError: fetch failed", "transient"],
    [
      "The job running on runner GitHub Actions 3 has exceeded the maximum execution time of 15 minutes.",
      "transient",
    ],
    ["Supabase の取得で 502 Bad Gateway", "transient"],
    // 数字も相手も無い「Service Unavailable」は、公式サイトかもしれないので rerun しない（ADR-0067）
    ["Error: Service Unavailable", "other"],
    ["TypeError: Cannot read properties of undefined (reading 'map')", "other"],
    ["", "other"],
  ];
  for (const [text, want] of cases) {
    check(
      `分類: ${want} ← ${text.slice(0, 50)}`,
      classifyLog(text) === want,
      classifyLog(text),
    );
  }
}

// 2. 1本の失敗の扱い
const NOW = new Date("2026-10-20T03:00:00Z"); // JST 12:00
const allow = new Set([".github/workflows/update-outcome-distribution.yml"]);
const run = (o = {}) => ({
  id: 1,
  path: ".github/workflows/update-outcome-distribution.yml",
  attempt: 1,
  createdAt: "2026-10-19T15:30:00Z", // JST 10/20 00:30
  category: "transient",
  newerRun: false,
  ...o,
});
{
  const ctx = { rerunAllowed: allow, now: NOW };
  check(
    "一時的・許可・1回目・同じ日なら rerun",
    decideRun(run(), ctx).action === "rerun",
  );
  check(
    "許可の一覧に無ければ rerun しない",
    decideRun(run({ path: ".github/workflows/campaign-pipeline.yml" }), ctx)
      .action === "failure-issue",
  );
  check(
    "2回目の失敗は rerun しない（ループを防ぐ）",
    decideRun(run({ attempt: 2 }), ctx).action === "failure-issue",
  );
  check(
    "日をまたいだら rerun しない（日付を実行時に決める job）",
    decideRun(run({ createdAt: "2026-10-19T14:59:00Z" }), ctx).action ===
      "failure-issue",
  );
  check(
    "後の run が成功済み・動いていれば rerun しない（重ならない）",
    decideRun(run({ newerRun: true }), ctx).action === "failure-issue",
  );
  check(
    "鍵・設定の誤りは rerun せず鍵の Issue へ",
    decideRun(run({ category: "config" }), ctx).action === "key-issue",
  );
  check(
    "外部の 403・429・503 は rerun しない（ADR-0067）",
    decideRun(run({ category: "external-block" }), ctx).action ===
      "failure-issue",
  );
  check(
    "その他は rerun しない",
    decideRun(run({ category: "other" }), ctx).action === "failure-issue",
  );
  check(
    "JST の日付",
    jstDate("2026-10-19T15:00:00Z") === "2026-10-20" &&
      jstDate("2026-10-19T14:59:59Z") === "2026-10-19",
  );
  const rec = recoveryReruns(
    [
      run({ id: 1, category: "config" }),
      run({ id: 2, category: "transient" }),
      run({ id: 3, category: "config", attempt: 2 }),
      run({ id: 4, category: "config", path: "x" }),
    ],
    ctx,
  );
  check(
    "鍵が直った後の追い上げは、鍵の誤り・許可・1回目・同じ日のものだけ",
    JSON.stringify(rec.map((r) => r.id)) === "[1]",
    JSON.stringify(rec.map((r) => r.id)),
  );
}

// 3. 印
{
  const m = runMarker(123, 1, "key");
  check("印の形", m === "<!-- job-watch:key:123:1 -->");
  const got = handledMarkers([
    `本文\n${m}`,
    "x <!-- job-watch:rerun:9:2 --> y",
    null,
  ]);
  check(
    "Issue の本文とコメントから印を集める",
    got.has(m) && got.has("<!-- job-watch:rerun:9:2 -->") && got.size === 2,
  );
}

// 4・5. 登録と許可の一覧
const config = JSON.parse(
  readFileSync(path.join(ROOT, "scripts/watch/job-watch.json"), "utf8"),
);
const yml = (f) => readFileSync(path.join(ROOT, f), "utf8");
const nameOf = (f) =>
  /^name:\s*(.+)$/m
    .exec(yml(f))?.[1]
    .trim()
    .replace(/^["']|["']$/g, "");
{
  const uses = readdirSync(WF)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `.github/workflows/${f}`)
    .filter((f) =>
      /^\s+environment:\s*(?:prod-jobs|ryujin-bot)\s*$|^\s+name:\s*(?:prod-jobs|ryujin-bot)\s*$/m.test(
        yml(f),
      ),
    );
  const expected = [...uses, ".github/workflows/key-canary.yml"].sort();
  const watched = [...config.watched].sort();
  check(
    "prod-jobs・ryujin-bot を使う workflow は全部見張りの一覧にある（漏れも余りも無い）",
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
    "review.yml", // 審査
    "campaign-pipeline.yml", // 送信
    "collect-racer-news.yml", // master への push
    "e2e-live.yml", // 本番への通信の検査
    "post-merge-checks.yml", // push の検査
    "update-sitemap.yml", // master への push と deploy
    "scrape-scheduled.yml", // 10分ごと（次の定期実行で戻る。concurrency の待ちを奪う）
    "key-canary.yml", // 30分ごと
  ];
  check(
    "許可の一覧に、送信・push・db-apply・審査・頻繁な job を入れない",
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

// 6. 配線
{
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
  const js = readFileSync(path.join(ROOT, "scripts/watch/job-watch.js"), "utf8");
  check(
    "見回りは push で動く見張りの対象（Post-merge Checks 等）も数える",
    /r\.event === "push"/.test(js) && /github\.event\.workflow_run\.event == 'push'/.test(jobs.scan),
  );
  check("見回りは master の run だけを一覧で取る（PR の CI を取らない）", /actions\/runs\?branch=master&created=/.test(js));
  check("既に書いた run のログは読み直さない", /if \(alreadyNoted\) \{[\s\S]{0,400}?continue;\s*\}\s*const category = classifyLog/.test(js));
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

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
