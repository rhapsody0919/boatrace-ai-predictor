#!/usr/bin/env node
/**
 * verify-bot-push-workflows.js — master へ直接 push するワークフローが、アプリ ryujin-bot の名義で push し、
 * その push でワークフローが連鎖起動しない形になっていることを検査する。
 *
 * 背景: master の ruleset の bypass に GITHUB_TOKEN は入れられないため、自動コミットはアプリのトークンで
 * push する。アプリのトークンの push は（GITHUB_TOKEN と違って）他のワークフローを起動するので、
 * master への push で動くワークフローは「ボットの push では動かない」条件を持つ必要がある。
 * 新しく push するワークフローを足したときに、次のどれかを忘れると、ruleset で push が拒否されるか、
 * regenerate-generated-docs が自分を起動し続ける。
 *
 * 検査すること:
 *   1. push-with-retry.sh を呼ぶステップは、env に PUSH_TOKEN: ${{ steps.app-token.outputs.token }} を持つ
 *   2. そのワークフローに id: app-token の actions/create-github-app-token ステップ（RYUJIN_BOT_* の Secrets）がある
 *   3. そのワークフローの git commit -m のメッセージは [automated] で終わる（下の 4 の条件が末尾で判定するため）
 *   4. on.push で master を対象にし、paths で絞っていないワークフローの各 job は、
 *      ryujin-bot[bot] と endsWith(head_commit.message, '[automated]') の両方で除外する if を持つ
 *   5. RYUJIN_BOT_* を使う job は environment: ryujin-bot を持ち、トークンの発行は github.ref が master のときだけ
 *   6. push のステップが !cancelled()・always() で走るなら、steps.app-token.outcome == 'success' も条件にする
 *
 * 使い方: node scripts/maintenance/verify-bot-push-workflows.js
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WORKFLOW_DIR = path.join(repoRoot, ".github/workflows");

const PUSH_TOKEN_ENV = "PUSH_TOKEN: ${{ steps.app-token.outputs.token }}";

/** インデントが `indent` のステップ（`- ` で始まる行）ごとに行を分ける。 */
function splitSteps(lines) {
  const steps = [];
  let current = null;
  let indent = null;
  for (const line of lines) {
    const m = line.match(/^(\s*)- /);
    if (m && (indent === null || m[1].length === indent)) {
      indent = m[1].length;
      current = [line];
      steps.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return steps;
}

/** `steps:` 配下の各ステップのテキストを返す（job をまたいで全部）。 */
export function listSteps(yaml) {
  const lines = yaml.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)steps:\s*$/);
    if (!m) continue;
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j];
      if (l.trim() !== "" && !l.trim().startsWith("#")) {
        const ind = l.match(/^(\s*)/)[1].length;
        if (ind <= m[1].length && !l.trimStart().startsWith("- ")) break;
        if (ind < m[1].length) break;
      }
      body.push(l);
    }
    for (const s of splitSteps(body)) result.push(s.join("\n"));
  }
  return result;
}

/** トップレベルの `jobs:` の直下にある job ごとに、job のテキストを返す。 */
export function listJobs(yaml) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const jobs = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      current = { name: m[1], lines: [] };
      jobs.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return jobs.map((j) => ({ name: j.name, text: j.lines.join("\n") }));
}

