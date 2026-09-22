/**
 * レース特記事項（事故・内規違反・減点／モーター・ボート変更／欠場・帰郷）取得
 * （BOA-318/319/320、docs/design/scraping-full-coverage/plan.md FR-1）
 *
 * boatrace.jp の race/information ページ（会場・日付単位、レース番号非依存。
 * rno は必須パラメータだが値によって内容は変わらないことを実データで確認済み）
 * から3区分の通知をまとめて取得し、race_special_notes テーブルへ保存する。
 *
 * 実データ確認済み構造（2026-09-15調査）:
 * - 通知なしの場合: 各区分の<table>内に「※ 現在、お知らせはありません。」の
 *   1行のみ（<td class="is-p10-0">）
 * - 通知がある場合（過去の実例、jcd=12 hd=20171224で確認）:
 *   - 事故・内規違反・減点: <tr>ごとに [日付(MM/DD), レース番号(例:10R), 選手名,
 *     違反/事故内容(例:落水失格（選手責任）), 処分(例:減点5点|処置なし)] の5セル
 *   - モーター・ボート変更: [日付, 選手名, 変更内容(例:26→69（ボート変更）),
 *     適用タイミング(例:2日目より使用)] の4セル
 *   - 欠場・帰郷: [日付, 選手名, 理由(例:帰郷（私傷病のため）)] の3セル
 * - 各行の日付は「MM/DD」形式で、当該節（開催期間）内の過去日を含む累積表示
 *   になっている（hd指定日＝節の最終確認日ではなく、節開始日からの全行が
 *   毎回表示される）。年またぎ節（12月末〜1月）を考慮し、hd の年月と行の
 *   月を突き合わせて実際の年を復元する（resolveRaceDate）。
 *
 * 通知の発生頻度が低く行の内容もほぼ不変なため、venue_code/race_date/category/
 * detail_text/racer_name の組み合わせにUNIQUE制約を張り、10分間隔の再取得で同じ行を
 * 何度取得してもエラーにならない（ignoreDuplicates upsert）設計にする。racer_name を
 * 含めるのは、同じ会場・日付・区分でdetail_textがたまたま一致する別選手の通知を
 * 1行に潰さないため（BOA-371、マイグレーション093）。
 *
 * 構造変化監視: scripts/lib/venueMotorStats/driftHealth.js のコアロジック
 * （updateVenueHealth）を再利用する。Vercel Function（api/cron/race-notices.js）
 * は10分間隔で実行されファイルシステムへの永続化・git commitができないため、
 * 会場×日付単位の当日集計を race_notices_health テーブルに保存し、
 * scripts/maintenance/check-race-notices-drift.js（GitHub Actions日次実行）が
 * 直近日数分を畳み込んで連続失敗日数を判定する。
 *
 * race_notices_health は、変更のある行（had_success・last_reason が変わった会場×日）だけを書く
 * （BOA-353 T4b-11-1、変更の無い行は書かない方針）。last_checked_at は「その行を最後に書いた時刻」
 * になり、最終確認時刻ではなくなる（最終確認・最終成功は scrape_job_state の race_notices の
 * last_success_at）。
 *
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）から呼ぶ場合は、scripts/lib/raceNoticesJob.js が
 * strict（DBの読み書きの失敗を例外にする）・dryRun（shadow: 取得・解析のみ）・並列度・取得関数
 * （politeFetch）を渡す。CLI・従来の呼び出しは、オプション無し（従来どおり、逐次・失敗はログのみ）。
 */

import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { diffRows } from "../lib/unchangedRows.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};
// supabaseClient.js の FETCH_TIMEOUT_MS と同じ値（Node.js標準fetchの無期限
// ハング不具合対策、PR #639セルフレビュー由来の既存踏襲）
const FETCH_TIMEOUT_MS = 15000;

const NO_NOTICE_TEXT = "現在、お知らせはありません";

const CATEGORY_LABELS = {
  "事故・内規違反・減点": "accident",
  "モーター・ボート変更": "equipment_change",
  "欠場・帰郷": "absence",
};
const EXPECTED_CATEGORY_COUNT = Object.keys(CATEGORY_LABELS).length;

/**
 * race/information ページを取得する
 * @returns {Promise<{html: string|null, reason: string|null}>}
 */
