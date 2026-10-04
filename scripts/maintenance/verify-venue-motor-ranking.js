#!/usr/bin/env node
/**
 * 会場のモーターの順位と並べ替え（src/utils/venueMotorRanking.js、BOA-428）の検証。DB接続は不要。
 *
 * 守るもの:
 *   - 同じ値は同じ順位で、次の順位は飛ぶ（1, 2, 2, 4）
 *   - 並べている列の値が無い行は末尾で、順位は null（画面は「-」）
 *   - 機番で並べたときの順位は、2連率の順位のまま
 *   - 列ごとの向き（2連率・優勝は降順、機番・前検は昇順）
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
