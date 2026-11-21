// verify-rough-water-trait.js から字のまま移した、アーカイブの読みと走の列（期間・条件の線・条件の旗・期待値の表・選手ごとの走）。アーカイブは KB_ARCHIVE_DIR から読む

import fs from "fs";
import path from "path";
import zlib from "zlib";
import os from "os";
import crypto from "crypto";

const ARCHIVE_DIR =
  process.env.KB_ARCHIVE_DIR ||
  path.join(os.homedir(), "boatrace-archive-backup/kb-archive");

// 画面の定数と同じ値（src/utils/racerConditionStats.js・src/components/race/basicInfoStats.js）
const STRONG_WIND_MS = 5;
const ROUGH_WAVE_CM = 5;
const WAVE_EXCLUDED_VENUE = 3;

const FROM = "2020-02-01";
const TO = "2026-09-30";

const MIN_VENUE_CELL = 200;

const dateInt = (s) => Number(s.replaceAll("-", ""));

// ---------- 読み込み ----------
const emptyRuns = () => ({
  racer: [],
  date: [],
  venue: [],
  course: [],
  win: [],
  top3: [],
  wind: [],
  wave: [],
  band: [],
  natWin: [],
});

// 全国勝率の帯（0.5刻み、2.0未満と8.0以上は端にまとめる）。不明は 99
const bandOf = (nw) =>
  nw == null || nw <= 0 ? 99 : Math.min(16, Math.max(4, Math.floor(nw * 2)));

// 対象期間の日ファイルを月・日付の順に並べる
function listDayFiles(parsedDir) {
  const out = [];
  for (const month of fs.readdirSync(parsedDir).sort()) {
    const dir = path.join(parsedDir, month);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith(".json.gz")) continue;
      const date = file.slice(3, 13);
      if (date < FROM || date > TO) continue;
      out.push({ file, full: path.join(dir, file) });
    }
  }
  return out;
}

function pushRun(R, di, vc, race, bRace, x) {
  const e = bRace?.entries?.find((b) => b.boat_number === x.boat_number);
  const nw = e?.national_win_rate;
  R.racer.push(x.racer_id);
  R.date.push(di);
  R.venue.push(vc);
  R.course.push(x.course);
  R.win.push(x.rank === 1 ? 1 : 0);
  R.top3.push(x.rank != null && x.rank <= 3 ? 1 : 0);
  R.wind.push(race.wind_speed ?? -1);
  R.wave.push(race.wave_height ?? -1);
  R.natWin.push(nw ?? -1);
  R.band.push(bandOf(nw));
}

// 1レース分の走を足す。数えたレースなら 1、走が無ければ 0
function pushRaceRuns(R, di, vc, race, bVenue) {
  const rows = (race.rows ?? []).filter((x) => x.course != null && x.racer_id);
  if (rows.length === 0) return 0;
  const bRace = bVenue?.races?.find((r) => r.race_number === race.race_number);
  for (const x of rows) pushRun(R, di, vc, race, bRace, x);
  return 1;
}

// 1日分の走を足す。数えたレース数を返す
function pushDayRuns(R, day) {
  const di = dateInt(day.date);
  let nRaces = 0;
  for (const venue of day.k?.venues ?? []) {
    const vc = venue.venue_code;
    const bVenue = day.b?.venues?.find((v) => v.venue_code === vc);
    for (const race of venue.races ?? [])
      nRaces += pushRaceRuns(R, di, vc, race, bVenue);
  }
  return nRaces;
}

function loadRuns() {
  const parsedDir = path.join(ARCHIVE_DIR, "parsed");
  const R = emptyRuns();
  const hash = crypto.createHash("sha256");
  let nRaces = 0;
  let days = 0;
  for (const { file, full } of listDayFiles(parsedDir)) {
    const buf = fs.readFileSync(full);
    hash.update(file).update(buf);
    const day = JSON.parse(zlib.gunzipSync(buf));
    days += 1;
    nRaces += pushDayRuns(R, day);
  }
  return { R, nRaces, days, inputHash: hash.digest("hex") };
}

// 条件の札: 1=荒れ 0=静水 -1=判定できない
function condFlags(R) {
  const n = R.racer.length;
  const wind = new Int8Array(n);
  const wave = new Int8Array(n);
  const rough = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    wind[i] = R.wind[i] < 0 ? -1 : R.wind[i] >= STRONG_WIND_MS ? 1 : 0;
    wave[i] =
      R.venue[i] === WAVE_EXCLUDED_VENUE || R.wave[i] < 0
        ? -1
        : R.wave[i] >= ROUGH_WAVE_CM
          ? 1
          : 0;
    if (wind[i] === 1 || wave[i] === 1) rough[i] = 1;
    else if (
      wind[i] === 0 &&
      (wave[i] === 0 || R.venue[i] === WAVE_EXCLUDED_VENUE)
    )
      rough[i] = 0;
    else rough[i] = -1;
  }
  return { wind, wave, rough };
}

function indicesIn(R, [from, to]) {
  const a = dateInt(from);
  const b = dateInt(to);
  const out = [];
  for (let i = 0; i < R.date.length; i++)
    if (R.date[i] >= a && R.date[i] <= b) out.push(i);
  return out;
}

// ---------- 期待値（同じ期間の全選手の率） ----------
function expectationTable(R, idx, flag, y) {
  const fine = new Map();
  const coarse = new Map();
  const add = (m, k, v) => {
    const s = m.get(k) ?? { n: 0, s: 0 };
    s.n += 1;
    s.s += v;
    m.set(k, s);
  };
  for (const i of idx) {
    const f = flag[i];
    if (f < 0) continue;
    add(fine, `${f}|${R.course[i]}|${R.band[i]}|${R.venue[i]}`, y[i]);
    add(coarse, `${f}|${R.course[i]}|${R.band[i]}`, y[i]);
  }
  return (i, f) => {
    const s = fine.get(`${f}|${R.course[i]}|${R.band[i]}|${R.venue[i]}`);
    if (s && s.n >= MIN_VENUE_CELL) return s.s / s.n;
    const c = coarse.get(`${f}|${R.course[i]}|${R.band[i]}`);
    if (c && c.n > 0) return c.s / c.n;
    return null;
  };
}

// 選手ごとの走（札が判定できる走だけ）
function racerRuns(R, idx, flag, y) {
  const E = expectationTable(R, idx, flag, y);
  const byRacer = new Map();
  let popRough = 0;
  let popRoughN = 0;
  for (const i of idx) {
    const f = flag[i];
    if (f < 0) continue;
    const eR = E(i, 1);
    const eC = E(i, 0);
    if (eR == null || eC == null) continue;
    let d = byRacer.get(R.racer[i]);
    if (!d)
      byRacer.set(
        R.racer[i],
        (d = { y: [], eR: [], eC: [], f: [], v: [], c1: 0, nat: 0, natN: 0 }),
      );
    d.y.push(y[i]);
    d.eR.push(eR);
    d.eC.push(eC);
    d.f.push(f);
    d.v.push(R.venue[i]);
    if (R.course[i] === 1) d.c1 += 1;
    if (R.natWin[i] > 0) {
      d.nat += R.natWin[i];
      d.natN += 1;
    }
    if (f === 1) {
      popRough += y[i];
      popRoughN += 1;
    }
  }
  return { byRacer, popRoughRate: popRough / popRoughN };
}

export {
  STRONG_WIND_MS,
  ROUGH_WAVE_CM,
  FROM,
  TO,
  loadRuns,
  condFlags,
  indicesIn,
  racerRuns,
};
