/**
 * BOA-271: 本体の風向（直前情報・結果ページのアイコン）を、長期分（K ファイル、方位）の基準に直す表を作る。
 *
 * 本体の race_conditions.wind_direction は、ページの風向アイコン `is-windN` を「1=北 … 16=北北西」と方位名にしたもの
 * （scripts/lib/beforeinfoWeather.js）。実際のアイコンは方位ではなく、同じページの方位マーク
 * `<p class="weather1_bodyUnitImage is-directionM">`（会場ごとに北の向きが違う水面の図）に対する向き。
 * そのため K の方位に直すには、会場ごとに (M − 9) × 22.5° を引く（M=9 は北が下の図で、回転 0°）。
 * M は会場ごとに固定（DIRECTION_MARKS。2026-10-03 に各会場の直前情報ページで確認）。
 *
 * このスクリプトは、表を K ファイルと DB の実データで検証してから書く（DB は読み取りのみ。K は解析済みのアーカイブ）:
 *   - 会場ごとに δ = (DB − K) mod 360 の最頻値が、表の回転と一致すること（一致しなければ失敗して何も書かない）
 *   - 統計（組数・回転を引いた後の一致率・回転を引く前の一致率）を wind_basis.json の venues に残す
 * 出力（features.py が読み、学習の版の per_race_meta.json にも入る）:
 *   scripts/ml/analogy/wind_basis.json  offsets_deg（会場→引く角度）・方位マーク・検証の統計
 *   scripts/ml/analogy/k_wind_fill.csv  本体のレースで DB の風向が空・風速>0 のものの K の風向（2025-12・01 はほぼ全件。
 *                                       他の月は K/B の補完で風速だけが入った行）
 *
 * 残るずれ: 2R 以降の直前情報は前のレースの時点の気象なので、DB はレース時点の K と時刻がずれる（回転とは別。
 * 観測時刻のある行は、回転を引くと K と全件一致する）。docs/design/analogy-finder/wind-basis.md
 *
 * 使い方: node scripts/ml/analogy/build-wind-basis.js [--archive-dir=…] [--to=YYYY-MM-DD]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../../lib/supabaseClient.js";
import {
  DEFAULT_ARCHIVE_DIR,
  readParsedDay,
} from "../../maintenance/backfill-kb-gaps.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FROM = "2025-12-03";
const MIN_SPEED = 1;
const DIR16 = [
  "北",
  "北北東",
  "北東",
  "東北東",
  "東",
  "東南東",
  "南東",
  "南南東",
  "南",
  "南南西",
  "南西",
  "西南西",
  "西",
  "西北西",
  "北西",
  "北北西",
];
const ANG = Object.fromEntries(DIR16.map((d, i) => [d, i * 22.5]));

/** 会場 → 直前情報ページの方位マーク `is-directionM` の M（2026-10-03 確認） */
export const DIRECTION_MARKS = Object.freeze({
  1: 14,
  2: 16,
  3: 4,
  4: 5,
  5: 9,
  6: 13,
  7: 11,
  8: 9,
  9: 8,
  10: 14,
  11: 13,
  12: 13,
  13: 10,
  14: 15,
  15: 7,
  16: 13,
  17: 11,
  18: 7,
  19: 11,
  20: 10,
  21: 1,
  22: 2,
  23: 12,
  24: 3,
});
export const offsetFromMark = (m) => ((((m - 9) * 22.5) % 360) + 360) % 360;

const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const archiveDir = arg("archive-dir") ?? DEFAULT_ARCHIVE_DIR;
const TO = arg("to") ?? "2026-09-30";
const angleDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const round3 = (x) => Math.round(x * 1000) / 1000;

async function readDb() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("race_conditions")
      .select("race_id,wind_direction,wind_speed")
      .gte("race_id", FROM)
      .lt("race_id", `${TO}~`)
      .order("race_id")
      .range(from, from + 999);
    if (error)
      throw new Error(`race_conditions の読み取りに失敗: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function readK() {
  const k = new Map();
  let missingDays = 0;
  for (
    let d = new Date(`${FROM}T00:00:00Z`);
    d <= new Date(`${TO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10);
    const day = readParsedDay(archiveDir, date);
    if (!day) {
      missingDays++;
      continue;
    }
    for (const v of day.k?.venues ?? [])
      for (const r of v.races ?? [])
        k.set(
          `${date}-${String(v.venue_code).padStart(2, "0")}-${String(r.race_number).padStart(2, "0")}`,
          { dir: r.wind_direction, speed: r.wind_speed },
        );
  }
  return { k, missingDays };
}

async function main() {
  const { k, missingDays } = readK();
  if (k.size === 0)
    throw new Error(`${archiveDir} に K の解析済みデータがありません`);
  const db = await readDb();
  const pairs = [];
  const fill = [];
  for (const c of db) {
    const kk = k.get(c.race_id);
    if (!kk) continue;
    if (
      c.wind_direction == null &&
      Number(c.wind_speed) > 0 &&
      (kk.dir in ANG || kk.dir === "無風")
    )
      fill.push(`${c.race_id},${kk.dir}`);
    if (!(kk.dir in ANG) || !(c.wind_direction in ANG)) continue;
    if (!(kk.speed >= MIN_SPEED && Number(c.wind_speed) >= MIN_SPEED)) continue;
    pairs.push({
      v: Number(c.race_id.slice(11, 13)),
      k: ANG[kk.dir],
      db: ANG[c.wind_direction],
    });
  }
  const venues = {};
  const offsets = {};
  const problems = [];
  for (let v = 1; v <= 24; v++) {
    const off = offsetFromMark(DIRECTION_MARKS[v]);
    const g = pairs.filter((p) => p.v === v);
    const counts = new Map();
    for (const p of g) {
      const d = (p.db - p.k + 360) % 360;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (mode !== off)
      problems.push(
        `会場 ${v}: 最頻の回転 ${mode}° が方位マークの回転 ${off}° と違う`,
      );
    const share = (pred) => round3(g.filter(pred).length / g.length);
    venues[v] = {
      direction_mark: DIRECTION_MARKS[v],
      n: g.length,
      mode_deg: mode,
      exact_after: share((p) => angleDiff(p.db - off, p.k) === 0),
      within45_after: share((p) => angleDiff(p.db - off, p.k) <= 45),
      exact_before: share((p) => angleDiff(p.db, p.k) === 0),
    };
    offsets[v] = off;
  }
  if (problems.length) throw new Error(problems.join("\n"));
  const basis = {
    offsets_deg: offsets,
    method: {
      definition:
        "本体の風向の角度から offsets_deg（(方位マーク − 9) × 22.5°）を引くと、K ファイル（方位）の基準になる",
      period: [FROM, TO],
      min_speed: MIN_SPEED,
      pairs: pairs.length,
      k_missing_days: missingDays,
      script: "scripts/ml/analogy/build-wind-basis.js",
    },
    venues,
  };
  fs.writeFileSync(
    path.join(HERE, "wind_basis.json"),
    `${JSON.stringify(basis, null, 1)}\n`,
  );
  fs.writeFileSync(
    path.join(HERE, "k_wind_fill.csv"),
    `race_id,wind_direction\n${fill.sort().join("\n")}\n`,
  );
  console.log(
    `組 ${pairs.length}（K の欠けた日 ${missingDays}）、24会場とも最頻の回転が方位マークと一致、埋める行 ${fill.length}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
