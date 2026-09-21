/**
 * 開催場一覧（race/index）と結果ページ（raceresult）から、中止・順延の告知を読み取る純粋関数。
 * DB・取得先には接続しない。検証: scripts/maintenance/verify-race-status-job.js
 * 設計: docs/design/scraping-vercel-consolidation/postponed-day-early-detection.md
 *
 * 実ページ（2026-09-21）で確認した表記:
 *   race/index?hd=YYYYMMDD の会場ごとの行の状態欄（td.is-attentionColor1 または 通常の発売状況）
 *     "中止順延"            日全体の順延（戸田・江戸川）
 *     "5R以降中止順延"       5R以降が順延（津。1〜4Rは実施済み）
 *     "10R以降中止"          10R以降が中止（三国）
 *     "1R以降発売中" "最終Ｒ発売終了" 等は通常の発売状況（中止ではない）
 *   raceresult の見出し（h3.title12_title）
 *     "レース中止"           中止・順延のレース（発走予定時刻の前でも表示される）
 *     "※ データはありません。"  まだ結果が無い通常のレース
 * 日付タブの「順延」（racelist・beforeinfo・raceresult 共通）は、津のように前半を実施した日でも付くため、
 * 「そのレースが中止」の根拠にはしない（設計書の却下案を参照）。
 */
import * as cheerio from "cheerio";

const pad2 = (n) => String(n).padStart(2, "0");

/** 開催場一覧のURL（date は YYYY-MM-DD） */
export function raceIndexUrl(date) {
  return `https://www.boatrace.jp/owpc/pc/race/index?hd=${date.replaceAll("-", "")}`;
}

/** 結果ページのURL（date は YYYY-MM-DD） */
export function raceResultUrl(venueCode, raceNumber, date) {
  return `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${raceNumber}&jcd=${pad2(venueCode)}&hd=${date.replaceAll("-", "")}`;
}

// NFKC で全角のＲ・数字を半角にそろえてから照合する
const WHOLE_DAY_RE = /^(?:中止順延|中止|順延)$/;
const FROM_RACE_RE = /^(\d{1,2})R以降(?:中止順延|中止|順延)$/;

/**
 * 状態欄の文言を分類する。
 *
 * @param {string} rawText
 * @returns {{kind: "cancelled_from", fromRace: number}|{kind: "none"}|{kind: "unrecognized"}}
 *   cancelled_from: fromRace（1〜12）以降のレースが中止・順延（日全体は 1）。
 *   unrecognized: 「中止」「順延」を含むが、既知の形ではない（人が確認する。何も確定しない）。
 *   none: 中止・順延の告知ではない（発売中・発売終了・空欄 等）
 */
export function classifyStatusText(rawText) {
  const text = String(rawText ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
  if (WHOLE_DAY_RE.test(text)) return { kind: "cancelled_from", fromRace: 1 };
  const m = FROM_RACE_RE.exec(text);
  if (m) {
    const fromRace = Number(m[1]);
    if (fromRace >= 1 && fromRace <= 12) {
      return { kind: "cancelled_from", fromRace };
    }
    return { kind: "unrecognized" };
  }
  if (/中止|順延/.test(text)) return { kind: "unrecognized" };
  return { kind: "none" };
}

/**
 * 開催場一覧ページから、会場ごとの中止・順延の告知を読み取る。
 * 会場は、行内のリンクの jcd（会場コード）で識別する（表示名・画像に依存しない）。
 *
 * @param {string} html race/index の HTML
 * @returns {Array<{venueCode: number, statusText: string, status: ReturnType<typeof classifyStatusText>}>}
 *   ページに載っている全会場（中止・順延でない会場も含む）。1件も読めなければ空配列
 *   （呼び出し側が、構造の変化として失敗にする）
 */
export function parseVenueStatuses(html) {
  const $ = cheerio.load(html);
  const venues = [];
  const seen = new Set();
  $("tbody").each((_, tbody) => {
    const firstRow = $(tbody).find("tr").first();
    // 会場の行は、先頭のセルに会場ロゴのリンク（javascript:MultiOpen(...)）を持つ
    if (firstRow.find("td.is-arrow1").length === 0) return;
    const href = $(tbody).find('a[href*="jcd="]').first().attr("href") ?? "";
    const jcd = /[?&]jcd=(\d{2})/.exec(href)?.[1];
    if (!jcd) return;
    const venueCode = Number(jcd);
    if (seen.has(venueCode)) return;
    seen.add(venueCode);
    // 状態欄は、ロゴのセルの次のセル（colspan=3 の告知、または発売状況）
    const statusText = firstRow
      .children("td")
      .eq(1)
      .text()
      .replace(/\s+/g, " ")
      .trim();
    venues.push({
      venueCode,
      statusText,
      status: classifyStatusText(statusText),
    });
  });
  return venues;
}

/**
 * 結果ページが「レース中止」の表示か。見出し（h3.title12_title）が「レース中止」のときだけ true。
 * 「※ データはありません。」（まだ結果が無い通常のレース）や、結果の表が載っているページは false。
 *
 * @param {string} html raceresult の HTML
 */
export function isRaceCancelledPage(html) {
  const $ = cheerio.load(html);
  return $("h3.title12_title")
    .map((_, el) => $(el).text().replace(/\s+/g, ""))
    .get()
    .some((text) => text === "レース中止");
}
