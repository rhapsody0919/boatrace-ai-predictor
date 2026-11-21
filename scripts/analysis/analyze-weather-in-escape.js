/**
 * 風向・風速・波高とイン逃げ率（1コース1着率）の分析（BOA-211）
 *
 * 定義・判定基準は docs/design/weather-in-escape/preregistration.md で事前に固定している。
 * 入力は公式K・Bファイルの解析済みファイル（kb-day/v1）。本番DBは読まない。
 *
 * 使い方:
 *   node scripts/analysis/analyze-weather-in-escape.js
 *   KB_ARCHIVE_DIR=/path/to/kb-archive node scripts/analysis/analyze-weather-in-escape.js
 *
 * 出力: data/analysis/weather-in-escape.json（分析の全結果）と
 *       public/data/weather-in-escape.json（分析ツールのタブが読む表示用の集計）
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import os from "os";
import { fileURLToPath } from "url";
import {
  FIRST_HALF_END,
  TECHNIQUES,
  BOOT_REPS,
  CI_LEVEL,
  pt,
  compare,
  analyze,
} from "./analyzeWeatherInEscapeStats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR =
  process.env.KB_ARCHIVE_DIR ||
  path.join(os.homedir(), "boatrace-archive-backup/kb-archive");
const OUT_PATH = path.join(
  __dirname,
  "../../data/analysis/weather-in-escape.json",
);
// 画面（分析ツール「風とイン逃げ率」タブ）が読む集計。分析の結果から、表示に使う値だけを抜き出す
const DISPLAY_PATH = path.join(
  __dirname,
  "../../public/data/weather-in-escape.json",
);
const FROM = "2020-02-01";
const TO = "2026-09-30";

const COMPASS = [
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

// 会場ごとの「画面上の矢印番号 − Kの方位番号」（事前登録 1.1）。
// 公式の is-direction{d} から (d + 7) mod 16 で導ける値と、2026-02〜09 の突き合わせの最頻値が一致する
export const VENUE_WIND_OFFSET = {
  1: 5,
  2: 7,
  3: 11,
  4: 12,
  5: 0,
  6: 4,
  7: 2,
  8: 0,
  9: 15,
  10: 5,
  11: 4,
  12: 4,
  13: 1,
  14: 6,
  15: 14,
  16: 4,
  17: 2,
  18: 14,
  19: 2,
  20: 1,
  21: 8,
  22: 9,
  23: 3,
  24: 10,
};

export const WIND_BINS = [
  { key: "head_strong", label: "向かい風・強" },
  { key: "head", label: "向かい風" },
  { key: "calm_cross", label: "弱い・横風" },
  { key: "tail", label: "追い風" },
  { key: "tail_strong", label: "追い風・強" },
];

export const WAVE_BINS = [
  { key: "w0_2", label: "0〜2cm", test: (w) => w <= 2 },
  { key: "w3_5", label: "3〜5cm", test: (w) => w >= 3 && w <= 5 },
  { key: "w6_9", label: "6〜9cm", test: (w) => w >= 6 && w <= 9 },
  { key: "w10", label: "10cm以上", test: (w) => w >= 10 },
];

const CLASSES = ["A1", "A2", "B1", "B2"];

/** 追い風からの角度（度、−180〜180）。風向が分からなければ null */
export function tailwindAngle(venueCode, compass) {
  const k = COMPASS.indexOf(compass);
  const offset = VENUE_WIND_OFFSET[venueCode];
  if (k < 0 || offset == null) return null;
  const r = (k + offset) % 16;
  const deg = (r - 4) * 22.5;
  return deg > 180 ? deg - 360 : deg <= -180 ? deg + 360 : deg;
}

/** 風の区分（事前登録 3.1）。風速が無い、または風速2m以上で向きが分からなければ null */
export function windBin(venueCode, compass, speed) {
  if (speed == null) return null;
  if (speed <= 1 || compass === "無風") return "calm_cross";
  const phi = tailwindAngle(venueCode, compass);
  if (phi == null) return null;
  const strong = speed >= 4;
  if (Math.abs(phi) <= 45) return strong ? "tail_strong" : "tail";
  if (Math.abs(phi) >= 135) return strong ? "head_strong" : "head";
  return "calm_cross";
}

