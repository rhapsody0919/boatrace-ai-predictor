#!/usr/bin/env node
/**
 * 会場のモーターの順位と並べ替え（src/utils/venueMotorRanking.js、BOA-428）の検証。DB接続は不要。
 *
 * 守るもの:
 *   - 同じ値は同じ順位で、次の順位は飛ぶ（1, 2, 2, 4）
 *   - 並べている列の値が無い行は末尾で、順位は null（画面は「-」）
 *   - 機番で並べたときの順位は、2連率の順位のまま
 *   - 列ごとの向き（2連率・優勝は降順、機番・前検は昇順）
 *   - 2連率1位（R1）は同率1位を全部、全部同じ値なら付けない
 *   - 2連率の表示桁（小数第2位があれば残す）と取得日の表記
 *   - 使用者は今の節の出走表で直近に乗った選手（前検データに載らない途中の入れ替えを補う）
 *
 * 末尾の変異検証で、要の箇所を1つずつ壊したコピーに同じ検証をかけ、検証が落ちることを確かめる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const TARGET = path.join(ROOT, "src/utils/venueMotorRanking.js");
const DEP = path.join(ROOT, "src/utils/competitionRank.js");

const show = (v) => JSON.stringify(v);

// 児島 9/30 の一部を縮めた形。36.1 が2基・35.6 が2基で同値、前検・優勝に値の無い行がある
const ROWS = [
  { motorNumber: 55, top2Rate: 47.9, championshipCount: 2, pretestTime: 6.79 },
  { motorNumber: 22, top2Rate: 36.1, championshipCount: 0, pretestTime: 6.8 },
  { motorNumber: 16, top2Rate: 36.1, championshipCount: 0, pretestTime: 6.87 },
  { motorNumber: 69, top2Rate: 35.6, championshipCount: 0, pretestTime: 6.74 },
  { motorNumber: 61, top2Rate: 35.6, championshipCount: 1, pretestTime: 6.69 },
  { motorNumber: 28, top2Rate: 32.8, championshipCount: 0, pretestTime: null },
  {
    motorNumber: 70,
    top2Rate: null,
    championshipCount: null,
    pretestTime: null,
  },
];

function runChecks(mod) {
  const failures = [];
  const check = (name, actual, expected) => {
    if (show(actual) !== show(expected)) {
      failures.push(`${name}: 期待 ${show(expected)} / 実際 ${show(actual)}`);
    }
  };
  const pick = (rows) => rows.map((r) => [r.motorNumber, r.rank]);

  check(
    "2連率（降順）: 同値は同じ順位で次が飛ぶ、値なしは末尾で順位 null",
    pick(mod.sortMotorRows(ROWS, "top2Rate")),
    [
      [55, 1],
      [16, 2],
      [22, 2],
      [61, 4],
      [69, 4],
      [28, 6],
      [70, null],
    ],
  );
  check(
    "機番（昇順）: 順位は2連率の順位のまま",
    pick(mod.sortMotorRows(ROWS, "motorNumber")),
    [
      [16, 2],
      [22, 2],
      [28, 6],
      [55, 1],
      [61, 4],
      [69, 4],
      [70, null],
    ],
  );
  check(
    "優勝（降順）: 優勝の値で付け直す。0 は値として数える",
    pick(mod.sortMotorRows(ROWS, "championshipCount")),
    [
      [55, 1],
      [61, 2],
      [16, 3],
      [22, 3],
      [28, 3],
      [69, 3],
      [70, null],
    ],
  );
  check(
    "前検（昇順、速い順）: 値なしは末尾",
    pick(mod.sortMotorRows(ROWS, "pretestTime")),
    [
      [61, 1],
      [69, 2],
      [55, 3],
      [22, 4],
      [16, 5],
      [28, null],
      [70, null],
    ],
  );
  check(
    "tied: 同値の件数（自分を含む）",
    mod
      .sortMotorRows(ROWS, "top2Rate")
      .filter((r) => r.motorNumber === 22 || r.motorNumber === 55)
      .map((r) => [r.motorNumber, r.tied]),
    [
      [55, 1],
      [22, 2],
    ],
  );
  check(
    "入力の配列を書き換えない",
    (() => {
      const before = show(ROWS);
      mod.sortMotorRows(ROWS, "pretestTime");
      return show(ROWS) === before;
    })(),
    true,
  );
  let threw = false;
  try {
    mod.sortMotorRows(ROWS, "unknown");
  } catch {
    threw = true;
  }
  check("知らない列は例外", threw, true);
  check(
    "浜名湖・宮島は会場サイトの値を出さない",
    mod.VENUE_SITE_STATS_HIDDEN,
    [6, 17],
  );
  // 2連率1位（R1、子3 のランキング）
  check(
    "2連率1位: 同率1位は全部、値なしは外す",
    [
      ...mod.topRateMotors([
        { motorNumber: 1, top2Rate: 40 },
        { motorNumber: 2, top2Rate: 40 },
        { motorNumber: 3, top2Rate: 30 },
        { motorNumber: 4, top2Rate: null },
      ]),
    ],
    [1, 2],
  );
  check(
    "2連率1位: 全部同じ値なら付けない",
    mod.topRateMotors([
      { motorNumber: 1, top2Rate: 40 },
      { motorNumber: 2, top2Rate: 40 },
    ]).size,
    0,
  );
  check(
    "2連率1位: 値のある行が無ければ付けない",
    mod.topRateMotors([{ motorNumber: 1, top2Rate: null }]).size,
    0,
  );
  // 表示の桁（会場サイトによって小数第2位まである）
  check(
    "2連率の表示: 小数第2位があれば残し、無ければ1桁",
    [47.9, 51.43, 0, 36.1, null].map(mod.formatMotorRate),
    ["47.9", "51.43", "0.0", "36.1", null],
  );
  check(
    "取得日の表記: 年つき、月日の0を詰める",
    mod.formatSlashDate("2026-09-03"),
    "2026/9/3",
  );
  // 今の節で各モーターに直近に乗った選手（前検データに載らない途中の入れ替えを補う）
  const e = (race_id, racer_id, motor_number) => ({
    race_id,
    racer_id,
    motor_number,
  });
  const ENTRIES = [
    // 前の節（9/24 の後に空きの日がある）
    e("2026-09-24-15-01", 9001, 50),
    // 今の節 9/26〜10/02。50号機は10/01から入れ替わりで 5206 が乗る
    e("2026-09-26-15-01", 4511, 50),
    e("2026-10-01-15-02", 5206, 50),
    e("2026-10-02-15-08", 5206, 50),
    e("2026-10-02-15-03", 4534, 2),
    e("2026-09-27-15-05", 4089, 66),
    e("2026-09-28-15-01", 4534, 2),
    e("2026-09-29-15-01", 4534, 2),
    e("2026-09-30-15-01", 4534, 2),
  ];
  const riders = mod.currentSeriesRiders(ENTRIES, "2026-10-02");
  check(
    "使用者: 節の途中で入った選手の直近のレースで上書きする",
    [riders.get(50)?.racer_id, riders.get(50)?.race_id],
    [5206, "2026-10-02-15-08"],
  );
  check(
    "使用者: 節の途中で抜けた選手のモーターは、その節で最後に乗った選手",
    riders.get(66)?.racer_id,
    4089,
  );
  check(
    "使用者: レースの無い日より前（前の節）は数えない",
    mod.currentSeriesRiders(
      [e("2026-09-24-15-01", 9001, 70), ...ENTRIES],
      "2026-10-02",
    ).has(70),
    false,
  );
  check(
    "使用者: 出走表の最新日が前検日の前日より古ければ、今の節はまだ走っていない",
    mod.currentSeriesRiders(ENTRIES, "2026-10-08").size,
    0,
  );
  check(
    "使用者: 前検日の前日の出走表までは今の節として使う",
    mod.currentSeriesRiders(ENTRIES, "2026-10-03").get(50)?.racer_id,
    5206,
  );
  return failures;
}

const MUTANTS = [
  {
    name: "値の無い行を先頭に置く",
    from: "if (av !== bv) return av ? -1 : 1;",
    to: "if (av !== bv) return av ? 1 : -1;",
  },
  {
    name: "機番で並べたときも機番で順位を取る",
    from: 'sortKey === "motorNumber" ? "top2Rate" : sortKey',
    to: "sortKey",
  },
  {
    name: "向きを逆にする",
    from: "const sign = config.ascending ? 1 : -1;",
    to: "const sign = config.ascending ? -1 : 1;",
  },
  {
    name: "値なしの順位を 0 にする",
    from: "rank: hit?.rank ?? null",
    to: "rank: hit?.rank ?? 0",
  },
  {
    name: "全部同じ値でも1位を光らせる",
    from: "if (Math.min(...values) === max) return new Set();",
    to: "",
  },
  {
    name: "2連率を常に1桁に丸める",
    from: ": n.toFixed(2);",
    to: ": n.toFixed(1);",
  },
  {
    name: "前の節の行も数える",
    from: "if (e.race_id.slice(0, 10) < start) continue;",
    to: "",
  },
  {
    name: "直近ではなく最初のレースの選手を使う",
    from: "e.race_id > prev.race_id",
    to: "e.race_id < prev.race_id",
  },
  {
    name: "出走表が古くても使う",
    from: "if (latest < shiftDay(pretestDate, -1)) return new Map();",
    to: "",
  },
];

async function main() {
  const failures = runChecks(await import(pathToFileURL(TARGET).href));
  if (failures.length > 0) {
    console.error("❌ venueMotorRanking の検証に失敗:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log("✅ venueMotorRanking の検証: すべて通過");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-vmr-"));
  try {
    fs.copyFileSync(DEP, path.join(tmp, "competitionRank.js"));
    const source = fs.readFileSync(TARGET, "utf8");
    const survivors = [];
    for (const [i, m] of MUTANTS.entries()) {
      if (!source.includes(m.from)) {
        throw new Error(`変異の置換元が見つからない（${m.name}）: ${m.from}`);
      }
      const file = path.join(tmp, `mutant-${i}.js`);
      fs.writeFileSync(file, source.replace(m.from, m.to));
      const caught = runChecks(await import(pathToFileURL(file).href));
      if (caught.length === 0) survivors.push(m.name);
    }
    if (survivors.length > 0) {
      console.error(
        `❌ 変異検証: 検証が落ちない変異がある: ${survivors.join(" / ")}`,
      );
      process.exit(1);
    }
    console.log(`✅ 変異検証: ${MUTANTS.length}件すべて検出`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`❌ verify-venue-motor-ranking: ${err.message}`);
  process.exit(1);
});
