/**
 * 風向・風速・波高とイン逃げ率（1コース1着率）の分析（BOA-211）
 *
 * 定義・判定基準は docs/design/weather-in-escape/preregistration.md で事前に固定している。
 * 入力は公式K・Bファイルの解析済みファイル（kb-day/v1）。本番DBは読まない。
 *
 * 使い方:
 *   node scripts/analysis/analyze-weather-in-escape.js
 *   KB_ARCHIVE_DIR=/path/to/kb-archive node scripts/analysis/analyze-weather-in-escape.js
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR =
  process.env.KB_ARCHIVE_DIR ||
  path.join(os.homedir(), "boatrace-archive-backup/kb-archive");
const OUT_PATH = path.join(
  __dirname,
  "../../data/analysis/weather-in-escape.json",
);
const FROM = "2020-02-01";
const TO = "2026-09-30";
const FIRST_HALF_END = "2022-12-31";

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

const TECHNIQUES = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];
const CLASSES = ["A1", "A2", "B1", "B2"];
const BOOT_REPS = 1000;
const CI_LEVEL = 0.975; // Bonferroni（判定の機会が2つ）
const MIN_STRATUM = 30;
const VENUE_SIGN_MIN_N = 300;

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

function loadRaces() {
  const races = [];
  const hash = crypto.createHash("sha256");
  let maxDate = null;
  for (const { file, buf, day } of readDays()) {
    if (day.date < FROM || day.date > TO) continue;
    hash.update(file).update(buf);
    for (const venue of day.k?.venues ?? []) {
      const bVenue = day.b?.venues?.find(
        (v) => v.venue_code === venue.venue_code,
      );
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
        if (!maxDate || r.date > maxDate) maxDate = r.date;
      }
    }
  }
  return { races, maxDate, inputHash: hash.digest("hex") };
}

const pt = (x) =>
  x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 10;

// 再現できるよう、ブートストラップの乱数は種を固定する
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 会場×月×レース番号帯×級別の期待値（30件未満の層は会場×月） */
function expectedRates(races) {
  const strata = new Map();
  const fallback = new Map();
  const add = (m, k, r) => {
    const s = m.get(k) ?? { n: 0, win: 0 };
    s.n += 1;
    s.win += r.inWin;
    m.set(k, s);
  };
  for (const r of races) {
    add(fallback, `${r.venue}|${r.month}`, r);
    if (r.cls) add(strata, `${r.venue}|${r.month}|${r.rnBand}|${r.cls}`, r);
  }
  return (r) => {
    const s = r.cls
      ? strata.get(`${r.venue}|${r.month}|${r.rnBand}|${r.cls}`)
      : null;
    const f =
      s && s.n >= MIN_STRATUM ? s : fallback.get(`${r.venue}|${r.month}`);
    return f.win / f.n;
  };
}

/** 全会場の差 D̄（区分ごと）。venueAgg: Map(venue → {N, W, bins: {key: {n, w}}}) */
function pooledDiff(venueAgg, binKey) {
  let n = 0;
  let num = 0;
  for (const v of venueAgg.values()) {
    const b = v.bins[binKey];
    if (!b || !b.n || !v.N) continue;
    n += b.n;
    num += b.w - (b.n * v.W) / v.N;
  }
  return n ? num / n : null;
}

/**
 * 区分ごとの会場内比較。binOf(race) が区分キー（対象外は null）を返す
 */
