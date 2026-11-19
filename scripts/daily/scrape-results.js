// Race Results Scraper
// Supabaseからレース一覧を取得し、結果をスクレイピングしてSupabaseに書き込む

import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
  fetchAll,
} from "../lib/supabaseClient.js";
import {
  getTodayDateJST,
  getDateDaysAgo,
  parseDateArg,
} from "../lib/dateUtils.js";
import {
  PREDICTION_HIT_COLUMNS as HIT_COLUMNS,
  buildPredictionHitUpdate,
} from "../lib/hitCalculator.js";
import { isCancellationConfirmed } from "../lib/cancellationStatus.js";
import {
  getRaceSchedule,
  getRacesAfterStart,
  getRacesPastResultWindow,
} from "../lib/raceSchedule.js";
import {
  fetchKFileText,
  parseKFileText,
  parseKFileRankings,
} from "../lib/kfileParser.js";
import {
  filterUnchangedRows,
  formatSkipSummary,
} from "../lib/unchangedRows.js";
import {
  OFFICIAL_FINISH_CODE_COLUMN,
  buildOfficialFinishCodeRows,
} from "../lib/officialFinishCode.js";
import { isColumnMissingError } from "../lib/optionalColumns.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
// 結果ページの取得・解析・行の組み立ては raceResultPage.js に置く（呼び出し元はこれまでどおりここから import できる）
import {
  ResultHttpError,
  buildRaceResultRow,
  fetchRaceResultHtml,
  isResultComplete,
  parseRaceResultHtml,
  scrapeRaceResult,
} from "../lib/raceResultPage.js";
// 結果の書き込みとレース単位の入口は raceResultPersist.js に置く
import { persistRaceResults } from "../lib/raceResultPersist.js";
import { runForRaces } from "../lib/raceResultRun.js";

export {
  runForRaces,
  ResultHttpError,
  buildRaceResultRow,
  fetchRaceResultHtml,
  isResultComplete,
  parseRaceResultHtml,
};

// Generate race result page URL

// Scrape race result（GitHub Actions・CLIの従来の入口。失敗は null に丸める）

/**
 * オーケストレーターから呼び出し可能な結果取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{skipResults?: boolean, skipKFile?: boolean}} [options]
 *   Vercel Cron へ移した処理を止めるためのスイッチ（既定はどちらも false ＝従来どおり全て実行。
 *   scrape-scheduled.js が、リポジトリ変数 SKIP_RESULTS_ON_GHA・SKIP_KFILE_ON_GHA から渡す。T4b-02-4・T4b-05-3）
 *   skipResults: 結果取得と、中止・順延の確定を行わない
 *   skipKFile:   Kファイル同期（進入コース・rank4〜6）を行わない
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(
  schedule,
  date,
  { skipResults = false, skipKFile = false } = {},
) {
  let resultSummary = { updated: false, count: 0 };

  if (!skipResults) {
    const startedRaces = getRacesAfterStart(schedule, 5);

    if (startedRaces.length === 0) {
      console.log("📭 結果: 発走後5分以上経過したレースなし");
    } else {
      console.log(`🎯 結果取得: ${startedRaces.length}レース（発走後5分以上）`);

      // schedule から直接 races 情報を構築（追加 DB 呼び出し不要）
      const races = startedRaces.map((r) => ({
        race_id: r.race_id,
        venue_code: r.venue_code,
        race_number: r.race_no,
        start_time: r.start_time,
      }));

      resultSummary = await scrapeAndSaveResults(races, date);
    }

    // 発走90分超・結果未取得のレースを中止・順延「確定」として扱う（BOA-254 FR2、ADR 0040）。
    // startedRaces（5〜90分後ウィンドウ）が0件の日でも、90分を超えて見捨てられた
    // レースは別途存在しうるため、上のearly returnとは独立して必ず実行する
    await confirmOverdueCancellations(schedule);
  } else {
    console.log("⏭️ 結果取得: Vercel Cron へ移行済みのためスキップ");
  }

  if (!skipKFile) {
    // 進入コース（Kファイル方式、BOA-257）とrank4/5/6（BOA-338、Kファイル方式）を、過去数日分について同期。
    // Kファイルは開催日当日の夜〜翌日に公開されるため「当日」は対象にせず、
    // 直近数日分を毎回チェックすることで取得漏れ・公開遅延を自己修復する。
    // scrapeAndSaveResults()のfinishedRaceIds判定はpayout_win等のみを見て
    // 「完了」を判定するためrank4の有無をチェックせず、一度完了判定された
    // レースは再スクレイピングされない（BOA-340）ため、Kファイル方式で独立して自己修復する。
    // 同じ日のKファイルを、2つの同期で別々にダウンロードしていた重複（D4）は、1回に統合した
    await syncRecentKFile();
  } else {
    console.log("⏭️ Kファイル同期: Vercel Cron へ移行済みのためスキップ");
  }

  return resultSummary;
}

/**
 * 進入コース・rank4〜6のKファイル同期の対象日数（当日を除く直近N日）。
 * 大きくし過ぎるとKファイル未取得日も毎回ダウンロードを試みてしまうため、
 * 通常運用での取得漏れを拾える程度の小さい値にとどめる。
 */
