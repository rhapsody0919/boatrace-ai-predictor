#!/usr/bin/env node
/**
 * e2e-new-reds.js（CLI）の runCli を固定の入力で確かめる: Playwright の JSON から赤の鍵を取る・鍵と知らせた時刻を
 * 書き出す物に入れる・GITHUB_OUTPUT に notify と text を書く・組が欠けた run の鍵は書かない・壊れた基準は「基準なし」・
 * --baseline が無ければ workflow の基準を探す口を呼ぶ。判定そのものは verify-e2e-new-reds.js。
 * ファイル・gh・通信には触らない（読む口と探す口はメモリの偽物）。
 */
import { parseArgs, redKeysOf, runCli } from "./e2e-new-reds.js";

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
const GROUP = "出走表の組";
const report = {
  suites: [
    {
      title: GROUP,
      file: GROUP,
      specs: [
        spec("締切前のカード", "unexpected"),
        spec("出走表が開く", "expected"),
        spec("取り直しで緑", "flaky"),
      ],
      suites: [
        {
          title: "AI タブ",
          file: GROUP,
          specs: [spec("展開が出る", "unexpected", "layout-wide")],
        },
      ],
    },
  ],
};
const A = `smoke › ${GROUP} › 締切前のカード`;
const B = `layout-wide › ${GROUP} › AI タブ › 展開が出る`;
const NOW = new Date("2026-11-25T12:00:00Z");

// --- 鍵: unexpected だけ・flaky は数えない・並べ替えて重複なし ---
check("赤の鍵", redKeysOf(report), [B, A].sort());
check("試験の無いレポートは比べられない", redKeysOf({ suites: [] }), null);

// --- 引数 ---
check(
  "引数の読み",
  parseArgs(["--report=r", "--failed=true", "--incomplete=false", "x"]),
  { report: "r", failed: true, incomplete: false },
);

// --- runCli: 読む口・探す口はメモリの偽物 ---
const texts = {
  "report.json": JSON.stringify(report),
  "base.json": JSON.stringify({
    keys: [A],
    notifiedAt: { [A]: NOW.toISOString() },
  }),
  "found.json": JSON.stringify({
    keys: [A, B],
    notifiedAt: { [A]: NOW.toISOString(), [B]: NOW.toISOString() },
  }),
  "bad.json": "{",
};
const searched = [];
const run = (argv) =>
  runCli({
    args: parseArgs(argv),
    readText: (file) => texts[file] ?? null,
    fetchBaseline: (workflow) => {
      searched.push(workflow);
      return "found.json";
    },
    now: NOW,
    delim: "EOF_x",
    log: () => {},
  });

const withBase = run([
  "--report=report.json",
  "--baseline=base.json",
  "--out=keys.json",
  "--failed=true",
]);
check(
  "鍵を書き出す物に入れる",
  JSON.parse(withBase.keysFile.body).keys,
  [B, A].sort(),
);
check("書き出す先は --out", withBase.keysFile.path, "keys.json");
check(
  "知らせた時刻を残す",
  Object.keys(JSON.parse(withBase.keysFile.body).notifiedAt).sort(),
  [B, A].sort(),
);
check(
  "GITHUB_OUTPUT に notify=true",
  withBase.output.startsWith("notify=true\ntext<<EOF_x\n"),
  true,
);
check("text に新しい赤", withBase.output.includes(B), true);
check("--baseline があれば探さない", searched, []);

const found = run([
  "--report=report.json",
  "--workflow=e2e-live.yml",
  "--failed=true",
]);
check("--baseline が無ければ workflow で探す", searched, ["e2e-live.yml"]);
check("探した基準と同じ赤だけなら黙る", found.decision.notify, false);
check("--out が無ければ書き出さない", found.keysFile, null);

const incomplete = run([
  "--report=report.json",
  "--baseline=base.json",
  "--out=keys.json",
  "--failed=true",
  "--incomplete=true",
]);
check("組が欠けた run は鍵を書かない", incomplete.keysFile, null);
check("組が欠けた run は鳴らす", incomplete.decision.reason, "incomplete");

const bad = run([
  "--report=report.json",
  "--baseline=bad.json",
  "--failed=true",
]);
check("壊れた基準は基準なし", bad.decision.reason, "no_baseline");
const noReport = run([
  "--report=missing.json",
  "--baseline=base.json",
  "--out=keys.json",
  "--failed=true",
]);
check(
  "レポートが無ければ鳴らし、鍵を書かない",
  [noReport.decision.reason, noReport.keysFile],
  ["no_report", null],
);

if (failures.length > 0) {
  console.error(`NG: ${failures.length}/${checked}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e-new-reds の CLI ${checked} 件`);