function informationUrl(venueCode, dateYmd) {
  const jcd = String(venueCode).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/information?rno=1&jcd=${jcd}&hd=${dateYmd}`;
}

async function fetchInformationPage(venueCode, dateYmd) {
  const url = informationUrl(venueCode, dateYmd);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return { html: null, reason: `http_${res.status}` };
    const html = await res.text();
    return { html, reason: null };
  } catch (error) {
    if (error.name === "AbortError") {
      return { html: null, reason: "timeout" };
    }
    return { html: null, reason: `fetch_error: ${error.message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * politeFetch（共通ラッパの、タイムアウト・429/503のバックオフ・サーキットブレーカー付きの取得）で
 * race/information ページを取得する関数を作る。戻り値の形は fetchInformationPage と同じ。
 * ブレーカーが開いていて取得しなかった場合の reason は "breaker_open"（構造変化の失敗とは区別する）
 *
 * @param {(url: string, init?: RequestInit) => Promise<Response>} politeFetch
 * @returns {(venueCode: number, dateYmd: string) => Promise<{html: string|null, reason: string|null}>}
 */
export function createInformationFetcher(politeFetch) {
  return async (venueCode, dateYmd) => {
    try {
      const res = await politeFetch(informationUrl(venueCode, dateYmd), {
        headers: FETCH_HEADERS,
      });
      if (!res.ok) return { html: null, reason: `http_${res.status}` };
      return { html: await res.text(), reason: null };
    } catch (error) {
      if (error?.name === "BreakerOpenError") {
        return { html: null, reason: "breaker_open" };
      }
      return {
        html: null,
        reason: `fetch_error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

const FULLWIDTH_SPACE_CODE = 0x3000; // 全角スペース。エディタ上で目視しづらいため
// ソースにリテラル文字を埋め込まずコードポイントで扱う（no-irregular-whitespace対策）

function normalizeRacerName(name) {
  return (name || "")
    .split("")
    .filter((ch) => !/\s/.test(ch) && ch.charCodeAt(0) !== FULLWIDTH_SPACE_CODE)
    .join("");
}

/**
 * 「MM/DD」文字列と基準日（YYYYMMDD）から実際の日付（YYYY-MM-DD）を復元する。
 * 節が年をまたぐ場合（12月開催の節が1月まで続く等）、基準日が1月で行がの
 * 月が12月なら前年と判定する。それ以外は基準年をそのまま使う
 * （行の月が基準月より後＝来年、というケースは実運用上ほぼ起きないため
 * 未対応。発生した場合はconsole.warnで気づけるようにする）
 */
function resolveRaceDate(mmddText, baseDateYmd) {
  const m = mmddText.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const baseYear = parseInt(baseDateYmd.slice(0, 4), 10);
  const baseMonth = parseInt(baseDateYmd.slice(4, 6), 10);

  let year = baseYear;
  if (baseMonth === 1 && month === 12) {
    year -= 1;
  } else if (month > baseMonth + 1) {
    // 基準月より2ヶ月以上先の月＝想定外（節の跨ぎ方が想定と違う可能性）
    console.warn(
      `⚠️ race-information: 想定外の日付関係 baseDate=${baseDateYmd} row=${mmddText}`,
    );
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseAccidentRow(cells) {
  // [日付, レース番号, 選手名, 違反/事故内容, 処分]
  if (cells.length < 5) return null;
  const [dateText, raceNoText, racerName, violationText, penaltyText] = cells;
  const penaltyMatch = penaltyText.match(/減点(\d+)点/);
  const raceNoMatch = raceNoText.match(/(\d+)R/);
  return {
    dateText,
    racerName,
    detailText: `${violationText} ${penaltyText}`.trim(),
    structuredData: {
      raceNo: raceNoMatch ? parseInt(raceNoMatch[1], 10) : null,
      violation: violationText,
      penaltyText,
      penaltyPoints: penaltyMatch ? parseInt(penaltyMatch[1], 10) : null,
    },
  };
}

function parseEquipmentChangeRow(cells) {
  // [日付, 選手名, 変更内容, 適用タイミング]
  if (cells.length < 3) return null;
  const [dateText, racerName, changeText, effectiveFrom = null] = cells;
  const changeMatch = changeText.match(
    /(\d+)\s*→\s*(\d+)\s*[（(](モーター|ボート)変更[）)]/,
  );
  return {
    dateText,
    racerName,
    detailText: [changeText, effectiveFrom].filter(Boolean).join(" "),
    structuredData: changeMatch
      ? {
          equipmentType: changeMatch[3] === "モーター" ? "motor" : "boat",
          oldNumber: parseInt(changeMatch[1], 10),
          newNumber: parseInt(changeMatch[2], 10),
          effectiveFrom: effectiveFrom || null,
        }
      : { rawText: changeText, effectiveFrom: effectiveFrom || null },
  };
}

function parseAbsenceRow(cells) {
  // [日付, 選手名, 理由]
  if (cells.length < 3) return null;
  const [dateText, racerName, reasonText] = cells;
  const isReturnHome = reasonText.includes("帰郷");
  const subReasonMatch = reasonText.match(/[（(](.+)[）)]/);
  return {
    dateText,
    racerName,
    detailText: reasonText,
    structuredData: {
      // BOA-318記載の「途中帰郷」「即日帰郷」「即刻帰郷」の区別は実データで
      // 未確認（実例では「帰郷（その他）」「帰郷（私傷病のため）」のみ観測）。
      // 見つかり次第このtypeの分類ロジックを見直す
      type: isReturnHome ? "帰郷" : "欠場",
      subReason: subReasonMatch ? subReasonMatch[1] : null,
      rawText: reasonText,
    },
  };
}

const ROW_PARSERS = {
  accident: parseAccidentRow,
  equipment_change: parseEquipmentChangeRow,
  absence: parseAbsenceRow,
};

/**
 * HTMLから3区分の通知を抽出する
 * @returns {{notes: Array|null, reason: string|null}}
 */
function parseInformationHtml(html, dateYmd) {
  const $ = cheerio.load(html);
  const sections = $(".title7_mainLabel");
  if (sections.length === 0) {
    return { notes: null, reason: "notice_section_not_found" };
  }

  const notes = [];
  let matchedCategories = 0;

  sections.each((_, el) => {
    const label = $(el).text().trim();
    const category = CATEGORY_LABELS[label];
    if (!category) return; // 未知の見出し＝構造変化の可能性、件数チェックで検知
    matchedCategories++;

    const table = $(el).closest(".title7").next(".table1").find("table");
    if (table.length === 0) return;

    if (table.text().includes(NO_NOTICE_TEXT)) return; // 通知なし（正常系）

    table.find("tbody tr").each((__, tr) => {
      const cells = $(tr)
        .find("th,td")
        .map((___, c) => $(c).text().trim())
        .get()
        .filter((t) => t.length > 0);
      if (cells.length === 0) return;

      const parser = ROW_PARSERS[category];
      const parsed = parser ? parser(cells) : null;
      if (!parsed) return;

      const raceDate = resolveRaceDate(parsed.dateText, dateYmd);
      if (!raceDate) return;

      notes.push({
        category,
        raceDate,
        racerName: parsed.racerName,
        detailText: parsed.detailText,
        structuredData: parsed.structuredData,
      });
    });
  });

  if (matchedCategories < EXPECTED_CATEGORY_COUNT) {
    return { notes, reason: "unexpected_section_count" };
  }
  return { notes, reason: null };
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
  const data = await fetchAll("racer_profiles", "racer_id,name", undefined, {
    throwOnError: strict,
    client,
  });

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

/** 取得しなかった（ブレーカーが開いていた・ソフトデッドラインを過ぎた）会場。構造変化の失敗とは区別する */
const NOT_ATTEMPTED_REASONS = new Set(["breaker_open", "deadline"]);

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
 *   venuesNotAttempted: number[], notesParsed: number, notesInserted: number, healthWritten: number,
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

  const empty = {
    updated: false,
    count: 0,
    venuesChecked: 0,
    venuesFailed: [],
    venuesNotAttempted: [],
    notesParsed: 0,
    notesInserted: 0,
    healthWritten: 0,
    healthSkipped: 0,
    digest: digestNotes([]),
    writeErrors: [],
  };

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
    async (venueCode) => {
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
      const { notes, reason: parseReason } = parseInformationHtml(
        html,
        dateYmd,
      );
      // parseReasonが立っている場合（見出し自体が見つからない、または3区分
      // 揃わない）は構造変化の疑いとして必ず失敗扱いにする。notesが空配列でも
      // nullでなければ「取得自体は成功」と誤判定してしまうバグを防ぐ
      // （notes !== null だけを見るとunexpected_section_countを握りつぶす）
      return {
        venueCode,
        outcome: { success: parseReason === null, reason: parseReason },
        notes: notes ?? [],
      };
    },
  );

  const allNoteRows = [];
  const healthUpdates = [];
  const venuesFailed = [];
  const venuesNotAttempted = [];

  for (const { venueCode, outcome, notes } of perVenue) {
    for (const note of notes) {
      const racerId =
        racerNameMap.get(normalizeRacerName(note.racerName)) ?? null;
      allNoteRows.push({
        venue_code: venueCode,
        race_date: note.raceDate,
        category: note.category,
        racer_id: racerId,
        // racer_id は同姓同名で一意に特定できない選手がnullになり、一意制約の差別化に使えない
        // （BOA-371）ため、必ず取得できる生の選手名表記（racer_name）を差別化キーに使う
        racer_name: note.racerName,
        boat_number: null, // 情報ページ自体には艇番の記載がないため未実装（将来race_entries突き合わせで補完可）
        detail_text: note.detailText,
        structured_data: {
          ...note.structuredData,
          racerName: note.racerName,
        },
      });
    }

    if (NOT_ATTEMPTED_REASONS.has(outcome.reason)) {
      // 取得していない会場は、構造変化の判定材料にならないため、集計行を作らない
      venuesNotAttempted.push(venueCode);
      console.log(`  ⏭️ 会場${venueCode}: 取得せず（${outcome.reason}）`);
      continue;
    }

    const prev = existingHealth.get(venueCode);
    const hadSuccess = (prev?.had_success ?? false) || outcome.success;
    const lastReason = outcome.success
      ? (prev?.last_reason ?? null)
      : outcome.reason;
    healthUpdates.push({
      venue_code: venueCode,
      check_date: date,
      had_success: hadSuccess,
      last_reason: lastReason,
      last_checked_at: new Date().toISOString(),
    });

    if (!outcome.success) {
      venuesFailed.push({ venueCode, reason: outcome.reason });
      console.log(`  ⚠️ 会場${venueCode}: ${outcome.reason}`);
    } else if (notes.length > 0) {
      console.log(`  📝 会場${venueCode}: 通知あり`);
    }
  }

  const writeErrors = [];
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

  const venuesChecked = venueCodes.length - venuesNotAttempted.length;
  console.log(
    `📊 レース特記事項: ${venuesChecked}会場チェック${dryRun ? "[DRY-RUN]" : ""}、${insertedCount}件新規保存、集計行${healthWritten}件書き込み（変更なし${healthUpdates.length - healthToWrite.length}件スキップ）`,
  );
  // 共通ラッパ（strict）は、書き込みの失敗を例外にする。両方の書き込みを試みた後にまとめて投げる
  if (strict && writeErrors.length > 0) {
    throw new Error(writeErrors.join(" / "));
  }
  return {
    updated: insertedCount > 0,
    count: insertedCount,
    venuesChecked,
    venuesFailed,
    venuesNotAttempted,
    notesParsed: allNoteRows.length,
    notesInserted: insertedCount,
    healthWritten,
    healthSkipped: healthUpdates.length - healthToWrite.length,
    digest: digestNotes(allNoteRows),
    writeErrors,
  };
}

// 回帰テスト（scripts/maintenance/verify-race-notices-parser.js）用に内部関数を公開する
// （scripts/daily/update-race-info.jsの_internalパターンを踏襲）
export const _internal = {
  parseInformationHtml,
  resolveRaceDate,
  parseAccidentRow,
  parseEquipmentChangeRow,
  parseAbsenceRow,
  normalizeRacerName,
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { getRaceSchedule } = await import("../lib/raceSchedule.js");
  const { getTodayDateJST, parseDateArg } = await import("../lib/dateUtils.js");
  const date = parseDateArg() || getTodayDateJST();
  const schedule = await getRaceSchedule(date);
  run(schedule, date)
    .then((result) => console.log("完了:", result))
    .catch((error) => {
      console.error("❌ エラー:", error);
      process.exit(1);
    });
}
