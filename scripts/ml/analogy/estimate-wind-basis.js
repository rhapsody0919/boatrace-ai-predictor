/**
 * BOA-271: 本体の風向（直前情報・結果ページのアイコン）を、長期分（K ファイル、方位）の基準に直す表を作る。
 * DB は読み取りのみ。K は解析済みのアーカイブ（scripts/maintenance/backfill-kb-gaps.js と同じ場所）を読む。
 *
 * 出力（features.py が読み、学習の版の per_race_meta.json にも入る）:
 *   scripts/ml/analogy/wind_basis.json  会場ごとの回転（DB の角度 − K の角度 の円周平均）・除外した会場・会場ごとの統計
 *   scripts/ml/analogy/k_wind_fill.csv  DB の風向が空で風速>0 の本体のレースのうち、FILL_MONTHS の K の風向
 *
 * 方法（docs/design/analogy-finder/wind-basis.md）:
 *   - 対象: 本体の期間（2025-12-03〜TO）で、K と DB の両方に16方位のどれかがあり、両方の風速が1m以上のレース
 *   - 回転: 会場ごとに δ = (DB − K) mod 360 の円周平均（丸めない）
 *   - 除外: 風速3m以上のレースで、回転を引いた DB と K の差が45°以内の割合が EXCLUDE_BELOW 未満の会場
 *
 * 使い方: node scripts/ml/analogy/estimate-wind-basis.js [--archive-dir=…] [--to=YYYY-MM-DD]
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
const FILL_MONTHS = ["2025-12", "2026-01"];
const MIN_SPEED = 1;
const STRONG_SPEED = 3;
const EXCLUDE_BELOW = 0.7;
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

const arg = (k) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const archiveDir = arg("archive-dir") ?? DEFAULT_ARCHIVE_DIR;
const TO = arg("to") ?? "2026-09-30";

const DEG = Math.PI / 180;
export function circularMean(degs) {
  const c = degs.reduce((a, d) => a + Math.cos(d * DEG), 0) / degs.length;
  const s = degs.reduce((a, d) => a + Math.sin(d * DEG), 0) / degs.length;
  return {
    mean: (((Math.atan2(s, c) / DEG) % 360) + 360) % 360,
    r: Math.hypot(c, s),
  };
}
const angleDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

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
      FILL_MONTHS.includes(c.race_id.slice(0, 7)) &&
      (kk.dir in ANG || kk.dir === "無風")
    )
      fill.push(`${c.race_id},${kk.dir}`);
    if (!(kk.dir in ANG) || !(c.wind_direction in ANG)) continue;
    if (!(kk.speed >= MIN_SPEED && Number(c.wind_speed) >= MIN_SPEED)) continue;
    pairs.push({
      v: Number(c.race_id.slice(11, 13)),
      k: ANG[kk.dir],
      db: ANG[c.wind_direction],
      strong: kk.speed >= STRONG_SPEED && Number(c.wind_speed) >= STRONG_SPEED,
    });
  }
  const venues = {};
  const offsets = {};
  const excluded = [];
  for (let v = 1; v <= 24; v++) {
    const g = pairs.filter((p) => p.v === v);
    if (g.length === 0) throw new Error(`会場 ${v} の組が0件`);
    const { mean, r } = circularMean(g.map((p) => (p.db - p.k + 360) % 360));
    const strong = g.filter((p) => p.strong);
    const within = (arr, tol) =>
      arr.filter((p) => angleDiff(p.db - mean, p.k) <= tol).length / arr.length;
    const match45Strong = within(strong, 45);
    venues[v] = {
      n: g.length,
      offset_deg: round(mean, 2),
      resultant_length: round(r),
      match22: round(within(g, 22.5)),
      match45: round(within(g, 45)),
      n_strong: strong.length,
      match45_strong: round(match45Strong),
      raw_match22: round(
        g.filter((p) => angleDiff(p.db, p.k) <= 22.5).length / g.length,
      ),
    };
    offsets[v] = round(mean, 2);
    if (match45Strong < EXCLUDE_BELOW) excluded.push(v);
  }
  const basis = {
    offsets_deg: offsets,
    excluded_venues: excluded,
    method: {
      definition:
        "本体の風向の角度から offsets_deg を引くと、K ファイル（方位）の基準になる。excluded_venues の会場は風向を欠損にする",
      period: [FROM, TO],
      min_speed: MIN_SPEED,
      strong_speed: STRONG_SPEED,
      exclude_below: EXCLUDE_BELOW,
      pairs: pairs.length,
      k_missing_days: missingDays,
      script: "scripts/ml/analogy/estimate-wind-basis.js",
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
    `組 ${pairs.length}（K の欠けた日 ${missingDays}）、除外 ${JSON.stringify(excluded)}、埋める行 ${fill.length}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
