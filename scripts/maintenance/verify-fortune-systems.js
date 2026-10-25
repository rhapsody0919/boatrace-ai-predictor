/**
 * BOA-1073: コメントの配点・日付境界と ADR-0021 の12分類を固定する。
 * 期待値は対象の定数・関数から生成せず、表と基準日の手計算から置く。
 * 不明な仕様は KNOWN_GAPS で観測のみ行う。ネットワーク・DB・実時刻不要。
 */
import assert from "node:assert/strict";
import { calculateScore as western } from "../lib/fortuneTelling/westernAstrology.js";
import { calculateScore as kyusei } from "../lib/fortuneTelling/kyuseiKigaku.js";
import { calculateScore as shichu } from "../lib/fortuneTelling/shichuSuimei.js";
import { calculateScore as rokusei } from "../lib/fortuneTelling/rokuseiSenjutsu.js";
import { FORTUNE_SYSTEMS } from "../lib/fortuneTelling/index.js";

let failures = 0;
let tests = 0;
function test(name, run) {
  tests++;
  try {
    run();
    console.log(`✅ ${name}`);
  } catch (error) {
    failures++;
    console.error(`❌ ${name}: ${error.message}`);
  }
}
function scoreCase(name, calculate, birth, target, score, label) {
  test(name, () => {
    const actual = calculate(birth, target);
    assert.deepEqual(actual, { score, label });
    assert.ok(Number.isInteger(actual.score) && actual.score >= 0 && actual.score <= 100);
    assert.equal(typeof actual.label, "string");
    assert.deepEqual(calculate(birth, target), actual);
  });
}

test("FORTUNE_SYSTEMS: 4件のIDと関数参照", () => {
  const expected = [
    ["western-astrology", western], ["shichu-suimei", shichu],
    ["kyusei-kigaku", kyusei], ["rokusei-senjutsu", rokusei],
  ];
  assert.equal(FORTUNE_SYSTEMS.length, 4);
  assert.deepEqual(FORTUNE_SYSTEMS.map(({ id }) => id).sort(), expected.map(([id]) => id).sort());
  for (const [id, calculate] of expected) {
    assert.equal(FORTUNE_SYSTEMS.find((system) => system.id === id).calculateScore, calculate);
  }
});

// 星座の開始日・終了日を両方固定（山羊座だけ年をまたぐ）。
const ZODIAC_CASES = [
  ["03-21", "04-19", "牡羊座"], ["04-20", "05-20", "牡牛座"],
  ["05-21", "06-20", "双子座"], ["06-21", "07-22", "蟹座"],
  ["07-23", "08-22", "獅子座"], ["08-23", "09-22", "乙女座"],
  ["09-23", "10-22", "天秤座"], ["10-23", "11-21", "蠍座"],
  ["11-22", "12-21", "射手座"], ["12-22", "01-19", "山羊座"],
  ["01-20", "02-18", "水瓶座"], ["02-19", "03-20", "魚座"],
];
for (const [start, end, label] of ZODIAC_CASES) {
  scoreCase(`西洋: ${label}の両端`, western, `2000-${start}`, `2000-${end}`, 80, `${label}×${label}`);
}
const ASPECTS = [80, 55, 75, 30, 90, 40, 25, 40, 90, 30, 75, 55];
for (const [index, [date, , label]] of ZODIAC_CASES.entries()) {
  scoreCase(`西洋: 牡羊座から${label}への距離`, western,
    "2000-03-21", `2000-${date}`, ASPECTS[index], `牡羊座×${label}`);
}
scoreCase("西洋: 魚座から牡羊座の境界", western, "2000-03-20", "2000-03-21", 55, "魚座×牡羊座");
scoreCase("西洋: 山羊座から水瓶座の境界", western, "2000-12-22", "2000-01-20", 55, "山羊座×水瓶座");

