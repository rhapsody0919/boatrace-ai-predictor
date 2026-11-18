#!/usr/bin/env node
/**
 * verify-race-outcome.js — 不成立・返還の判定関数（src/utils/raceOutcome.js）の回帰テスト（BOA-543）。
 * DB接続は不要。
 *
 * 守るもの:
 *   1. 成立状態の判定: race_status を正とし、NULL（078以前・RPC未適用）は 'unknown'（今までどおり）。
 *      旧フラグ is_no_race は見ない（全行 false で機能していない。078）
 *   2. 展開予測の的中判定: 不成立は判定対象外（本番で浜名湖 2026-09-14 6R に「展開的中」が付いていた。
 *      rank1=4 は不成立で唯一フライングしなかった艇で、1着ではない）。一部返還は1着で通常どおり判定し、
 *      返還艇の候補に印を付ける
 *   3. 買い目の判定可否（BOA-544 が使う）: 返還艇を含む買い目は対象外
 *   4. 着欄の記号: 返還は F・L・欠のみ（078。転・落・沈・妨・エ・不・失は返還ではない）
 *   5. 画面側で的中の判定を独自に書き直していない（RaceCard・TurnPatternList・HitRaces が
 *      judgeTurnPrediction を通す）。src/components で `winnerCourse === ...rank1` の直接比較と、
 *      旧フラグ isNoRace の読み取りを検知する
 *
 * 末尾の変異検証で、要を1つずつ壊したコピーに同じ検証をかけ、検証が失敗する（＝歯がある）ことを確かめる。
 *
 * 使い方: node scripts/maintenance/verify-race-outcome.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  raceOutcomeKeyChecks,
  raceOutcomeStatusChecks,
  raceOutcomeTurnChecks,
  raceOutcomePayoutChecks,
  raceOutcomeVoidTableChecks,
  raceOutcomePartialVoidChecks,
} from "./verifyData/race-outcome-checks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const TARGET = path.join(ROOT, "src/utils/raceOutcome.js");

function runChecks(m) {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail });
  const show = (v) => JSON.stringify(v);

  raceOutcomeKeyChecks(m, check, show);
  raceOutcomeStatusChecks(m, check);
  raceOutcomeTurnChecks(m, check, show);
  raceOutcomePayoutChecks(m, check);
  // 不成立になる勝式の表（BOA-558）。2026-10-02 に本番の race_payouts と race_start_timings を
  // 突き合わせた実データ（返還・失格・完走不足のある154レースが全件一致）
  if (typeof m.expectedVoidBetTypes === "function") {
    raceOutcomeVoidTableChecks(m, check);
    raceOutcomePartialVoidChecks(m, check, show);
  } else {
    check(
      "expectedVoidBetTypes / describePartialVoid がある（BOA-558）",
      false,
    );
  }

  return results;
}

// 5. 画面側の直接比較・旧フラグの読み取り（静的検査）
function staticChecks() {
  const problems = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(jsx?|mjs)$/.test(name)) {
        const src = fs.readFileSync(full, "utf8");
        const rel = path.relative(ROOT, full);
        if (/winnerCourse\s*===\s*[\w.?]*rank1\b/.test(src)) {
          problems.push(
            `${rel}: 展開予測の的中を winnerCourse === rank1 で直接判定している（judgeTurnPrediction を使う）`,
          );
        }
        if (/\bresult\??\.isNoRace\b/.test(src)) {
          problems.push(
            `${rel}: 旧フラグ isNoRace を読んでいる（getRaceOutcomeState を使う）`,
          );
        }
      }
    }
  };
  walk(path.join(ROOT, "src/components"));
  return problems;
}

let failed = 0;
const target = await import(pathToFileURL(TARGET).href);
console.log("## 判定関数（src/utils/raceOutcome.js）");
for (const r of runChecks(target)) {
  if (r.ok) console.log(`✅ ${r.name}`);
  else {
    failed++;
    console.error(`❌ ${r.name}${r.detail ? `\n  ${r.detail}` : ""}`);
  }
}

console.log("\n## 画面側が判定関数を通しているか（src/components）");
const problems = staticChecks();
if (problems.length === 0) console.log("✅ 直接比較・旧フラグの読み取りなし");
for (const p of problems) {
  failed++;
  console.error(`❌ ${p}`);
}

// 変異検証
const MUTANTS = [
  {
    name: "getRefundBoats が整数以外を除かない",
    from: ".filter((boat) => Number.isInteger(boat))",
    to: "",
  },
  {
    name: "winnerEntryCourseOf が actual_course を優先しない",
    from: "if (actual != null) return actual;",
    to: "",
  },
  {
    name: "race_status が NULL のとき is_no_race を見る",
    from: "const status = result?.raceStatus ?? result?.race_status ?? null;",
    to: 'const status = result?.raceStatus ?? result?.race_status ?? (result?.isNoRace ? "no_race" : null);',
  },
  {
    name: "isJudgeable が不成立を除かない",
    from: "return getRaceOutcomeState(result) !== RACE_OUTCOME.NO_RACE;",
    to: "return true;",
  },
  {
    name: "isBetJudgeable が返還艇を見ない",
    from: "return !(boats ?? []).some((boat) => isBoatRefunded(result, boat));",
    to: "return true;",
  },
  {
    name: "欠を返還でない扱いにする",
    from: '欠: { key: "absent", refund: true },',
    to: '欠: { key: "absent", refund: false },',
  },
  {
    name: "転を返還扱いにする",
    from: '転: { key: "capsized", refund: false },',
    to: '転: { key: "capsized", refund: true },',
  },
  {
    name: "特払を最高配当の対象から外す",
    from: "row?.status === PAYOUT_STATUS.SPECIAL",
    to: "false",
  },
];

console.log("\n## 変異検証");
const source = fs.readFileSync(TARGET, "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "race-outcome-mutants-"));
for (const [i, mutant] of MUTANTS.entries()) {
  if (!source.includes(mutant.from)) {
    failed++;
    console.error(`❌ 変異の対象が見つかりません: ${mutant.name}`);
    continue;
  }
  const file = path.join(tmp, `m${i}.mjs`);
  fs.writeFileSync(file, source.replace(mutant.from, mutant.to));
  let detected = false;
  try {
    const m = await import(pathToFileURL(file).href);
    detected = runChecks(m).some((r) => !r.ok);
  } catch {
    detected = true;
  }
  if (detected) console.log(`✅ 変異「${mutant.name}」を検出できる`);
  else {
    failed++;
    console.error(`❌ 変異「${mutant.name}」を検出できない（検証に歯が無い）`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

// DB の整数列では起きない入力。仕様未定のため assert・変異判定には含めない。
const KNOWN_GAPS = [
  {
    input: 'getRefundBoats({refundBoats: [null, 0, 7, true]})',
    specification: "型変換で生じる値・艇番の範囲外の扱いは未定",
    current: () => target.getRefundBoats({ refundBoats: [null, 0, 7, true] }),
  },
  {
    input: 'winnerEntryCourseOf({rank1: 3, actual_course_3: 0}, 4)',
    specification: "actual_course が 0 の扱いは未定",
    current: () => target.winnerEntryCourseOf({ rank1: 3, actual_course_3: 0 }, 4),
  },
  {
    input: 'winnerEntryCourseOf({rank1: 0}, 1)',
    specification: "rank1 が 0 の扱いは未定",
    current: () => target.winnerEntryCourseOf({ rank1: 0 }, 1),
  },
];
console.log(`\n## KNOWN_GAPS: ${KNOWN_GAPS.length}件（判定対象外）`);
for (const gap of KNOWN_GAPS) {
  console.log(`${gap.input}: ${gap.specification} / 今の値=${JSON.stringify(gap.current())}`);
}

if (failed > 0) {
  console.error(`\nNG: ${failed}件`);
  process.exit(1);
}
console.log("\nOK: 不成立・返還の判定関数の検証に成功しました");
