#!/usr/bin/env node
/**
 * 出走表（race_entries）が、公式のK/Bファイルと一致するかを突き合わせる監査（BOA-422・BOA-423）
 *
 * 背景: BOA-407（幻の開催日）は「開催が無い日に、過去日の出走表が複製される」事象で、race_results が
 * 欠損するため、欠損ベースの抽出で見つかった。本件はその逆で、**実際に開催があった日**の race_entries
 * だけが過去日のデータで汚染される。race_results は正常に入るため、既存の監視・抽出には一切ひっかからない。
 *
 * 日次の自動検知は、DBだけで完結する `data_health` の `entries.duplicates`（マイグレーション100）が担う。
 * このCLIは、その検知の**裏取り**（公式の一次情報との突き合わせ）と、過去分の一括監査に使う。
 *
 * 【新規の公式サイトアクセスは無い】（DB読み取り + ローカルのK/Bアーカイブ読み取りのみ）。
 * DBは日ごとに1回だけ読む（fetchAll には .order("race_id") を付ける。BOA-403 のページング不安定のため）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/audit-race-entries-vs-kb.js [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *                                                                             [--archive=data/kb-archive]
 *                                                                             [--threshold=0.9] [--json=out.json]
 *
 * 判定: 会場×日ごとに、Bファイル（番組表）の「艇番→登録番号」と、DBの race_entries を突き合わせ、
 * 一致率が --threshold（既定0.9）未満なら汚染の疑いとして報告する。レース単位の内訳も出す。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll } from "../lib/supabaseClient.js";
import { _internal as kbBackfillInternal } from "./kb-backfill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const FROM = arg("from", "2025-12-02");
const TO = arg("to", new Date().toISOString().slice(0, 10));
const ARCHIVE = path.resolve(REPO_ROOT, arg("archive", "data/kb-archive"));
const THRESHOLD = Number(arg("threshold", "0.9"));
const JSON_OUT = arg("json", null);

if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO))
  throw new Error(`--from・--to は YYYY-MM-DD です: ${FROM} 〜 ${TO}`);
if (!(THRESHOLD > 0 && THRESHOLD <= 1))
  throw new Error(`--threshold は 0 < x <= 1 です: ${THRESHOLD}`);
if (!fs.existsSync(ARCHIVE))
  throw new Error(
    `K/Bアーカイブが見つかりません: ${ARCHIVE}（kb-backfill.js で取得した data/kb-archive を --archive= で指定してください）`,
  );

const datesBetween = (from, to) => {
  const out = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
};

const raceIdOf = (date, venueCode, raceNumber) =>
  `${date}-${String(venueCode).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`;

/** その日のDBの出走表を race_id -> (艇番 -> 登録番号) に畳む */
async function loadDbEntries(date) {
  const rows = await fetchAll(
    "race_entries",
    "race_id, boat_number, racer_id",
    (q) => q.gte("race_id", date).lte("race_id", `${date}~`).order("race_id"),
    { throwOnError: true },
  );
  const byRace = new Map();
  for (const e of rows) {
    if (!byRace.has(e.race_id)) byRace.set(e.race_id, new Map());
    byRace.get(e.race_id).set(e.boat_number, e.racer_id);
  }
  return byRace;
}

/** 会場×日ごとに、Bファイルとの一致を数える */
function compareVenue(date, venue, dbEntries) {
  const venueCode = Number(venue.venue_code);
  let match = 0;
  let total = 0;
  const races = [];
  for (const race of venue.races ?? []) {
    const db = dbEntries.get(raceIdOf(date, venueCode, race.race_number));
    if (!db) continue; // DBにそのレースが無い（欠損は別の監視の担当）
    let m = 0;
    let t = 0;
    for (const entry of race.entries ?? []) {
      t++;
      if (db.get(entry.boat_number) === entry.racer_id) m++;
    }
    if (t === 0) continue;
    match += m;
    total += t;
    races.push({ race_number: race.race_number, match: m, total: t });
  }
  return { venue_code: venueCode, match, total, races };
}

async function main() {
  const findings = [];
  const skipped = [];
  let checkedVenueDays = 0;

  for (const date of datesBetween(FROM, TO)) {
    let day = null;
    try {
      day = kbBackfillInternal.readParsedDay(ARCHIVE, date);
    } catch {
      day = null;
    }
    if (!day?.b?.venues?.length) {
      skipped.push({ date, reason: "Bファイルが無い（未取得・未開催）" });
      continue;
    }
    const dbEntries = await loadDbEntries(date);
    if (dbEntries.size === 0) {
      skipped.push({ date, reason: "DBに出走表が無い" });
      continue;
    }
    for (const venue of day.b.venues) {
      const result = compareVenue(date, venue, dbEntries);
      if (result.total === 0) continue; // 幻の開催日など、DB側に対応するレースが無い（別の監視の担当）
      checkedVenueDays++;
      const rate = result.match / result.total;
      if (rate >= THRESHOLD) continue;
      findings.push({
        date,
        venue_code: result.venue_code,
        match: result.match,
        total: result.total,
        rate: Number(rate.toFixed(4)),
        contaminated_races: result.races
          .filter((r) => r.match < r.total)
          .map((r) => r.race_number),
      });
    }
  }

  const summary = {
    from: FROM,
    to: TO,
    threshold: THRESHOLD,
    checkedVenueDays,
    findingCount: findings.length,
    contaminatedRaceCount: findings.reduce(
      (n, f) => n + f.contaminated_races.length,
      0,
    ),
    skippedCount: skipped.length,
  };

  if (JSON_OUT) {
    fs.writeFileSync(
      path.resolve(JSON_OUT),
      JSON.stringify({ summary, findings, skipped }, null, 2),
    );
    console.log(`JSONを書き出しました: ${path.resolve(JSON_OUT)}`);
  }
  console.log(JSON.stringify(summary, null, 2));
  for (const f of findings)
    console.log(
      `  ${f.date} 会場${String(f.venue_code).padStart(2, "0")}: ${f.match}/${f.total} 一致` +
        `（汚染 ${f.contaminated_races.length}レース: R${f.contaminated_races.join(" R")}）`,
    );
  if (findings.length === 0) console.log("  汚染の疑いはありません");
}

await main();
