import { supabase } from "./supabaseClient.js";
import { fetchKFileText } from "./kfileParser.js";
import {
  OFFICIAL_FINISH_CODE_COLUMN,
  buildOfficialFinishCodeRows,
} from "./officialFinishCode.js";
import { isColumnMissingError } from "./optionalColumns.js";
import {
  syncActualCourseFromKFile,
  syncRank456FromKFile,
} from "./kfileSyncCourse.js";

/**
 * 進入コース・rank4〜6のKファイル同期の対象日数（当日を除く直近N日）。
 * 大きくし過ぎるとKファイル未取得日も毎回ダウンロードを試みてしまうため、
 * 通常運用での取得漏れを拾える程度の小さい値にとどめる。
 */
export const KFILE_SYNC_LOOKBACK_DAYS = 4;

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

export {
  syncActualCourseFromKFile,
  syncRank456FromKFile,
} from "./kfileSyncCourse.js";
