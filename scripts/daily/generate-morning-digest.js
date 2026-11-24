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
 * 集計バッチ update-racer-course-technique-stats.js（Vercel Cron、JST 13:00 / 17:00。
 * 2026-09-25 に GitHub Actions の JST 01:10 から移行。ADR-0066 §改訂1）が、前日までの
 * venue_course_technique_baseline / racer_course_technique_stats を更新済みであること。
 * 完全性チェックで window_end を見て、古すぎれば書かない。
 *
 * ⚠️ **window_end は構造上「前々日」までしか進まない**（2026-09-25 に本番で発覚）。
 * 集計の材料である `race_results.actual_course_1〜6` は Kファイル同期（`api/cron/kfile-sync.js`、
 * Vercel Cron の **JST 07:00 / 12:00**）が書き、Kファイル自体が「開催日の夜〜翌日」公開のため、
 * **前日ぶんの進入コースが埋まるのは当日 JST 07:00**。夜間集計は JST 01:10 で6時間早く、
 * 前日ぶんを取り込めない。したがって完全性チェックの許容は「前々日以降」でなければならない
 * （当初は「前日以降」を要求しており、定時実行が3回とも書けずに永久に未生成だった）。
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
import { isDirectRun } from "../lib/isDirectRun.js";
import { isColumnMissingError, stripColumns } from "../lib/optionalColumns.js";
import { normalizeRacerName } from "../../src/utils/digestMetrics.js";
import {
  attachReturnReasons,
  buildSections,
  inCautionColumns,
  indexStats,
  returnedCandidates,
  returnedRows,
} from "../lib/morningDigestParts.js";
import {
  attachMotorRaceCounts,
  buildDayRow,
  buildReport,
  incompleteResult,
  logCompleteness,
  logDryRun,
  logMotorSummary,
  logSectionSummary,
  motorTargetsOf,
  pickFeatured,
  rankRows,
  warnNoVolatility,
} from "../lib/morningDigestSummary.js";

// 読み手（verify-digest-*.js 等）が今までどおりこのファイルから読めるように再 export
export { buildSections, pickFeatured, attachMotorRaceCounts };
import {
  STATS_MAX_LAG_DAYS,
  addDays,
  fetchAll,
  fetchRaces,
  fetchEntries,
  fetchMotorRaceCounts,
  fetchRacerStats,
  fetchBaseline,
  fetchCourseWin,
  fetchVolatility,
  fetchInCaution,
} from "../lib/morningDigestFetch.js";

/** 当日の会場数が前日のこの割合を下回ったら、出走表の投入が途中とみなして書かない */
const VENUE_COUNT_MIN_RATIO = 0.7;

function todayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
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

  // 夜間バッチが動いているか。許容は「前々日以降」（STATS_MAX_LAG_DAYS）。
  // 「前日以降」にすると構造上ぜったいに満たせない（冒頭の⚠️参照）
  const { data: stat, error } = await supabase
    .from("racer_course_technique_stats")
    .select("window_end")
    .order("window_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const minWindowEnd = addDays(date, -STATS_MAX_LAG_DAYS);
  if (!stat) {
    problems.push(
      "racer_course_technique_stats が空です（夜間バッチが未実行）",
    );
  } else if (stat.window_end < minWindowEnd) {
    problems.push(
      `racer_course_technique_stats.window_end が ${stat.window_end} で古すぎます（${minWindowEnd} 以降が必要）`,
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// セクションの生成
// ---------------------------------------------------------------------------

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
        ...inCautionColumns(null),
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
  const { rows, suppressed } = returnedRows(
    returnedCandidates({ prevRaces, prevEntries, todayRaces, todayRoster }),
  );

  // 帰郷の「理由」は race_special_notes から。**結合キーは前日（D）**。
  // digest_date（D+1）で引くと1日ずれて理由が永久に出ない（レビュー指摘M-13）
  if (rows.length > 0) {
    const { data: notes, error } = await supabase
      .from("race_special_notes")
      .select("venue_code, racer_id, detail_text")
      .eq("race_date", prevDate)
      .eq("category", "absence");
    if (error) throw error;
    attachReturnReasons(rows, notes);
  }

  rows.sort((a, b) => a.venue_code - b.venue_code || a.racer_id - b.racer_id);
  return { rows, suppressed };
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

/**
 * マイグレーションの適用前でも書き込みを止めない列。グループごとに除く（156 が未適用でも 131 の列は書き続ける）
 */
const OPTIONAL_ROW_COLUMN_GROUPS = {
  "マイグレーション131": ["motor_race_count"],
  "マイグレーション156": ["in_caution_pct", "in_caution_n", "in_caution_level"],
};

/**
 * 200行ずつ INSERT する。列が無いエラー（isColumnMissingError）がグループの列のときは、そのグループを除いて
 * 書き直し、以降のバッチにも引き継ぐ。グループ数+1回で必ず終わる。ほかのエラーは投げる。
 *
 * @param {(chunk: object[]) => Promise<{error: object|null}>} insertChunk
 * @param {object[]} rows
 * @param {Record<string, string[]>} [groups]
 * @returns {Promise<string[]>} 除いたグループの名前
 */
export async function insertWithOptionalColumnGroups(
  insertChunk,
  rows,
  groups = OPTIONAL_ROW_COLUMN_GROUPS,
) {
  const missingGroups = new Set();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    for (;;) {
      const skipped = [...missingGroups].flatMap((name) => groups[name]);
      const { error } = await insertChunk(stripColumns(chunk, skipped));
      if (!error) break;
      const missing = Object.keys(groups).find(
        (name) =>
          !missingGroups.has(name) && isColumnMissingError(error, groups[name]),
      );
      if (missing === undefined) throw error;
      missingGroups.add(missing);
      console.warn(
        `  ⚠️ morning_digest_rows に ${groups[missing].join(", ")} がありません（${missing}が未適用）。この列を除いて書きます`,
      );
    }
  }
  return [...missingGroups];
}

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

  // 131・156 が未適用の DB では、その列だけを除いて書く（生成は止めない）
  await insertWithOptionalColumnGroups(
    (chunk) => supabase.from("morning_digest_rows").insert(chunk),
    rows,
  );

  const { error: stampErr } = await supabase
    .from("morning_digest_days")
    .update({ generated_at: new Date().toISOString() })
    .eq("digest_date", date);
  if (stampErr) throw stampErr;
}

// ---------------------------------------------------------------------------

/**
 * 1日ぶんを生成して書き込む。Vercel Cron（api/cron/morning-digest.js）と CLI の
 * 両方から呼ぶ（ADR-0066 §改訂1）。
 *
 * 戻り値は共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）の run() の契約に合わせる。
 * **完全性チェックを満たさないときは `incomplete: true` を返す**。ラッパはこのとき
 * 対象日を処理済みにしないため、後続のスロット（06:30 / 08:00）がもう一度処理する。
 *
 * @param {{date?: string|null, dryRun?: boolean}} [opts]
 * @returns {Promise<{outcome: "ok", rowsWritten: number, rowsExpected?: number,
 *   rowsParsed?: number, incomplete?: boolean, report: object}>}
 */
export async function runMorningDigest({
  date: dateArg = null,
  dryRun = false,
} = {}) {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabaseの環境変数が未設定です（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
  }

  const date = typeof dateArg === "string" && dateArg ? dateArg : todayJST();
  const prevDate = addDays(date, -1);
  console.log(
    `本日のデータ一覧を生成します（対象 ${date} JST / 前日 ${prevDate}${dryRun ? " / dry-run" : ""}）`,
  );

  const races = await fetchRaces(date);
  const entries =
    races.length > 0 ? await fetchEntries(races.map((r) => r.race_id)) : [];

  const problems = await checkCompleteness(date, races, entries);
  if (problems.length > 0) return incompleteResult(date, problems);
  logCompleteness(races, entries);

  const raceIds = races.map((r) => r.race_id);
  const [statRows, baselineRows, volatilityMap, inCautionMap] =
    await Promise.all([
      fetchRacerStats(entries.map((e) => e.racer_id)),
      fetchBaseline(),
      fetchVolatility(raceIds),
      fetchInCaution(raceIds),
    ]);
  const { statMap, baselineMap } = indexStats(statRows, baselineRows);
  warnNoVolatility(volatilityMap, inCautionMap);

  const sections = buildSections({
    races,
    entries,
    statMap,
    baselineMap,
    volatilityMap,
    inCautionMap,
  });
  const featured = pickFeatured(sections);
  const courseWin = await fetchCourseWin(date, races, entries);
  const flying = await buildFlying(date, prevDate);
  const returned = await buildReturned(date, prevDate, races);

  // rank はセクション内の並び順（1始まり）。会場公式のモーター出走数（未使用の新モーターの判定、BOA-702）を付ける
  const ranked = rankRows({ featured, sections, flying, returned }, date);
  const motorRaceCounts = await fetchMotorRaceCounts(
    date,
    motorTargetsOf(ranked, entries),
  );
  const rows = attachMotorRaceCounts(ranked, entries, motorRaceCounts.counts);
  const digest = {
    date,
    races,
    statRows,
    featured,
    sections,
    flying,
    returned,
  };
  logMotorSummary(rows, motorRaceCounts);
  logSectionSummary({ ...digest, rows });
  const dayRow = buildDayRow({ ...digest, rows, volatilityMap, courseWin });
  const { report, byGradeReport } = buildReport({
    date,
    dayRow,
    rows,
    courseWin,
  });

  if (dryRun) {
    logDryRun(rows, byGradeReport);
    return {
      outcome: "ok",
      rowsWritten: 0,
      report: { ...report, dryRun: true },
    };
  }

  await write(date, dayRow, rows);
  console.log(`\n完了しました（${rows.length} 行を書き込みました）`);

  // SNS のネタ（sns_topics）への登録は、読む先（Routine）が止まって使われていないため撤去した
  // （2026-10-24、hq SH01 R2）。/today の X 投稿は snsTodayPlanner.js が digest の表から直接作る

  return {
    outcome: "ok",
    rowsWritten: rows.length,
    // 0行を成功にしない（applyZeroRowGuard は `rowsExpected > 0 && rowsParsed === 0`
    // のときだけ error にする）。両方に rows.length を入れると、0件のとき
    // rowsExpected も0になり判定が働かない。完全性チェックを通った＝開催日なので、
    // 1行も出ないのは異常として扱う（verify-morning-digest.js の判定とも揃う）
    rowsExpected: 1,
    rowsParsed: rows.length,
    report,
  };
}

// --- CLI（node scripts/daily/generate-morning-digest.js [--date=…] [--dry-run]） ---
if (isDirectRun(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
  );
  runMorningDigest({
    date: typeof args.date === "string" ? args.date : null,
    dryRun: Boolean(args["dry-run"]),
  }).catch((error) => {
    console.error("\n失敗しました:", error.message);
    process.exit(1);
  });
}

export { fetchMotorRaceCounts, fetchCourseWin } from "../lib/morningDigestFetch.js";
