import { supabase } from "./supabaseClient.js";
import {
  fetchKFileText,
  parseKFileText,
  parseKFileRankings,
} from "./kfileParser.js";
import { filterUnchangedRows, formatSkipSummary } from "./unchangedRows.js";

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
