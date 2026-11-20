import { createHash } from "node:crypto";
import { supabase, fetchAll } from "./supabaseClient.js";
import { diffRows } from "./unchangedRows.js";
import { mapWithConcurrency } from "./scrapeJobs/concurrency.js";
import { archiveRawHtml } from "./rawHtmlArchive.js";
import { collectVenueResults } from "./raceNoticesRows.js";
import { parseInformationHtml } from "./raceNoticesParse.js";
import { fetchInformationPage } from "./raceNoticesFetch.js";

const FULLWIDTH_SPACE_CODE = 0x3000; // 全角スペース。エディタ上で目視しづらいため
// ソースにリテラル文字を埋め込まずコードポイントで扱う（no-irregular-whitespace対策）

function normalizeRacerName(name) {
  return (name || "")
    .split("")
    .filter((ch) => !/\s/.test(ch) && ch.charCodeAt(0) !== FULLWIDTH_SPACE_CODE)
    .join("");
}

/**
 * racer_profiles から 正規化した氏名→racer_id の対応表を作る。
 * 同姓同名で複数該当する場合はどちらか特定できないため対応表に含めない
 * （racer_idはnullのまま保存する）
 */
async function buildRacerNameMap(client, { strict = false } = {}) {
  const map = new Map();
  if (!client) return map;

  // racer_profilesは約1,627行あり、PostgRESTのデフォルト上限（1000行）を
  // 超えるため fetchAll() でページネーションする（.range()無しの単発selectだと
  // 後半の選手が対応表から漏れ、racer_idが解決できなくなる）。
  // strict（共通ラッパ）では、取得エラーを部分結果にせず例外にする（DB障害を成功にしない）
  const data = await fetchAll(
    "racer_profiles",
    "racer_id,name",
    (q) => q.order("racer_id"),
    {
      throwOnError: strict,
      client,
    },
  );

  for (const row of data ?? []) {
    const key = normalizeRacerName(row.name);
    if (!key) continue;
    if (map.has(key)) {
      map.set(key, null); // 重複＝一意に特定できない
    } else {
      map.set(key, row.racer_id);
    }
  }
  return map;
}

/** 会場×当日の既存の集計行（変更の比較と、had_success・last_reason の引き継ぎに使う） */
async function getExistingDailyHealth(
  client,
  venueCodes,
  checkDate,
  { strict = false } = {},
) {
  if (venueCodes.length === 0) return [];
  const { data, error } = await client
    .from("race_notices_health")
    .select("venue_code,check_date,had_success,last_reason")
    .eq("check_date", checkDate)
    .in("venue_code", venueCodes);
  if (error) {
    if (strict) {
      throw new Error(`race_notices_health取得エラー: ${error.message}`);
    }
    console.error("⚠️ race_notices_health取得エラー:", error.message);
    return [];
  }
  return data ?? [];
}

/**
 * 通知の一覧のダイジェスト（shadow で、解析結果の内容を記録し、live のDBの行と突き合わせるため）。
 * 並び順に依存しない
 */
function digestNotes(noteRows) {
  const keys = noteRows
    .map((r) =>
      [r.venue_code, r.race_date, r.category, r.detail_text].join("|"),
    )
    .sort();
  return createHash("sha1").update(keys.join("\n")).digest("hex").slice(0, 16);
}

function emptyResult() {
  return {
    updated: false,
    count: 0,
    venuesChecked: 0,
    venuesFailed: [],
    venuesNotAttempted: [],
    notesParsed: 0,
    rowsUnparsed: 0,
    venuesWithUnparsedRows: [],
    notesInserted: 0,
    healthWritten: 0,
    healthSkipped: 0,
    digest: digestNotes([]),
    writeErrors: [],
    capturedPages: [],
  };
}

