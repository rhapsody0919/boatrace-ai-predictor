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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const TARGET = path.join(ROOT, "src/utils/raceOutcome.js");

// 本番の実データ（2026-09-29 に execute_sql で確認した race_results の値）
const HAMANAKO_NO_RACE = {
  finished: true,
  rank1: 4,
  rank2: 1,
  rank3: 2,
  raceStatus: "no_race",
  refundBoats: [1, 2, 3, 5, 6],
};
const TODA_PARTIAL = {
  finished: true,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  raceStatus: "partial_refund",
  refundBoats: [3, 4, 5, 6],
};
const KIRYU_PARTIAL = {
  finished: true,
  rank1: 2,
  rank2: 1,
  rank3: 4,
  raceStatus: "partial_refund",
  refundBoats: [3, 5, 6],
};
const NORMAL = {
  finished: true,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  raceStatus: "normal",
  refundBoats: [],
};
// RPC未適用（raceStatus が届かない）。is_no_race は全行 false
const UNAPPLIED = {
  finished: true,
  rank1: 4,
  rank2: 1,
  rank3: 2,
  isNoRace: false,
};

const patterns = (...courses) =>
  courses.map((c) => ({
    winnerCourse: c,
    technique: "nige",
    probability: 0.3,
  }));

function runChecks(m) {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail });
  const show = (v) => JSON.stringify(v);

  // 1. 成立状態
  check(
    "不成立: race_status='no_race' → no_race",
    m.getRaceOutcomeState(HAMANAKO_NO_RACE) === "no_race",
  );
  check(
    "一部返還 → partial_refund",
    m.getRaceOutcomeState(TODA_PARTIAL) === "partial_refund",
  );
  check("通常 → normal", m.getRaceOutcomeState(NORMAL) === "normal");
  check(
    "RPC未適用（raceStatus なし） → unknown",
    m.getRaceOutcomeState(UNAPPLIED) === "unknown",
  );
  check(
    "旧フラグ isNoRace=true だけでは不成立にしない（is_no_race は読まない）",
    m.getRaceOutcomeState({ ...UNAPPLIED, isNoRace: true }) === "unknown",
  );
  check(
    "race_results の生の行（race_status）も受ける",
    m.getRaceOutcomeState({ race_status: "no_race" }) === "no_race",
  );
  check(
    "未知の値は unknown",
    m.getRaceOutcomeState({ raceStatus: "weird" }) === "unknown",
  );
  check("null は unknown", m.getRaceOutcomeState(null) === "unknown");

  // isJudgeable
  check("不成立は判定不可", m.isJudgeable(HAMANAKO_NO_RACE) === false);
  check("一部返還は判定可", m.isJudgeable(TODA_PARTIAL) === true);
  check("RPC未適用は今までどおり判定可", m.isJudgeable(UNAPPLIED) === true);
  check(
    "rank1 が無ければ判定不可",
    m.isJudgeable({ finished: true, rank1: null }) === false,
  );
  check(
    "未確定は判定不可",
    m.isJudgeable({ finished: false, rank1: 1 }) === false,
  );

  // isBoatRefunded
  check("返還艇（戸田9R の3号艇）", m.isBoatRefunded(TODA_PARTIAL, 3) === true);
  check(
    "返還でない艇（戸田9R の1号艇）",
    m.isBoatRefunded(TODA_PARTIAL, 1) === false,
  );
  check("文字列の艇番も受ける", m.isBoatRefunded(TODA_PARTIAL, "4") === true);
  check(
    "refund_boats 未判定は返還でない",
    m.isBoatRefunded(UNAPPLIED, 1) === false,
  );
  check(
    "生の行（refund_boats）も受ける",
    m.isBoatRefunded({ refund_boats: [2] }, 2) === true,
  );

  // 2. 展開予測
  const noRaceJ = m.judgeTurnPrediction(patterns(1, 3, 4), HAMANAKO_NO_RACE);
  check(
    "不成立（浜名湖9/14 6R）: rank1=4 が候補にあっても判定対象外",
    noRaceJ.status === "not_judgeable" && noRaceJ.winner === null,
    show(noRaceJ),
  );
  const kiryuJ = m.judgeTurnPrediction(patterns(2, 1, 3), KIRYU_PARTIAL);
  check(
    "一部返還（桐生9/24 8R）: 1着=2号艇で的中、返還艇3号艇に印",
    kiryuJ.status === "hit" &&
      kiryuJ.winner === 2 &&
      show(kiryuJ.refundedCourses) === "[3]",
    show(kiryuJ),
  );
  const todaJ = m.judgeTurnPrediction(patterns(3, 4), TODA_PARTIAL);
  check(
    "一部返還: 候補が返還艇だけなら外れ（1着は決まっている）",
    todaJ.status === "miss" && show(todaJ.refundedCourses) === "[3,4]",
    show(todaJ),
  );
  check(
    "通常: 一致すれば的中",
    m.judgeTurnPrediction(patterns(1), NORMAL).status === "hit",
  );
  check(
    "通常: 一致しなければ外れ",
    m.judgeTurnPrediction(patterns(2, 3), NORMAL).status === "miss",
  );
  check(
    "RPC未適用: 今までどおり rank1 で判定（#949 以前と同じ）",
    m.judgeTurnPrediction(patterns(4), UNAPPLIED).status === "hit",
  );
  check(
    "予想なしは判定対象外",
    m.judgeTurnPrediction([], NORMAL).status === "not_judgeable",
  );
  check(
    "patterns が null でも落ちない",
    m.judgeTurnPrediction(null, NORMAL).status === "not_judgeable",
  );

  // 3. 買い目
  check(
    "返還艇を含む買い目は判定対象外",
    m.isBetJudgeable(TODA_PARTIAL, [1, 2, 3]) === false,
  );
  check(
    "返還艇を含まない買い目は判定可",
    m.isBetJudgeable(TODA_PARTIAL, [1, 2]) === true,
  );
  check(
    "不成立は買い目も判定対象外",
    m.isBetJudgeable(HAMANAKO_NO_RACE, [4]) === false,
  );

  // 4. 記号
  const refundMarks = Object.entries(m.FINISH_MARKS)
    .filter(([, v]) => v.refund)
    .map(([k]) => k)
    .sort();
  check(
    "返還の記号は F・L・欠のみ",
    show(refundMarks) === show(["F", "L", "欠"].sort()),
    show(refundMarks),
  );
  check("全角 Ｆ を F に正規化", m.normalizeFinishMark("Ｆ") === "F");
  check("全角 ＿ を _ に正規化", m.normalizeFinishMark("＿") === "_");
  check("空文字は null", m.normalizeFinishMark("  ") === null);

  // 払戻
  check(
    "最高配当の対象: 通常",
    m.isPayoutAmountCountable({ status: "paid", amount: 870 }) === true,
  );
  check(
    "最高配当の対象: 特払",
    m.isPayoutAmountCountable({ status: "special", amount: 70 }) === true,
  );
  check(
    "最高配当の対象外: 不成立",
    m.isPayoutAmountCountable({ status: "no_race", amount: null }) === false,
  );
  check(
    "最高配当の対象外: 金額なし",
    m.isPayoutAmountCountable({ status: "no_amount", amount: null }) === false,
  );
  check(
    "払戻表の並びはモックどおり（単勝・複勝・3連単・3連複・2連単・2連複・拡連複）",
    m.PAYOUT_BET_TYPES.map((b) => b.betType).join(",") ===
      "win,place,3tan,3fuku,2tan,2fuku,wide",
  );
  check(
    "3連単=trifecta・3連複=trio（race_results の列名の逆転を持ち込まない）",
    m.PAYOUT_BET_TYPES.find((b) => b.betType === "3tan").typeKey ===
      "trifecta" &&
      m.PAYOUT_BET_TYPES.find((b) => b.betType === "3fuku").typeKey === "trio",
  );

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

if (failed > 0) {
  console.error(`\nNG: ${failed}件`);
  process.exit(1);
}
console.log("\nOK: 不成立・返還の判定関数の検証に成功しました");
