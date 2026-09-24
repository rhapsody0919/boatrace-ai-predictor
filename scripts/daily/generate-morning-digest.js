#!/usr/bin/env node
/**
 * generate-morning-digest.js
 *
 * 「本日のデータ一覧」（BOA-402）の1日ぶんの抽出結果を morning_digest_rows /
 * morning_digest_days に書き込む。ページ（/today）もSNS下書き生成も、この2表**だけ**を
 * 読む。抽出ロジックはこのスクリプトの1箇所にしか存在しない（ADR-0070）。
 *
 * 設計: docs/design/morning-data-digest/plan.md §3.2〜§3.3
 *       docs/adr/0070-morning-digest-precomputed-rows.md
 *       docs/adr/0071-venue-adjusted-skill-delta.md
 *
 * ## 前提
 *
 * 夜間バッチ update-racer-course-technique-stats.js（JST 01:10）が
 * venue_course_technique_baseline / racer_course_technique_stats を更新済みであること。
 * 完全性チェックで window_end を見て、古ければ書かない。
 *
 * ## 日付の扱い
 *
 * すべて **JST** で判定する。DBの current_date はUTCで1日ずれる（spec §1.6）。
 *
 * ## 実行
 *
 *   node scripts/daily/generate-morning-digest.js                    # JSTの当日
 *   node scripts/daily/generate-morning-digest.js --date=2026-09-24  # 任意日（再生成・バックフィル）
 *   node scripts/daily/generate-morning-digest.js --dry-run          # 書き込まずに結果を出す
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  EXTRACTION_THRESHOLDS,
  MIN_RUNS,
  MIN_RUNS_90D,
  computeSkillDelta,
  computePredicted,
  computeFeaturedScore,
  isSmallSampleByRuns,
  wilsonLowerPercentFromCount,
  normalizeRacerName,
} from "../../src/utils/digestMetrics.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const DRY_RUN = Boolean(args["dry-run"]);

/** PostgRESTの1ページあたりの行数 */
const PAGE_SIZE = 1000;

/** 逃げセクションの表示上限。実測で32.3件/日出るため常に効く */
const NIGE_LIMIT = 25;

/**
 * 帰郷判定の節境界ガード。1会場あたりこの件数を超えたら「節の切り替わり」とみなして
 * その会場を除外する。全期間295日の実測で、正常時の最大は4〜10件、節境界は39〜47件で、
 * 11〜20の帯が空。1会場あたりの延べ選手数は39〜52（中央値45）。
 */
const RETURNED_VENUE_GUARD = 20;

/** finish_mark が100%運用になった日。これより前は「昨日のフライング」が不完全 */
const FLYING_DATA_COMPLETE_FROM = "2026-09-21";

/** 当日の会場数が前日のこの割合を下回ったら、出走表の投入が途中とみなして書かない */
const VENUE_COUNT_MIN_RATIO = 0.7;

function todayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * `.range()` によるページ分割取得。
 *
 * ⚠️ 呼び出し側は必ず `.order()` を付けること。ORDER BY の無い LIMIT/OFFSET は
 * 行順が保証されず、ページ間で同じ行が重複したり抜けたりしうる。
 * 1チャンク200レース × 6艇 = 1200行のように、2ページ以上になるクエリが実際にある。
 */
async function fetchAll(buildQuery) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error("配列が返りませんでした");
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------------

async function fetchRaces(date) {
  return fetchAll((from, to) =>
    supabase
      .from("races")
      .select("race_id, venue_code, race_number, start_time, race_grade")
      .eq("race_date", date)
      .order("race_id", { ascending: true })
      .range(from, to),
  );
}

/**
 * @param {string[]} raceIds
 * @param {{includeAbsent?: boolean}} [opts] 帰郷判定では欠場者も名簿に含める。
 *   欠場（is_absent）は帰郷の前段であることが多く、除外すると**帰郷した選手そのものを
 *   取りこぼす**（2026-09-24の実測: 黄金井力良（津、racer_id=4432）が 9/23 に
 *   is_absent=true で、除外すると帰郷が6名になり競合掲載の7名と合わなかった）。
 *   指標セクション（逃げ・まくり・逃がし）は「本日走る選手」が対象なので除外する。
 */
