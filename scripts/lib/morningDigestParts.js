/**
 * generate-morning-digest.js の純粋な部品（DB に触らない）。
 * 行の組み立て（指標の行・帰郷の行・順位付け）、day 行・報告の組み立て、まとめの出力。
 * 書き込みの順・出力の文は generate-morning-digest.js の元の形のまま。
 */
import {
  EXTRACTION_THRESHOLDS,
  MIN_RUNS,
  MIN_RUNS_90D,
  NIGASHI_LIST_COURSE,
  computeSkillDelta,
  computePredicted,
  isSmallSampleByRuns,
  wilsonLowerPercentFromCount,
  normalizeRacerName,
} from "../../src/utils/digestMetrics.js";

/** 帰郷判定の節境界ガード: 1会場でこの人数を超えて「前日いて当日いない」なら、節の切り替わりとみなして除外 */
export const RETURNED_VENUE_GUARD = 20;

export function baselineKey(venueCode, grade, course) {
  return `${venueCode}|${grade}|${course}`;
}

/** 本日の会場×グレード×コースのベースライン。母数不足なら ALL へフォールバック */
export function lookupBaseline(baselineMap, venueCode, grade, course, metric) {
  const cell =
    baselineMap.get(baselineKey(venueCode, grade ?? "ippan", course)) ??
    baselineMap.get(baselineKey(venueCode, "ALL", course));
  const fallback = baselineMap.get(baselineKey(venueCode, "ALL", course));
  const chosen = cell && cell.runs >= 100 ? cell : fallback;
  // ベースラインが引けない行は metric_venue_baseline / metric_predicted が NULL になり、
  // morning_digest_rows の CHECK 制約 mdr_metric_fields_by_section で弾かれる。
  // DBの制約名だけのエラーになると原因が分からないので、ここで会場・コースを添えて落とす
  if (!chosen) {
    throw new Error(
      `会場${venueCode} ${course}コースのベースラインが見つかりません` +
        `（race_grade='ALL' のフォールバック行も無い）。夜間バッチ` +
        ` update-racer-course-technique-stats.js が走っているか確認してください`,
    );
  }
  const v = chosen[`${metric}_rate`];
  if (v === null || v === undefined) {
    throw new Error(
      `会場${venueCode} ${course}コースの ${metric}_rate が NULL です` +
        `（race_grade=${chosen.race_grade}）`,
    );
  }
  // どのセルを使ったかを返す。画面のラベルが「本日のグレード」なのか
  // 「全グレード」なのかを、実際に使った値と一致させるため
  // （実測で 110行中31行＝28.2% がALLへフォールバックしていた）
  return { rate: Number(v), grade: chosen.race_grade };
}

export function buildMetricRow({
  section,
  race,
  entry,
  stat,
  course,
  rate,
  expected,
  count,
  venueBaseline,
  baselineGrade = null,
  volatility,
  rate90d,
  runs90d,
}) {
  const skillDelta = computeSkillDelta({ rate, expected });
  const predicted =
    venueBaseline === null
      ? null
      : computePredicted({ venueBaseline, skillDelta });
  return {
    section,
    race_id: race.race_id,
    venue_code: race.venue_code,
    race_number: race.race_number,
    start_time: race.start_time,
    racer_id: entry.racer_id,
    racer_name: normalizeRacerName(entry.player_name),
    grade: entry.grade,
    boat_number: entry.boat_number,
    course,
    metric_value: rate,
    metric_expected: expected,
    metric_skill_delta: skillDelta,
    metric_venue_baseline: venueBaseline,
    metric_predicted: predicted ? predicted.value : null,
    sample_size: stat.runs,
    is_small_sample: isSmallSampleByRuns(stat.runs),
    metric_wilson_lower: wilsonLowerPercentFromCount(count, stat.runs),
    rate_90d: runs90d >= MIN_RUNS_90D ? rate90d : null,
    sample_size_90d: runs90d,
    motor_2rate: entry.motor_2rate === null ? null : Number(entry.motor_2rate),
    volatility_percentile: volatility ?? null,
    detail: {
      clampedPredicted: predicted ? predicted.clamped : false,
      // 会場平均に使ったセル（'ippan'/'G1'/…/'ALL'）。画面のラベルに出す
      baselineGrade,
    },
  };
}

