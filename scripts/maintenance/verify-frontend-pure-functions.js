#!/usr/bin/env node
/**
 * 画面側の純関数（DB・ネットワーク・DOMに依存しない集計・判定）の回帰テスト（BOA-255）。
 * DB接続は不要。
 *
 * 対象は「2026-08-15以降に fix コミットが入った」かつ「既存の verify-* から検証されていない」
 * ファイルを fix 件数順に選んだもの（選定表は BOA-255 の PR 本文）。各検証は、実際に起きた
 * バグを再現する入力を含み、そのバグが再発すると落ちる。
 *
 *   1. src/components/race/basicInfoStats.js  … 基本情報・直前情報・今節タブの集計
 *   2. src/utils/raceStatus.js                … レースの締切前/結果反映待ち/確定の判定
 *   3. src/components/race/courseGridStats.js … 枠別情報タブのコース別成績
 *   4. src/components/race/venueDayTrend.js   … 「この日の水面傾向」の1行要約
 *   5. src/utils/weatherInfo.js（移す前は src/components/race/weatherInfo.js）… 気象の観測時刻の表示
 *   6. src/utils/dateUtils.js                 … ブログ一覧の NEW バッジ（isWithinDays）
 *
 * 末尾の変異検証で、各関数の要（過去に壊れた箇所を含む）を1つずつ壊したコピーに同じ検証を
 * かけ、検証が失敗する（＝歯がある）ことを確かめる。
 *
 * 期間フィルタ（last3m / last1m）は既定で実行時の現在日時に依存するため、日付は「今日から何日前」で
 * 作り、境界から十分離す（同じコミットなら常に同じ結果になるように）。境界そのものを見る検証
 * （BOA-469）は filterRecords の now で現在時刻を固定する。TZ=UTC / TZ=Asia/Tokyo の両方で通ること。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { show } from "./verifyData/frontend-pure-functions-common.js";
import { suiteBasicInfoStats } from "./verifyData/frontend-pure-functions-basic-info1.js";
import { suiteCourseGridStats, suiteSixBoatCourseStats } from "./verifyData/frontend-pure-functions-course-six.js";
import { suitePrevResult, suiteHscrollHint, suiteVolatilityHighlights } from "./verifyData/frontend-pure-functions-prev-hscroll-vol.js";
import {
  suiteDateUtils,
  suiteFinishPosition,
  suiteMeetGrouping,
  suiteNextOpenDate,
  suiteRaceStatus,
  suiteTurnPrediction,
  suiteVenueDayTrend,
  suiteWeatherInfo,
} from "./verifyData/frontend-pure-functions-suites-1.js";
import {
  suiteCautionEvents,
  suiteInCautionAccuracy,
  suiteMeetStRank,
  suiteMotorMeetParts,
  suiteSemifinalCount,
  suiteVolatilityLevel,
} from "./verifyData/frontend-pure-functions-suites-2.js";
import { MUTANTS } from "./verifyData/frontend-pure-functions-mutants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

// RA41（BOA-1501）で src/components/race から src/pure へ移す3本は、移す前後のどちらでも本体のある方を見る
// （移した後の元の場所は export * の殻で、変異の文字列が無いため）。移した後に元の場所の分岐は外す
const bodyOf = (pure, old) =>
  fs.existsSync(path.join(ROOT, pure)) ? pure : old;

const TARGETS = {
  motorMeetParts: "src/utils/motorMeetParts.js",
  meetStRank: "src/components/race/meetStRank.js",
  semifinalCount: "src/pure/semifinalCount.js",
  finishPosition: "src/pure/finishPosition.js",
  basicInfoStats: bodyOf(
    "src/pure/basicInfoStats.js",
    "src/components/race/basicInfoStats.js",
  ),
  raceStatus: "src/utils/raceStatus.js",
  courseGridStats: bodyOf(
    "src/pure/courseGridStats.js",
    "src/components/race/courseGridStats.js",
  ),
  sixBoatCourseStats: bodyOf(
    "src/pure/sixBoatCourseStats.js",
    "src/components/race/sixBoatCourseStats.js",
  ),
  venueDayTrend: "src/components/race/venueDayTrend.js",
  weatherInfo: bodyOf("src/utils/weatherInfo.js", "src/components/race/weatherInfo.js"),
  dateUtils: "src/utils/dateUtils.js",
  prevResult: "src/utils/prevResult.js",
  nextOpenDate: "src/utils/nextOpenDate.js",
  meetGrouping: "src/utils/meetGrouping.js",
  meetGroupingPure: "src/pure/meetGrouping.js",
  turnPrediction: "src/utils/turnPrediction.js",
  volatilityLevel: "src/utils/volatilityLevel.js",
  hscrollHint: "src/utils/horizontalScrollHint.js",
  volatilityHighlights: "src/utils/volatilityHighlights.js",
  inCautionLevel: "src/utils/inCautionLevel.js",
  cautionEvents: "src/utils/cautionEvents.js",
  inCautionAccuracy: "src/utils/inCautionAccuracy.js",
};

// BOA-822 イン崩れ注意度の段・帯。帯の答えは Python の夜の集計（in_caution_bands.py）の pytest と同じ固定の入力
// （scripts/ml/analogy/tests/fixtures/in_caution_cases.json）で確かめる
const IN_CAUTION_CASES = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "scripts/ml/analogy/tests/fixtures/in_caution_cases.json"),
    "utf8",
  ),
).gapCases;

function suiteInCautionLevel(m, check) {
  for (const c of IN_CAUTION_CASES) {
    const [b1, ...others] = c.rates.map(m.rateCents);
    const top = others.filter((v) => v !== null);
    const gap = b1 === null || top.length === 0 ? null : b1 - Math.max(...top);
    check(`inCaution: ${c.name}`, [gap, m.bandOf(gap)], [c.gapCents, c.band]);
  }
  // 整数だけで四捨五入: 34.49% は 34、34.5% は 35（段は 35 から中くらい）、54.5% は 55（崩れやすい）
  const at = (nonWin, n) => [m.pctOf(nonWin, n), m.levelOf(m.pctOf(nonWin, n))];
  check("inCaution: 3449/10000 は 34%・堅め", at(3449, 10000), [34, "low"]);
  check("inCaution: 345/1000 は 35%・中くらい", at(345, 1000), [35, "mid"]);
  check("inCaution: 5449/10000 は 54%・中くらい", at(5449, 10000), [54, "mid"]);
  check("inCaution: 545/1000 は 55%・崩れやすい", at(545, 1000), [55, "high"]);
  check(
    "inCaution: 浮動小数で丸めるとずれる組（29/200=14.5%、57/200=28.5%、113/200=56.5%）も整数で四捨五入",
    [m.pctOf(29, 200), m.pctOf(57, 200), m.pctOf(113, 200)],
    [15, 29, 57],
  );
  check(
    "inCaution: 例のレース (other, −5) 22634/34842 は 65%・崩れやすい",
    at(22634, 34842),
    [65, "high"],
  );
  check(
    "inCaution: 件数0は null（0 で割らない）",
    [m.pctOf(0, 0), m.levelOf(null)],
    [null, null],
  );
  check(
    "inCaution: 帯の範囲（端は片側だけ）",
    [m.bandRange(-8), m.bandRange(-5), m.bandRange(0), m.bandRange(6)],
    [
      { from: null, to: -3.5 },
      { from: -2.5, to: -2 },
      { from: 0, to: 0.5 },
      { from: 3, to: null },
    ],
  );
  check(
    "inCaution: 符号の書き方（負は全角のマイナス、正は +、0 は符号なし）",
    [
      m.signedText(-2.12, 2),
      m.signedText(3, 1),
      m.signedText(0, 1),
      m.signedText(-0.5, 1),
    ],
    ["−2.12", "+3.0", "0.0", "−0.5"],
  );
  check(
    "inCaution: 1号艇の着順（rank1〜6 はその着の艇番、いなければ null）、日付の書き方",
    [
      m.boat1Rank({ rank1: 2, rank2: 1 }),
      m.boat1Rank({ rank1: 1 }),
      m.boat1Rank({
        rank1: 2,
        rank2: 3,
        rank3: 4,
        rank4: 5,
        rank5: 6,
        rank6: null,
      }),
      m.boat1Rank(null),
      m.slashDate("2019-04-01"),
      m.slashDate(null),
    ],
    [2, 1, null, null, "2019/4/1", ""],
  );
  check(
    "inCaution: ラウンド（準々・準優進出は other、空も other）",
    ["準優勝戦", "優勝戦", "予選", "準優進出戦", "", null].map(m.roundOf),
    ["junyu", "yusho", "other", "other", "other", "other"],
  );
}

const SUITES = {
  motorMeetParts: suiteMotorMeetParts,
  meetStRank: suiteMeetStRank,
  semifinalCount: suiteSemifinalCount,
  nextOpenDate: suiteNextOpenDate,
  prevResult: suitePrevResult,
  finishPosition: suiteFinishPosition,
  basicInfoStats: suiteBasicInfoStats,
  raceStatus: suiteRaceStatus,
  courseGridStats: suiteCourseGridStats,
  sixBoatCourseStats: suiteSixBoatCourseStats,
  venueDayTrend: suiteVenueDayTrend,
  weatherInfo: suiteWeatherInfo,
  dateUtils: suiteDateUtils,
  meetGrouping: suiteMeetGrouping,
  meetGroupingPure: suiteMeetGrouping,
  turnPrediction: suiteTurnPrediction,
  volatilityLevel: suiteVolatilityLevel,
  hscrollHint: suiteHscrollHint,
  volatilityHighlights: suiteVolatilityHighlights,
  inCautionLevel: suiteInCautionLevel,
  cautionEvents: suiteCautionEvents,
  inCautionAccuracy: suiteInCautionAccuracy,
};

const MUTANT_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "frontend-pure-mutants-"),
);

// 壊したコピーは一時ディレクトリに置く（src/ を汚さない）。相対 import は元ファイルの
// 場所から解決した絶対URLに書き換える
async function loadMutant(index, target, from, to) {
  const srcPath = path.join(ROOT, TARGETS[target]);
  const source = fs.readFileSync(srcPath, "utf8");
  if (!source.includes(from)) {
    throw new Error(
      `変異の対象が見つかりません（${TARGETS[target]}）: ${from.slice(0, 60)}`,
    );
  }
  const mutated = source
    .replace(from, to)
    .replace(/from "(\.{1,2}\/[^"]+)"/g, (_, spec) => {
      const href = pathToFileURL(
        path.resolve(path.dirname(srcPath), spec),
      ).href;
      return `from "${href}"`;
    });
  const file = path.join(MUTANT_DIR, `m${index}-${target}.mjs`);
  fs.writeFileSync(file, mutated);
  return import(pathToFileURL(file).href);
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
let failures = 0;

for (const [target, suite] of Object.entries(SUITES)) {
  console.log(`\n## ${TARGETS[target]}`);
  const mod = await import(
    pathToFileURL(path.join(ROOT, TARGETS[target])).href
  );
  suite(mod, (label, actual, expected) => {
    const a = show(actual);
    const e = show(expected);
    if (a === e) {
      console.log(`✅ ${label}`);
    } else {
      failures++;
      console.error(`❌ ${label}\n  expected: ${e}\n  actual:   ${a}`);
    }
  });
}

console.log("\n## 変異検証");
for (const [i, [target, name, from, to]] of MUTANTS.entries()) {
  let killed = false;
  let detail = "検出されなかった（この変異を入れても検証が通る）";
  try {
    const mod = await loadMutant(i, target, from, to);
    let failed = 0;
    try {
      SUITES[target](mod, (_label, actual, expected) => {
        if (show(actual) !== show(expected)) failed++;
      });
    } catch {
      failed++; // 変異したモジュールが例外を投げた場合も検出とみなす
    }
    killed = failed > 0;
  } catch (error) {
    detail = error.message;
  }
  if (killed) {
    console.log(`✅ 変異検証（${target}）: 「${name}」を検出できる`);
  } else {
    failures++;
    console.error(`❌ 変異検証（${target}）: 「${name}」\n  ${detail}`);
  }
}

fs.rmSync(MUTANT_DIR, { recursive: true, force: true });

console.log(failures === 0 ? "\n✅ 全テスト成功" : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
