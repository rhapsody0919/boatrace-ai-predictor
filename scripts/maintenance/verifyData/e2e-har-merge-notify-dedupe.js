/**
 * e2e-har-merge-notify-dedupe.js - e2e-recording.js の notify-dedupe を、偽の gh（受けた endpoint を記録して空の runs を返す）を PATH に置いて実行し、
 * 取得先の endpoint を返す（verify-e2e-har-merge.js の部品。本文の字は読まない。GitHub には繋がない）
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** @returns {{ status: number | null, endpoints: string[] }} 終了コードと、gh api が受けた endpoint の並び */
export function notifyDedupeEndpoints(repoRoot) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-har-merge-gh-"));
  const log = path.join(dir, "endpoints.txt");
  writeFileSync(
    path.join(dir, "gh"),
    `#!/bin/sh\nprintf '%s\\n' "$2" >> ${JSON.stringify(log)}\necho '{"workflow_runs":[]}'\n`,
    { mode: 0o755 },
  );
  try {
    const run = spawnSync(
      process.execPath,
      [path.join(repoRoot, "scripts/maintenance/e2e-recording.js"), "notify-dedupe"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
          GITHUB_REPOSITORY: "rhapsody0919/boatrace-ai-predictor",
          GITHUB_RUN_ID: "1",
        },
      },
    );
    const endpoints = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { status: run.status, endpoints };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
