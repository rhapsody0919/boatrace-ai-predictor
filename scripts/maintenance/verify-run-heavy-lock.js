#!/usr/bin/env node
/**
 * run-heavy.sh（BOA-769、2026-10-13）の検証。
 *
 * 実プロセスを3本同時に起動し、同時に走る（枠を確保した状態の）本数が
 * RYUJIN_HEAVY_MAX_SLOTS（このテストでは2）を一度も超えないこと、
 * かつ3本とも最終的に完走することを確認する。
 *
 * 実タイマー（sleep）に依存する統合テストのため、CIでは走らせない
 * （tier=manual、verify-registry.json参照）。手元で以下のように実行する:
 *   node scripts/maintenance/verify-run-heavy-lock.js
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SCRIPT = path.join(repoRoot, "scripts/maintenance/run-heavy.sh");

/** 枠を取ってから解放するまでの間、短く眠るだけの子プロセスを1本起動する */
function spawnSlowJob(lockDir) {
  return spawn("bash", [SCRIPT, "bash", "-c", "sleep 1.5"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: "",
      RYUJIN_HEAVY_LOCK_DIR: lockDir,
      RYUJIN_HEAVY_MAX_SLOTS: "2",
      RYUJIN_HEAVY_POLL_INTERVAL: "1",
    },
  });
}

/** lockDir/slots 配下にある「枠」ディレクトリの数（＝今まさに走っている本数） */
function countActiveSlots(lockDir) {
  try {
    return readdirSync(path.join(lockDir, "slots")).length;
  } catch {
    return 0;
  }
}

async function main() {
  const lockDir = mkdtempSync(path.join(tmpdir(), "run-heavy-lock-test-"));
  const maxSlots = 2;
  const jobCount = 3;

  const children = Array.from({ length: jobCount }, () =>
    spawnSlowJob(lockDir),
  );

  let maxObserved = 0;
  const poll = setInterval(() => {
    maxObserved = Math.max(maxObserved, countActiveSlots(lockDir));
  }, 50);

  const exitCodes = await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => child.on("exit", (code) => resolve(code))),
    ),
  );
  clearInterval(poll);
  rmSync(lockDir, { recursive: true, force: true });

  const problems = [];
  if (maxObserved > maxSlots) {
    problems.push(
      `同時に走った本数が${maxObserved}本（上限${maxSlots}本を超えた）`,
    );
  }
  if (maxObserved === 0) {
    problems.push(
      "一度も枠を確保した様子が観測できなかった（ポーリング間隔が粗すぎる、またはロックが機能していない）",
    );
  }
  const failed = exitCodes.filter((c) => c !== 0);
  if (failed.length > 0) {
    problems.push(`${jobCount}本中${failed.length}本が異常終了した`);
  }

  if (problems.length > 0) {
    console.error("NG: run-heavy.sh の検証に失敗");
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `OK: ${jobCount}本同時起動で、同時に走ったのは最大${maxObserved}本（上限${maxSlots}本以内）、全本完走`,
  );
}

main();