/** 追い風成分による区分（事前登録 3.2、感度分析） */
export function tailwindComponentBin(venueCode, compass, speed) {
  if (speed == null) return null;
  let c = 0;
  if (speed > 0 && compass !== "無風") {
    const phi = tailwindAngle(venueCode, compass);
    if (phi == null) return null;
    // cos(90°) 等の浮動小数の誤差で境界がぶれないよう 0.01m で丸める
    c = Math.round(speed * Math.cos((phi * Math.PI) / 180) * 100) / 100;
  }
  if (c <= -4) return "head_strong";
  if (c <= -2) return "head";
  if (c < 2) return "calm_cross";
  if (c < 4) return "tail";
  return "tail_strong";
}

function* readDays() {
  const parsedDir = path.join(ARCHIVE_DIR, "parsed");
  for (const month of fs.readdirSync(parsedDir).sort()) {
    const dir = path.join(parsedDir, month);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith(".json.gz")) continue;
      const buf = fs.readFileSync(path.join(dir, file));
      yield {
        file: `${month}/${file}`,
        buf,
        day: JSON.parse(zlib.gunzipSync(buf)),
      };
    }
  }
}

function toRace(date, venue, race, bRace) {
  const rows = race.rows ?? [];
  const inBoat = rows.find((r) => r.course === 1);
  const winner = rows.find((r) => r.rank === 1);
  if (!inBoat || !winner) return null;
  const cls = bRace?.entries?.find(
    (e) => e.boat_number === inBoat.boat_number,
  )?.class;
  const vc = venue.venue_code;
  return {
    date,
    month: Number(date.slice(5, 7)),
    venue: vc,
    raceNumber: race.race_number,
    rnBand: race.race_number <= 4 ? 1 : race.race_number <= 8 ? 2 : 3,
    cls: CLASSES.includes(cls) ? cls : null,
    inWin: winner.boat_number === inBoat.boat_number ? 1 : 0,
    technique: race.technique ?? null,
    wind: windBin(vc, race.wind_direction, race.wind_speed),
    windC: tailwindComponentBin(vc, race.wind_direction, race.wind_speed),
    wave: race.wave_height ?? null,
  };
}

/** 1会場の1日分のレース（前のレースの風つき）。集計に使えないレースは含めない */
function venueRaces(day, venue) {
  const races = [];
  const bVenue = day.b?.venues?.find((v) => v.venue_code === venue.venue_code);
  // 前のレースの風（事前登録 5「時点」）。中止等で前のレースが無ければ null
  const windByRn = new Map(
    (venue.races ?? []).map((r) => [
      r.race_number,
      windBin(venue.venue_code, r.wind_direction, r.wind_speed),
    ]),
  );
  for (const race of venue.races ?? []) {
    const bRace = bVenue?.races?.find(
      (r) => r.race_number === race.race_number,
    );
    const r = toRace(day.date, venue, race, bRace);
    if (!r) continue;
    r.prevWind = windByRn.get(race.race_number - 1) ?? null;
    races.push(r);
  }
  return races;
}

function loadRaces() {
  const races = [];
  const hash = crypto.createHash("sha256");
  let maxDate = null;
  for (const { file, buf, day } of readDays()) {
    if (day.date < FROM || day.date > TO) continue;
    hash.update(file).update(buf);
    for (const venue of day.k?.venues ?? []) {
      for (const r of venueRaces(day, venue)) {
        races.push(r);
        if (!maxDate || r.date > maxDate) maxDate = r.date;
      }
    }
  }
  return { races, maxDate, inputHash: hash.digest("hex") };
}

/**
 * 画面用の集計。判定した推定量（会場内の差 D と97.5%区間）をそのまま出す（事前登録 §7）
 */
