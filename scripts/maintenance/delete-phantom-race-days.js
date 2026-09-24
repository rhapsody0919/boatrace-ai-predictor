#!/usr/bin/env node
/**
 * 「幻の開催日」（過去の実在開催日の race_entries が複製され、開催終了後の別日付に誤って
 * 保存されたレース）を races から削除する（BOA-407）。
 *
 * 背景: BOA-403 の調査で判明した race_results 欠損のうち venue_not_in_k 分類（該当日の
 * K-fileにその会場のブロックが無い）について、BOA-407 で全件を調査した結果、race_id の
 * 日付ズレではなく「過去の実在日の出走表がそのまま複製され、別日付の下に誤保存された」
 * ことが判明した（docs/issues/venue-not-in-k-phantom-race-days.md、PR #818）。
 *
 * 判定方法（PR #818 §2.3 と同じロジック）: 対象会場日の各レース番号（1〜12）について、
 * 艇1〜6の racer_id を、過去14日以内でその会場のデータが最初に存在する日（データが無い
 * 日は読み飛ばす）と突き合わせ、12レース×6艇=72値が完全一致すれば「幻」と判定する。
 *
 * 除外: 2025-12-03 の津(09)は、自社DBに比較対象となる過去日が無く（自社データ最古日）、
 * BOA-325（Done）の120レースの一部でもあるため、本スクリプトの対象に含めない
 * （前提の再検証はBOA-413で別途扱う）。
 *
 * 【新規の公式サイトアクセスは無い】（DB読み取りのみ）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/delete-phantom-race-days.js plan
 *   node --env-file=.env.local scripts/maintenance/delete-phantom-race-days.js delete          # DRY-RUN
 *   node --env-file=.env.local scripts/maintenance/delete-phantom-race-days.js delete --apply  # 書き込み（要承認）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll, supabase } from "../lib/supabaseClient.js";
import {
  classifyMissingResult,
  MISSING_STATUS,
} from "../lib/kbResultsBackfillRows.js";
import { _internal as kbBackfillInternal } from "./kb-backfill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const ARCHIVE_DIR = path.join(REPO_ROOT, "data/kb-archive");

const FROM = "2025-12-03";
const TO = "2026-03-31";
const LOOKBACK_DAYS = 14;
const RACE_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);
const BOAT_NUMBERS = [1, 2, 3, 4, 5, 6];

// 2025-12-03の津(09)はBOA-325・BOA-413の対象のため、本スクリプトでは除外する
const EXCLUDED = new Set(["2025-12-03|9"]);

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** venue_not_in_k に分類される (race_date, venue_code) の一覧を取得する（読み取りのみ） */
async function findVenueNotInKGroups() {
  const races = await fetchAll(
    "races",
    "race_id, race_date, venue_code, race_number",
    (q) => q.gte("race_date", FROM).lte("race_date", TO).order("race_id"),
    { throwOnError: true },
  );
  const results = await fetchAll(
    "race_results",
    "race_id",
    (q) => q.gte("race_id", FROM).lte("race_id", `${TO}~`),
    { throwOnError: true },
  );
  const hasResult = new Set(results.map((r) => r.race_id));
  const seen = new Set();
  const missing = races
    .filter((r) => !hasResult.has(r.race_id))
    .filter((r) => {
      if (seen.has(r.race_id)) return false;
      seen.add(r.race_id);
      return true;
    });

  const dayCache = new Map();
  const getDay = (date) => {
    if (!dayCache.has(date)) {
      dayCache.set(date, kbBackfillInternal.readParsedDay(ARCHIVE_DIR, date));
    }
    return dayCache.get(date);
  };

  const groups = new Map(); // key: `${race_date}|${venue_code}` → Set<race_number>
  for (const r of missing) {
    const day = getDay(r.race_date);
    const result = classifyMissingResult(day, r.venue_code, r.race_number);
    if (result.status === MISSING_STATUS.VENUE_NOT_IN_K) {
      const key = `${r.race_date}|${r.venue_code}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(r.race_number);
    }
  }
  return groups;
}

/** 指定venue_code・race_dateの、race_number×boat_numberごとのracer_idマップを取得する */
async function fetchRacerIdGrid(client, raceDate, venueCode) {
  const racePrefix = `${raceDate}-${String(venueCode).padStart(2, "0")}-`;
  const races = await client
    .from("races")
    .select("race_id, race_number")
    .eq("race_date", raceDate)
    .eq("venue_code", venueCode);
  if (races.error) throw new Error(`races取得エラー: ${races.error.message}`);
  if (!races.data || races.data.length === 0) return null;

  const raceIds = races.data.map((r) => r.race_id);
  const entries = await client
    .from("race_entries")
    .select("race_id, boat_number, racer_id")
    .in("race_id", raceIds);
  if (entries.error)
    throw new Error(`race_entries取得エラー: ${entries.error.message}`);

  const raceNumberByRaceId = new Map(
    races.data.map((r) => [r.race_id, r.race_number]),
  );
  const grid = new Map(); // key: `${race_number}|${boat_number}` → racer_id
  for (const e of entries.data ?? []) {
    const rn = raceNumberByRaceId.get(e.race_id);
    if (rn == null) continue;
    grid.set(`${rn}|${e.boat_number}`, e.racer_id);
  }
  void racePrefix;
  return grid;
}

function gridsMatch(a, b) {
  for (const rn of RACE_NUMBERS) {
    for (const bn of BOAT_NUMBERS) {
      const key = `${rn}|${bn}`;
      if (!a.has(key) || !b.has(key)) return false;
      if (a.get(key) !== b.get(key)) return false;
    }
  }
  return true;
}

/** 過去14日以内で、その会場のデータが最初に見つかる日と72値の完全一致を確認する */
async function findPhantomMatch(client, raceDate, venueCode) {
  const current = await fetchRacerIdGrid(client, raceDate, venueCode);
  if (!current || current.size < RACE_NUMBERS.length * BOAT_NUMBERS.length) {
    return { matched: false, reason: "対象日の12レース×6艇が揃っていない" };
  }
  for (let delta = 1; delta <= LOOKBACK_DAYS; delta++) {
    const pastDate = addDays(raceDate, -delta);
    if (pastDate < FROM) break; // 自社データ範囲外
    const pastGrid = await fetchRacerIdGrid(client, pastDate, venueCode);
    if (!pastGrid || pastGrid.size === 0) continue; // その日データ無し、さらに遡る
    if (gridsMatch(current, pastGrid)) {
      return { matched: true, matchedDate: pastDate, daysAgo: delta };
    }
    // 不一致でも遡り続ける（直近の日に無関係な別データがあるだけの可能性がある。
    // PR #818 §3の三国(10)の実例: 01-11の複製元は01-09だが、1日前の01-10には
    // 無関係な別大会のR1〜R6が存在し、直近データで止めると誤判定する）
  }
  return {
    matched: false,
    reason: `過去${LOOKBACK_DAYS}日以内に比較対象データなし`,
  };
}

async function collectPhantoms() {
  const groups = await findVenueNotInKGroups();
  const phantoms = [];
  const nonPhantoms = [];
  for (const [key, raceNumbers] of groups) {
    const [raceDate, venueCodeStr] = key.split("|");
    const venueCode = Number(venueCodeStr);
    if (EXCLUDED.has(key)) {
      nonPhantoms.push({
        raceDate,
        venueCode,
        raceCount: raceNumbers.size,
        reason: "除外対象(BOA-413)",
      });
      continue;
    }
    if (raceNumbers.size !== RACE_NUMBERS.length) {
      nonPhantoms.push({
        raceDate,
        venueCode,
        raceCount: raceNumbers.size,
        reason: "12レース未満（対象外）",
      });
      continue;
    }
    const match = await findPhantomMatch(supabase, raceDate, venueCode);
    if (match.matched) {
      phantoms.push({
        raceDate,
        venueCode,
        matchedDate: match.matchedDate,
        daysAgo: match.daysAgo,
      });
    } else {
      nonPhantoms.push({
        raceDate,
        venueCode,
        raceCount: raceNumbers.size,
        reason: match.reason,
      });
    }
  }
  return { phantoms, nonPhantoms };
}

function raceIdsFor(raceDate, venueCode) {
  return RACE_NUMBERS.map(
    (rn) =>
      `${raceDate}-${String(venueCode).padStart(2, "0")}-${String(rn).padStart(2, "0")}`,
  );
}

async function cmdPlan() {
  const { phantoms, nonPhantoms } = await collectPhantoms();
  console.log(
    `幻の開催日と確定: ${phantoms.length}会場日（${phantoms.length * 12}レース）`,
  );
  for (const p of phantoms) {
    console.log(
      `  ${p.raceDate} 会場${p.venueCode} ← ${p.matchedDate}（${p.daysAgo}日前）と完全一致`,
    );
  }
  console.log(`対象外・不一致: ${nonPhantoms.length}件`);
  for (const n of nonPhantoms) {
    console.log(
      `  ${n.raceDate} 会場${n.venueCode}（${n.raceCount}レース）: ${n.reason}`,
    );
  }
  return 0;
}

async function cmdDelete(apply) {
  const { phantoms } = await collectPhantoms();
  const raceIds = phantoms.flatMap((p) => raceIdsFor(p.raceDate, p.venueCode));
  console.log(`削除対象: ${phantoms.length}会場日・${raceIds.length}レース`);
  if (raceIds.length === 0) {
    console.log("対象0件です");
    return 0;
  }
  if (!apply) {
    console.log("[DRY-RUN] --apply を付けると本番から削除します");
    console.log(
      raceIds.slice(0, 10).join(", ") + (raceIds.length > 10 ? " ..." : ""),
    );
    return 0;
  }
  const { error, count } = await supabase
    .from("races")
    .delete({ count: "exact" })
    .in("race_id", raceIds);
  if (error) {
    console.error("削除エラー:", error.message);
    return 1;
  }
  console.log(
    `削除完了: ${count}件（CASCADEでrace_entries・race_conditions・predictions等も連動削除）`,
  );
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--apply");
  if (command === "plan") return await cmdPlan();
  if (command === "delete") return await cmdDelete(apply);
  console.error(
    "使い方: node scripts/maintenance/delete-phantom-race-days.js <plan|delete> [--apply]",
  );
  return 1;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