export const KFILE_SYNC_LOOKBACK_DAYS = 4;

/**
 * 直近数日分（当日を除く）について、Kファイル同期を行う。GitHub Actions・CLIの入口。
 * Vercel Cron の kfile-sync は、対象日ごとの結果を集計するため syncKFileForDate を直接呼ぶ。
 */
async function syncRecentKFile() {
  for (let i = 1; i <= KFILE_SYNC_LOOKBACK_DAYS; i++) {
    await syncKFileForDate(getDateDaysAgo(i));
  }
}

/**
 * 実進入コース同期で書き込む列（race_id は更新条件）。Kファイルのパース結果には
 * venue_code・race_numberも含まれるが race_results の列ではないため、比較・更新には含めない
 */
const ACTUAL_COURSE_COLUMNS = [1, 2, 3, 4, 5, 6].map(
  (n) => `actual_course_${n}`,
);

/**
 * 指定日について、公式成績ファイル（Kファイル）から実進入コースを取得し
 * race_results.actual_course_1〜6にマージする（BOA-257）。
 *
 * BOA-349（原因）: 「未取得レースがあるか」の判定が actual_course_1 のnull判定だったため、
 * 1号艇が欠場したレース（Kファイルの結果行が「K0」「K1」等の欠場行で、1号艇は進入コースを
 * 持たない＝actual_course_1がnullなのが正しい状態。2026-09-15 平和島3R・2026-09-16 唐津12R等）が
 * 永久に「未取得」と判定され続け、その日の全レースを毎回UPDATEしていた
 * （累計167,072回・WAL 1.3GB）。しかも race_results のUPDATEは trg_update_predictions で
 * predictions・bet_recommendations の再UPDATEも連鎖させる。パーサーの不具合ではない
 * （生のKファイルで欠場行を確認済み、verify-unchanged-rows.js で固定）。
 * 対策:
 *   (a) 既存値と同じレースはUPDATEを発行しない（変更のある行だけ書く）
 *   (b) 「未取得」の判定を「actual_course_1〜6が全てnull」に改める。欠場艇はその艇のcolumnだけが
 *       nullで、他の艇のcolumnは埋まるため、欠場を含む同期済みレースを未取得と誤判定しない
 *       （2026-09-01〜18の2,506レースで、actual_course_1がnullのレース3件は全て
 *       他の艇のcolumnが埋まっており、全columnがnullのレースは0件）
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] trueならDBへ書き込まず、書くはずの件数だけ数える
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {() => Promise<string|null>} [options.loadText] Kファイルのテキストの取得（既定は、その日のKファイルをダウンロードする。
 *   進入コースとrank4〜6の同期で、同じ日のKファイルを1回だけダウンロードするために、呼び出し側が共有する）
 * @returns {Promise<{updated: number, skipped: number, status: string, parsed: number, error?: string}>}
 *   updated=書き込んだ件数（dry-runでは書くはずの件数）。status:
 *   nothing_pending（同期済み・対象なし。ダウンロードしない）/ pending_check_failed / kfile_error（ダウンロード失敗。
 *   error に理由）/ kfile_unavailable（未公開・開催なし）/ no_races_parsed / synced
 */