/**
 * 1つの指標（nige・makuri・nigashi）の行。stat の `<section>_rate`・`_expected`・`_count`・`_rate_90d` を読み、
 * 会場×グレード×コースのベースラインを引いて buildMetricRow に渡す
 */
export function sectionRow(
  section,
  { race, entry, stat, course, baselineMap, volatility },
) {
  const baseline = lookupBaseline(
    baselineMap,
    race.venue_code,
    race.race_grade,
    course,
    section,
  );
  const rate90d = stat[`${section}_rate_90d`];
  return buildMetricRow({
    section,
    race,
    entry,
    stat,
    course,
    rate: Number(stat[`${section}_rate`]),
    expected: Number(stat[`${section}_expected`]),
    count: stat[`${section}_count`],
    venueBaseline: baseline.rate,
    baselineGrade: baseline.grade,
    volatility,
    rate90d: rate90d === null ? null : Number(rate90d),
    runs90d: stat.runs_90d,
  });
}

/** 選手の成績（racer_id|course）と会場のベースライン（venue|grade|course）を Map にする */
export function indexStats(statRows, baselineRows) {
  const statMap = new Map(
    statRows.map((s) => [`${s.racer_id}|${s.course}`, s]),
  );
  const baselineMap = new Map(
    baselineRows.map((b) => [
      baselineKey(b.venue_code, b.race_grade, b.course),
      b,
    ]),
  );
  return { statMap, baselineMap };
}

/** 逃げセクションの表示上限。実測で32.3件/日出るため常に効く */
const NIGE_LIMIT = 25;
/** 逃がしを保存するコース（＝当日の枠）。一覧に出すのは2（NIGASHI_LIST_COURSE）、3は折りたたみの中だけ（2026-10-15） */
const NIGASHI_COURSES = [2, 3];

export function buildSections({
  races,
  entries,
  statMap,
  baselineMap,
  volatilityMap,
}) {
  const raceById = new Map(races.map((r) => [r.race_id, r]));
  const nige = [];
  const makuri = [];
  const nigashi = [];

  for (const entry of entries) {
    const race = raceById.get(entry.race_id);
    if (!race) continue;
    const volatility = volatilityMap.get(race.race_id) ?? null;

    // 当日わかるのは枠番だけ。指標は「その選手が枠番と同じコースに進入した場合」で引く
    const stat = statMap.get(`${entry.racer_id}|${entry.boat_number}`);
    if (!stat || stat.runs < MIN_RUNS) continue;
    const course = entry.boat_number;
    const ctx = { race, entry, stat, course, baselineMap, volatility };

    if (course === 1 && Number(stat.nige_rate) >= EXTRACTION_THRESHOLDS.nige) {
      nige.push(sectionRow("nige", ctx));
    }

    if (Number(stat.makuri_rate) >= EXTRACTION_THRESHOLDS.makuri) {
      makuri.push(sectionRow("makuri", ctx));
    }

    // 逃がしは当日の2号艇（過去の2コースの実績）を一覧に出し、3号艇は画面の折りたたみの中だけに出す。
    // 4〜6号艇は保存しない（2026-10-15 オーナー承認。22pt の基準は変えない）
    if (NIGASHI_COURSES.includes(course) && stat.nigashi_rate !== null) {
      const delta = Number(stat.nigashi_rate) - Number(stat.nigashi_expected);
      if (delta >= EXTRACTION_THRESHOLDS.nigashi) {
        nigashi.push(sectionRow("nigashi", ctx));
      }
    }
  }

  const bySkill = (a, b) =>
    b.metric_skill_delta - a.metric_skill_delta ||
    a.race_id.localeCompare(b.race_id);

  const nigeSorted = nige.sort(bySkill);
  return {
    nige: nigeSorted.slice(0, NIGE_LIMIT),
    // 注目レースの選定は「表示上限で切る前」の全候補から行う。
    // featured のスコアは z × 方向一致度で、skill_delta の順位とは別物のため、
    // 26位以降の行が勝つケースがありうる（逃げは実測で平均32.3件/日出るため
    // 上限25件は常に効いており、切ってから選ぶと取りこぼす）
    nigeAll: nigeSorted,
    nigeTotal: nige.length,
    makuri: makuri.sort(bySkill),
    // 2号艇を先、3号艇を後に並べる（rank はこの順。読み手は course で分ける）
    nigashi: [
      ...nigashi.filter((r) => r.course === NIGASHI_LIST_COURSE).sort(bySkill),
      ...nigashi.filter((r) => r.course !== NIGASHI_LIST_COURSE).sort(bySkill),
    ],
  };
}

