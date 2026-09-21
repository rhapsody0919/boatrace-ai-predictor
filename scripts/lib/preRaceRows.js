/**
 * 出走表・直前情報の全項目の解析結果（scripts/lib/raceListParser.js・beforeInfoParser.js）から、DBへ書く行を作る
 * （純関数。DB・取得先・fs に接続しない。A1・A2 の Vercel 化を見据えて、解析・行の組み立て・書き込みを分ける）。
 *
 * extended=false は、旧実装が書いていた列だけの行（マイグレーション081・082の未適用のDB用）。
 * extended=true は、新しい列（scripts/lib/preRaceSchema.js が適用済みと判定した表だけ）を含める。
 * 旧実装と共通の列の値は、同じ。違いは、行に新しい列が加わること（と、A2で欠場艇の行も書くこと）だけ
 * （scripts/maintenance/verify-pre-race-parsers.js が旧実装と比べる）。
 */

/** 発走予定時刻（Date）を、JSTの "HH:MM" にする */
export function formatJstHm(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(11, 16);
}

/**
 * race_entries の行（1レース6艇）。ai_score系は書かない。
 *
 * @param {string} raceId
 * @param {ReturnType<import("./raceListParser.js").parseRaceListPage>["entries"]} entries
 * @param {{extended?: boolean}} [options]
 */
export function buildRaceEntryRows(raceId, entries, { extended = false } = {}) {
  return entries.map((e) => ({
    race_id: raceId,
    boat_number: e.boat_number,
    racer_id: e.racer_id,
    player_name: e.player_name,
    grade: e.grade,
    age: e.age,
    win_rate: e.win_rate,
    local_win_rate: e.local_win_rate,
    global_2rate: e.global_2rate,
    local_2rate: e.local_2rate,
    global_3rate: e.global_3rate,
    local_3rate: e.local_3rate,
    motor_number: e.motor_number,
    motor_2rate: e.motor_2rate,
    motor_3rate: e.motor_3rate,
    boat_number_id: e.boat_number_id,
    boat_2rate: e.boat_2rate,
    boat_3rate: e.boat_3rate,
    ...(extended
      ? {
          weight_kg: e.weight_kg,
          branch: e.branch,
          hometown: e.hometown,
          f_count: e.f_count,
          l_count: e.l_count,
          is_absent: e.is_absent,
        }
      : {}),
  }));
}

/**
 * race_conditions の行（気象の列を除く。気象は buildWeatherRows が作る）。race_grade は races テーブルで管理する。
 *
 * @param {string} raceId
 * @param {ReturnType<import("./raceListParser.js").parseRaceListPage>["meta"]} meta
 * @param {{extended?: boolean}} [options]
 */
export function buildRaceConditionRow(raceId, meta, { extended = false } = {}) {
  return {
    race_id: raceId,
    series_day: meta.seriesDay,
    is_final_day: meta.isFinalDay,
    race_title: meta.raceTitle,
    race_stage: meta.raceStage,
    ...(extended
      ? {
          race_distance_m: meta.distanceM,
          // NULL=未取得、{}=ラベルなしを確認した
          race_labels: meta.labels.map((label) => label.text),
        }
      : {}),
  };
}

/**
 * exhibition_data の行。展示タイム・スタート展示のSTがある艇の行を書く（旧実装と同じ）。extended では、
 * 欠場艇（体重だけがある）の行も書く（is_absent=true。他の列はNULL）。
 *
 * @param {string} raceId
 * @param {ReturnType<import("./beforeInfoParser.js").parseBeforeInfoPage>["boats"]} boats
 * @param {{extended?: boolean}} [options]
 */
export function buildExhibitionRows(raceId, boats, { extended = false } = {}) {
  return boats
    .filter(
      (b) =>
        b.exhibition_time != null ||
        b.start_timing != null ||
        (extended && b.is_absent),
    )
    .map((b) => ({
      race_id: raceId,
      boat_number: b.boat_number,
      exhibition_time: b.exhibition_time,
      start_timing: b.start_timing,
      tilt: b.tilt,
      propeller_change: b.propeller_text,
      parts_changed: b.parts_changed.length > 0 ? b.parts_changed : null,
      adjustment_weight: b.adjustment_weight,
      today_weight: b.weight_kg,
      prev_race_no: b.prev_race_no,
      prev_entry_course: b.prev_entry_course,
      prev_start_timing: b.prev_start_timing,
      prev_finish_rank: b.prev_finish_rank,
      ...(extended
        ? {
            exhibition_course: b.exhibition_course,
            start_flag: b.start_flag,
            prev_finish_mark: b.prev_finish_mark,
            is_absent: b.is_absent,
          }
        : {}),
    }));
}

/**
 * 締切予定時刻の日中の変更を、races.start_time の更新に変える。
 * races.start_time は予定表（scrape_slots）の期限の基準で、racelist の「締切予定時刻」の行と同じ値。朝の値が
 * 日中に変わることがある（唐津 2026-09-16 8R: 12:04 → 12:05）。同日12レース分の行を持つ出走表を取るたびに、
 * 会場の全レースを照合する。
 *
 * 更新しない場合: 時刻が空（中止・順延等）、同じ値、または maxShiftMin を超えて動く（別の日の値・書式の誤読の恐れ）。
 *
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time: Date}>} schedule getRaceSchedule() の返り値
 * @param {number} venueCode
 * @param {Array<{race_number: number, time: string|null}>} deadlines 出走表の締切予定時刻
 * @param {{maxShiftMin?: number}} [options]
 * @returns {{updates: Array<{race_id: string, start_time: string, previous: string}>, skipped: Array<{race_id: string, reason: string}>}}
 */
export function planDeadlineUpdates(
  schedule,
  venueCode,
  deadlines,
  { maxShiftMin = 180 } = {},
) {
  const byRaceNo = new Map(deadlines.map((d) => [d.race_number, d.time]));
  const updates = [];
  const skipped = [];
  for (const race of schedule) {
    if (race.venue_code !== venueCode) continue;
    const time = byRaceNo.get(race.race_no);
    if (!time) {
      if (byRaceNo.has(race.race_no)) {
        skipped.push({ race_id: race.race_id, reason: "no_time" });
      }
      continue;
    }
    const current = formatJstHm(race.start_time);
    if (time === current) continue;
    const [h, m] = time.split(":").map(Number);
    const [ch, cm] = current.split(":").map(Number);
    if (Math.abs(h * 60 + m - (ch * 60 + cm)) > maxShiftMin) {
      skipped.push({ race_id: race.race_id, reason: "shift_too_large" });
      continue;
    }
    updates.push({
      race_id: race.race_id,
      start_time: `${time}:00`,
      previous: current,
    });
  }
  return { updates, skipped };
}