function compare(
  races,
  bins,
  binOf,
  { bootstrap = false, expected = null } = {},
) {
  const target = races.filter((r) => binOf(r) != null);
  // 会場 → 会場×日（クラスタ）→ 区分ごとの件数
  const clustersByVenue = new Map();
  const venueAgg = new Map();
  const tech = new Map();
  const adj = new Map();
  for (const r of target) {
    const key = binOf(r);
    const cKey = r.date;
    let cl = clustersByVenue.get(r.venue);
    if (!cl) clustersByVenue.set(r.venue, (cl = new Map()));
    const c = cl.get(cKey) ?? { N: 0, W: 0, bins: {} };
    c.N += 1;
    c.W += r.inWin;
    c.bins[key] ??= { n: 0, w: 0 };
    c.bins[key].n += 1;
    c.bins[key].w += r.inWin;
    cl.set(cKey, c);

    const v = venueAgg.get(r.venue) ?? { N: 0, W: 0, bins: {} };
    v.N += 1;
    v.W += r.inWin;
    v.bins[key] ??= { n: 0, w: 0 };
    v.bins[key].n += 1;
    v.bins[key].w += r.inWin;
    venueAgg.set(r.venue, v);

    const tk = `${r.venue}|${key}`;
    const t = tech.get(tk) ?? {};
    if (r.technique) t[r.technique] = (t[r.technique] ?? 0) + 1;
    tech.set(tk, t);

    if (expected) {
      const a = adj.get(key) ?? { n: 0, resid: 0 };
      a.n += 1;
      a.resid += r.inWin - expected(r);
      adj.set(key, a);
    }
  }

  let boot = null;
  if (bootstrap) {
    const rand = mulberry32(211);
    const clusterLists = [...clustersByVenue].map(([venue, m]) => [
      venue,
      [...m.values()],
    ]);
    boot = Object.fromEntries(bins.map((b) => [b.key, []]));
    for (let i = 0; i < BOOT_REPS; i++) {
      const agg = new Map();
      for (const [venue, list] of clusterLists) {
        const v = { N: 0, W: 0, bins: {} };
        for (let j = 0; j < list.length; j++) {
          const c = list[Math.floor(rand() * list.length)];
          v.N += c.N;
          v.W += c.W;
          for (const [k, b] of Object.entries(c.bins)) {
            v.bins[k] ??= { n: 0, w: 0 };
            v.bins[k].n += b.n;
            v.bins[k].w += b.w;
          }
        }
        agg.set(venue, v);
      }
      for (const b of bins) boot[b.key].push(pooledDiff(agg, b.key));
    }
  }
  const quantile = (arr, q) => {
    const s = arr.filter((x) => x != null).sort((a, b) => a - b);
    return s.length
      ? s[Math.min(s.length - 1, Math.floor(q * s.length))]
      : null;
  };

  const venues = {};
  const pooled = {};
  for (const bin of bins) {
    const dBar = pooledDiff(venueAgg, bin.key);
    let sameSign = 0;
    let eligible = 0;
    let n = 0;
    for (const [venue, v] of venueAgg) {
      const b = v.bins[bin.key];
      if (!b) continue;
      n += b.n;
      const d = b.w / b.n - v.W / v.N;
      venues[venue] ??= {
        all: { n: v.N, inWinRate: pt(v.W / v.N) },
        bins: {},
      };
      venues[venue].bins[bin.key] = {
        n: b.n,
        inWinRate: pt(b.w / b.n),
        diffVsVenue: pt(d),
        techniques: Object.fromEntries(
          TECHNIQUES.map((t) => [t, tech.get(`${venue}|${bin.key}`)?.[t] ?? 0]),
        ),
      };
      if (b.n >= VENUE_SIGN_MIN_N && dBar != null) {
        eligible += 1;
        if (Math.sign(d) === Math.sign(dBar)) sameSign += 1;
      }
    }
    const a = adj.get(bin.key);
    const alpha = (1 - CI_LEVEL) / 2;
    pooled[bin.key] = {
      label: bin.label,
      n,
      diffVsVenue: pt(dBar),
      ci: boot
        ? [
            pt(quantile(boot[bin.key], alpha)),
            pt(quantile(boot[bin.key], 1 - alpha)),
          ]
        : null,
      adjustedDiff: a ? pt(a.resid / a.n) : null,
      venueSign: { eligible, sameSign },
    };
  }
  return { pooled, venues };
}

function judge(full, first, second, keys) {
  return Object.fromEntries(
    keys.map((key) => {
      const f = full.pooled[key];
      const d = f.diffVsVenue;
      const a = first.pooled[key]?.diffVsVenue;
      const b = second.pooled[key]?.diffVsVenue;
      const checks = {
        c1_absDiffAtLeast3pt: d != null && Math.abs(d) >= 3,
        c2_ciExcludesZero:
          f.ci != null && f.ci[0] != null && (f.ci[0] > 0 || f.ci[1] < 0),
        c3_adjustedKeeps:
          d != null &&
          f.adjustedDiff != null &&
          Math.sign(f.adjustedDiff) === Math.sign(d) &&
          Math.abs(f.adjustedDiff) >= (Math.abs(d) * 2) / 3,
        c4_halvesSameSign:
          a != null &&
          b != null &&
          Math.sign(a) === Math.sign(d) &&
          Math.sign(b) === Math.sign(d),
        c5_venuesSameSign:
          f.venueSign.eligible > 0 &&
          f.venueSign.sameSign >= (f.venueSign.eligible * 2) / 3,
      };
      return [key, { ...checks, pass: Object.values(checks).every(Boolean) }];
    }),
  );
}

function analyze(races, bins, binOf, judgeKeys) {
  const firstHalf = races.filter((r) => r.date <= FIRST_HALF_END);
  const secondHalf = races.filter((r) => r.date > FIRST_HALF_END);
  const expected = expectedRates(races.filter((r) => binOf(r) != null));
  const full = compare(races, bins, binOf, { bootstrap: true, expected });
  const first = compare(firstHalf, bins, binOf);
  const second = compare(secondHalf, bins, binOf);
  return {
    pooled: full.pooled,
    firstHalf: first.pooled,
    secondHalf: second.pooled,
    judge: judge(full, first, second, judgeKeys),
    venues: full.venues,
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