async function fetchEntries(raceIds, { includeAbsent = false } = {}) {
  const all = [];
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("race_entries")
        .select(
          "race_id, boat_number, racer_id, player_name, grade, motor_2rate, is_absent",
        )
        .in("race_id", chunk)
        .order("race_id", { ascending: true })
        .order("boat_number", { ascending: true })
        .range(from, to),
    );
    all.push(...rows);
  }
  return all.filter(
    (e) => e.racer_id !== null && (includeAbsent || !e.is_absent),
  );
}

async function fetchRacerStats(racerIds) {
  const unique = [...new Set(racerIds)];
  const all = [];
  for (let i = 0; i < unique.length; i += 300) {
    const chunk = unique.slice(i, i + 300);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("racer_course_technique_stats")
        .select("*")
        .in("racer_id", chunk)
        .order("racer_id", { ascending: true })
        .order("course", { ascending: true })
        .range(from, to),
    );
    all.push(...rows);
  }
  return all;
}

async function fetchBaseline() {
  return fetchAll((from, to) =>
    supabase
      .from("venue_course_technique_baseline")
      .select("*")
      .range(from, to),
  );
}

/**
 * イン崩れ指数。**0〜1で保存されているので ×100 して返す**（plan.md §2.2、レビュー指摘H-1）。
 * volatilityPercentileIsFallback（会場内サンプル不足のプレースホルダ）の行は除外する。
 * predictions が未生成でも落とさない（plan.md §3.2、レビュー指摘H-7）。
 */
