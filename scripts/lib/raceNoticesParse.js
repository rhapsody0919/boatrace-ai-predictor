// レース特記事項のページ（race/information）の解析の純関数。scrape-race-information.js から移した（中身は元のまま）。
// DB・ファイル・ネットワークに触れない
import * as cheerio from "cheerio";

const NO_NOTICE_TEXT = "現在、お知らせはありません";

const CATEGORY_LABELS = {
  "事故・内規違反・減点": "accident",
  "モーター・ボート変更": "equipment_change",
  "欠場・帰郷": "absence",
};
const EXPECTED_CATEGORY_COUNT = Object.keys(CATEGORY_LABELS).length;

/**
 * 「MM/DD」文字列と基準日（YYYYMMDD）から実際の日付（YYYY-MM-DD）を復元する。
 * 節が年をまたぐ場合（12月開催の節が1月まで続く等）、基準日が1月で行がの
 * 月が12月なら前年と判定する。それ以外は基準年をそのまま使う
 * （行の月が基準月より後＝来年、というケースは実運用上ほぼ起きないため
 * 未対応。発生した場合はconsole.warnで気づけるようにする）
 */
export function resolveRaceDate(mmddText, baseDateYmd) {
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

export function parseAccidentRow(cells) {
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

export function parseEquipmentChangeRow(cells) {
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

export function parseAbsenceRow(cells) {
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
 * rowsUnparsed: 通知の表に行（セルあり）があるのに、行の解析・日付の解決に失敗して捨てた行数（BOA-373）。
 * 「通知なし」と「行はあるが読めない（構造変化・未知の書式）」を区別するために数える
 * @returns {{notes: Array|null, reason: string|null, rowsUnparsed: number}}
 */
export function parseInformationHtml(html, dateYmd) {
  const $ = cheerio.load(html);
  const sections = $(".title7_mainLabel");
  if (sections.length === 0) {
    return { notes: null, reason: "notice_section_not_found", rowsUnparsed: 0 };
  }

  const notes = [];
  let matchedCategories = 0;
  let rowsUnparsed = 0;

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
      const raceDate = parsed
        ? resolveRaceDate(parsed.dateText, dateYmd)
        : null;
      if (!raceDate) {
        rowsUnparsed++;
        return;
      }

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
    return { notes, reason: "unexpected_section_count", rowsUnparsed };
  }
  return { notes, reason: null, rowsUnparsed };
}
