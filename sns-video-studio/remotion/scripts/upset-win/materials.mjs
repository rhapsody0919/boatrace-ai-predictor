/**
 * 【人気薄の1着】（BOA-1284）の材料の読み取り。Supabase の匿名の読み取り（画面と同じ公開キー、VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）だけを使い、
 * 書き込みはしない（全貌の fetch-materials.mjs と同じ鍵の分け方）。計算は src/upsetWin/model.js の純粋関数がする。
 *
 * 直近1年の回数は、日ごとの数（dayCounts）をキャッシュのファイル（--cache、既定 out/upset-win/day-counts.json）に残し、無い日だけ読む。
 * 1日の読み取りは5つの表（races・race_results・race_entries・exhibition_data・race_odds_final）を race_id の日で引く（約6回の要求）。
 * 初回は365日分（約2,200回）を読む。次の朝からは前日の1日だけ。
 * キャッシュには、読んだ時点で結果がそろった日だけを入れる（その日の全レースが中止か結果ありで、今日より前の日）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { READ_COLUMNS, addDays, dayCounts, shapeDay } from "../../src/upsetWin/model.js";

/** キャッシュの決まりの版（数え方を変えたら上げる。版が違うキャッシュは捨てて読み直す） */
export const COUNT_RULE_VERSION = "upset-win-counts/4";

async function sbGet(table, query, fetchImpl = fetch) {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase の URL・匿名キーが無い（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）");
  const out = [];
  for (let from = 0; ; from += 1000) {
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetchImpl(`${url}/rest/v1/${table}?${query}`, {
          signal: AbortSignal.timeout(30000),
          headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
        });
        if (res.ok || attempt >= 3 || res.status < 500) break;
      } catch (error) {
        if (attempt >= 3) throw new Error(`${table}: 読み取りに失敗（${error.message}）`);
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** その日の全レースの行（読み取りだけ） */
export async function fetchDayRows(date, { get = sbGet } = {}) {
  const like = `race_id=like.${encodeURIComponent(`${date}-*`)}`;
  const [races, results, entries, exhibition, odds] = await Promise.all([
    get("races", `race_date=eq.${date}&select=${READ_COLUMNS.races}&order=race_id`),
    get("race_results", `${like}&select=${READ_COLUMNS.race_results}&order=race_id`),
    get("race_entries", `${like}&select=${READ_COLUMNS.race_entries}&order=race_id,boat_number`),
    get("exhibition_data", `${like}&select=${READ_COLUMNS.exhibition_data}&order=race_id,boat_number`),
    get("race_odds_final", `${like}&select=${READ_COLUMNS.race_odds_final}&order=race_id`),
  ]);
  return { races, results, entries, exhibition, odds };
}

/** 1レースの行（送る口の読み直し・試験の見本の材料） */
export async function fetchRaceRows(raceId, { get = sbGet } = {}) {
  const id = `race_id=eq.${encodeURIComponent(raceId)}`;
  const [races, results, entries, exhibition, odds] = await Promise.all([
    get("races", `${id}&select=${READ_COLUMNS.races}`),
    get("race_results", `${id}&select=${READ_COLUMNS.race_results}`),
    get("race_entries", `${id}&select=${READ_COLUMNS.race_entries}&order=boat_number`),
    get("exhibition_data", `${id}&select=${READ_COLUMNS.exhibition_data}&order=boat_number`),
    get("race_odds_final", `${id}&select=${READ_COLUMNS.race_odds_final}`),
  ]);
  return { races, results, entries, exhibition, odds };
}

/** その日の結果がそろったか（中止・不成立でないレースに全部 1着がある）。そろわない日はキャッシュに入れない */
export const dayComplete = (races) =>
  races.length > 0 && races.every((r) => r.cancelled || r.no_race || r.rank1 != null);

export function readCache(file) {
  if (!file || !existsSync(file)) return { version: COUNT_RULE_VERSION, days: {} };
  const c = JSON.parse(readFileSync(file, "utf8"));
  return c?.version === COUNT_RULE_VERSION && c.days && typeof c.days === "object" ? c : { version: COUNT_RULE_VERSION, days: {} };
}

function writeCache(file, cache) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache));
  renameSync(tmp, file);
}

/**
 * 範囲の日ごとの数（項目ごと）。キャッシュに無い日を読み、そろった日をキャッシュに足す。
 * 返り値: { days: { 日: { 項目: [n, k] } }, fetched: 読んだ日の数 }。そろわない日（今日・結果の欠け）は投げる
 * レースが0件の日は全部の項目 [0, 0] として返すが、キャッシュには入れない（DB のデータの前の日・取得の失敗が0のまま残らないよう、毎回読み直す）。
 * データの始まりの後の0の日は、型の検査（checkBundle）がデータの欠けとして止める（2025-12-02〜2026-11-03 に0件の日は無い。2026-11-04 の読み取り）
 */
export async function loadDayCounts({ from, to, cacheFile, today, concurrency = 4, log = () => {}, get }) {
  const cache = readCache(cacheFile);
  const want = [];
  for (let d = from; d <= to; d = addDays(d, 1)) want.push(d);
  const missing = want.filter((d) => !cache.days[d]);
  const zero = {};
  let done = 0;
  const queue = [...missing];
  const work = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      if (d >= today) throw new Error(`${d} は今日（${today}）より前でない（結果がそろわない）`);
      const races = shapeDay(await fetchDayRows(d, get ? { get } : {}));
      // 結果のそろわない日（中止の判定が付かないまま1着の無いレースがある・取り込みの欠け）は、そのレースを外して数え、
      // キャッシュに入れない（次の朝に読み直す）。毎朝止まり続けないよう投げない。レースの無い日も入れない
      if (races.length && dayComplete(races)) cache.days[d] = dayCounts(races);
      else {
        if (races.length) log(`${d} の結果がそろっていない（1着の無いレースがある）。そのレースを外して数え、キャッシュに入れない`);
        zero[d] = dayCounts(races);
      }
      done += 1;
      if (done % 20 === 0) {
        log(`日ごとの数: ${done}/${missing.length} 日`);
        if (cacheFile) writeCache(cacheFile, cache);
      }
    }
  };
  // 1つの読み取りが落ちたら、残りの読み取りを止める（失敗した実行のために読み続けない）
  const guarded = () =>
    work().catch((error) => {
      queue.length = 0;
      throw error;
    });
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, guarded));
  if (cacheFile && missing.length) writeCache(cacheFile, cache);
  return { days: Object.fromEntries(want.map((d) => [d, cache.days[d] ?? zero[d]])), fetched: missing.length };
}

/** 項目ごとの日の数 → その項目の { 日: [n, k] } */
export const metricDays = (days, key) => Object.fromEntries(Object.entries(days).map(([d, v]) => [d, v[key]]));
