#!/usr/bin/env node
/**
 * race_series（節メタ、既にバックフィル済み）から、races.race_grade・race_conditions.series_day・
 * is_final_day の過去分の欠落を書き戻すCLI（N16、BOA-390）
 *
 * 背景: docs/design/scraping-vercel-consolidation/data-catalog.md N16。原材料の race_series
 * （節名・グレード・開始日・終了日、monthly-schedule-backfill.js で投入済み・6,312行・2019-04〜）は
 * 既にあるが、個別レースの races.race_grade・race_conditions.series_day・is_final_day への反映
 * （書き戻し）が無く、2025-12・2026-01（race_grade）・2026年2〜8月（series_day）が未充足のまま残っていた。
 *
 * 設計（scripts/lib/raceSeriesRows.js の既存コメントに準拠）:
 *   - race_grade は COALESCE(races.race_grade, race_series.grade) と同じ考え方。既存値がNULLの行だけを、
 *     race_series.grade が非NULL（SG/G1/G2/G3/ippanのみ確定。オールレディース等はNULLのまま埋めない）の
 *     ときだけ埋める。既存値には一切触れない
 *   - series_day = race_date − start_date + 1、is_final_day = (race_date = end_date)。
 *     順延で実開催日が月間スケジュールの予定（start_date〜end_date）からずれた節は、単純にマッチしない
 *     （範囲外として除外。誤った値を書かない）
 *   - 会場×日で複数の race_series 行にマッチする場合（重複・データ不整合）は、書き込まず「曖昧」として
 *     別集計する
 *
 * 新規の公式サイトアクセスは無い（DB内のJOIN・書き戻しのみ）ため、夜間窓の制約は無い。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js status [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *   node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js grade --from=2025-12-01 --to=2026-02-01          # dry-run
 *   node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js grade --from=2025-12-01 --to=2026-02-01 --apply  # 書き込み
 *   node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js series-day --from=2026-02-01 --to=2026-09-14 --apply
 *   node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js final-title --from=2025-12-01 --to=2025-12-31          # dry-run
 *   node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js final-title --from=2025-12-01 --to=2025-12-31 --apply  # 書き込み
 *
 * final-title（BOA-695）: race_conditions.race_title・is_final_day の NULL だけを race_series から埋める。
 *   series-day は series_day が NULL の行だけを対象にするが、2025-12〜2026-02 等の欠けは series_day が埋まっていて
 *   race_title・is_final_day だけが NULL（2026-10-04 の実測で約1万行すべて）。そのため別の対象で引く。
 *   - race_title   = race_series.title
 *   - is_final_day = (race_date = race_series.end_date)
 *   既存値がある列は触らない。根拠: 2025-12 以降で両方が入っている3,142会場日では、race_series の title・end_date
 *   からの導出と全件一致した（2026-10-04 実測）。K ファイルの is_final_day は常に false のため使えない。
 *   手順書: docs/issues/boa-695-race-conditions-title-final-backfill.md
 */

import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";
import { isDirectRun } from "../lib/isDirectRun.js";

const WRITE_BATCH_SIZE = 500;

function getArg(name, fallback = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}
const APPLY = process.argv.includes("--apply");

async function loadSeries(from, to) {
  // race_series は6,312行のみ（2026-09-23時点）のため、対象範囲に重なるものを全件メモリに載せる
  const rows = await fetchAll(
    "race_series",
    "venue_code, start_date, end_date, grade, title",
    (q) =>
      q
        .lte("start_date", to)
        .gte("end_date", from)
        .order("venue_code")
        .order("start_date"),
    { throwOnError: true },
  );
  // venue_code → [series...] の索引
  const byVenue = new Map();
  for (const s of rows) {
    if (!byVenue.has(s.venue_code)) byVenue.set(s.venue_code, []);
    byVenue.get(s.venue_code).push(s);
  }
  return byVenue;
}

/** race_date（venue_code）に一致する race_series を探す。0件=unmatched、2件以上=ambiguous */
export function findSeries(byVenue, venueCode, raceDate) {
  const list = byVenue.get(venueCode) || [];
  const matches = list.filter(
    (s) => raceDate >= s.start_date && raceDate <= s.end_date,
  );
  if (matches.length === 0) return { status: "unmatched" };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "ok", series: matches[0] };
}