async function fetchVolatility(raceIds) {
  const map = new Map();
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("predictions")
        .select("race_id, feature_contributions")
        .eq("model_id", "unified")
        .in("race_id", chunk)
        .order("race_id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const fc = r.feature_contributions;
      const p = fc?.volatilityPercentile;
      if (typeof p !== "number") continue;
      if (fc?.volatilityPercentileIsFallback) continue;
      map.set(r.race_id, Math.round(p * 100 * 100) / 100);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// 完全性チェック（不完全なまま書かない。plan.md §3.2）
// ---------------------------------------------------------------------------

async function checkCompleteness(date, races, entries) {
  const problems = [];

  if (races.length === 0) {
    problems.push(`${date} の races が0件です`);
    return problems;
  }

  const raceIdsWithEntries = new Set(entries.map((e) => e.race_id));
  const missing = races.filter((r) => !raceIdsWithEntries.has(r.race_id));
  if (missing.length > 0) {
    problems.push(
      `出走表が無いレースが ${missing.length} 件あります（例: ${missing
        .slice(0, 3)
        .map((r) => r.race_id)
        .join(", ")}）`,
    );
  }

  // 会場数が前日より大きく減っていたら、出走表の投入が途中とみなす。
  // races に入っている行だけを基準にすると「10会場ぶんを完全な結果」として
  // 確定させてしまう（レビュー指摘H-6）。帰郷の偽陰性もここで防ぐ
  const venuesToday = new Set(races.map((r) => r.venue_code)).size;
  const prev = await fetchRaces(addDays(date, -1));
  const venuesPrev = new Set(prev.map((r) => r.venue_code)).size;
  if (venuesPrev > 0 && venuesToday < venuesPrev * VENUE_COUNT_MIN_RATIO) {
    problems.push(
      `会場数が前日より大きく減っています（前日${venuesPrev} → 当日${venuesToday}、` +
        `閾値は前日の${Math.round(VENUE_COUNT_MIN_RATIO * 100)}%）。出走表の投入が途中の可能性があります`,
    );
  }

  // 夜間バッチが当日ぶん走っているか
  const { data: stat, error } = await supabase
    .from("racer_course_technique_stats")
    .select("window_end")
    .order("window_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!stat) {
    problems.push(
      "racer_course_technique_stats が空です（夜間バッチが未実行）",
    );
  } else if (stat.window_end < addDays(date, -1)) {
    problems.push(
      `racer_course_technique_stats.window_end が ${stat.window_end} で古すぎます（${addDays(date, -1)} 以降が必要）`,
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// セクションの生成
// ---------------------------------------------------------------------------

function baselineKey(venueCode, grade, course) {
  return `${venueCode}|${grade}|${course}`;
}

/** 本日の会場×グレード×コースのベースライン。母数不足なら ALL へフォールバック */
function lookupBaseline(baselineMap, venueCode, grade, course, metric) {
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
  return Number(v);
}

function buildMetricRow({
  section,
  race,
  entry,
  stat,
  course,
  rate,
  expected,
  count,
  venueBaseline,
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
    detail: { clampedPredicted: predicted ? predicted.clamped : false },
  };
}

function buildSections({
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

    if (course === 1 && Number(stat.nige_rate) >= EXTRACTION_THRESHOLDS.nige) {
      const venueBaseline = lookupBaseline(
        baselineMap,
        race.venue_code,
        race.race_grade,
        1,
        "nige",
      );
      nige.push(
        buildMetricRow({
          section: "nige",
          race,
          entry,
          stat,
          course,
          rate: Number(stat.nige_rate),
          expected: Number(stat.nige_expected),
          count: stat.nige_count,
          venueBaseline,
          volatility,
          rate90d:
            stat.nige_rate_90d === null ? null : Number(stat.nige_rate_90d),
          runs90d: stat.runs_90d,
        }),
      );
    }

    if (Number(stat.makuri_rate) >= EXTRACTION_THRESHOLDS.makuri) {
      const venueBaseline = lookupBaseline(
        baselineMap,
        race.venue_code,
        race.race_grade,
        course,
        "makuri",
      );
      makuri.push(
        buildMetricRow({
          section: "makuri",
          race,
          entry,
          stat,
          course,
          rate: Number(stat.makuri_rate),
          expected: Number(stat.makuri_expected),
          count: stat.makuri_count,
          venueBaseline,
          volatility,
          rate90d:
            stat.makuri_rate_90d === null ? null : Number(stat.makuri_rate_90d),
          runs90d: stat.runs_90d,
        }),
      );
    }

    if (course >= 2 && stat.nigashi_rate !== null) {
      const delta = Number(stat.nigashi_rate) - Number(stat.nigashi_expected);
      if (delta >= EXTRACTION_THRESHOLDS.nigashi) {
        const venueBaseline = lookupBaseline(
          baselineMap,
          race.venue_code,
          race.race_grade,
          course,
          "nigashi",
        );
        nigashi.push(
          buildMetricRow({
            section: "nigashi",
            race,
            entry,
            stat,
            course,
            rate: Number(stat.nigashi_rate),
            expected: Number(stat.nigashi_expected),
            count: stat.nigashi_count,
            venueBaseline,
            volatility,
            rate90d:
              stat.nigashi_rate_90d === null
                ? null
                : Number(stat.nigashi_rate_90d),
            runs90d: stat.runs_90d,
          }),
        );
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
    nigashi: nigashi.sort(bySkill),
  };
}

/**
 * 「今日の注目レース」。**地力(pt)のまま指標横断で比較しない**。
 * ベースレートが逃げ53%・まくり4%と桁違いなので、zスコアに標準化してから
 * イン崩れ指数との方向一致度を掛ける（plan.md §3.3、レビュー指摘C-1）。
 */
function pickFeatured(sections) {
  const candidates = [...sections.nige, ...sections.makuri, ...sections.nigashi]
    .filter((r) => r.volatility_percentile !== null)
    .map((r) => ({
      row: r,
      score: computeFeaturedScore({
        metric: r.section,
        rate: r.metric_value,
        expected: r.metric_expected,
        n: r.sample_size,
        volatilityPercentile: r.volatility_percentile,
      }),
    }))
    .filter((c) => c.score !== null);

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => b.score - a.score || a.row.race_id.localeCompare(b.row.race_id),
  );
  const best = candidates[0];

  const metricLabel = {
    nige: "逃げ率",
    makuri: "まくり率",
    nigashi: "逃がし率",
  }[best.row.section];
  const direction =
    best.row.section === "nige" ? "イン有利" : "イン不利（1号艇が崩れる）";
  // 集計した事実だけで書く。推定値（metric_predicted）は文にも出さない
  // （2026-09-24、UIと同じ改訂。予想を提示している体裁を避ける）
  const reason =
    `この選手の${metricLabel}は全国${best.row.sample_size}走で${best.row.metric_value}%、` +
    `この会場・級別の平均は${best.row.metric_venue_baseline}%です。` +
    `AIが当日条件から算出したイン崩れ指数は${best.row.volatility_percentile}%で、` +
    `過去の実績と当日条件がどちらも「${direction}」方向を向いています。`;

  return {
    ...best.row,
    section: "featured",
    detail: {
      ...best.row.detail,
      reason,
      score: best.score,
      from: best.row.section,
    },
  };
}

/** 前日（JST）のフライング */
async function buildFlying(date, prevDate) {
  const prevRaces = await fetchRaces(prevDate);
  if (prevRaces.length === 0) return [];
  const raceById = new Map(prevRaces.map((r) => [r.race_id, r]));
  const ids = prevRaces.map((r) => r.race_id);

  const timings = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await fetchAll((from, to) =>
      supabase
        .from("race_start_timings")
        .select("race_id, boat_number, start_timing, finish_mark")
        .in("race_id", chunk)
        .eq("finish_mark", "F")
        .order("race_id", { ascending: true })
        .order("boat_number", { ascending: true })
        .range(from, to),
    );
    timings.push(...rows);
  }
  if (timings.length === 0) return [];

  const entries = await fetchEntries([
    ...new Set(timings.map((t) => t.race_id)),
  ]);
  const entryByKey = new Map(
    entries.map((e) => [`${e.race_id}|${e.boat_number}`, e]),
  );

  return timings
    .map((t) => {
      const race = raceById.get(t.race_id);
      const entry = entryByKey.get(`${t.race_id}|${t.boat_number}`);
      if (!race || !entry) return null;
      const st = t.start_timing === null ? null : Number(t.start_timing);
      return {
        section: "flying",
        race_id: t.race_id,
        venue_code: race.venue_code,
        race_number: race.race_number,
        start_time: race.start_time,
        racer_id: entry.racer_id,
        racer_name: normalizeRacerName(entry.player_name),
        grade: entry.grade,
        boat_number: t.boat_number,
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
        // "F.01" 形式（公式の表記に合わせる）
        detail: {
          startTiming: st,
          label:
            st === null
              ? "F"
              : `F.${String(Math.round(st * 100)).padStart(2, "0")}`,
        },
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) => a.venue_code - b.venue_code || a.race_number - b.race_number,
    );
}

/**
 * 前日の出走表にいたが、当日も同一会場の開催が続いているのに当日の出走表にいない選手。
 * 競合（ボートレース日和）の「昨日の帰郷選手」と同じ集合を再現する（spec FR-14）。
 */
async function buildReturned(date, prevDate, todayRaces) {
  const prevRaces = await fetchRaces(prevDate);
  if (prevRaces.length === 0) return { rows: [], suppressed: [] };

  // 前日・当日とも**欠場者を含めた名簿**で比べる。欠場は帰郷の前段であることが多く、
  // 前日側から除くと帰郷を取りこぼす。当日側は「出走表に名前があれば（欠場でも）
  // まだ帰っていない」ので、こちらも含める
  const prevEntries = await fetchEntries(
    prevRaces.map((r) => r.race_id),
    { includeAbsent: true },
  );
  const todayRoster = await fetchEntries(
    todayRaces.map((r) => r.race_id),
    { includeAbsent: true },
  );
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

  // 節境界ガード: 1会場で閾値を超えたら、前節の最終日と新節の初日が連続した
  // ケースとみなして除外する。黙って0件にせず記録に残す（spec FR-14）
  const suppressed = [];
  const rows = [];
  for (const [venueCode, list] of candidatesByVenue) {
    if (list.length > RETURNED_VENUE_GUARD) {
      suppressed.push(venueCode);
      continue;
    }
    for (const { race, entry } of list) {
      rows.push({
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
      });
    }
  }

  // 帰郷の「理由」は race_special_notes から。**結合キーは前日（D）**。
  // digest_date（D+1）で引くと1日ずれて理由が永久に出ない（レビュー指摘M-13）
  if (rows.length > 0) {
    const { data: notes, error } = await supabase
      .from("race_special_notes")
      .select("venue_code, racer_id, detail_text")
      .eq("race_date", prevDate)
      .eq("category", "absence");
    if (error) throw error;
    const reasonByKey = new Map(
      (notes || []).map((n) => [
        `${n.venue_code}|${n.racer_id}`,
        n.detail_text,
      ]),
    );
    for (const r of rows) {
      const reason = reasonByKey.get(`${r.venue_code}|${r.racer_id}`);
      if (reason) r.detail = { ...r.detail, reason };
    }
  }

  rows.sort((a, b) => a.venue_code - b.venue_code || a.racer_id - b.racer_id);
  return { rows, suppressed };
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

/**
 * 書き込み順は **rows が先、generated_at の確定が最後**（ADR-0070、レビュー指摘M-8）。
 * morning_digest_rows は morning_digest_days をFK参照するため、
 *   (1) day行を generated_at=NULL でINSERT → (2) rowsを投入 → (3) generated_atをUPDATE
 * の順で書く。途中で落ちると generated_at が NULL のまま残り、ページは「未生成」として
 * 扱える。逆順だと「該当0件」と混同される。
 */
async function write(date, dayRow, rows) {
  const { error: dayErr } = await supabase
    .from("morning_digest_days")
    .upsert({ ...dayRow, generated_at: null }, { onConflict: "digest_date" });
  if (dayErr) throw dayErr;

  const { error: delErr } = await supabase
    .from("morning_digest_rows")
    .delete()
    .eq("digest_date", date);
  if (delErr) throw delErr;

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("morning_digest_rows")
      .insert(rows.slice(i, i + 200));
    if (error) throw error;
  }

  const { error: stampErr } = await supabase
    .from("morning_digest_days")
    .update({ generated_at: new Date().toISOString() })
    .eq("digest_date", date);
  if (stampErr) throw stampErr;
}

// ---------------------------------------------------------------------------

async function main() {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabaseの環境変数が未設定です（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
  }

  const date = typeof args.date === "string" ? args.date : todayJST();
  const prevDate = addDays(date, -1);
  console.log(
    `本日のデータ一覧を生成します（対象 ${date} JST / 前日 ${prevDate}${DRY_RUN ? " / dry-run" : ""}）`,
  );

  const races = await fetchRaces(date);
  const entries =
    races.length > 0 ? await fetchEntries(races.map((r) => r.race_id)) : [];

  const problems = await checkCompleteness(date, races, entries);
  if (problems.length > 0) {
    console.log("\n完全性チェックを満たさないため、書き込まずに終了します:");
    for (const p of problems) console.log(`  - ${p}`);
    console.log(
      "\n（次回の実行で再試行されます。2回目でも満たせない場合はジョブを失敗させてください）",
    );
    process.exitCode = 0;
    return;
  }
  console.log(
    `  完全性チェック: OK（${new Set(races.map((r) => r.venue_code)).size}会場 ${races.length}レース ${entries.length}艇）`,
  );

  const [statRows, baselineRows, volatilityMap] = await Promise.all([
    fetchRacerStats(entries.map((e) => e.racer_id)),
    fetchBaseline(),
    fetchVolatility(races.map((r) => r.race_id)),
  ]);
  const statMap = new Map(
    statRows.map((s) => [`${s.racer_id}|${s.course}`, s]),
  );
  const baselineMap = new Map(
    baselineRows.map((b) => [
      baselineKey(b.venue_code, b.race_grade, b.course),
      b,
    ]),
  );
  if (volatilityMap.size === 0) {
    console.log(
      "  ⚠️ イン崩れ指数が1件も取得できませんでした（predictions が未生成）。" +
        "注目レースは生成せず、volatility_percentile は NULL で書きます",
    );
  }

  const sections = buildSections({
    races,
    entries,
    statMap,
    baselineMap,
    volatilityMap,
  });
  const featured = pickFeatured(sections);
  const flying = await buildFlying(date, prevDate);
  const returned = await buildReturned(date, prevDate, races);

  const ordered = [
    ...(featured ? [featured] : []),
    ...sections.nige,
    ...sections.makuri,
    ...sections.nigashi,
    ...flying,
    ...returned.rows,
  ];

  // rank はセクション内の並び順（1始まり）
  const rankBySection = new Map();
  const rows = ordered.map((r) => {
    const next = (rankBySection.get(r.section) ?? 0) + 1;
    rankBySection.set(r.section, next);
    return { ...r, digest_date: date, rank: next };
  });

  console.log(
    `\n注目 ${featured ? 1 : 0} / 逃げ ${sections.nige.length}（候補${sections.nigeTotal}）` +
      ` / まくり ${sections.makuri.length} / 逃がし ${sections.nigashi.length}` +
      ` / フライング ${flying.length} / 帰郷 ${returned.rows.length}` +
      ` / 合計 ${rows.length} 行`,
  );
  if (featured) {
    console.log(
      `  注目: ${featured.race_id} ${featured.racer_name}（${featured.detail.from} score=${featured.detail.score}）`,
    );
  }
  if (returned.suppressed.length > 0) {
    console.log(
      `  ⚠️ 節境界とみなして帰郷判定から除外した会場: ${returned.suppressed.join(", ")}`,
    );
  }

  const clamped = rows.filter((r) => r.detail?.clampedPredicted).length;
  const dayRow = {
    digest_date: date,
    venue_count: new Set(races.map((r) => r.venue_code)).size,
    race_count: races.length,
    window_start: statRows[0]?.window_start ?? null,
    window_end: statRows[0]?.window_end ?? null,
    window_days: statRows[0]?.window_days ?? null,
    flying_data_complete: date >= FLYING_DATA_COMPLETE_FROM,
    suppressed_venues: returned.suppressed,
    notes: {
      sectionCounts: {
        featured: featured ? 1 : 0,
        nige: sections.nige.length,
        nigeCandidates: sections.nigeTotal,
        makuri: sections.makuri.length,
        nigashi: sections.nigashi.length,
        flying: flying.length,
        returned: returned.rows.length,
      },
      clampedPredictedRows: clamped,
      volatilityAvailable: volatilityMap.size,
      thresholds: EXTRACTION_THRESHOLDS,
    },
  };

  if (DRY_RUN) {
    console.log("\n[dry-run] 書き込みません。先頭5行:");
    for (const r of rows.slice(0, 5)) {
      console.log(
        `  ${r.section}#${r.rank} ${r.race_id ?? "-"} ${r.racer_name} ` +
          `${r.metric_value ?? "-"}% 地力${r.metric_skill_delta ?? "-"}pt n=${r.sample_size ?? "-"}`,
      );
    }
    console.log("\n完了しました（dry-run のため書き込んでいません）");
    return;
  }

  await write(date, dayRow, rows);
  console.log(`\n完了しました（${rows.length} 行を書き込みました）`);
}

main().catch((error) => {
  console.error("\n失敗しました:", error.message);
  process.exit(1);
});
