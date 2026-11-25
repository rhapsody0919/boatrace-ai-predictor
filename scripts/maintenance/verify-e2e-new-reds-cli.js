#!/usr/bin/env node
/**
 * e2e-new-reds.js（CLI）を固定の入力で確かめる: Playwright の JSON から赤の鍵を取る・鍵と知らせた時刻を書き出す・
 * GITHUB_OUTPUT に notify と text を書く・組が欠けた run の鍵は書かない・壊れた基準は「基準なし」。
 * 判定そのものは verify-e2e-new-reds.js。通信・gh は使わない（--baseline を渡し、一時のディレクトリで回す）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redKeysOf } from "./e2e-new-reds.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const spec = (title, status, projectName = "smoke") => ({
  title,
  tests: [{ status, projectName }],
});
const FILE = "e2e/race.spec.js";
const report = {
  suites: [
    {
      title: FILE,
      file: FILE,
      specs: [
        spec("締切前のカード", "unexpected"),
        spec("出走表が開く", "expected"),
        spec("取り直しで緑", "flaky"),
      ],
      suites: [
        {
          title: "AI タブ",
          file: FILE,
          specs: [spec("展開が出る", "unexpected", "layout-wide")],
        },
      ],
    },
  ],
};
const A = `smoke › ${FILE} › 締切前のカード`;
const B = `layout-wide › ${FILE} › AI タブ › 展開が出る`;

// --- 鍵: unexpected だけ・flaky は数えない・:行:列 を持たない・並べ替えて重複なし ---
check("赤の鍵", redKeysOf(report), [B, A].sort());
check("試験の無いレポートは比べられない", redKeysOf({ suites: [] }), null);
check(
  "同じ鍵は1つ",
  redKeysOf({ suites: [report.suites[0], report.suites[0]] }),
  [B, A].sort(),
);

// --- CLI: 鍵と知らせた時刻を書き出し、GITHUB_OUTPUT に notify と text を書く ---
const dir = mkdtempSync(path.join(tmpdir(), "e2e-new-reds-"));
const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "e2e-new-reds.js",
);
const out = path.join(dir, "out.txt");
const runCli = (extra) => {
  writeFileSync(out, "");
  execFileSync(
    process.execPath,
    [
      script,
      `--report=${path.join(dir, "report.json")}`,
      "--failed=true",
      ...extra,
    ],
    { env: { ...process.env, GITHUB_OUTPUT: out }, stdio: "pipe" },
  );
  return readFileSync(out, "utf8");
};
try {
  writeFileSync(path.join(dir, "report.json"), JSON.stringify(report));
  writeFileSync(
    path.join(dir, "base.json"),
    JSON.stringify({
      keys: [A],
      notifiedAt: { [A]: new Date().toISOString() },
    }),
  );
  const keysFile = path.join(dir, "keys.json");
  const written = runCli([
    `--baseline=${path.join(dir, "base.json")}`,
    `--out=${keysFile}`,
  ]);
  const keys = JSON.parse(readFileSync(keysFile, "utf8"));
  check("CLI が鍵を書く", keys.keys, [B, A].sort());
  check(
    "CLI が知らせた時刻を書く",
    Object.keys(keys.notifiedAt).sort(),
    [B, A].sort(),
  );
  check("CLI が notify=true を書く", written.startsWith("notify=true\n"), true);
  check("CLI の text に新しい赤", written.includes(B), true);
  // 組が欠けた run は鍵を書かない
  rmSync(keysFile);
  runCli([
    `--baseline=${path.join(dir, "base.json")}`,
    `--out=${keysFile}`,
    "--incomplete=true",
  ]);
  let wroteIncomplete = true;
  try {
    readFileSync(keysFile);
  } catch {
    wroteIncomplete = false;
  }
  check("組が欠けた run は基準を残さない", wroteIncomplete, false);
  // 基準のファイルが壊れていても落ちずに「基準なし」で知らせる
  writeFileSync(path.join(dir, "bad.json"), "{");
  const bad = runCli([`--baseline=${path.join(dir, "bad.json")}`]);
  check("壊れた基準は基準なし", bad.startsWith("notify=true\n"), true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`NG: ${failures.length}/${checked}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e-new-reds の CLI ${checked} 件`);