const KYUSEI_CASES = [
  ["1980-06-01", "2026-10-25", 55, "二黒土星", "一白水星"],
  ["1990-06-01", "2026-10-25", 65, "一白水星", "一白水星"],
  ["1999-06-01", "2026-10-25", 65, "一白水星", "一白水星"],
  ["2000-06-01", "2026-10-25", 30, "九紫火星", "一白水星"],
  ["1980-02-03", "2026-10-25", 85, "三碧木星", "一白水星"],
  ["1980-01-01", "2026-10-25", 85, "三碧木星", "一白水星"],
  ["1980-02-04", "2026-10-25", 55, "二黒土星", "一白水星"],
  ["1980-06-01", "2026-02-03", 65, "二黒土星", "二黒土星"],
  ["1980-06-01", "2026-02-04", 55, "二黒土星", "一白水星"],
  ["1980-06-01", "2024-06-01", 30, "二黒土星", "三碧木星"],
  ["1980-06-01", "2027-06-01", 85, "二黒土星", "九紫火星"],
  ["1980-06-01", "2028-06-01", 65, "二黒土星", "八白土星"],
  ["1980-06-01", "2029-06-01", 60, "二黒土星", "七赤金星"],
  ["1980-06-01", "2030-06-01", 60, "二黒土星", "六白金星"],
  ["1980-06-01", "2031-06-01", 65, "二黒土星", "五黄土星"],
  ["1980-06-01", "2032-06-01", 30, "二黒土星", "四緑木星"],
];
for (const [birth, target, score, natal, transit] of KYUSEI_CASES) {
  scoreCase(`九星: ${birth}×${target}`, kyusei, birth, target, score, `本命${natal}×年盤${transit}`);
}

// 2008-02-06=丙子、10-05=戊寅、2006-12-31=甲午（verify-sexagenary-cycle）。
const SHICHU_CASES = [
  ["2006-12-31", 85, "甲午(木)"], ["2008-10-05", 60, "戊寅(土)"],
  ["2008-02-06", 65, "丙子(火)"], ["2008-02-07", 65, "丁丑(火)"],
  ["2008-02-10", 55, "庚辰(金)"], ["2008-02-11", 55, "辛巳(金)"],
  ["2008-02-12", 30, "壬午(水)"], ["2008-02-13", 30, "癸未(水)"],
  ["2008-02-14", 85, "甲申(木)"], ["2008-02-15", 85, "乙酉(木)"],
  ["2008-02-08", 60, "戊寅(土)"], ["2008-02-09", 60, "己卯(土)"],
];
for (const [target, score, label] of SHICHU_CASES) {
  scoreCase(`四柱: 丙子×${label}`, shichu, "2008-02-06", target, score, `日主丙子(火)×${label}`);
  scoreCase(`四柱: ${label}×丙子の逆方向`, shichu, target, "2008-02-06",
    ({ 85: 60, 60: 85, 65: 65, 55: 30, 30: 55 })[score], `日主${label}×丙子(火)`);
}

// 各旬の最初の日と、2008年=子(陽)・2009年=丑(陰)で独立に12分類を列挙。
// 年の途中の日を使い、未定の年境界（暦年か立春か）を固定しない。
const CATEGORIES = [
  ["2008-07-23", "土星人+"], ["2009-07-18", "土星人-"],
  ["2008-06-03", "金星人+"], ["2009-07-28", "金星人-"],
  ["2008-06-13", "火星人+"], ["2009-06-08", "火星人-"],
  ["2008-06-23", "天王星人+"], ["2009-06-18", "天王星人-"],
  ["2008-07-03", "木星人+"], ["2009-06-28", "木星人-"],
  ["2008-07-13", "水星人+"], ["2009-07-08", "水星人-"],
];
for (const [i, [birth, natal]] of CATEGORIES.entries()) {
  for (const [j, [target, transit]] of CATEGORIES.entries()) {
    scoreCase(`六星: ${natal}×${transit}`, rokusei, birth, target,
      ASPECTS[(j - i + 12) % 12], `${natal}×${transit}`);
  }
}

function observe(calculate, input) {
  try {
    return calculate(...input);
  } catch (error) {
    return { error: error.name, message: error.message };
  }
}
const KNOWN_GAPS = [
  { topic: "西洋の存在しない日付", calculate: western, input: ["2000-13-01", "2000-03-21"], spec: "未定（不正入力の契約なし）" },
  { topic: "九星の立春固定と実際の立春", calculate: kyusei, input: ["1980-06-01", "2026-02-03"], spec: "2/4固定はコメントに明記。実際の立春の扱いは未定" },
  { topic: "六星の陰陽の年境界", calculate: rokusei, input: ["2006-12-31", "2007-01-01"], spec: "未定（暦年か立春かの明記なし）" },
].map(({ calculate, ...gap }) => ({ ...gap, actual: observe(calculate, gap.input) }));
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`, JSON.stringify(KNOWN_GAPS, null, 2));
console.log(`${tests}試験 / 失敗${failures}件`);
if (failures > 0) process.exitCode = 1;