/** race_special_notes へ upsert（重複は無視）。失敗は writeErrors に足す。戻り値は新規に入った行数 */
async function writeSpecialNotes(client, allNoteRows, { dryRun, writeErrors }) {
  let insertedCount = 0;
  if (allNoteRows.length > 0 && !dryRun) {
    const { data, error } = await client
      .from("race_special_notes")
      .upsert(allNoteRows, {
        onConflict: "venue_code,race_date,category,detail_text,racer_name",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      console.error("❌ race_special_notes 書き込みエラー:", error.message);
      writeErrors.push(`race_special_notes書き込みエラー: ${error.message}`);
    } else {
      insertedCount = data?.length ?? 0;
    }
  }
  return insertedCount;
}

/** race_notices_health へ変更のある行だけ upsert。失敗は writeErrors に足す */
async function writeNoticesHealth(
  client,
  existingHealthRows,
  healthUpdates,
  { dryRun, writeErrors },
) {
  // 変更のある行（had_success・last_reason が変わった、または新規の会場×日）だけを書く（D9）。
  // last_checked_at は毎回変わるが情報を持たないため、比較から外す。既存行の取得に失敗した場合
  // （非strict）は、既存行が空になり、全行が「新規」として書かれる（従来と同じ、書く側に倒れる）
  const { toWrite: healthToWrite } = diffRows(
    existingHealthRows,
    healthUpdates,
    {
      keyColumns: ["venue_code", "check_date"],
      ignoreColumns: ["last_checked_at"],
    },
  );
  let healthWritten = 0;
  if (healthToWrite.length > 0 && !dryRun) {
    const { error } = await client
      .from("race_notices_health")
      .upsert(healthToWrite, { onConflict: "venue_code,check_date" });
    if (error) {
      console.error("❌ race_notices_health 書き込みエラー:", error.message);
      writeErrors.push(`race_notices_health書き込みエラー: ${error.message}`);
    } else {
      healthWritten = healthToWrite.length;
    }
  }
  return { healthWritten, healthToWrite };
}

/**
 * 1会場分の取得・解析（通知を検出したら生HTMLを保管する。dryRun では保管しない）。
 * 戻り値: { venueCode, outcome: {success, reason}, notes, rowsUnparsed?, capturedPath? }
 */
async function scrapeVenueNotices(
  venueCode,
  { client, fetchPage, dryRun, shouldStop, date, dateYmd },
) {
  if (shouldStop()) {
    return {
      venueCode,
      outcome: { success: false, reason: "deadline" },
      notes: [],
    };
  }
  const { html, reason: fetchReason } = await fetchPage(venueCode, dateYmd);
  if (!html) {
    return {
      venueCode,
      outcome: { success: false, reason: fetchReason },
      notes: [],
    };
  }
  const {
    notes,
    reason: parseReason,
    rowsUnparsed,
  } = parseInformationHtml(html, dateYmd);
  // parseReasonが立っている場合（見出し自体が見つからない、または3区分
  // 揃わない）は構造変化の疑いとして必ず失敗扱いにする。notesが空配列でも
  // nullでなければ「取得自体は成功」と誤判定してしまうバグを防ぐ
  // （notes !== null だけを見るとunexpected_section_countを握りつぶす）
  let capturedPath = null;
  // 通知を1件でも検出した瞬間の生HTMLを保管する（N28調査用の暫定計測、2026-09-23）。
  // race_special_notesが稼働開始から0件のまま続いており、パーサーの不具合か、
  // 単に通知が無いだけかを実例が出るまで判別できなかった。次に検出した瞬間を
  // 確実に押さえるための一時的なフック（恒久化するかはBOA-XXXで判断）。
  // dryRun（shadow）では、他のテーブルと同じく副作用を起こさない
  if (notes && notes.length > 0 && !dryRun) {
    const contentHash = createHash("sha1")
      .update(html)
      .digest("hex")
      .slice(0, 16);
    // race_id形式（YYYY-MM-DD-VV-RR）を流用した会場×日のキー（RRは固定で"00"）
    const pseudoRaceId = `${date}-${String(venueCode).padStart(2, "0")}-00`;
    capturedPath = await archiveRawHtml(client, {
      pageType: "race_notices",
      raceId: pseudoRaceId,
      contentHash,
      html,
    });
  }
  return {
    venueCode,
    outcome: { success: parseReason === null, reason: parseReason },
    notes: notes ?? [],
    rowsUnparsed,
    capturedPath,
  };
}

/**
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time: Date}>} schedule
 * @param {string} date - YYYY-MM-DD
 * @param {Object} [options]
 * @param {import("@supabase/supabase-js").SupabaseClient|null} [options.client] 既定は supabaseClient.js
 * @param {(venueCode: number, dateYmd: string) => Promise<{html: string|null, reason: string|null}>} [options.fetchPage]
 *   取得関数。既定は素の fetch（15秒タイムアウト）。共通ラッパからは createInformationFetcher(politeFetch)
 * @param {boolean} [options.dryRun] true なら、取得・解析のみ（DBへ書かない。shadow）
 * @param {boolean} [options.strict] true なら、DBの読み書きの失敗を例外にする（共通ラッパ。DB障害を
 *   「成功」「対象なし」にしない。G13）。既定は従来どおり、ログに出して続行する
 * @param {number} [options.concurrency] 会場の同時取得数（既定1＝従来どおり逐次）
 * @param {() => boolean} [options.shouldStop] true を返したら、以降の会場は取得しない（ソフトデッドライン）
 * @returns {Promise<{
 *   updated: boolean, count: number, venuesChecked: number, venuesFailed: Array<{venueCode: number, reason: string|null}>,
 *   venuesNotAttempted: number[], notesParsed: number, rowsUnparsed: number,
 *   venuesWithUnparsedRows: Array<{venueCode: number, rows: number}>, notesInserted: number, healthWritten: number,
 *   healthSkipped: number, digest: string, writeErrors: string[]
 * }>}
 */
export async function run(schedule, date, options = {}) {
  const {
    client = supabase,
    fetchPage = fetchInformationPage,
    dryRun = false,
    strict = false,
    concurrency = 1,
    shouldStop = () => false,
  } = options;

  const empty = emptyResult();

  if (!client) {
    if (strict) throw new Error("Supabase が設定されていません");
    console.error("❌ Supabase環境変数が未設定です。");
    return empty;
  }

  const venueCodes = [...new Set(schedule.map((r) => r.venue_code))].sort(
    (a, b) => a - b,
  );
  if (venueCodes.length === 0) {
    console.log("📭 レース特記事項: 本日の開催会場なし");
    return empty;
  }

  const dateYmd = date.replace(/-/g, "");
  const racerNameMap = await buildRacerNameMap(client, { strict });
  const existingHealthRows = await getExistingDailyHealth(
    client,
    venueCodes,
    date,
    { strict },
  );
  const existingHealth = new Map(
    existingHealthRows.map((row) => [row.venue_code, row]),
  );

  // 会場ごとの取得・解析（並列度 concurrency。結果は会場コード順に並ぶ）
  const perVenue = await mapWithConcurrency(
    venueCodes,
    concurrency,
    (venueCode) =>
      scrapeVenueNotices(venueCode, {
        client,
        fetchPage,
        dryRun,
        shouldStop,
        date,
        dateYmd,
      }),
  );

  const col = collectVenueResults(perVenue, {
    racerIdOf: (name) =>
      racerNameMap.get(normalizeRacerName(name)) ?? null,
    existingHealth,
    date,
  });

  const writeErrors = [];
  const insertedCount = await writeSpecialNotes(client, col.allNoteRows, {
    dryRun,
    writeErrors,
  });
  const { healthWritten, healthToWrite } = await writeNoticesHealth(
    client,
    existingHealthRows,
    col.healthUpdates,
    { dryRun, writeErrors },
  );

  const venuesChecked = venueCodes.length - col.venuesNotAttempted.length;
  console.log(
    `📊 レース特記事項: ${venuesChecked}会場チェック${dryRun ? "[DRY-RUN]" : ""}、${insertedCount}件新規保存、集計行${healthWritten}件書き込み（変更なし${col.healthUpdates.length - healthToWrite.length}件スキップ）`,
  );
  // 共通ラッパ（strict）は、書き込みの失敗を例外にする。両方の書き込みを試みた後にまとめて投げる
  if (strict && writeErrors.length > 0) {
    throw new Error(writeErrors.join(" / "));
  }
  return {
    updated: insertedCount > 0,
    count: insertedCount,
    venuesChecked,
    venuesFailed: col.venuesFailed,
    venuesNotAttempted: col.venuesNotAttempted,
    notesParsed: col.allNoteRows.length,
    rowsUnparsed: col.venuesWithUnparsedRows.reduce((n, v) => n + v.rows, 0),
    venuesWithUnparsedRows: col.venuesWithUnparsedRows,
    notesInserted: insertedCount,
    healthWritten,
    healthSkipped: col.healthUpdates.length - healthToWrite.length,
    digest: digestNotes(col.allNoteRows),
    writeErrors,
    capturedPages: col.capturedPages,
  };
}

export { normalizeRacerName };

export { createInformationFetcher } from "./raceNoticesFetch.js";