export async function syncActualCourseFromKFile(
  dateStr,
  {
    dryRun = false,
    client = supabase,
    loadText = () => fetchKFileText(dateStr),
  } = {},
) {
  // 結果確定済み（rank1あり）だが進入コースが1艇分も未取得（actual_course_1〜6が全てnull）の
  // レースが無ければ、Kファイルのダウンロード自体をスキップする（無駄な外部アクセスを避ける）。
  // 1艇でも埋まっていれば同期済み（欠場艇のcolumnだけがnullのレースを含む。上のBOA-349参照）
  const { data: pending, error: pendingError } =
    await ACTUAL_COURSE_COLUMNS.reduce(
      (query, column) => query.is(column, null),
      client
        .from("race_results")
        .select("race_id")
        .gte("race_id", dateStr)
        .lt("race_id", `${dateStr}~`)
        .not("rank1", "is", null),
    ).limit(1);

  if (pendingError) {
    // actual_course_1列がまだ存在しない場合（マイグレーション未適用）もここに来る。
    // 日次パイプライン全体を止めないよう、ログのみでスキップする
    console.error(
      `  ⚠️ actual_course対象確認エラー(${dateStr}): ${pendingError.message}`,
    );
    return {
      updated: 0,
      skipped: 0,
      parsed: 0,
      status: "pending_check_failed",
      error: pendingError.message,
    };
  }
  if (!pending || pending.length === 0) {
    // 同期済み、または対象レース無し
    return { updated: 0, skipped: 0, parsed: 0, status: "nothing_pending" };
  }

  let text;
  try {
    text = await loadText();
  } catch (e) {
    console.error(`  ⚠️ Kファイル取得エラー(${dateStr}): ${e.message}`);
    return {
      updated: 0,
      skipped: 0,
      parsed: 0,
      status: "kfile_error",
      error: e.message,
    };
  }
  if (!text) {
    console.log(`  進入コース: Kファイル未公開/開催なし (${dateStr})`);
    return { updated: 0, skipped: 0, parsed: 0, status: "kfile_unavailable" };
  }

  const parsed = parseKFileText(text, dateStr);
  if (parsed.length === 0) {
    console.log(`  進入コース: Kファイルからレースを抽出できず (${dateStr})`);
    return { updated: 0, skipped: 0, parsed: 0, status: "no_races_parsed" };
  }

  const rows = parsed.map((row) => ({
    race_id: row.race_id,
    ...Object.fromEntries(ACTUAL_COURSE_COLUMNS.map((c) => [c, row[c]])),
  }));
  // race_resultsに行が無いレースはUPDATEしても0件のため書かない（writeMissing: false）。
  // 既存値と同じ行（=何もUPDATEで変わらない行）もUPDATEしない
  const { toWrite, stats, fallback } = await filterUnchangedRows(
    client,
    "race_results",
    rows,
    { keyColumns: ["race_id"], writeMissing: false },
  );

  let updated = 0;
  if (dryRun) {
    updated = toWrite.length;
  } else {
    for (const row of toWrite) {
      const { race_id: raceId, ...columns } = row;
      const { error: updateError } = await client
        .from("race_results")
        .update(columns)
        .eq("race_id", raceId);
      if (updateError) {
        console.error(
          `  ⚠️ actual_course更新エラー(${raceId}): ${updateError.message}`,
        );
      } else {
        updated++;
      }
    }
  }
  console.log(
    `  ✅ ${dryRun ? "[DRY-RUN] " : ""}${formatSkipSummary(`進入コース(Kファイル方式, ${dateStr})`, stats, { fallback })}` +
      ` / 更新${updated}件（Kファイル${rows.length}件中、race_results未登録${stats.missing}件）`,
  );
  return {
    updated,
    skipped: stats.unchanged,
    parsed: parsed.length,
    status: "synced",
  };
}

/**
 * 指定日について、公式成績ファイル（Kファイル）からrank4/5/6を取得し
 * race_results.rank4〜6にマージする（BOA-340）。
 *
 * 安全策（BOA-338のバックフィルスクリプトと同じ）: Kファイルからパースした
 * 1〜3着が既存のrank1〜3と完全一致する場合のみ更新する。不一致・重複艇番
 * （パース異常の疑い）・Kファイル側に該当レースが無い場合は更新せずスキップする。
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {Object} [options] syncActualCourseFromKFile と同じ（dryRun・client・loadText）
 * @returns {Promise<{updated: number, status: string, parsed: number, pending: number, skipped?: number, error?: string}>}
 *   status は syncActualCourseFromKFile と同じ語彙
 */
export async function syncRank456FromKFile(
  dateStr,
  {
    dryRun = false,
    client = supabase,
    loadText = () => fetchKFileText(dateStr),
  } = {},
) {
  // rank1はある（結果確定済み）がrank4が未取得のレースが無ければ
  // Kファイルのダウンロード自体をスキップする（無駄な外部アクセスを避ける）
  const { data: pending, error: pendingError } = await client
    .from("race_results")
    .select("race_id, rank1, rank2, rank3")
    .gte("race_id", dateStr)
    .lt("race_id", `${dateStr}~`)
    .not("rank1", "is", null)
    .is("rank4", null);

  if (pendingError) {
    console.error(
      `  ⚠️ rank456対象確認エラー(${dateStr}): ${pendingError.message}`,
    );
    return {
      updated: 0,
      parsed: 0,
      pending: 0,
      status: "pending_check_failed",
      error: pendingError.message,
    };
  }
  if (!pending || pending.length === 0) {
    // 同期済み、または対象レース無し
    return { updated: 0, parsed: 0, pending: 0, status: "nothing_pending" };
  }

  let text;
  try {
    text = await loadText();
  } catch (e) {
    console.error(`  ⚠️ Kファイル取得エラー(${dateStr}): ${e.message}`);
    return {
      updated: 0,
      parsed: 0,
      pending: pending.length,
      status: "kfile_error",
      error: e.message,
    };
  }
  if (!text) {
    console.log(`  rank456: Kファイル未公開/開催なし (${dateStr})`);
    return {
      updated: 0,
      parsed: 0,
      pending: pending.length,
      status: "kfile_unavailable",
    };
  }

  const rows = parseKFileRankings(text, dateStr);
  if (rows.length === 0) {
    console.log(`  rank456: Kファイルからレースを抽出できず (${dateStr})`);
    return {
      updated: 0,
      parsed: 0,
      pending: pending.length,
      status: "no_races_parsed",
    };
  }
  const kfileByRaceId = new Map(rows.map((r) => [r.race_id, r]));

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  for (const race of pending) {
    const k = kfileByRaceId.get(race.race_id);
    if (
      !k ||
      !k.valid ||
      k.rank1 !== race.rank1 ||
      k.rank2 !== race.rank2 ||
      k.rank3 !== race.rank3
    ) {
      skipped++;
      // BOA-338のbackfill-rank456-from-kfile.jsのmismatchDetailsと同様、
      // race_id・理由・両側の値を残す。集計件数だけでは恒常的な不一致
      // レースがあっても気づけないため（毎日スキップされ続けるだけになる）
      const reason = !k
        ? "not_in_kfile"
        : !k.valid
          ? "duplicate_boat_in_kfile"
          : "rank1_3_mismatch";
      console.log(
        `  ⚠️ rank456スキップ(${race.race_id}): ${reason}` +
          (k
            ? ` db=[${race.rank1},${race.rank2},${race.rank3}] kfile=[${k.rank1},${k.rank2},${k.rank3}]`
            : ""),
      );
      continue;
    }

    // Kファイルにも4〜6着が無いレース（3着以内しか完走していない等）は、pendingの条件
    // （rank4がnull）を永久に満たし続けるため、null→nullの空UPDATEを毎回発行してしまう
    // （BOA-349と同種）。既存値（null）と同じなら書かない
    if (k.rank4 == null && k.rank5 == null && k.rank6 == null) {
      unchanged++;
      continue;
    }

    if (dryRun) {
      updated++;
      continue;
    }
    const { error: updateError } = await client
      .from("race_results")
      .update({ rank4: k.rank4, rank5: k.rank5, rank6: k.rank6 })
      .eq("race_id", race.race_id);
    if (updateError) {
      console.error(
        `  ⚠️ rank456更新エラー(${race.race_id}): ${updateError.message}`,
      );
    } else {
      updated++;
    }
  }
  console.log(
    `  ✅ ${dryRun ? "[DRY-RUN] " : ""}rank456(Kファイル方式): ${updated}/${pending.length}件更新 (${dateStr}, スキップ${skipped}件, 変更なし${unchanged}件スキップ)`,
  );
  return {
    updated,
    skipped,
    parsed: rows.length,
    pending: pending.length,
    status: "synced",
  };
}