export function buildDisplay(out) {
  const techniqueTotals = Object.fromEntries(
    WIND_BINS.map(({ key }) => [
      key,
      Object.fromEntries(
        TECHNIQUES.map((t) => [
          t,
          Object.values(out.wind.venues).reduce(
            (s, v) => s + (v.bins[key]?.techniques[t] ?? 0),
            0,
          ),
        ]),
      ),
    ]),
  );
  return {
    source: "scripts/analysis/analyze-weather-in-escape.js",
    period: { from: out.period.from, to: out.period.maxDate },
    rows: out.rows,
    inputHash: out.inputHash,
    overallInWinRate: out.overallInWinRate,
    ciLevel: out.ciLevel,
    pooled: Object.fromEntries(
      Object.entries(out.wind.pooled).map(([k, p]) => [
        k,
        {
          n: p.n,
          diff: p.diffVsVenue,
          ci: p.ci,
          adjustedDiff: p.adjustedDiff,
          venueSign: p.venueSign,
        },
      ]),
    ),
    techniques: techniqueTotals,
    wave: {
      w6_9: {
        n: out.waveWithinCalm.pooled.w6_9.n,
        diff: out.waveWithinCalm.pooled.w6_9.diffVsVenue,
      },
    },
    venues: Object.fromEntries(
      Object.entries(out.wind.venues).map(([code, v]) => [
        code,
        {
          n: v.all.n,
          rate: v.all.inWinRate,
          bins: Object.fromEntries(
            Object.entries(v.bins).map(([k, b]) => [
              k,
              { n: b.n, rate: b.inWinRate, diff: b.diffVsVenue },
            ]),
          ),
        },
      ]),
    ),
  };
}

function main() {
  const { races, maxDate, inputHash } = loadRaces();
  const waveBinOf = (r) =>
    r.wind === "calm_cross" && r.wave != null
      ? (WAVE_BINS.find((b) => b.test(r.wave))?.key ?? null)
      : null;

  const out = {
    preregistration: "docs/design/weather-in-escape/preregistration.md",
    source: "kb-day/v1 parsed (K/B files)",
    period: { from: FROM, to: TO, maxDate, firstHalfEnd: FIRST_HALF_END },
    rows: races.length,
    rowsWithWind: races.filter((r) => r.wind != null).length,
    rowsWithWave: races.filter((r) => r.wave != null).length,
    rowsWithClass: races.filter((r) => r.cls != null).length,
    inputHash,
    ciLevel: CI_LEVEL,
    bootstrapReps: BOOT_REPS,
    overallInWinRate: pt(races.reduce((s, r) => s + r.inWin, 0) / races.length),
    wind: analyze(races, WIND_BINS, (r) => r.wind, [
      "head_strong",
      "tail_strong",
    ]),
    waveWithinCalm: analyze(races, WAVE_BINS, waveBinOf, ["w6_9", "w10"]),
    sensitivity: {
      tailwindComponent: compare(races, WIND_BINS, (r) => r.windC).pooled,
      previousRaceWind: compare(races, WIND_BINS, (r) => r.prevWind).pooled,
    },
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  fs.mkdirSync(path.dirname(DISPLAY_PATH), { recursive: true });
  fs.writeFileSync(DISPLAY_PATH, JSON.stringify(buildDisplay(out)) + "\n");

  console.log(
    `rows=${out.rows} wind=${out.rowsWithWind} wave=${out.rowsWithWave} class=${out.rowsWithClass} max=${maxDate} in1=${out.overallInWinRate}`,
  );
  const print = (title, block) => {
    console.log(`\n[${title}]`);
    for (const [key, p] of Object.entries(block.pooled)) {
      console.log(
        `  ${p.label.padEnd(7, "　")} n=${String(p.n).padStart(6)} D=${p.diffVsVenue} CI=${JSON.stringify(p.ci)} A=${p.adjustedDiff} 前半=${block.firstHalf[key]?.diffVsVenue} 後半=${block.secondHalf[key]?.diffVsVenue} 会場符号=${p.venueSign.sameSign}/${p.venueSign.eligible}`,
      );
    }
    console.log(`  判定: ${JSON.stringify(block.judge)}`);
  };
  print("風", out.wind);
  print("波高（弱い・横風のみ）", out.waveWithinCalm);
  for (const [name, pooled] of Object.entries(out.sensitivity)) {
    console.log(`\n[感度: ${name}]`);
    for (const p of Object.values(pooled))
      console.log(`  ${p.label} n=${p.n} D=${p.diffVsVenue}`);
  }
  console.log(`\n→ ${path.relative(process.cwd(), OUT_PATH)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