// ---------------------------------------------------------------------------
// 帰郷
// ---------------------------------------------------------------------------

/**
 * 前日いて当日いない選手（会場ごと）。前日・当日とも**欠場者を含めた名簿**で比べる。
 * 翌日の開催が無い会場（節の終わり）は対象外
 */
export function returnedCandidates({
  prevRaces,
  prevEntries,
  todayRaces,
  todayRoster,
}) {
  const prevRaceById = new Map(prevRaces.map((r) => [r.race_id, r]));
  const venuesToday = new Set(todayRaces.map((r) => r.venue_code));
  const todayRaceById = new Map(todayRaces.map((r) => [r.race_id, r]));
  const todayByVenueRacer = new Set(
    todayRoster
      .map((e) => {
        const race = todayRaceById.get(e.race_id);
        return race ? `${race.venue_code}|${e.racer_id}` : null;
      })
      .filter(Boolean),
  );

  const candidatesByVenue = new Map();
  const seen = new Set();
  for (const e of prevEntries) {
    const race = prevRaceById.get(e.race_id);
    if (!race) continue;
    if (!venuesToday.has(race.venue_code)) continue; // 翌日の開催が無い＝節の終わり
    const key = `${race.venue_code}|${e.racer_id}`;
    if (seen.has(key)) continue;
    if (todayByVenueRacer.has(key)) continue;
    seen.add(key);
    if (!candidatesByVenue.has(race.venue_code)) {
      candidatesByVenue.set(race.venue_code, []);
    }
    candidatesByVenue.get(race.venue_code).push({ race, entry: e });
  }
  return candidatesByVenue;
}

export function returnedRow(venueCode, race, entry) {
  return {
    section: "returned",
    race_id: null,
    venue_code: venueCode,
    race_number: null,
    start_time: null,
    racer_id: entry.racer_id,
    racer_name: normalizeRacerName(entry.player_name),
    grade: entry.grade,
    boat_number: null,
    course: null,
    metric_value: null,
    metric_expected: null,
    metric_skill_delta: null,
    metric_venue_baseline: null,
    metric_predicted: null,
    sample_size: null,
    is_small_sample: false,
    metric_wilson_lower: null,
    rate_90d: null,
    sample_size_90d: null,
    motor_2rate: null,
    volatility_percentile: null,
    detail: { lastRaceId: race.race_id },
  };
}

/**
 * 帰郷の行と、節境界ガードで除外した会場。
 * 節境界ガード: 1会場で閾値を超えたら、前節の最終日と新節の初日が連続した
 * ケースとみなして除外する。黙って0件にせず記録に残す（spec FR-14）
 */
export function returnedRows(candidatesByVenue) {
  const suppressed = [];
  const rows = [];
  for (const [venueCode, list] of candidatesByVenue) {
    if (list.length > RETURNED_VENUE_GUARD) {
      suppressed.push(venueCode);
      continue;
    }
    for (const { race, entry } of list) {
      rows.push(returnedRow(venueCode, race, entry));
    }
  }
  return { rows, suppressed };
}

/** race_special_notes（前日の absence）の理由を帰郷の行の detail に付ける（行を直接書き換える） */
export function attachReturnReasons(rows, notes) {
  const reasonByKey = new Map(
    (notes || []).map((n) => [`${n.venue_code}|${n.racer_id}`, n.detail_text]),
  );
  for (const r of rows) {
    const reason = reasonByKey.get(`${r.venue_code}|${r.racer_id}`);
    if (reason) r.detail = { ...r.detail, reason };
  }
}