/**
 * 指定日について、公式成績ファイル（Kファイル）の艇ごとの成績コード（01〜06・F・L0・L1・K0・K1・S0・S1・S2 等）を
 * race_start_timings.official_finish_code に書く（BOA-553。マイグレーション116）。
 *
 * 対象は、成績コードの無い行がある日。無ければダウンロードしない（同じ日の進入・rank4〜6 の同期と K を共有する）。
 * 書くのは既存の行の official_finish_code（と updated_at）だけ。行の無い艇は挿入しない（race_start_timings の
 * 読み手のうち7箇所が「行がある＝出走した」と見るため。2026-09-29 の棚卸し）。値の変わる行だけを書く。
 * 列が未適用（116 が未適用）のDBでは、何もせず status=column_missing を返す。
 *
 * @param {string} dateStr YYYY-MM-DD
 * @param {Object} [options] syncActualCourseFromKFile と同じ（dryRun・client・loadText）と now（テスト用）
 * @returns {Promise<{updated: number, status: string, parsed: number, pending: number, error?: string}>}
 */
export async function syncOfficialFinishCodeFromKFile(
  dateStr,
  {
    dryRun = false,
    client = supabase,
    loadText = () => fetchKFileText(dateStr),
    now = () => new Date(),
  } = {},
) {
  const column = OFFICIAL_FINISH_CODE_COLUMN;
  // 1日で1000行（約166レース）を超える日がある（2026-01-02 は192レース）ので、ページングして全部読む
  const timings = [];
  let readError = null;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("race_start_timings")
      .select(`race_id, boat_number, ${column}`)
      .gte("race_id", dateStr)
      .lt("race_id", `${dateStr}~`)
      .order("race_id")
      .order("boat_number")
      .range(from, from + 999);
    if (error) {
      readError = error;
      break;
    }
    timings.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  if (readError && isColumnMissingError(readError, [column])) {
    console.warn(
      `  ⚠️ 成績コード: race_start_timings.${column} が未適用のため、同期しません（マイグレーション116）`,
    );
    return { updated: 0, parsed: 0, pending: 0, status: "column_missing" };
  }
  if (readError) {
    console.error(
      `  ⚠️ 成績コード対象確認エラー(${dateStr}): ${readError.message}`,
    );
    return {
      updated: 0,
      parsed: 0,
      pending: 0,
      status: "pending_check_failed",
      error: readError.message,
    };
  }
  const current = new Map(
    timings.map((t) => [`${t.race_id}|${t.boat_number}`, t[column] ?? null]),
  );
  const pending = timings.filter((t) => (t[column] ?? null) === null).length;
  if (pending === 0) {
    return { updated: 0, parsed: 0, pending: 0, status: "nothing_pending" };
  }

  let text;
  try {
    text = await loadText();
  } catch (e) {
    console.error(`  ⚠️ Kファイル取得エラー(${dateStr}): ${e.message}`);
    return {
      updated: 0,
      parsed: 0,
      pending,
      status: "kfile_error",
      error: e.message,
    };
  }
  if (!text) {
    console.log(`  成績コード: Kファイル未公開/開催なし (${dateStr})`);
    return { updated: 0, parsed: 0, pending, status: "kfile_unavailable" };
  }

  const parsed = buildOfficialFinishCodeRows(text, dateStr);
  const at = now().toISOString();
  // 既存の行で、値が変わるものだけ（行の無い艇は書かない）
  const toWrite = parsed
    .filter((r) => {
      const key = `${r.race_id}|${r.boat_number}`;
      return current.has(key) && current.get(key) !== r[column];
    })
    .map((r) => ({ ...r, updated_at: at }));
  if (!dryRun && toWrite.length > 0) {
    for (let i = 0; i < toWrite.length; i += 1000) {
      const { error } = await client
        .from("race_start_timings")
        .upsert(toWrite.slice(i, i + 1000), {
          onConflict: "race_id,boat_number",
        });
      if (error) {
        console.error(
          `  ⚠️ 成績コード書き込みエラー(${dateStr}): ${error.message}`,
        );
        return {
          updated: i,
          parsed: parsed.length,
          pending,
          status: "write_error",
          error: error.message,
        };
      }
    }
  }
  console.log(
    `  ✅ ${dryRun ? "[DRY-RUN] " : ""}成績コード(Kファイル方式): ${toWrite.length}艇を更新 (${dateStr}, 未同期${pending}艇)`,
  );
  return {
    updated: toWrite.length,
    parsed: parsed.length,
    pending,
    status: "synced",
  };
}

