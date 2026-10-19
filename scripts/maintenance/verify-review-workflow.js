#!/usr/bin/env node
/**
 * verify-review-workflow.js - AI の PR の審査（.github/workflows/review.yml・scripts/review/*・scripts/lib/reviewPr.js、
 * ADR-0097 段取り E）の検証。
 *
 * 確認する観点:
 *   1. 審査の相手（claude/ は OpenAI、codex/ は Anthropic、他は審査しない）
 *   2. 機械で落とす形（symlink・submodule・LFS・バイナリ・.gitattributes・件数と大きさの上限・木の切り捨て）
 *   3. SQL の PR で材料に渡す表の名前（識別子の形だけ、上限つき）
 *   4. LLM の答えの検査（JSON でない・形が違う・P0 の数え方）
 *   5. 承認の判定（head が進んだら何もしない、関門・審査の失敗・P0 では承認しない、P0 が0件なら承認）
 *   6. 配線（pull_request_target の types、作者の user.id・同じリポジトリ・base master、head を checkout しない、
 *      persist-credentials: false、npm ci・cache なし、run に ${{ }} を書かない、action は SHA で固定、
 *      鍵は決めた job だけ、Environment pr-review・db-readonly を使うのは review.yml だけ）
 *   7. e2e の集約の job は always() で走り、組の結果が success 以外なら落とす（skipped の必須 check は通過扱いになるため）
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideAction,
  LIMITS,
  mechanicalRejections,
  parseVerdict,
  sqlTablesFromFiles,
  vendorForBranch,
} from "../lib/reviewPr.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 1. 審査の相手
check(
  "claude/ は OpenAI",
  vendorForBranch("claude/identity-e-review") === "openai",
);
check("codex/ は Anthropic", vendorForBranch("codex/x") === "anthropic");
check(
  "他の接頭辞は審査しない",
  vendorForBranch("feature/x") === null &&
    vendorForBranch("claudex/x") === null,
);
check("ブランチ名が無ければ審査しない", vendorForBranch(undefined) === null);

// 2. 機械で落とす形
{
  const file = (filename, extra = {}) => ({
    filename,
    status: "modified",
    patch: "@@ -1 +1 @@\n-a\n+b",
    changes: 2,
    ...extra,
  });
  const modes = (...names) => new Map(names.map((n) => [n, "100644"]));
  check(
    "普通の差分は通る",
    mechanicalRejections([file("src/a.js")], modes("src/a.js"), false)
      .length === 0,
  );
  const cases = {
    差分が無い: [[], modes(), false],
    件数の上限: [
      Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => file(`f${i}.js`)),
      modes(
        ...Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => `f${i}.js`),
      ),
      false,
    ],
    差分の大きさの上限: [
      [file("a.js", { patch: "x".repeat(LIMITS.maxPatchChars + 1) })],
      modes("a.js"),
      false,
    ],
    木が切られた: [[file("a.js")], modes("a.js"), true],
    ".gitattributes": [
      [file("docs/.gitattributes")],
      modes("docs/.gitattributes"),
      false,
    ],
    ".gitattributes への改名": [
      [file("x", { status: "renamed", previous_filename: ".gitattributes" })],
      modes("x"),
      false,
    ],
    ".gitmodules": [[file(".gitmodules")], modes(".gitmodules"), false],
    "バイナリ（patch が無い）": [
      [file("img.png", { patch: undefined })],
      modes("img.png"),
      false,
    ],
    "LFS のポインタ": [
      [
        file("big.bin", {
          patch: "+version https://git-lfs.github.com/spec/v1",
        }),
      ],
      modes("big.bin"),
      false,
    ],
    シンボリックリンク: [[file("link")], new Map([["link", "120000"]]), false],
    submodule: [[file("vendor/x")], new Map([["vendor/x", "160000"]]), false],
    "head の木に無い": [[file("ghost.js")], modes(), false],
  };
  for (const [name, args] of Object.entries(cases)) {
    check(
      `落とす: ${name}`,
      mechanicalRejections(...args).length > 0,
      JSON.stringify(mechanicalRejections(...args)),
    );
  }
  check(
    "消したファイルは木に無くてよい",
    mechanicalRejections(
      [file("old.js", { status: "removed" })],
      modes(),
      false,
    ).length === 0,
  );
}

// 3. 材料に渡す表の名前
{
  const sql = (filename, patch, status = "added") => ({
    filename,
    status,
    patch,
    changes: 1,
  });
  const tables = sqlTablesFromFiles([
    sql(
      "docs/db-migration/170_x.sql",
      '@@ -0,0 +1,4 @@\n+CREATE TABLE IF NOT EXISTS public.new_t (id int);\n+ALTER TABLE races ADD COLUMN memo text;\n+DELETE FROM "Weird""Name" WHERE true;\n+-- DROP TABLE secret_t;',
    ),
    sql("src/a.js", "+CREATE TABLE not_sql (id int);"),
    sql("docs/db-migration/169_old.sql", "-DROP TABLE removed_t;", "removed"),
  ]);
  check(
    "SQL の + の行から表の名前を取る",
    JSON.stringify(tables) === JSON.stringify(["new_t", "races"]),
    JSON.stringify(tables),
  );
  const many = sqlTablesFromFiles([
    sql(
      "docs/db-migration/171_y.sql",
      Array.from({ length: 30 }, (_, i) => `+CREATE TABLE t${i} (a int);`).join(
        "\n",
      ),
    ),
  ]);
  check("表の数に上限がある", many.length === LIMITS.maxTables);
}

// 4. LLM の答え
{
  check(
    "JSON でなければ ok=false",
    parseVerdict("承認してください").ok === false,
  );
  check(
    "findings が無ければ ok=false",
    parseVerdict('{"approve": true}').ok === false,
  );
  check(
    "重大度が決まった値でなければ ok=false",
    parseVerdict(
      '{"findings":[{"severity":"P9","file":"a","line":1,"summary":"x"}]}',
    ).ok === false,
  );
  check(
    "行が整数でなければ ok=false",
    parseVerdict(
      '{"findings":[{"severity":"P1","file":"a","line":"1","summary":"x"}]}',
    ).ok === false,
  );
  const v = parseVerdict(
    '```json\n{"findings":[{"severity":"P0","file":"a.js","line":3,"summary":"鍵を外へ送る"},{"severity":"P2","file":"b.js","line":1,"summary":"x"}]}\n```',
  );
  check(
    "コードの囲みを外して読み、P0 を数える",
    v.ok && v.p0 === 1 && v.findings.length === 2,
    JSON.stringify(v),
  );
  check("指摘が無ければ P0 は0", parseVerdict('{"findings":[]}').p0 === 0);
  const long = parseVerdict(
    JSON.stringify({
      findings: [
        { severity: "P3", file: "a", line: 1, summary: "x".repeat(5000) },
      ],
    }),
  );
  check(
    "長い指摘は切る",
    long.findings[0].summary.length === LIMITS.maxFindingChars,
  );
}

// 5. 承認の判定
{
  const sha = "a".repeat(40);
  const ok = parseVerdict(
    '{"findings":[{"severity":"P1","file":"a.js","line":1,"summary":"x"}]}',
  );
  const base = {
    gateOk: true,
    gateReason: "",
    llmResult: "success",
    verdict: ok,
    reviewedSha: sha,
    currentHeadSha: sha,
  };
  check("P0 が0件なら承認", decideAction(base).event === "APPROVE");
  check(
    "head が進んだら何もしない",
    decideAction({ ...base, currentHeadSha: "b".repeat(40) }).event === "NONE",
  );
  check(
    "関門で止めたら承認しない",
    decideAction({ ...base, gateOk: false, gateReason: "symlink" }).event ===
      "COMMENT",
  );
  check(
    "審査が失敗したら承認しない",
    decideAction({ ...base, llmResult: "failure" }).event === "COMMENT",
  );
  check(
    "審査が skipped なら承認しない",
    decideAction({ ...base, llmResult: "skipped" }).event === "COMMENT",
  );
  check(
    "判定が無ければ承認しない",
    decideAction({ ...base, verdict: null }).event === "COMMENT",
  );
  check(
    "答えを読めなければ承認しない",
    decideAction({ ...base, verdict: parseVerdict("x") }).event === "COMMENT",
  );
  const p0 = parseVerdict(
    '{"findings":[{"severity":"P0","file":"a.js","line":1,"summary":"x"}]}',
  );
  check(
    "P0 があれば承認しない",
    decideAction({ ...base, verdict: p0 }).event === "COMMENT",
  );
}

// 6. 配線
const WF_DIR = path.join(ROOT, ".github/workflows");
// コメント行は外して見る（説明の中の「npm ci を使わない」等に当てないため）
const review = readFileSync(path.join(WF_DIR, "review.yml"), "utf8").replace(/^\s*#.*\n/gm, "");
const jobsText = review.slice(review.indexOf("\njobs:\n"));
const jobBlocks = Object.fromEntries(
  [
    ...jobsText.matchAll(
      /^ {2}([a-z-]+):\n([\s\S]*?)(?=^ {2}[a-z-]+:\n|(?![\s\S]))/gm,
    ),
  ].map((m) => [m[1], m[2]]),
);
{
  check(
    "job は gate・materials・llm・approve の4つ",
    JSON.stringify(Object.keys(jobBlocks)) ===
      JSON.stringify(["gate", "materials", "llm", "approve"]),
    Object.keys(jobBlocks).join(","),
  );
  check(
    "起動は pull_request_target の opened・synchronize・reopened だけ",
    /^on:\n {2}pull_request_target:\n {4}types: \[opened, synchronize, reopened\]\n\n/m.test(
      review,
    ),
  );
  check("workflow の permissions は空", /^permissions: \{\}$/m.test(review));
  const gateIf =
    jobBlocks.gate.match(/if: >-\n([\s\S]*?)\n {4}runs-on/)?.[1] ?? "";
  check(
    "作者を数値の user.id で決める",
    /format\('\{0\}', github\.event\.pull_request\.user\.id\) == vars\.REVIEW_MAKER_BOT_ID/.test(
      gateIf,
    ),
  );
  check(
    "変数が空なら動かさない",
    /vars\.REVIEW_MAKER_BOT_ID != ''/.test(gateIf),
  );
  check(
    "head は同じリポジトリだけ",
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/.test(
      gateIf,
    ),
  );
  check(
    "base は master だけ",
    /github\.event\.pull_request\.base\.ref == 'master'/.test(gateIf),
  );
  check(
    "後ろの job は gate を needs に持つ",
    ["materials", "llm", "approve"].every((j) =>
      /needs: (gate|\[gate)/.test(jobBlocks[j]),
    ),
  );

  const checkouts = [
    ...review.matchAll(
      /uses: actions\/checkout@[^\n]*\n {8}with:\n((?: {10}.*\n)+)/g,
    ),
  ].map((m) => m[1]);
  check(
    "checkout は4つとも master（github.sha）",
    checkouts.length === 4 &&
      checkouts.every((w) => /ref: \$\{\{ github\.sha \}\}/.test(w)),
    String(checkouts.length),
  );
  check(
    "checkout は4つとも persist-credentials: false",
    checkouts.every((w) => /persist-credentials: false/.test(w)),
  );
  check(
    "PR の head を checkout・fetch しない",
    !/head\.sha \}\}\n|refs\/pull|git fetch|gh pr checkout/.test(
      review.replace(
        /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
        "",
      ),
    ),
  );
  check(
    "npm ci・npm install・cache を使わない",
    !/npm (ci|install)|^\s*cache:|actions\/cache|setup-node/m.test(review),
  );
  const runLines = [
    ...review.matchAll(
      /^( +)run: ([\s\S]*?)(?=^\1(?:- |[a-z-]+:)|^ {0,2}\S|(?![\s\S]))/gm,
    ),
  ].map((m) => m[2]);
  check(
    "run に ${{ }} を書かない（値は env 経由）",
    runLines.length > 0 && runLines.every((r) => !r.includes("${{")),
    String(runLines.length),
  );
  check(
    "外部の action は SHA で固定",
    [...review.matchAll(/uses: ([^\s]+)/g)].every((m) =>
      /@[0-9a-f]{40}$/.test(m[1]),
    ),
  );

  const secretJobs = (name) =>
    Object.entries(jobBlocks)
      .filter(([, t]) => t.includes(`secrets.${name}`))
      .map(([j]) => j);
  check(
    "審査の App の鍵は approve だけ",
    JSON.stringify(secretJobs("REVIEWER_APP_PRIVATE_KEY")) === '["approve"]',
  );
  check(
    "OpenAI の鍵は llm だけ",
    JSON.stringify(secretJobs("OPENAI_API_KEY")) === '["llm"]',
  );
  check(
    "Anthropic の鍵は llm だけ",
    JSON.stringify(secretJobs("ANTHROPIC_API_KEY")) === '["llm"]',
  );
  check(
    "claude_ro は materials だけ",
    JSON.stringify(secretJobs("CLAUDE_RO_DB_URL")) === '["materials"]',
  );
  check(
    "gate は鍵を持たず Environment も無い",
    !/secrets\.|environment:/.test(jobBlocks.gate),
  );
  check(
    "materials は Environment db-readonly",
    /^ {4}environment: db-readonly$/m.test(jobBlocks.materials),
  );
  check(
    "llm・approve は Environment pr-review",
    ["llm", "approve"].every((j) =>
      /^ {4}environment: pr-review$/m.test(jobBlocks[j]),
    ),
  );
  check(
    "llm は材料の失敗・取り消しで走らない",
    /needs\.materials\.result == 'success' \|\| needs\.materials\.result == 'skipped'/.test(
      jobBlocks.llm,
    ),
  );
  check(
    "PR のタイトル・本文を参照しない",
    !/pull_request\.(title|body)/.test(review),
  );

  const others = readdirSync(WF_DIR).filter(
    (f) => /\.ya?ml$/.test(f) && f !== "review.yml",
  );
  const leaks = others.filter((f) => {
    const t = readFileSync(path.join(WF_DIR, f), "utf8");
    return (
      /environment:\s*(?:\n\s*name:\s*)?["']?(pr-review|db-readonly)\b/.test(
        t,
      ) ||
      /secrets\.(REVIEWER_APP_PRIVATE_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_RO_DB_URL)\b/.test(
        t,
      )
    );
  });
  check(
    "Environment pr-review・db-readonly と審査の鍵を使うのは review.yml だけ",
    leaks.length === 0,
    leaks.join(", "),
  );
}

// 7. e2e の集約
{
  const e2e = readFileSync(path.join(WF_DIR, "e2e-smoke-test.yml"), "utf8");
  const agg = e2e.slice(e2e.indexOf("\n  e2e:\n"));
  check(
    "e2e の集約の job は always() で走る（取り消しで skipped にならない）",
    /^ {2}e2e:\n {4}needs: e2e-shard\n(?: {4}#.*\n)* {4}if: always\(\)\n/m.test(e2e),
  );
  check(
    "e2e の集約は組の結果が success 以外なら落とす",
    /if \[ "\$\{\{ needs\.e2e-shard\.result \}\}" != "success" \]; then[\s\S]*?exit 1/.test(
      agg,
    ),
  );
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
