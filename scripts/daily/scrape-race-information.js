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
 * detail_text の組み合わせにUNIQUE制約を張り、10分間隔の再取得で同じ行を
 * 何度取得してもエラーにならない（ignoreDuplicates upsert）設計にする。
 *
 * 構造変化監視: scripts/lib/venueMotorStats/driftHealth.js のコアロジック
 * （updateVenueHealth）を再利用する。Vercel Function（api/cron/race-notices.js）
 * は10分間隔で実行されファイルシステムへの永続化・git commitができないため、
 * 会場×日付単位の当日集計を race_notices_health テーブルに保存し、
 * scripts/maintenance/check-race-notices-drift.js（GitHub Actions日次実行）が
 * 直近日数分を畳み込んで連続失敗日数を判定する。
 */

import * as cheerio from "cheerio";
import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";

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
async function fetchInformationPage(venueCode, dateYmd) {
  const jcd = String(venueCode).padStart(2, "0");
  const url = `https://www.boatrace.jp/owpc/pc/race/information?rno=1&jcd=${jcd}&hd=${dateYmd}`;

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
async function buildRacerNameMap() {
  const map = new Map();
  if (!isSupabaseEnabled()) return map;

  // racer_profilesは約1,627行あり、PostgRESTのデフォルト上限（1000行）を
  // 超えるため fetchAll() でページネーションする（.range()無しの単発selectだと
  // 後半の選手が対応表から漏れ、racer_idが解決できなくなる）
  const data = await fetchAll("racer_profiles", "racer_id,name");

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

async function getExistingDailyHealth(venueCodes, checkDate) {
  const map = new Map();
  if (venueCodes.length === 0) return map;
  const { data, error } = await supabase
    .from("race_notices_health")
    .select("venue_code,had_success,last_reason")
    .eq("check_date", checkDate)
    .in("venue_code", venueCodes);
  if (error) {
    console.error("⚠️ race_notices_health取得エラー:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    map.set(row.venue_code, row);
  }
  return map;
}

/**
 * @param {Array<{race_id: string, venue_code: number, race_no: number, start_time: Date}>} schedule
 * @param {string} date - YYYY-MM-DD
 */
export async function run(schedule, date) {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    return { updated: false, count: 0 };
  }

  const venueCodes = [...new Set(schedule.map((r) => r.venue_code))].sort(
    (a, b) => a - b,
  );
  if (venueCodes.length === 0) {
    console.log("📭 レース特記事項: 本日の開催会場なし");
    return { updated: false, count: 0 };
  }

  const dateYmd = date.replace(/-/g, "");
  const racerNameMap = await buildRacerNameMap();
  const existingHealth = await getExistingDailyHealth(venueCodes, date);

  const allNoteRows = [];
  const healthUpdates = [];

  for (const venueCode of venueCodes) {
    const { html, reason: fetchReason } = await fetchInformationPage(
      venueCode,
      dateYmd,
    );

    let outcome;
    if (!html) {
      outcome = { success: false, reason: fetchReason };
    } else {
      const { notes, reason: parseReason } = parseInformationHtml(
        html,
        dateYmd,
      );
      // parseReasonが立っている場合（見出し自体が見つからない、または3区分
      // 揃わない）は構造変化の疑いとして必ず失敗扱いにする。notesが空配列でも
      // nullでなければ「取得自体は成功」と誤判定してしまうバグを防ぐ
      // （notes !== null だけを見るとunexpected_section_countを握りつぶす）
      outcome = { success: parseReason === null, reason: parseReason };
      for (const note of notes ?? []) {
        const racerId =
          racerNameMap.get(normalizeRacerName(note.racerName)) ?? null;
        allNoteRows.push({
          venue_code: venueCode,
          race_date: note.raceDate,
          category: note.category,
          racer_id: racerId,
          boat_number: null, // 情報ページ自体には艇番の記載がないため未実装（将来race_entries突き合わせで補完可）
          detail_text: note.detailText,
          structured_data: {
            ...note.structuredData,
            racerName: note.racerName,
          },
        });
      }
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
      console.log(`  ⚠️ 会場${venueCode}: ${outcome.reason}`);
    } else if (allNoteRows.length > 0) {
      console.log(`  📝 会場${venueCode}: 通知あり`);
    }
  }

  let insertedCount = 0;
  if (allNoteRows.length > 0) {
    const { data, error } = await supabase
      .from("race_special_notes")
      .upsert(allNoteRows, {
        onConflict: "venue_code,race_date,category,detail_text",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      console.error("❌ race_special_notes 書き込みエラー:", error.message);
    } else {
      insertedCount = data?.length ?? 0;
    }
  }

  if (healthUpdates.length > 0) {
    const { error } = await supabase
      .from("race_notices_health")
      .upsert(healthUpdates, { onConflict: "venue_code,check_date" });
    if (error) {
      console.error("❌ race_notices_health 書き込みエラー:", error.message);
    }
  }

  console.log(
    `📊 レース特記事項: ${venueCodes.length}会場チェック、${insertedCount}件新規保存`,
  );
  return { updated: insertedCount > 0, count: insertedCount };
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
