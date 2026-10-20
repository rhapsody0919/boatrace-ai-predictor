#!/usr/bin/env node
/**
 * verify-data-health-workflow-coverage.js - Environment prod-jobs を使う workflow が、data_health の鮮度の項目
 * （scripts/lib/dataHealth/checks.js の workflow）か、理由つきの除外（scripts/lib/dataHealth/workflowCoverage.js）に
 * 載っていることを検査する。本番DBには接続しない。.github/workflows は読むだけ。
 *
 * あわせて、prod-jobs を使う workflow が job の失敗の見張りの一覧（scripts/watch/job-watch.json の watched、PR #1679）にも
 * 載ることを検査する（見張りと data_health の両方に登録されていること。site-freshness-watch v2 の項目2-3）。
 *
 * 確認すること:
 *   (a) 今のリポジトリで、登録の漏れ・残骸が無い
 *   (b) 漏れ・残骸・両方への登録・理由の無い除外を検出する（変異）
 *   (c) prod-jobs の検出が、`environment: prod-jobs` と `environment:\n  name: prod-jobs` の両方を拾い、別の Environment は拾わない
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUNT_CHECKS,
  MORNING_FRESHNESS_CHECKS,
} from "../lib/dataHealth/checks.js";
import {
  WORKFLOW_EXCLUSIONS,
  findCoverageProblems,
  usesProdJobs,
} from "../lib/dataHealth/workflowCoverage.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, ".github/workflows");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`  OK ${label}`);
  else {
    failures++;
    console.log(`  NG ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}

const workflows = Object.fromEntries(
  fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf8")]),
);
const checks = [...COUNT_CHECKS, ...MORNING_FRESHNESS_CHECKS];
const watched = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/watch/job-watch.json"), "utf8"),
).watched;

console.log("(a) 今のリポジトリ");
{
  const problems = findCoverageProblems({ workflows, checks, watched });
  check(
    "prod-jobs を使う workflow は全て、鮮度の項目か理由つきの除外に載り、job-watch.json の watched にも載る（残骸も無い）",
    problems.length === 0,
    problems.join("\n     "),
  );
  const prodJobs = Object.keys(workflows).filter((f) =>
    usesProdJobs(workflows[f]),
  );
  check(
    `prod-jobs を使う workflow を検出できている（${prodJobs.length}本。0本なら検出の不具合）`,
    prodJobs.length >= 20,
  );
  const nightlyWorkflows = [
    "update-outcome-distribution.yml",
    "aggregate-course-baseline-stats.yml",
    "update-exhibition-time-top-stats.yml",
    "update-losing-technique-stats.yml",
    "update-nige-outcome-distribution.yml",
    "update-winning-technique-stats.yml",
    "update-top-start-stats.yml",
    "calculate-accuracy.yml",
    "update-moriarty.yml",
    "scrape-point-rank.yml",
    "aggregate-stats.yml",
  ];
  check(
    "夜の集計11本は、除外ではなく鮮度の項目に載る",
    nightlyWorkflows.every(
      (f) =>
        checks.some((c) => c.workflow === f) &&
        !Object.hasOwn(WORKFLOW_EXCLUSIONS, f),
    ),
  );
  check(
    "龍神ソナーの朝のバッチ（analogy-v16-morning.yml）は、通知する（alert）鮮度の項目に載る",
    checks.some(
      (c) => c.workflow === "analogy-v16-morning.yml" && c.severity === "alert",
    ),
  );
}

console.log("(b) 変異");
{
  const prod = "jobs:\n  a:\n    environment: prod-jobs\n";
  const other = "jobs:\n  a:\n    environment: production-db\n";
  const base = {
    workflows: { "a.yml": prod, "b.yml": prod, "c.yml": other },
    checks: [{ id: "nightly.a", workflow: "a.yml" }],
    exclusions: {
      "b.yml": { kind: "no_table", reason: "表を書かない検査だけのため" },
    },
  };
  check("基準の組み合わせは問題なし", findCoverageProblems(base).length === 0);
  const missing = findCoverageProblems({
    ...base,
    exclusions: {},
  });
  check(
    "どちらにも載らない prod-jobs の workflow を検出する",
    missing.some((p) => p.startsWith("b.yml:")),
  );
  const both = findCoverageProblems({
    ...base,
    exclusions: {
      ...base.exclusions,
      "a.yml": { kind: "no_table", reason: "表を書かない検査だけのため" },
    },
  });
  check(
    "鮮度の項目と除外の両方への登録を検出する",
    both.some((p) => p.includes("両方")),
  );
  const stale = findCoverageProblems({
    ...base,
    checks: [
      ...base.checks,
      { id: "nightly.c", workflow: "c.yml" },
      { id: "nightly.z", workflow: "z.yml" },
    ],
    exclusions: {
      ...base.exclusions,
      "y.yml": { kind: "no_table", reason: "表を書かない検査だけのため" },
    },
  });
  check(
    "prod-jobs を使わない・無い workflow を指す項目と除外（残骸）を検出する",
    stale.some((p) => p.includes("c.yml") && p.includes("残骸")) &&
      stale.some((p) => p.includes("z.yml がありません")) &&
      stale.some((p) => p.includes("除外 y.yml")),
  );
  const unwatched = findCoverageProblems({
    ...base,
    watched: [".github/workflows/a.yml"],
  });
  check(
    "job-watch.json の watched に無い prod-jobs の workflow を検出する（載っていれば通る）",
    unwatched.some(
      (p) => p.startsWith("b.yml:") && p.includes("job-watch.json"),
    ) &&
      findCoverageProblems({
        ...base,
        watched: [".github/workflows/a.yml", ".github/workflows/b.yml"],
      }).length === 0,
  );
  const noReason = findCoverageProblems({
    ...base,
    exclusions: { "b.yml": { kind: "weird", reason: "" } },
  });
  check(
    "理由の無い除外・不正な kind を検出する",
    noReason.some((p) => p.includes("理由")) &&
      noReason.some((p) => p.includes("kind")),
  );
}

console.log("(c) prod-jobs の検出");
check(
  "`environment: prod-jobs` を拾う",
  usesProdJobs("jobs:\n  a:\n    environment: prod-jobs\n"),
);
check(
  "`environment:` の下の `name: prod-jobs` を拾う",
  usesProdJobs(
    "jobs:\n  a:\n    environment:\n      name: prod-jobs\n      url: x\n",
  ),
);
check(
  "別の Environment（production-db・prod-jobs-x）は拾わない",
  !usesProdJobs("jobs:\n  a:\n    environment: production-db\n") &&
    !usesProdJobs("jobs:\n  a:\n    environment: prod-jobs-x\n"),
);
check(
  "コメントの中の prod-jobs は拾わない",
  !usesProdJobs(
    "# environment: prod-jobs を使わない\njobs:\n  a:\n    runs-on: x\n",
  ),
);

if (failures > 0) {
  console.log(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