/**
 * 指定日のKファイル同期（進入コース＋rank4〜6＋成績コード）。同じ日のKファイルを、1回だけダウンロードして両方に使う
 * （D4の解消。従来は、2つの同期が同じ日を別々にダウンロードしていた）。どちらも、未同期のレースが無ければ
 * ダウンロードしない。Vercel Cron の kfile-sync と、GitHub Actions・CLIの両方から呼ぶ。
 *
 * @param {string} dateStr YYYY-MM-DD
 * @param {Object} [options]
 * @param {boolean} [options.dryRun]
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {typeof fetch} [options.fetchImpl] Kファイルのダウンロードに使う fetch（Vercelでは politeFetch）
 * @param {(dateStr: string, options: {fetchImpl?: typeof fetch}) => Promise<string|null>} [options.fetchText] テスト用の差し替え
 * @returns {Promise<{date: string, downloads: number, actualCourse: Awaited<ReturnType<typeof syncActualCourseFromKFile>>, rank456: Awaited<ReturnType<typeof syncRank456FromKFile>>}>}
 */
export async function syncKFileForDate(
  dateStr,
  {
    dryRun = false,
    client = supabase,
    fetchImpl,
    fetchText = fetchKFileText,
  } = {},
) {
  let downloads = 0;
  /** @type {Promise<string|null>|null} */
  let cached = null;
  const loadText = () => {
    if (!cached) {
      downloads++;
      cached = fetchText(dateStr, { fetchImpl });
    }
    return cached;
  };
  const actualCourse = await syncActualCourseFromKFile(dateStr, {
    dryRun,
    client,
    loadText,
  });
  const rank456 = await syncRank456FromKFile(dateStr, {
    dryRun,
    client,
    loadText,
  });
  // 成績コード（BOA-553）。同じKファイルを使う（ダウンロードは1回のまま）
  const officialFinishCode = await syncOfficialFinishCodeFromKFile(dateStr, {
    dryRun,
    client,
    loadText,
  });
  return {
    date: dateStr,
    downloads,
    actualCourse,
    rank456,
    officialFinishCode,
  };
}
/**
 * 発走90分超で結果が取得できていないレースを中止・順延「確定」として扱う（BOA-254 FR2）。
 * getRacesAfterStart(schedule, 5) が対象とする5〜90分後ウィンドウを抜けた
 * レースが対象。既存の結果取得ロジック（scrapeAndSaveResults）は変更しない。
 * GitHub Actions・CLIの入口。失敗しても、結果取得の後続を止めない（ログのみ）。
 *
 * @param {Array} schedule - getRaceSchedule() の返り値
 */
async function confirmOverdueCancellations(schedule) {
  const overdueRaces = getRacesPastResultWindow(schedule, 90);
  if (overdueRaces.length === 0) return;
  try {
    await confirmCancellationsForRaceIds(
      supabase,
      overdueRaces.map((r) => r.race_id),
    );
  } catch (error) {
    console.error(`❌ ${error.message}`);
  }
}

/**
 * 指定のレースのうち、結果（race_results の行）が無く、まだ確定していないものを、中止・順延「確定」にする。
 * 呼び出し側が「発走90分超」を保証して渡す（GitHub Actionsは schedule から、Vercel Cron は発走時刻の範囲の
 * クエリから、result-catchup は当日の全レースから選ぶ）。
 *
 * 読み取りに失敗したら、書き込まずに例外にする（結果の有無が分からないまま「結果なし」とみなして、
 * 結果のあるレースまで中止にしてしまわないため）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} overdueIds
 * @param {{reason?: string}} [options] reason: ログに出す確定の根拠（既定は発走90分超・結果未取得。
 *   公式の告知による確定＝ race_status ジョブは、その旨を渡す）
 * @returns {Promise<{checked: number, confirmed: string[]}>}
 */
