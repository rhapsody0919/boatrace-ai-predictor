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

import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { isDirectRun } from "../lib/isDirectRun.js";
import { isColumnMissingError, stripColumns } from "../lib/optionalColumns.js";
import { normalizeRacerName } from "../../src/utils/digestMetrics.js";
import {
  attachReturnReasons,
  buildSections,
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
  buildCourseWinNotes,
  courseWinRowsFromJson,
} from "../../src/utils/todayCourseWin.js";

/** PostgRESTの1ページあたりの行数 */
const PAGE_SIZE = 1000;

/** 当日の会場数が前日のこの割合を下回ったら、出走表の投入が途中とみなして書かない */
const VENUE_COUNT_MIN_RATIO = 0.7;

/**
 * 選手集計（racer_course_technique_stats.window_end）に許容する遅れの日数。
 *
 * 2 なのは構造上の下限。前日ぶんの進入コースが埋まるのは Kファイル同期の当日 JST 07:00 で、
 * 夜間集計（JST 01:10）はそれより前に走るため、window_end は必ず「前々日」までになる。
 * 1 にすると永久に満たせない（2026-09-25 に本番で発生）。
 * 3 以上にすると「集計が止まっている」という本来検知したい異常を見逃す。
 *
 * 影響: 朝の時点の選手集計には前日のレースが入っていない。集計窓は約295日・
 * 1選手1コースあたり中央値26走なので、1日ぶん（最大1〜2走）の欠落は実質的に無視できる。
 */
const STATS_MAX_LAG_DAYS = 2;

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
          "race_id, boat_number, racer_id, player_name, grade, motor_number, motor_2rate, is_absent",
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

/**
 * 会場公式のモーター出走数（venue_motor_stats.race_count）を、対象日以前で最新のスナップショットから引く（BOA-702）。
 * データ出走表の getVenueMotorStats(venueCode, motorNumber, asOfDate) と同じ条件。
 * 1件ずつ引くのは、会場によってスナップショットの日がモーターごとにずれうるため（会場単位で最新日を決めると、
 * その日に載っていないモーターを「分からない」にしてしまう）。対象は1日数十艇。
 *
 * 取得に失敗したモーターは Map に入れない（＝分からない。画面は従来どおり 0.0% を出す）。生成自体は止めない
 * （この列は表示の補助で、他の列の正しさには関わらないため）。失敗数は戻り値で返し、呼び出し側が記録する。
 *
 * @param {string} date 対象日（YYYY-MM-DD）
 * @param {Array<{venue_code: number, motor_number: number}>} targets
 * @returns {Promise<{counts: Map<string, number|null>, failed: number}>} キーは `${venue_code}|${motor_number}`。
 *   値が null は「スナップショットはあるが出走数の列が空（その会場のサイトに出走数が無い）」
 */
export async function fetchMotorRaceCounts(date, targets) {
  const keys = [
    ...new Set(targets.map((t) => `${t.venue_code}|${t.motor_number}`)),
  ];
  const counts = new Map();
  let failed = 0;
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(
      keys.slice(i, i + 20).map(async (key) => {
        const [venueCode, motorNumber] = key.split("|").map(Number);
        const { data, error } = await supabase
          .from("venue_motor_stats")
          .select("race_count")
          .eq("venue_code", venueCode)
          .eq("motor_number", motorNumber)
          .lte("scraped_date", date)
          .order("scraped_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          failed += 1;
          console.warn(
            `  ⚠️ venue_motor_stats の取得に失敗（会場${venueCode} モーター${motorNumber}）: ${error.message}`,
          );
          return;
        }
        if (data) counts.set(key, data.race_count ?? null);
      }),
    );
  }
  return { counts, failed };
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
 * /today の X 投稿の型 b の材料（級別の全国のコース別1着率と今日の選手のコース別の1着数、RPC 183）。
 * 窓は前々日まで（STATS_MAX_LAG_DAYS と同じ理由）。関数がまだ無い（マイグレーション 183 の適用前）・読めないときは
 * 一覧の生成を止めず、notes.courseWin を unavailable にする（/today は型 a で送り、Slack の知らせに理由が出る）。
 * notes（匿名でも読める）には理由のコードだけを入れ、エラーの本文はログにだけ出す（system-architect の審査 P3）
 */
export async function fetchCourseWin(
  date,
  races,
  entries,
  rpc = (args) => supabase.rpc("compute_today_course_win_stats", args),
) {
  const until = addDays(date, -STATS_MAX_LAG_DAYS);
  const racerIds = [...new Set(entries.map((e) => e.racer_id))];
  const unavailable = (reason, message) => {
    console.error(
      `  ⚠️ コース別1着率の材料を作れない（${reason}: ${message}）。/today の型 b は出さない`,
    );
    return { v: 1, status: "unavailable", reason };
  };
  const startedMs = Date.now();
  const { data, error } = await rpc({
    p_until: until,
    p_racer_ids: racerIds,
  });
  if (error)
    return error.code === "PGRST202"
      ? unavailable("rpc_missing", "関数が無い。マイグレーション183が未適用")
      : unavailable("rpc_error", error.message);
  // 窓が全期間なので、時間はデータとともに伸びる。通信を含むこの値が6秒を超えたら窓の上限を入れて見直す（183 の注記）
  console.log(`  コース別1着率の RPC: ${Date.now() - startedMs}ms`);
  try {
    return buildCourseWinNotes({
      races,
      entries,
      rpcRows: courseWinRowsFromJson(data),
      until,
    });
  } catch (buildError) {
    // 材料の形が想定と違う（窓がそろわない等）。一覧の a の材料は壊さず、型 b だけを止める
    return unavailable("build_error", buildError.message);
  }
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

/** マイグレーションの適用前でも書き込みを止めない列（131: motor_race_count） */
const OPTIONAL_ROW_COLUMNS = ["motor_race_count"];

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

  // motor_race_count（マイグレーション131）が未適用の DB では、その列だけを除いて書く（生成は止めない）
  let payload = rows;
  for (let i = 0; i < payload.length; i += 200) {
    let { error } = await supabase
      .from("morning_digest_rows")
      .insert(payload.slice(i, i + 200));
    if (error && isColumnMissingError(error, OPTIONAL_ROW_COLUMNS)) {
      console.warn(
        `  ⚠️ morning_digest_rows に ${OPTIONAL_ROW_COLUMNS.join(", ")} がありません（マイグレーション131が未適用）。この列を除いて書きます`,
      );
      payload = stripColumns(payload, OPTIONAL_ROW_COLUMNS);
      ({ error } = await supabase
        .from("morning_digest_rows")
        .insert(payload.slice(i, i + 200)));
    }
    if (error) throw error;
  }

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

  const [statRows, baselineRows, volatilityMap] = await Promise.all([
    fetchRacerStats(entries.map((e) => e.racer_id)),
    fetchBaseline(),
    fetchVolatility(races.map((r) => r.race_id)),
  ]);
  const { statMap, baselineMap } = indexStats(statRows, baselineRows);
  warnNoVolatility(volatilityMap);

  const sections = buildSections({
    races,
    entries,
    statMap,
    baselineMap,
    volatilityMap,
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