async function runGrade({ from, to }) {
  const byVenue = await loadSeries(from, to);
  const races = await fetchAll(
    "races",
    "race_id, venue_code, race_date, race_number",
    (q) =>
      q
        .is("race_grade", null)
        .gte("race_date", from)
        .lte("race_date", to)
        .order("race_id"),
    { throwOnError: true },
  );

  const updates = [];
  let unmatched = 0;
  let ambiguous = 0;
  let noGrade = 0; // マッチしたがgradeがNULL（AllLadies/Venus/Rookie/Masters等）
  for (const r of races) {
    const found = findSeries(byVenue, r.venue_code, r.race_date);
    if (found.status === "unmatched") {
      unmatched++;
      continue;
    }
    if (found.status === "ambiguous") {
      ambiguous++;
      continue;
    }
    if (!found.series.grade) {
      noGrade++;
      continue;
    }
    // upsertはON CONFLICT DO UPDATEでも候補行の構築時にNOT NULL制約を検査するため、
    // race_date・venue_code・race_number（NOT NULL・DEFAULTなし）は変更しないが渡す必要がある
    updates.push({
      race_id: r.race_id,
      race_date: r.race_date,
      venue_code: r.venue_code,
      race_number: r.race_number,
      race_grade: found.series.grade,
    });
  }

  console.log(
    `race_grade: 対象${races.length}件、書き込み候補${updates.length}件` +
      `（unmatched=${unmatched}, ambiguous=${ambiguous}, grade未確定=${noGrade}）`,
  );

  if (!APPLY) {
    console.log("[DRY-RUN] --apply を付けると本番へ書き込みます");
    return;
  }
  if (!isSupabaseEnabled()) throw new Error("Supabaseが無効です");

  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_BATCH_SIZE) {
    const batch = updates.slice(i, i + WRITE_BATCH_SIZE);
    const { error } = await supabase
      .from("races")
      .upsert(batch, { onConflict: "race_id" });
    if (error) throw new Error(`races upsert エラー: ${error.message}`);
    written += batch.length;
  }
  console.log(`race_grade: 書き込み完了 ${written}件`);
}

async function runSeriesDay({ from, to }) {
  const byVenue = await loadSeries(from, to);
  // race_id は YYYY-MM-DD-VV-RR で日付部分が辞書順=時系列順になるため、race_id の範囲で絞る
  // （race_conditions には venue_code/race_date が無く、.in() で大量のrace_idを渡すとURLが長すぎて
  // 失敗するため、race_id の範囲フィルタで1回のページングfetchに収める）
  const idFrom = from;
  const idTo = `${to}~`; // '~' は通常の文字より辞書順で後ろに来るため、to日の全会場・全レースを含む
  const conds = await fetchAll(
    "race_conditions",
    "race_id, series_day",
    (q) =>
      q
        .is("series_day", null)
        .gte("race_id", idFrom)
        .lte("race_id", idTo)
        .order("race_id"),
    { throwOnError: true },
  );
  const races = await fetchAll(
    "races",
    "race_id, venue_code, race_date",
    (q) => q.gte("race_id", idFrom).lte("race_id", idTo).order("race_id"),
    { throwOnError: true },
  );
  const raceMetaByIds = new Map(races.map((r) => [r.race_id, r]));

  const updates = [];
  let unmatched = 0;
  let ambiguous = 0;
  let outOfRange = 0;
  for (const c of conds) {
    const meta = raceMetaByIds.get(c.race_id);
    if (!meta) {
      outOfRange++;
      continue;
    }
    const found = findSeries(byVenue, meta.venue_code, meta.race_date);
    if (found.status === "unmatched") {
      unmatched++;
      continue;
    }
    if (found.status === "ambiguous") {
      ambiguous++;
      continue;
    }
    const seriesDay =
      (Date.parse(meta.race_date) - Date.parse(found.series.start_date)) /
        86400000 +
      1;
    const isFinalDay = meta.race_date === found.series.end_date;
    updates.push({
      race_id: c.race_id,
      series_day: seriesDay,
      is_final_day: isFinalDay,
    });
  }

  console.log(
    `series_day/is_final_day: 対象範囲外${outOfRange}件を除く候補${conds.length - outOfRange}件中、` +
      `書き込み候補${updates.length}件（unmatched=${unmatched}, ambiguous=${ambiguous}）`,
  );

  if (!APPLY) {
    console.log("[DRY-RUN] --apply を付けると本番へ書き込みます");
    return;
  }
  if (!isSupabaseEnabled()) throw new Error("Supabaseが無効です");

  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_BATCH_SIZE) {
    const batch = updates.slice(i, i + WRITE_BATCH_SIZE);
    const { error } = await supabase
      .from("race_conditions")
      .upsert(batch, { onConflict: "race_id" });
    if (error)
      throw new Error(`race_conditions upsert エラー: ${error.message}`);
    written += batch.length;
  }
  console.log(`series_day/is_final_day: 書き込み完了 ${written}件`);
}

/**
 * final-title の書き込み候補を作る（純粋関数、BOA-695）。
 *
 * 書き込む行は race_id・race_title・is_final_day の3列を**全行そろえて**持つ。PostgREST のバルク upsert は行ごとに
 * キーの集合が違うと、欠けたキーを NULL で上書きする。そのため、既存値がある列もその値を渡し直す（値は変わらない）。
 *
 * @param {Array<{race_id: string, race_title: string|null, is_final_day: boolean|null}>} conds race_conditions の行
 *   （race_title か is_final_day が NULL のもの）
 * @param {Array<{race_id: string, venue_code: number, race_date: string}>} races
 * @param {Map<number, Array<{start_date: string, end_date: string, title: string|null}>>} byVenue loadSeries の戻り値
 */