export async function confirmCancellationsForRaceIds(
  client,
  overdueIds,
  { reason = "発走90分超・結果未取得" } = {},
) {
  if (overdueIds.length === 0) return { checked: 0, confirmed: [] };

  const [results, races] = await Promise.all([
    client.from("race_results").select("race_id").in("race_id", overdueIds),
    client
      .from("races")
      .select("race_id, cancellation_status")
      .in("race_id", overdueIds),
  ]);
  if (results.error) {
    throw new Error(
      `中止・順延の確定: race_results の取得に失敗しました: ${results.error.message}`,
    );
  }
  if (races.error) {
    throw new Error(
      `中止・順延の確定: races の取得に失敗しました: ${races.error.message}`,
    );
  }

  const hasResult = new Set((results.data || []).map((r) => r.race_id));
  const alreadyConfirmed = new Set(
    (races.data || [])
      .filter((r) => isCancellationConfirmed(r.cancellation_status))
      .map((r) => r.race_id),
  );

  const toConfirm = overdueIds.filter(
    (id) => !hasResult.has(id) && !alreadyConfirmed.has(id),
  );
  if (toConfirm.length === 0) {
    return { checked: overdueIds.length, confirmed: [] };
  }

  const { error } = await client
    .from("races")
    .update({ cancellation_status: "confirmed" })
    .in("race_id", toConfirm);
  if (error) {
    throw new Error(
      `races (cancellation_status確定) 一括更新エラー: ${error.message}`,
    );
  }
  console.log(`  ⚠️ 中止・順延を確定: ${toConfirm.length}件（${reason}）`);
  return { checked: overdueIds.length, confirmed: toConfirm };
}
/**
 * 指定のレースのうち、結果（race_results の行。rank1 は NOT NULL）があるのに、中止・順延の暫定（tentative）・
 * 確定（confirmed）が付いているものを解除する（cancellation_status を NULL、cancellation_check_streak を 0 に戻す）。
 * 結果があるレースは開催済みで、中止の値は誤り（BOA-512: 2026-09-12 に、結果の読み取りの失敗で32本が誤って
 * confirmed になった。結果が先に入り、確定が後から付いたため、結果の書き込みの時点では解除できない。BOA-524）。
 *
 * 読み取りに失敗したら、書き込まずに例外にする（confirmCancellationsForRaceIds と同じ。読めなかった集合を空と
 * みなして判定を反転させない）。更新は、読んだ後に値が変わった行を巻き込まないよう、非NULL の行に限る。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} raceIds
 * @returns {Promise<{checked: number, cleared: string[]}>}
 */
export async function clearCancellationsWithResults(client, raceIds) {
  if (raceIds.length === 0) return { checked: 0, cleared: [] };
  // .in() は GET の URL に race_id を並べるため、台風等で中止が数百件あっても URL 長の上限を超えないよう分ける
  const CHUNK = 200;
  const toClear = [];
  for (let i = 0; i < raceIds.length; i += CHUNK) {
    const ids = raceIds.slice(i, i + CHUNK);
    const [results, races] = await Promise.all([
      client.from("race_results").select("race_id").in("race_id", ids),
      client
        .from("races")
        .select("race_id, cancellation_status")
        .in("race_id", ids),
    ]);
    if (results.error) {
      throw new Error(
        `中止・順延の解除: race_results の取得に失敗しました: ${results.error.message}`,
      );
    }
    if (races.error) {
      throw new Error(
        `中止・順延の解除: races の取得に失敗しました: ${races.error.message}`,
      );
    }
    const hasResult = new Set((results.data ?? []).map((r) => r.race_id));
    toClear.push(
      ...(races.data ?? [])
        .filter(
          (r) => r.cancellation_status != null && hasResult.has(r.race_id),
        )
        .map((r) => r.race_id),
    );
  }
  if (toClear.length === 0) return { checked: raceIds.length, cleared: [] };

  for (let i = 0; i < toClear.length; i += CHUNK) {
    const { error } = await client
      .from("races")
      .update({ cancellation_status: null, cancellation_check_streak: 0 })
      .in("race_id", toClear.slice(i, i + CHUNK))
      .not("cancellation_status", "is", null);
    if (error) {
      throw new Error(
        `races (中止・順延の解除) 一括更新エラー: ${error.message}`,
      );
    }
  }
  console.log(
    `  ⚠️ 結果があるのに中止・順延だったレースを解除: ${toClear.length}件（${toClear.join(", ")}）`,
  );
  return { checked: raceIds.length, cleared: toClear };
}

