/**
 * verify-race-status-exclusion.js - 画面（src/）の集計が、不成立のレースを race_results.race_status で外していることの
 * 静的検査（BOA-477）。DBには接続しない。
 *
 * 旧フラグ is_cancelled・is_no_race は、どのスクリプトからも書かれていない（常に false）。画面がこれで判定していたため、
 * 不成立（race_status='no_race'）のレースが選手・会場の成績集計に混ざっていた（2026-10-02 時点で8レース）。
 * 078 の方針は「race_status IS DISTINCT FROM 'no_race'」（NULL は通常として通す）。
 *
 * 確認すること:
 *   - src/ と api/ が、旧フラグ is_cancelled・is_no_race を select・判定に使っていない（コメントは除く）
 *   - supabaseDataService.js の isUsableRaceResult が、raceOutcome.js の getRaceOutcomeState で不成立を外している
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(m?js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

/** 行コメント・ブロックコメントの行を除いた、コードの行だけを返す */
function codeLines(text) {
  return text
    .split("\n")
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

const offenders = [];
for (const dir of ["src", "api"]) {
  for (const file of walk(path.join(ROOT, dir))) {
    for (const { line, no } of codeLines(fs.readFileSync(file, "utf8"))) {
      if (/\bis_no_race\b|\bis_cancelled\b/.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${no}`);
      }
    }
  }
}
check(
  "src/・api/ のコードが、書かれていない旧フラグ is_cancelled・is_no_race を読んでいない",
  offenders.length === 0,
  offenders.slice(0, 10).join(", "),
);

const service = fs.readFileSync(
  path.join(ROOT, "src/services/supabaseDataService.js"),
  "utf8",
);
const usable = /function isUsableRaceResult\(result\) \{([\s\S]*?)\n\}/.exec(
  service,
);
const noRace = /function isNoRaceResult\(result\) \{([\s\S]*?)\n\}/.exec(
  service,
);
check(
  "isUsableRaceResult は、不成立（getRaceOutcomeState が NO_RACE）と rank1 の無い行を外す",
  !!usable &&
    /isNoRaceResult\(result\)/.test(usable[1]) &&
    /rank1 !== null/.test(usable[1]) &&
    !!noRace &&
    /getRaceOutcomeState\(result\) === RACE_OUTCOME\.NO_RACE/.test(noRace[1]),
);

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