export function planFinalTitle(conds, races, byVenue) {
  const raceMetaByIds = new Map(races.map((r) => [r.race_id, r]));
  const counts = {
    title: 0,
    final: 0,
    finalTrue: 0,
    unmatched: 0,
    ambiguous: 0,
    outOfRange: 0,
    nothingToFill: 0,
  };
  const updates = [];
  for (const c of conds) {
    const meta = raceMetaByIds.get(c.race_id);
    if (!meta) {
      counts.outOfRange++;
      continue;
    }
    const found = findSeries(byVenue, meta.venue_code, meta.race_date);
    if (found.status === "unmatched") {
      counts.unmatched++;
      continue;
    }
    if (found.status === "ambiguous") {
      counts.ambiguous++;
      continue;
    }
    const fillTitle = c.race_title === null && found.series.title != null;
    const fillFinal = c.is_final_day === null;
    if (!fillTitle && !fillFinal) {
      counts.nothingToFill++;
      continue;
    }
    const isFinalDay = fillFinal
      ? meta.race_date === found.series.end_date
      : c.is_final_day;
    if (fillTitle) counts.title++;
    if (fillFinal) {
      counts.final++;
      if (isFinalDay) counts.finalTrue++;
    }
    updates.push({
      race_id: c.race_id,
      race_title: fillTitle ? found.series.title : c.race_title,
      is_final_day: isFinalDay,
    });
  }
  return { updates, counts };
}

async function runFinalTitle({ from, to }) {
  const byVenue = await loadSeries(from, to);
  // race_id の範囲で絞る理由は runSeriesDay と同じ
  const idFrom = from;
  const idTo = `${to}~`;
  const conds = await fetchAll(
    "race_conditions",
    "race_id, race_title, is_final_day",
    (q) =>
      q
        .or("race_title.is.null,is_final_day.is.null")
        .gte("race_id", idFrom)
        .lte("race_id", idTo)
        .order("race_id"),
    { throwOnError: true },
  );
  const races = await fetchAll(
    "races",
    "race_id, venue_code, race_date",
    (q) => q.gte("race_id", idFrom).lte("race_id", idTo).order("race_id"),
    { throwOnError: true },
  );
  const { updates, counts } = planFinalTitle(conds, races, byVenue);

  console.log(
    `race_title/is_final_day: NULL を含む行${conds.length}件中、書き込み候補${updates.length}件` +
      `（race_title を埋める${counts.title}件、is_final_day を埋める${counts.final}件［うち最終日=true ${counts.finalTrue}件］、` +
      `unmatched=${counts.unmatched}, ambiguous=${counts.ambiguous}, 対象範囲外=${counts.outOfRange}, 埋める値なし=${counts.nothingToFill}）`,
  );

  if (!APPLY) {
    console.log("[DRY-RUN] --apply を付けると本番へ書き込みます");
    return;
  }
  if (!isSupabaseEnabled()) throw new Error("Supabaseが無効です");

  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_BATCH_SIZE) {
    const batch = updates.slice(i, i + WRITE_BATCH_SIZE);
    const { error } = await supabase
      .from("race_conditions")
      .upsert(batch, { onConflict: "race_id" });
    if (error)
      throw new Error(`race_conditions upsert エラー: ${error.message}`);
    written += batch.length;
  }
  console.log(`race_title/is_final_day: 書き込み完了 ${written}件`);
}

async function runStatus({ from, to }) {
  const [gradeNull, seriesDayNull, seriesRows] = await Promise.all([
    fetchAll("races", "race_id", (q) =>
      q
        .is("race_grade", null)
        .gte("race_date", from)
        .lte("race_date", to)
        .order("race_id"),
    ),
    fetchAll("race_conditions", "race_id", (q) =>
      q.is("series_day", null).order("race_id"),
    ),
    fetchAll("race_series", "venue_code", (q) =>
      q.order("venue_code").order("start_date"),
    ),
  ]);
  console.log(
    JSON.stringify(
      {
        range: { from, to },
        race_grade_null_in_range: gradeNull.length,
        series_day_null_total: seriesDayNull.length,
        race_series_rows: seriesRows.length,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const cmd = process.argv[2];
  const from = getArg("from", "2025-12-03");
  const to = getArg("to", "2026-09-23");
  if (cmd === "status") return runStatus({ from, to });
  if (cmd === "grade") return runGrade({ from, to });
  if (cmd === "series-day") return runSeriesDay({ from, to });
  if (cmd === "final-title") return runFinalTitle({ from, to });
  console.error(
    "使い方: backfill-race-series-meta.js <status|grade|series-day|final-title> [--from=] [--to=] [--apply]",
  );
  process.exit(1);
}

// 検証スクリプト（verify-race-series-final-title.js）から planFinalTitle を読むため、import だけでは実行しない
if (isDirectRun(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