/**
 * 期間（両端含む）の、中止・順延の暫定・確定が付いたレースを探し、結果があるものを解除する
 * （clearCancellationsWithResults）。結果の日次の catch-up が、対象日から遡って呼ぶ。
 * 中止・順延の付いたレースは期間あたり数十件のため、1回の読み取りで足りる（上限に達したら例外にして、黙って切り捨てない）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{from: string, to: string}} range YYYY-MM-DD
 * @returns {Promise<{checked: number, cleared: string[]}>}
 */
export async function clearCancellationsWithResultsInRange(
  client,
  { from, to },
) {
  const LIMIT = 1000;
  const { data, error } = await client
    .from("races")
    .select("race_id")
    .gte("race_date", from)
    .lte("race_date", to)
    .not("cancellation_status", "is", null)
    .limit(LIMIT);
  if (error) {
    throw new Error(
      `中止・順延の解除: 対象レースの取得に失敗しました: ${error.message}`,
    );
  }
  if ((data ?? []).length >= LIMIT) {
    throw new Error(
      `中止・順延の解除: 中止・順延の付いたレースが${LIMIT}件以上あります（${from}〜${to}）。期間を狭めてください`,
    );
  }
  return clearCancellationsWithResults(
    client,
    (data ?? []).map((r) => r.race_id),
  );
}

