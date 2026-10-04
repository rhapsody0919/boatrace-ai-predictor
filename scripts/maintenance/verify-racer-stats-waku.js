#!/usr/bin/env node
/**
 * racerStats を「コース」として読む画面のコードが戻ってこないことを検証する（BOA-302）。DB接続は不要。
 *
 * racerStats（predictions.feature_contributions.racerStats）の course / courseRaceCounts は
 * 中身が枠番で、BOA-284 で枠番キーのまま維持すると決まった。画面側は境界
 * （src/utils/racerStats.js の toWakuRacerStats）で wakuRaceCounts に詰め替えて読む。
 * 「コース→枠番」の表示修正が3チケット続いた（BOA-268・BOA-299・BOA-302）のは、
 * 新しい画面が course の名前を見て実進入コースと読み違えたため。
 *
 *   1. src/ のコード行（コメントを除く）に courseRaceCounts・courseRateOf・table.courseWinRate が無い
 *      （src/utils/racerStats.js の詰め替えだけは保存側のキーを読むので除く）
 *   2. toWakuRacerStats が courseRaceCounts を wakuRaceCounts に移し、course を渡さない
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toWakuRacerStats } from "../../src/utils/racerStats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const ALLOWED = new Set(["src/utils/racerStats.js"]);
const FORBIDDEN = [
  /\bcourseRaceCounts\b/,
  /\bcourseRateOf\b/,
  /["']table\.courseWinRate["']/,
];

const errors = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(entry.name)) checkFile(full);
  }
}

function checkFile(full) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  if (ALLOWED.has(rel)) return;
  const lines = fs.readFileSync(full, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*"))
      return;
    for (const re of FORBIDDEN) {
      if (re.test(line))
        errors.push(
          `${rel}:${i + 1}: ${re} を読んでいる（枠番は wakuRaceCounts で読む）`,
        );
    }
  });
}

walk(SRC);

const saved = [
  {
    boatNumber: 3,
    course: 3,
    avgST: 0.15,
    attackDistribution: { 3: { makuri: 0.5 } },
    defenseDistribution: null,
    courseRaceCounts: { 3: { total: 10, wins: 2 } },
  },
];
const got = toWakuRacerStats(saved);
const expected = [
  {
    boatNumber: 3,
    avgST: 0.15,
    attackDistribution: { 3: { makuri: 0.5 } },
    defenseDistribution: null,
    wakuRaceCounts: { 3: { total: 10, wins: 2 } },
  },
];
if (JSON.stringify(got) !== JSON.stringify(expected)) {
  errors.push(`toWakuRacerStats の詰め替えが違う: ${JSON.stringify(got)}`);
}
if (toWakuRacerStats(null) !== null)
  errors.push("toWakuRacerStats(null) が null でない");

if (errors.length > 0) {
  console.error(`❌ racerStats の枠番読みの検証に失敗（${errors.length}件）`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("✅ racerStats は枠番（wakuRaceCounts）で読まれている");
