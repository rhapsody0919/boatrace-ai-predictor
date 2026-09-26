#!/usr/bin/env node
/**
 * verify-lib-index.js — 共通ロジックの索引がソースと一致しているかを機械検査する。
 *
 * 索引（docs/reference/shared-logic-index.md）は
 * scripts/maintenance/generate-lib-index.js がソースから生成する。手で書いた索引は
 * 必ず陳腐化し、陳腐化した索引は「無い」より悪い（既にあるものを無いと判断させる）ため、
 * ER図（ADR-0065）と同じく生成物の最新性をCIで担保する。
 *
 * 併せて、抽出のロジック（モジュールの役割の1行・exportの名前・行の整形）も
 * 固定の入力で検証する。抽出が壊れると索引が静かに空になり、検査も通ってしまうため。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractExports,
  extractModuleSummary,
  formatRow,
  OUTPUT_PATH,
} from "./generate-lib-index.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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

// --- モジュールの役割の抽出 ---
check(
  "冒頭のブロックコメントの1行目",
  extractModuleSummary(
    "/**\n * 日付ユーティリティ\n * JSTを扱う\n */\nexport function a() {}",
  ),
  "日付ユーティリティ",
);
check(
  "shebangがあっても拾う",
  extractModuleSummary("#!/usr/bin/env node\n/**\n * 取得CLI\n */\n"),
  "取得CLI",
);
check(
  "@から始まる行は役割ではない",
  extractModuleSummary("/**\n * @module foo\n * 実際の説明\n */\n"),
  "実際の説明",
);
check("コメントが無い", extractModuleSummary("export function a() {}"), null);
check("空のコメント", extractModuleSummary("/**\n *\n */\n"), null);

// --- export の抽出 ---
check(
  "関数・const・class",
  extractExports(
    "export function a() {}\nexport async function b() {}\nexport const c = 1;\nexport class D {}",
  ),
  // function を先に全部拾い、次に const/class を出現順に拾う
  ["a", "b", "c", "D"],
);
check(
  "インデントされたexportは対象外（入れ子の定義を拾わない）",
  extractExports("  export function inner() {}"),
  [],
);
check(
  "同じ名前を重複させない",
  extractExports("export const a = 1;\nexport const a = 2;"),
  ["a"],
);
check("exportが無い", extractExports("function a() {}"), []);

// --- 行の整形 ---
check(
  "5件を超えるexportは件数で示す",
  formatRow("x.js", "説明", ["a", "b", "c", "d", "e", "f", "g"]),
  "| `x.js` | 説明 | a, b, c, d, e ほか2件 |",
);
check("exportが無い", formatRow("x.js", "説明", []), "| `x.js` | 説明 | — |");
check("役割が無い", formatRow("x.js", null, ["a"]), "| `x.js` | — | a |");
check(
  "パイプは表を壊さないよう置き換える",
  formatRow("x.js", "a | b", ["c"]),
  "| `x.js` | a / b | c |",
);
check(
  "長い役割は切る",
  formatRow("x.js", "あ".repeat(100), ["a"]),
  `| \`x.js\` | ${"あ".repeat(80)}… | a |`,
);

if (failures.length > 0) {
  console.error("NG: 索引の抽出ロジックが期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// --- 生成物がソースと一致しているか ---
try {
  execFileSync(
    "node",
    [
      path.join(repoRoot, "scripts/maintenance/generate-lib-index.js"),
      "--check",
    ],
    { stdio: "inherit", cwd: repoRoot },
  );
} catch {
  process.exit(1);
}

console.log(
  `OK: 索引の抽出ロジック${checked}件と、${OUTPUT_PATH} の最新性を検証`,
);