/**
 * 結果スクレイピング・DB書き込みの共通処理（GitHub Actions・CLI）
 * @param {Array} races - { race_id, venue_code, race_number, start_time? }[] の配列
 *   start_time（発走予定時刻）は、結果ページの気象の観測時刻に使う。無ければ観測時刻はNULL
 * @param {string} targetDate - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function scrapeAndSaveResults(races, targetDate) {
  // 既に結果があるレースを取得
  const { data: existingResults } = await supabase
    .from("race_results")
    .select("race_id, payout_win, winning_technique")
    .gte("race_id", targetDate)
    .lt("race_id", `${targetDate}~`);

  // 配当データに加え決まり手（winning_technique）も揃っているレースのみ「完了」扱いにする
  // （isResultComplete の説明を参照。BOA-323）
  const finishedRaceIds = new Set(
    (existingResults || []).filter(isResultComplete).map((r) => r.race_id),
  );

  console.log(
    `Fetching results for ${races.length} races (${finishedRaceIds.size} already finished)\n`,
  );

  let updatedCount = 0;
  let alreadyFinishedCount = 0;
  let notYetCount = 0;
  const newResults = [];
  const scrapeCache = new Map(); // race_id → scraped result (for start timings)
  const startTimeByRaceId = new Map(
    races.filter((r) => r.start_time).map((r) => [r.race_id, r.start_time]),
  );

  // Fetch results for each race
  for (const race of races) {
    const venueName = VENUE_NAMES[race.venue_code] || `会場${race.venue_code}`;
    const raceInfo = `${venueName} R${race.race_number}`;
    process.stdout.write(`${raceInfo.padEnd(20)} `);

    // Skip if already finished with payout data
    if (finishedRaceIds.has(race.race_id)) {
      console.log(`Already finished`);
      alreadyFinishedCount++;
      continue;
    }

    // Scrape result
    const result = await scrapeRaceResult(
      race.venue_code,
      race.race_number,
      targetDate,
    );

    if (result) {
      console.log(
        `New result: ${result.rank1}-${result.rank2}-${result.rank3}`,
      );
      scrapeCache.set(race.race_id, result);
      newResults.push(buildRaceResultRow(race.race_id, result));
      updatedCount++;
    } else {
      console.log(`Not yet finished`);
      notYetCount++;
    }

    // Wait to avoid server overload
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\nResults summary:`);
  console.log(`  - Newly fetched: ${updatedCount} races`);
  console.log(`  - Already finished: ${alreadyFinishedCount} races`);
  console.log(`  - Not yet finished: ${notYetCount} races`);

  // Supabaseに書き込み
  if (newResults.length > 0) {
    await persistRaceResults({
      client: supabase,
      newResults,
      scrapeCache,
      startTimeByRaceId,
    });
  } else {
    console.log("\n📤 結果: 新規データなし");
  }

  // 欠落した的中フラグを修正（新結果の有無に関わらず毎回実行）
  // 直近10日分を対象にすることで、当日限定では拾えない過去日の
  // 一時的な書き込み失敗を後続の実行で自己修復できるようにする。
  // newResults.length > 0の時だけに限定すると、対象日の結果が既に
  // 全件scrape済みになった時点で「新規データなし」が続き、二度と
  // このチェックが走らなくなる（2026-09-06、当日分の的中フラグが
  // 132件全件NULLのまま固着していた実例で発覚）
  // 結果は保存済みのため、補完の失敗で結果取得そのものを失敗扱いにしない（補完は次の実行・日次の
  // result-catchup がやり直す。BOA-391 で fixMissingHitFlags の取得失敗が例外になったため）
  try {
    await fixMissingHitFlags(getDateDaysAgo(9), targetDate);
  } catch (error) {
    console.error(
      `⚠️ 的中フラグの補完に失敗（次の実行で再試行）: ${error.message}`,
    );
  }

  return { updated: newResults.length > 0, count: newResults.length };
}

// Main function（スタンドアローン実行用の後方互換ラッパー）
async function scrapeResults(dateStr = null) {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabaseが設定されていません");
    process.exit(1);
  }

  const targetDate = dateStr || getTodayDateJST();
  console.log(`Starting race result scraping: ${targetDate}`);

  // 握りつぶし可（BOA-391）: 失敗したら下の「races テーブルから全件」のフォールバックに進む設計のため、空配列で受ける
  const schedule = await getRaceSchedule(targetDate, { throwOnError: false });
  let races;
  if (schedule.length > 0) {
    const startedRaces = getRacesAfterStart(schedule, 5);
    if (startedRaces.length === 0) {
      console.log("📭 発走後5分以上経過したレースなし");
      return;
    }
    console.log(`🎯 取得対象: ${startedRaces.length}レース（発走後5分以上）`);
    races = startedRaces.map((r) => ({
      race_id: r.race_id,
      venue_code: r.venue_code,
      race_number: r.race_no,
    }));
  } else {
    // スケジュール取得失敗時: races テーブルから全件取得（フォールバック）
    console.warn("⚠️ スケジュール取得失敗: races テーブルから全レースを対象");
    const { data: allRaces, error: racesError } = await supabase
      .from("races")
      .select("race_id, venue_code, race_number")
      .eq("race_date", targetDate)
      .order("race_id");
    if (racesError) {
      console.error("❌ レース取得エラー:", racesError.message);
      process.exit(1);
    }
    races = allRaces || [];
    if (races.length === 0) {
      console.log("⚠️ 対象レースがありません");
      return;
    }
  }

  await scrapeAndSaveResults(races, targetDate);
}

// 結果があるのにis_hit_winがNULLの予測を修正
// startDate〜endDate（両端含む、race_id昇順比較）の範囲で欠落を検知・修復する。
// 通常呼び出しは直近数日分の範囲を渡し、当日限定では拾えない過去日の
// 一時的な書き込み失敗（2026-09-06発覚）を後続の実行で自己修復できるようにする。
// GitHub Actions では結果取得のたびに、Vercel Cron では日次の result-catchup で呼ぶ（T4b-02-1）。
// 戻り値: 欠落していた件数と修正できた件数、判定対象外の件数（呼び出し側の多くは無視する）
export async function fixMissingHitFlags(
  startDate,
  endDate = startDate,
  { client = supabase } = {},
) {
  // is_hit_winがNULLの予測を取得
  // ⚠️ Supabaseのデフォルトlimit(1000行)を超える可能性があるため.range()でページネーションする
  // （2026-09-06発覚: 日付範囲を広げた際に無ページネーションのままだったため、範囲内の件数が
  // 1000件を超えると挿入順で末尾＝直近日（当日）の結果が切り捨てられ、当日分の欠落が
  // 一切修復されないまま固着していた）
  // 共通 fetchAll（失敗は例外。以前の自前のループは途中までの結果で続行し、欠落件数を少なく報告していた。BOA-391）
  const missingPredictions = await fetchAll(
    "predictions",
    `prediction_id, race_id, top_pick, top_2nd, top_3rd, feature_contributions, ${HIT_COLUMNS.join(", ")}`,
    (q) =>
      q
        .gte("race_id", startDate)
        .lt("race_id", `${endDate}~`)
        .is("is_hit_win", null)
        .order("prediction_id"),
    { client },
  );

  if (missingPredictions.length === 0) {
    return { missing: 0, fixed: 0 }; // 欠落なし
  }

  console.log(
    `\n🔧 欠落した的中フラグを修正中... (${missingPredictions.length}件, ${startDate}〜${endDate})`,
  );

  // 結果データを取得（同様にページネーション）
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio, race_status, refund_boats",
    (q) =>
      q.gte("race_id", startDate).lt("race_id", `${endDate}~`).order("race_id"),
    { client },
  );

  const resultsMap = new Map();
  for (const r of results) {
    resultsMap.set(r.race_id, r);
  }

  let fixed = 0;
  let notJudgeable = 0; // 判定対象外のまま（不成立・単勝の艇が返還）。欠落ではない
  for (const pred of missingPredictions) {
    const result = resultsMap.get(pred.race_id);
    if (!result || !result.rank1) continue;

    const update = buildPredictionHitUpdate(pred, result);
    // 判定対象外（不成立・返還艇を含む券種）は NULL のまま。is_hit_win が NULL の行は毎回ここに来るので、
    // 今の値と同じなら書かない（変更の無い行は書かない。BOA-544）
    if (HIT_COLUMNS.every((c) => (pred[c] ?? null) === update[c])) {
      notJudgeable++;
      continue;
    }

    const { error: updateError } = await client
      .from("predictions")
      .update(update)
      .eq("prediction_id", pred.prediction_id);

    if (!updateError) fixed++;
  }

  if (fixed > 0) {
    console.log(`  ✅ ${fixed}件の欠落フラグを修正`);
  }
  return {
    missing: missingPredictions.length - notJudgeable,
    fixed,
    notJudgeable,
  };
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const targetDate = parseDateArg();
  scrapeResults(targetDate);
}
