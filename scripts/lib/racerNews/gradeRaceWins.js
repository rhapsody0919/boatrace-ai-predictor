// FR1: 自社DB由来のグレードレース優勝ニュースの自動生成
// docs/design/racer-news-auto-collect/spec.md FR1 / plan.md 2.1 参照

import { supabase, isSupabaseEnabled, VENUE_NAMES } from "../supabaseClient.js";
import { getTodayDateJST, formatDateForUrl } from "../dateUtils.js";
import { isAlreadyProcessed } from "./dedup.js";
import { addPendingItem } from "./pendingReview.js";
import { generateGradeRaceWinNews } from "./templates.js";

const GRADE_RACE_GRADES = ["SG", "G1", "G2", "G3"];
const SOURCE_NAME = "BOAT RACEオフィシャルウェブサイト";

function buildRaceResultUrl(venueCode, raceNumber, raceDate) {
  const ymd = formatDateForUrl(raceDate);
  const jcd = String(venueCode).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${raceNumber}&jcd=${jcd}&hd=${ymd}`;
}

/**
 * 対象日にSG/G1/G2/G3で1着になった選手のニュースをracer_newsへ自動生成する
 * @param {{ targetDate?: string }} [options] targetDate省略時は当日(JST)
 * @returns {Promise<{ generated: number, pending: number, skipped: number, errors: number }>}
 */
export async function collectGradeRaceWinNews({ targetDate } = {}) {
  const date = targetDate || getTodayDateJST();
  const summary = { generated: 0, pending: 0, skipped: 0, errors: 0 };

  if (!isSupabaseEnabled()) {
    console.warn(
      "⚠️ Supabase未設定のためFR1（グレードレース優勝ニュース）をスキップ",
    );
    return summary;
  }

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("race_id, venue_code, race_number, race_grade")
    .eq("race_date", date)
    .in("race_grade", GRADE_RACE_GRADES);

  if (racesError) {
    throw new Error(`gradeレース取得に失敗しました: ${racesError.message}`);
  }
  if (!races || races.length === 0) {
    return summary;
  }

  const raceIds = races.map((r) => r.race_id);

  const { data: results, error: resultsError } = await supabase
    .from("race_results")
    .select("race_id, rank1, is_cancelled, is_no_race")
    .in("race_id", raceIds);
  if (resultsError) {
    throw new Error(`race_results取得に失敗しました: ${resultsError.message}`);
  }
  const resultByRaceId = new Map((results ?? []).map((r) => [r.race_id, r]));

  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, racer_id")
    .in("race_id", raceIds);
  if (entriesError) {
    throw new Error(`race_entries取得に失敗しました: ${entriesError.message}`);
  }

  // 1着エントリのみ事前に絞り込み、racer_profilesを一括取得するための対象racer_idを確定する
  const winningEntryByRaceId = new Map();
  for (const race of races) {
    const result = resultByRaceId.get(race.race_id);
    if (!result || result.is_cancelled || result.is_no_race || !result.rank1) {
      continue;
    }
    const entry = (entries ?? []).find(
      (e) => e.race_id === race.race_id && e.boat_number === result.rank1,
    );
    if (entry?.racer_id) {
      winningEntryByRaceId.set(race.race_id, entry);
    }
  }

  const racerIds = [
    ...new Set([...winningEntryByRaceId.values()].map((e) => e.racer_id)),
  ];
  let profileByRacerId = new Map();
  if (racerIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("racer_profiles")
      .select("racer_id, name")
      .in("racer_id", racerIds);
    if (profilesError) {
      throw new Error(
        `racer_profiles取得に失敗しました: ${profilesError.message}`,
      );
    }
    profileByRacerId = new Map((profiles ?? []).map((p) => [p.racer_id, p]));
  }

  for (const race of races) {
    try {
      const entry = winningEntryByRaceId.get(race.race_id);
      if (!entry) {
        summary.skipped++;
        continue;
      }

      const sourceUrl = buildRaceResultUrl(
        race.venue_code,
        race.race_number,
        date,
      );

      if (await isAlreadyProcessed(sourceUrl)) {
        summary.skipped++;
        continue;
      }

      const profile = profileByRacerId.get(entry.racer_id);
      if (!profile) {
        addPendingItem({
          id: `grade-race-win-${race.race_id}`,
          source: "grade-race-win",
          reason: `racer_profilesにracer_id=${entry.racer_id}が見つかりません`,
          candidate: { racerId: entry.racer_id, raceId: race.race_id },
          sourceUrl,
          sourceName: SOURCE_NAME,
          detectedAt: date,
        });
        summary.pending++;
        continue;
      }

      const { title, summary: newsSummary } = generateGradeRaceWinNews({
        racerName: profile.name.replace(/\s+/g, ""),
        raceGrade: race.race_grade,
        venueName: VENUE_NAMES[race.venue_code],
        raceNumber: race.race_number,
        raceDate: date,
      });

      const { error: insertError } = await supabase.from("racer_news").insert({
        racer_id: profile.racer_id,
        title,
        summary: newsSummary,
        source_url: sourceUrl,
        source_name: SOURCE_NAME,
        published_at: date,
      });
      if (insertError) {
        throw new Error(`racer_news投入に失敗しました: ${insertError.message}`);
      }

      summary.generated++;
    } catch (err) {
      console.error(
        `⚠️ race_id=${race.race_id} のグレードレース優勝ニュース生成に失敗しました:`,
        err.message,
      );
      summary.errors++;
    }
  }

  return summary;
}
