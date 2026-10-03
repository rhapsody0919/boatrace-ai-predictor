#!/usr/bin/env node
/**
 * races が丸1日無い会場日を、公式の出走表から作り直す（BOA-721）。
 *
 * 2026-06-03 の江戸川（03）・蒲郡（07）は、節の初日で全日中止だった。朝の初期化（当時の GitHub Actions）が
 * 開催場一覧の当日分への切り替え前に動き、新節の初日の会場を取りこぼした（9/12 の #625 で直した不具合と同じ）。
 * 公式の出走表・発走時刻は今も残っているので、通常の朝の初期化と同じ経路（scrapeVenue → generateAndWriteFromRacesData）
 * で races・race_entries・race_conditions を作り、--cancelled のときは中止の確定（cancellation_status='confirmed'）を立てる。
 *
 * 予想（predictions）は作らない。過去の日付は全レースが発走済みなので、generateAndWriteFromRacesData が書かない
 * （BOA-628 の発走済みの判定）。書いた後に、予想が0件であることも確かめる。
 *
 * 守り:
 *   - その会場日に races が1件でもあれば、書かずに止める（既存の行を上書きしない）
 *   - 出走表が12レースそろわなければ止める（公式の出走表の取得は strict）
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/backfill-missing-venue-day.js --date=2026-06-03 --venues=3,7 --cancelled          # 確認のみ
 *   node --env-file=.env.local scripts/maintenance/backfill-missing-venue-day.js --date=2026-06-03 --venues=3,7 --cancelled --apply  # 書き込み
 */
import { pathToFileURL } from "node:url";
import {
  CANCELLATION_CONFIRMED,
  isCancellationConfirmed,
} from "../lib/cancellationStatus.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const raceIdOf = (date, venue, race) =>
  `${date}-${String(venue).padStart(2, "0")}-${String(race).padStart(2, "0")}`;

export function parseArgs(argv) {
  const get = (k) =>
    argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const date = get("date");
  const venues = (get("venues") ?? "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 24);
  if (!date || !DATE_RE.test(date))
    throw new Error("--date=YYYY-MM-DD を指定してください");
  if (venues.length === 0)
    throw new Error("--venues=3,7 のように会場コードを指定してください");
  return {
    date,
    venues,
    apply: argv.includes("--apply"),
    cancelled: argv.includes("--cancelled"),
  };
}

/**
 * @param {{date: string, venues: number[], apply: boolean, cancelled: boolean}} opts
 * @param {{client: Object, scrapeVenue: Function, writeVenues: Function, log?: Function}} deps
 * @returns {Promise<{written: string[], skipped: Array<{venue: number, reason: string}>, races: number, entries: number}>}
 */
export async function backfillMissingVenueDay(opts, deps) {
  const log = deps.log ?? console.log;
  const { client } = deps;
  const out = { written: [], skipped: [], races: 0, entries: 0 };
  const scraped = [];
  for (const venue of opts.venues) {
    const { data: existing, error } = await client
      .from("races")
      .select("race_id")
      .eq("race_date", opts.date)
      .eq("venue_code", venue)
      .limit(1);
    if (error) throw new Error(`races の読み取りに失敗: ${error.message}`);
    if ((existing ?? []).length > 0) {
      out.skipped.push({ venue, reason: "races がすでにある" });
      continue;
    }
    const v = await deps.scrapeVenue(opts.date, venue, {
      strict: true,
      raceConcurrency: 4,
    });
    const races = v?.races ?? [];
    if (races.length !== 12) {
      throw new Error(
        `会場${venue}: 出走表が${races.length}レース（12のはず）。書かずに止めます`,
      );
    }
    const entries = races.reduce((n, r) => n + (r.racers?.length ?? 0), 0);
    out.races += races.length;
    out.entries += entries;
    log(
      `会場${venue}: ${races.length}レース・出走表 ${entries}艇（発走時刻 ${races.map((r) => r.startTime ?? "-").join(" ")}）`,
    );
    scraped.push(v);
  }
  if (!opts.apply) {
    log(
      `[DRY-RUN] 書く会場 ${scraped.map((v) => v.placeCd).join(",") || "なし"}・races ${out.races}・race_entries ${out.entries}`,
    );
    return out;
  }
  if (scraped.length === 0) return out;

  await deps.writeVenues(scraped, opts.date);
  const raceIds = scraped.flatMap((v) =>
    v.races.map((r) => raceIdOf(opts.date, v.placeCd, r.raceNo)),
  );
  if (opts.cancelled) {
    const { error } = await client
      .from("races")
      .update({ cancellation_status: CANCELLATION_CONFIRMED })
      .in("race_id", raceIds)
      .is("cancellation_status", null);
    if (error) throw new Error(`中止の確定の書き込みに失敗: ${error.message}`);
  }
  // 書いた結果の確認: races の数・中止の確定・予想が0件
  const { data: after, error: e2 } = await client
    .from("races")
    .select("race_id, cancellation_status")
    .in("race_id", raceIds);
  if (e2) throw new Error(`races の読み取りに失敗: ${e2.message}`);
  const { data: preds, error: e3 } = await client
    .from("predictions")
    .select("race_id")
    .in("race_id", raceIds);
  if (e3) throw new Error(`predictions の読み取りに失敗: ${e3.message}`);
  const confirmed = (after ?? []).filter(
    (r) => isCancellationConfirmed(r.cancellation_status),
  ).length;
  log(
    `[APPLY] races ${after?.length ?? 0}/${raceIds.length}・中止の確定 ${confirmed}・予想 ${preds?.length ?? 0}件（0のはず）`,
  );
  if ((after?.length ?? 0) !== raceIds.length)
    throw new Error("races の行数が想定と違います");
  if (opts.cancelled && confirmed !== raceIds.length)
    throw new Error("中止の確定が全レースに立っていません");
  if ((preds?.length ?? 0) !== 0)
    throw new Error("予想が書かれています（過去の日付に予想を作らない約束）");
  out.written = raceIds;
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { supabase } = await import("../lib/supabaseClient.js");
  const { scrapeVenue } = await import("../scrape-to-json.js");
  const { generateAndWriteFromRacesData } =
    await import("../daily/generate-predictions.js");
  const res = await backfillMissingVenueDay(opts, {
    client: supabase,
    scrapeVenue,
    writeVenues: (venues, date) =>
      generateAndWriteFromRacesData({
        racesData: { success: true, date, data: venues },
        date,
        client: supabase,
        throwOnError: true,
      }),
  });
  for (const s of res.skipped)
    console.log(`会場${s.venue}: 書かない（${s.reason}）`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    console.error(`エラー: ${e.message}`);
    process.exitCode = 1;
  });
}
