/**
 * verify-races-derived-backfill.js - races の導出列の埋め直し（build-races-derived-backfill-sql.js、BOA-630）の検証。
 * DBにも取得先にも接続しない（合成の出走と PGlite）。
 *
 *   (a) 計算: generate-predictions.js と同じ式（勝率は小数3桁・モーター2連率は小数1桁に丸めてから、平均と母標準偏差）。
 *       勝率・モーター2連率が欠けた艇がいれば null（予測を作れないレースと同じ）
 *   (b) SQL: 001 の列の型の表に当てると、列の桁に丸めて入る。6列とも NULL の行だけを更新し（既存の値を上書きしない）、
 *       再実行は0件。他の列（volatility_* 等）は変えない
 *   (c) 変異検証: 上を壊した版で、検証が失敗する
 *
 * 実行: node scripts/maintenance/verify-races-derived-backfill.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// 勝率 6.61/5.12/4.40/3.98/5.55/4.04、モーター2連率 33.3/41.2/28.0/35.5/30.1/38.9
const ENTRIES = [
  [1, "A1", 6.61, 33.3],
  [2, "A2", 5.12, 41.2],
  [3, "B1", 4.4, 28.0],
  [4, "B1", 3.98, 35.5],
  [5, "A2", 5.55, 30.1],
  [6, "B1", 4.04, 38.9],
].map(([boat_number, grade, win_rate, motor_2rate]) => ({
  boat_number,
  grade,
  win_rate,
  motor_2rate,
}));
// 独立に計算した期待値（母標準偏差）
const w = [6.61, 5.12, 4.4, 3.98, 5.55, 4.04];
const m = [33.3, 41.2, 28.0, 35.5, 30.1, 38.9];
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const pop = (v) =>
  Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / v.length);

async function evaluate(cli) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  const s = cli.deriveRaceStats([...ENTRIES].reverse());
  expect(
    "(a) 1号艇の級別・勝率・モーター2連率、勝率の平均・母標準偏差、モーター2連率の母標準偏差",
    s &&
      s.first_boat_grade === "A1" &&
      s.first_boat_win_rate === 6.61 &&
      s.first_boat_motor_2rate === 33.3 &&
      Math.abs(s.win_rate_avg - mean(w)) < 1e-9 &&
      Math.abs(s.win_rate_stddev - pop(w)) < 1e-9 &&
      Math.abs(s.motor_2rate_stddev - pop(m)) < 1e-9,
    show(s),
  );
  expect(
    "(a) 勝率が欠けた艇がいれば null",
    cli.deriveRaceStats([
      ...ENTRIES.slice(1),
      { ...ENTRIES[0], win_rate: null },
    ]) === null && cli.deriveRaceStats([]) === null,
  );

  const db = new PGlite();
  await db.exec(`CREATE TABLE races (race_id varchar(20) primary key, volatility_score smallint, recommended_model varchar(50),
    first_boat_grade varchar(5), first_boat_win_rate decimal(5,3), first_boat_motor_2rate decimal(5,2),
    win_rate_stddev decimal(5,3), win_rate_avg decimal(5,3), motor_2rate_stddev decimal(5,2), updated_at timestamptz);
    INSERT INTO races (race_id) VALUES ('A');
    INSERT INTO races (race_id, volatility_score, first_boat_grade, win_rate_avg) VALUES ('B', 40, 'B2', 5.0);`);
  const sql = cli.buildUpdateSql([
    { race_id: "A", stats: s },
    { race_id: "B", stats: s },
  ]);
  const first = await db.query(sql);
  const again = await db.query(sql);
  const { rows } = await db.query(
    "SELECT race_id, volatility_score, recommended_model, first_boat_grade, first_boat_win_rate::text, first_boat_motor_2rate::text, win_rate_avg::text, win_rate_stddev::text, motor_2rate_stddev::text, updated_at IS NOT NULL AS stamped FROM races ORDER BY race_id",
  );
  const [a, b] = rows;
  expect(
    "(b) 6列とも NULL の行だけ更新し、列の桁に丸めて入る。他の列は変えない",
    first.affectedRows === 1 &&
      a.first_boat_grade === "A1" &&
      a.first_boat_win_rate === "6.610" &&
      a.first_boat_motor_2rate === "33.30" &&
      a.win_rate_avg === mean(w).toFixed(3) &&
      a.win_rate_stddev === pop(w).toFixed(3) &&
      a.motor_2rate_stddev === pop(m).toFixed(2) &&
      a.volatility_score === null &&
      a.recommended_model === null &&
      a.stamped === true,
    show({ first: first.affectedRows, a }),
  );
  expect(
    "(b) 値のある行（B）は上書きしない。再実行は0件",
    b.first_boat_grade === "B2" &&
      b.win_rate_avg === "5.000" &&
      b.first_boat_win_rate === null &&
      again.affectedRows === 0,
    show({ b, again: again.affectedRows }),
  );
  return failed;
}

const cli = await import("./build-races-derived-backfill-sql.js");
const r = await evaluate(cli);
check("(a)(b) 計算と SQL", r.length === 0, r.join(" / "));

let mutantSeq = 0;
async function withMutant(from, to) {
  const file = path.join(
    ROOT,
    "scripts/maintenance/build-races-derived-backfill-sql.js",
  );
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(from)) {
    throw new Error(`変異の置き換え元が見つかりません: ${from}`);
  }
  const mutant = file.replace(
    /\.js$/,
    `.__mutant-${process.pid}-${++mutantSeq}.js`,
  );
  fs.writeFileSync(mutant, src.replace(from, to));
  try {
    return await evaluate(await import(pathToFileURL(mutant).href));
  } catch (e) {
    return [`例外: ${e.message}`];
  } finally {
    fs.rmSync(mutant, { force: true });
  }
}
for (const [label, from, to] of [
  [
    "標本標準偏差にする",
    "      values.length,\n  );",
    "      (values.length - 1),\n  );",
  ],
  ["既存の値を上書きする（NULL の条件を外す）", "  AND ${allNull};", ";"],
  [
    "勝率が欠けた艇がいても計算する",
    "entries.some((e) => e.win_rate == null || e.motor_2rate == null)",
    "false",
  ],
]) {
  const failed = await withMutant(from, to);
  check(
    `(c) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
