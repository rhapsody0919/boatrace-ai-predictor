#!/usr/bin/env node
/**
 * verify-workflow-secrets.js - 本番の書き込みの鍵を、master だけの Environment の中でしか使っていないか（ADR-0097 段取り S）。
 *
 * repo の secret（Environment の外）は、同じリポジトリのどのブランチの workflow からも読める。workflow を書ける身元
 * （作成の App は Workflows: write を持つ）なら、ブランチを push するだけで審査を通らずに本番へ書ける。
 * そこで、下の鍵を参照する job は必ず master だけの Environment（prod-jobs・ryujin-bot・production-db）を宣言する。
 *
 * 確認する観点:
 *   1. 下の鍵を参照する job は environment に prod-jobs・ryujin-bot・production-db のどれかを持つ
 *   2. pull_request で動く workflow は、anon（VITE_SUPABASE_*）以外の secret を参照しない
 *
 * YAML は字句で読む（job は2字下げの `名前:`、environment は4字下げ）。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DIR = path.join(ROOT, ".github/workflows");

export const PROTECTED_SECRETS = [
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_URL",
  "SLACK_WEBHOOK_URL",
  "VERCEL_DEPLOY_HOOK",
  "LINEAR_API_KEY",
  "LINEAR_TEAM_ID",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "SEARCH_CONSOLE_SITE_URL",
  "SUPABASE_DB_URL",
  "RYUJIN_BOT_PRIVATE_KEY",
];
const MASTER_ONLY_ENVIRONMENTS = new Set([
  "prod-jobs",
  "ryujin-bot",
  "production-db",
]);
// pull_request の workflow が参照してよいもの: anon と、PR の通知専用の webhook（漏れても PR 通知のチャンネルに投稿されるだけ）
const PUBLIC_SECRETS = new Set([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SLACK_PR_WEBHOOK_URL",
]);


/** @returns {{ id: string, text: string }[]} */
export function splitJobs(yamlText) {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const jobs = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (m) {
      current = { id: m[1], text: "" };
      jobs.push(current);
      continue;
    }
    if (current) current.text += `${line}\n`;
  }
  return jobs;
}

export function jobEnvironment(jobText) {
  const flat = /^ {4}environment:\s*([A-Za-z0-9_-]+)\s*$/m.exec(jobText);
  if (flat) return flat[1];
  const nested = /^ {4}environment:\s*\n {6}name:\s*([A-Za-z0-9_-]+)\s*$/m.exec(
    jobText,
  );
  return nested ? nested[1] : null;
}

export const secretsIn = (text) => [
  ...new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1])),
];

const triggers = (yamlText) => {
  const m = /^on:\s*\n((?: {2}.*\n?)*)/m.exec(yamlText);
  const block = m ? m[1] : "";
  const inline = /^on:\s*\[?([^\n\]]*)\]?\s*$/m.exec(yamlText)?.[1] ?? "";
  return new Set([
    ...[...block.matchAll(/^ {2}([a-z_]+):/gm)].map((x) => x[1]),
    ...inline
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  ]);
};

/** @returns {string[]} 違反の一覧 */
export function checkWorkflow(file, yamlText) {
  const problems = [];
  const onPullRequest = triggers(yamlText).has("pull_request");
  // jobs: より前（最上位の env 等）の secret は、どの job でも Environment の外（repo の secret）から読まれる
  const head = yamlText.split(/^jobs:\s*$/m)[0];
  const topLevel = secretsIn(head).filter((s) => !PUBLIC_SECRETS.has(s) && s !== "GITHUB_TOKEN");
  if (topLevel.length > 0) {
    problems.push(`${file}: workflow の最上位で ${topLevel.join(", ")} を参照する（job の Environment が効かない）`);
  }
  for (const job of splitJobs(yamlText)) {
    const used = secretsIn(job.text);
    const key = `${file}:${job.id}`;
    const protectedUsed = used.filter((s) => PROTECTED_SECRETS.includes(s));
    const env = jobEnvironment(job.text);
    if (protectedUsed.length > 0 && !MASTER_ONLY_ENVIRONMENTS.has(env)) {
      problems.push(
        `${key}: ${protectedUsed.join(", ")} を参照するが environment が master だけのもの（${[...MASTER_ONLY_ENVIRONMENTS].join("・")}）でない（${env ?? "なし"}）`,
      );
    }
    if (onPullRequest) {
      const leaked = used.filter(
        (s) => !PUBLIC_SECRETS.has(s) && s !== "GITHUB_TOKEN",
      );
      if (leaked.length > 0)
        problems.push(
          `${key}: pull_request で動くのに ${leaked.join(", ")} を参照する`,
        );
    }
  }
  return problems;
}

function main() {
  let failures = 0;
  const check = (label, pass, detail = "") => {
    if (pass) console.log(`✅ ${label}`);
    else {
      failures += 1;
      console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
    }
  };

  // 検査そのものの検査
  const good =
    "on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  a:\n    environment: prod-jobs\n    runs-on: ubuntu-latest\n    steps:\n      - run: x\n        env:\n          K: ${{ secrets.SUPABASE_SERVICE_KEY }}\n";
  check(
    "environment つきの job は通る",
    checkWorkflow("x.yml", good).length === 0,
  );
  check(
    "environment が無い job は落とす",
    checkWorkflow("x.yml", good.replace("    environment: prod-jobs\n", ""))
      .length === 1,
  );
  check(
    "知らない environment は落とす",
    checkWorkflow("x.yml", good.replace("prod-jobs", "staging")).length === 1,
  );
  check(
    "name: の形の environment も読む",
    checkWorkflow(
      "x.yml",
      good.replace(
        "    environment: prod-jobs\n",
        "    environment:\n      name: ryujin-bot\n",
      ),
    ).length === 0,
  );
  const pr =
    "on:\n  pull_request:\n    branches: [master]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: x\n        env:\n          A: ${{ secrets.VITE_SUPABASE_ANON_KEY }}\n";
  check(
    "pull_request で anon だけなら通る",
    checkWorkflow("x.yml", pr).length === 0,
  );
  check(
    "pull_request で他の secret は落とす",
    checkWorkflow(
      "x.yml",
      pr.replace("VITE_SUPABASE_ANON_KEY", "OPENAI_API_KEY"),
    ).length === 1,
  );
  check(
    "最上位の env の secret は落とす",
    checkWorkflow("x.yml", good.replace("jobs:\n", "env:\n  K: ${{ secrets.SUPABASE_SERVICE_KEY }}\njobs:\n")).length === 1,
  );
  check(
    "job を2字下げで分ける",
    splitJobs(good + "  b:\n    runs-on: x\n")
      .map((j) => j.id)
      .join(",") === "a,b",
  );

  // 実ファイル
  const problems = readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .flatMap((f) => checkWorkflow(f, readFileSync(path.join(DIR, f), "utf8")));
  check(
    "本番の書き込みの鍵は master だけの Environment の job でしか使わない",
    problems.length === 0,
    problems.join("\n  "),
  );

  if (failures > 0) {
    console.error(`\n${failures} 件失敗`);
    process.exit(1);
  }
  console.log("\nすべて成功");
}

main();
