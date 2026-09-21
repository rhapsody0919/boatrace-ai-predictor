/**
 * 直前情報ページの展示データの旧解析（凍結。新しい解析 scripts/lib/beforeInfoParser.js との互換確認だけに使う）
 *
 * scripts/daily/scrape-exhibition-data.js の scrapeExhibitionData・parseStartTimingText を、全項目化の前の
 * まま写したもの（2026-09-21時点の master）。変更しない。scripts/maintenance/verify-pre-race-parsers.js が、
 * 新しい解析と、既存の列の値が変わっていないことを比べる。
 */

import { toIntOrNull } from "../../venueMotorStats/parserUtils.js";

function parseStartTimingText(text) {
  if (!text) return { value: null, isFlying: false };
  const isFlying = text.includes("F");
  const numMatch = text.match(/[FL]?\.(\d+)/);
  const value = numMatch ? parseFloat("0." + numMatch[1]) : null;
  return { value, isFlying };
}

export function legacyScrapeExhibitionData($) {
  const exhibitionData = [];
  const tables = $(".table1");
  if (tables.length < 2) {
    return { data: null, reason: `tables_lt_2 (found ${tables.length})` };
  }

  const exTable = tables.eq(1);
  const tbodies = exTable.find("tbody");

  tbodies.each((i, tbody) => {
    if (i >= 6) return;
    const rows = $(tbody).find("tr");
    if (rows.length < 1) return;

    const mainCells = rows.eq(0).find("td");
    const boatNumber = parseInt(mainCells.eq(0).text().trim());
    const todayWeight = parseFloat(mainCells.eq(3).text().trim());
    const exhibitionTime = parseFloat(mainCells.eq(4).text().trim());
    const tilt = parseFloat(mainCells.eq(5).text().trim());
    const propellerText = mainCells.eq(6).text().trim();
    const partsChanged = mainCells
      .eq(7)
      .find("li")
      .map((_, li) => $(li).text().trim())
      .get()
      .filter(Boolean);
    const prevRaceNo = parseInt(mainCells.eq(9).text().trim());
    const adjustmentWeight = parseFloat(
      rows.eq(2).find("td").eq(0).text().trim(),
    );
    const prevEntryCourse = parseInt(rows.eq(1).find("td").eq(1).text().trim());
    const prevStartTimingText = rows.eq(2).find("td").eq(2).text().trim();
    const { value: prevStartTiming } =
      parseStartTimingText(prevStartTimingText);
    const prevFinishRankText = rows.eq(3).find("td").eq(1).text().trim();
    const prevFinishRank = toIntOrNull(prevFinishRankText);

    if (boatNumber >= 1 && boatNumber <= 6) {
      exhibitionData.push({
        boatNumber,
        exhibitionTime:
          !isNaN(exhibitionTime) && exhibitionTime > 0 ? exhibitionTime : null,
        startTiming: null,
        tilt: !isNaN(tilt) ? tilt : null,
        propellerChange: propellerText || null,
        partsChanged: partsChanged.length > 0 ? partsChanged : null,
        adjustmentWeight: !isNaN(adjustmentWeight) ? adjustmentWeight : null,
        todayWeight:
          !isNaN(todayWeight) && todayWeight > 0 ? todayWeight : null,
        prevRaceNo: !isNaN(prevRaceNo) ? prevRaceNo : null,
        prevEntryCourse: !isNaN(prevEntryCourse) ? prevEntryCourse : null,
        prevStartTiming,
        prevFinishRank,
      });
    }
  });

  if (exhibitionData.length === 0) {
    return { data: null, reason: `no_boats (tbodies=${tbodies.length})` };
  }

  if (tables.length >= 3) {
    const startTable = tables.eq(2);
    startTable.find(".table1_boatImage1").each((i, el) => {
      const boatText =
        $(el).find(".table1_boatImage1Number").text().trim() ||
        $(el).text().trim().split("\n")[0].trim();
      const boatNum = parseInt(boatText);

      const stText = $(el).find(".table1_boatImage1Time").text().trim();
      const { value: stValue, isFlying } = parseStartTimingText(stText);

      if (boatNum >= 1 && boatNum <= 6 && stValue !== null) {
        const entry = exhibitionData.find((e) => e.boatNumber === boatNum);
        if (entry) {
          entry.startTiming = stValue;
          entry.isFlying = isFlying;
        }
      }
    });
  }

  const hasData = exhibitionData.some(
    (e) => e.exhibitionTime !== null || e.startTiming !== null,
  );
  if (!hasData) {
    return { data: null, reason: `no_values (boats=${exhibitionData.length})` };
  }
  return { data: exhibitionData, reason: null };
}