/** トップレベルの `on:` ブロックのテキストを返す。 */
function onBlock(yaml) {
  const m = yaml.match(/^on:\s*\n((?:[ \t#].*\n|\s*\n)*)/m);
  return m ? m[1] : "";
}

/** on.push で master を対象にし、paths で絞っていないか。 */
export function triggersOnEveryMasterPush(yaml) {
  const on = onBlock(yaml);
  const push = on.match(/^ {2}push:\s*\n((?: {4,}.*\n|\s*\n)*)/m);
  if (!push) return false;
  const body = push[1];
  if (/^\s*paths:/m.test(body)) return false;
  if (/^\s*branches:/m.test(body))
    return /-\s*['"]?master['"]?\s*$/m.test(body);
  return true;
}

/** job の if が、ボットの push を actor と末尾の [automated] の両方で除外しているか。 */
export function jobSkipsBotPush(jobText) {
  const ifBlock = jobText.match(/^ {4}if:\s*(>-?\s*\n(?: {6,}.*\n?)+|.*)$/m);
  if (!ifBlock) return false;
  const cond = ifBlock[1];
  return (
    /github\.actor\s*!=\s*'ryujin-bot\[bot\]'/.test(cond) &&
    /!endsWith\(github\.event\.head_commit\.message,\s*'\[automated\]'\)/.test(
      cond,
    )
  );
}

/** 1ワークフローの問題を返す。 */
export function checkWorkflow(name, yaml) {
  const problems = [];
  const steps = listSteps(yaml);
  const pushSteps = steps.filter((s) => s.includes("push-with-retry.sh"));
  if (pushSteps.length > 0) {
    for (const s of pushSteps) {
      if (!s.includes(PUSH_TOKEN_ENV)) {
        problems.push(
          `${name}: push-with-retry.sh のステップに env の ${PUSH_TOKEN_ENV} が無い`,
        );
      }
    }
    const tokenStep = steps.find(
      (s) =>
        /^\s*id:\s*app-token\s*$/m.test(s) &&
        s.includes("actions/create-github-app-token@"),
    );
    if (!tokenStep) {
      problems.push(
        `${name}: id: app-token の actions/create-github-app-token ステップが無い`,
      );
    } else if (
      !tokenStep.includes("secrets.RYUJIN_BOT_APP_ID") ||
      !tokenStep.includes("secrets.RYUJIN_BOT_PRIVATE_KEY")
    ) {
      problems.push(
        `${name}: app-token のステップが RYUJIN_BOT_APP_ID・RYUJIN_BOT_PRIVATE_KEY を使っていない`,
      );
    }
    if (tokenStep && !tokenStep.includes("github.ref == 'refs/heads/master'")) {
      problems.push(
        `${name}: app-token のステップの if に github.ref == 'refs/heads/master' が無い`,
      );
    }
    for (const s of pushSteps) {
      const cond = (s.match(/^\s*if:\s*(.*)$/m) || [])[1] || "";
      // !cancelled()・always() は「先行ステップの失敗」でも走るので、トークンの発行の成功を明示しないと
      // 空の PUSH_TOKEN で GITHUB_TOKEN に戻ってしまう
      if (
        /!cancelled\(\)|always\(\)/.test(cond) &&
        !cond.includes("steps.app-token.outcome == 'success'")
      ) {
        problems.push(
          `${name}: push のステップの if（${cond}）が、トークンの発行の失敗後も走る（steps.app-token.outcome == 'success' を足す）`,
        );
      }
    }
    for (const m of yaml.matchAll(/git commit -m "([^"]*)"/g)) {
      if (!m[1].endsWith("[automated]")) {
        problems.push(
          `${name}: コミットのメッセージが [automated] で終わらない: ${m[1]}`,
        );
      }
    }
  }
  for (const job of listJobs(yaml)) {
    if (
      job.text.includes("secrets.RYUJIN_BOT_") &&
      !/^ {4}environment:\s*ryujin-bot\s*$/m.test(job.text)
    ) {
      problems.push(
        `${name}: RYUJIN_BOT_* を使う job「${job.name}」に environment: ryujin-bot が無い（master 以外から bypass 用のトークンを作れてしまう）`,
      );
    }
  }
  if (triggersOnEveryMasterPush(yaml)) {
    for (const job of listJobs(yaml)) {
      if (!jobSkipsBotPush(job.text)) {
        problems.push(
          `${name}: master への push（paths なし）で動く job「${job.name}」に、ボットの push を除外する if が無い` +
            `（github.actor != 'ryujin-bot[bot]' と !endsWith(github.event.head_commit.message, '[automated]') の両方）`,
        );
      }
    }
  }
  return problems;
}

// --- 判定ロジックの固定入力での検証 ---
const failures = [];
function check(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}
const TOKEN_STEP = `      - name: Create ryujin-bot token
        id: app-token
        if: github.ref == 'refs/heads/master'
        uses: actions/create-github-app-token@v3
        with:
          app-id: \${{ secrets.RYUJIN_BOT_APP_ID }}
          private-key: \${{ secrets.RYUJIN_BOT_PRIVATE_KEY }}
`;
const PUSH_STEP = (env, msg = "chore: x [automated]") => `      - name: Push
        run: |
          git commit -m "${msg}"
          bash scripts/maintenance/push-with-retry.sh
${env ? `        env:\n          ${PUSH_TOKEN_ENV}\n` : ""}`;
const ENV_LINE = "    environment: ryujin-bot\n";
const wf = (on, jobIf, steps, envLine = ENV_LINE) => `name: T
on:
${on}
jobs:
  a:
${jobIf}    runs-on: ubuntu-latest
${envLine}    steps:
      - uses: actions/checkout@v4
${steps}`;
const SCHEDULE = "  schedule:\n    - cron: '0 0 * * *'\n";
const MASTER_PUSH = "  push:\n    branches:\n      - master\n";
const GOOD_IF =
  "    if: >-\n      github.actor != 'ryujin-bot[bot]' &&\n      !endsWith(github.event.head_commit.message, '[automated]')\n";

check(
  "正しい形は問題なし",
  checkWorkflow("t", wf(SCHEDULE, "", TOKEN_STEP + PUSH_STEP(true))),
  [],
);
check(
  "PUSH_TOKEN が無い push を検出",
  checkWorkflow("t", wf(SCHEDULE, "", TOKEN_STEP + PUSH_STEP(false))).length,
  1,
);
check(
  "トークンのステップが無いことを検出",
  checkWorkflow("t", wf(SCHEDULE, "", PUSH_STEP(true))).length,
  1,
);
check(
  "[automated] で終わらないコミットを検出",
  checkWorkflow(
    "t",
    wf(SCHEDULE, "", TOKEN_STEP + PUSH_STEP(true, "chore: [automated] x")),
  ).length,
  1,
);
check(
  "master への push で動き、除外の if が無い job を検出",
  checkWorkflow("t", wf(MASTER_PUSH, "", "")).length,
  1,
);
check(
  "除外の if があれば問題なし",
  checkWorkflow("t", wf(MASTER_PUSH, GOOD_IF, "")),
  [],
);
check(
  "contains（部分一致）の if は不可",
  checkWorkflow(
    "t",
    wf(MASTER_PUSH, GOOD_IF.replace("endsWith", "contains"), ""),
  ).length,
  1,
);
check(
  "paths で絞っていれば対象外",
  triggersOnEveryMasterPush(
    wf(MASTER_PUSH + "    paths:\n      - 'src/**'\n", "", ""),
  ),
  false,
);
check(
  "pull_request だけなら対象外",
  triggersOnEveryMasterPush(
    wf("  pull_request:\n    branches:\n      - master\n", "", ""),
  ),
  false,
);
check(
  "environment: ryujin-bot が無い job を検出",
  checkWorkflow("t", wf(SCHEDULE, "", TOKEN_STEP + PUSH_STEP(true), "")).length,
  1,
);
check(
  "トークンの発行が master に限られていないことを検出",
  checkWorkflow(
    "t",
    wf(SCHEDULE, "", TOKEN_STEP.replace(/ {8}if: .*\n/, "") + PUSH_STEP(true)),
  ).length,
  1,
);
check(
  "!cancelled() の push がトークンの発行の失敗後も走ることを検出",
  checkWorkflow(
    "t",
    wf(SCHEDULE, "", TOKEN_STEP + PUSH_STEP(true).replace("        run: |", "        if: ${{ !cancelled() }}\n        run: |")),
  ).length,
  1,
);
check(
  "!cancelled() でも発行の成功を条件にしていれば問題なし",
  checkWorkflow(
    "t",
    wf(SCHEDULE, "", TOKEN_STEP + PUSH_STEP(true).replace("        run: |", "        if: ${{ !cancelled() && steps.app-token.outcome == 'success' }}\n        run: |")),
  ),
  [],
);
if (failures.length > 0) {
  console.error("NG: 検査ロジックが期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// --- 実際のワークフローを検査する ---
const files = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const problems = [];
let pushers = 0;
for (const f of files) {
  const yaml = fs.readFileSync(path.join(WORKFLOW_DIR, f), "utf8");
  if (yaml.includes("push-with-retry.sh")) pushers += 1;
  problems.push(...checkWorkflow(f, yaml));
}
if (pushers === 0) {
  console.error(
    "NG: push-with-retry.sh を呼ぶワークフローが1本も見つからない（検査の前提が崩れている）",
  );
  process.exit(1);
}
if (problems.length > 0) {
  console.error("NG: master へのボットの push の形が崩れています");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `✅ master へ push する ${pushers} 本が ryujin-bot のトークンで push し、ボットの push で連鎖起動しない`,
);
