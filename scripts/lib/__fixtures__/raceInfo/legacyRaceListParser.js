/**
 * 出走表ページの旧解析（凍結。新しい解析 scripts/lib/raceListParser.js との互換確認だけに使う）
 *
 * scripts/daily/update-race-info.js の scrapeRacers・scrapeRaceMeta・scrapeSeriesDay を、全項目化の前の
 * まま写したもの（2026-09-21時点の master）。変更しない。scripts/maintenance/verify-pre-race-parsers.js が、
 * 新しい解析と、既存の列の値が変わっていないことを比べる。
 */

import { normalizeText } from "../../venueMotorStats/parserUtils.js";
import { scrapeRaceStage } from "../../raceStageParser.js";

export function legacyScrapeRacers($) {
  const racers = [];
  $(".table1 tbody.is-fs12").each((index, tbody) => {
    if (index >= 6) return false;
    const $tbody = $(tbody);

    const name = $tbody.find(".is-fs18.is-fBold a").text().trim();
    const $fs11Divs = $tbody.find(".is-fs11");

    const gradeText = $fs11Divs.eq(0).text().trim();
    const racerIdMatch = gradeText.match(/^(\d+)/);
    const racerId = racerIdMatch ? parseInt(racerIdMatch[1]) : null;
    const gradeMatch = gradeText.match(/\s*\/\s*([AB][12])/);
    const grade = gradeMatch ? gradeMatch[1] : null;

    const ageText = $fs11Divs.eq(1).text().trim();
    const ageMatch = ageText.match(/(\d+)歳/);
    const age = ageMatch ? parseInt(ageMatch[1]) : null;

    const $stats = $tbody.find("td.is-lineH2");

    const globalStats = $stats
      .eq(1)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const localStats = $stats
      .eq(2)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const motorStats = $stats
      .eq(3)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const boatStats = $stats
      .eq(4)
      .text()
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const toFloat = (s) => {
      const v = parseFloat(s);
      return isNaN(v) ? null : v;
    };
    const toInt = (s) => {
      const v = parseInt(s, 10);
      return isNaN(v) ? null : v;
    };

    racers.push({
      boatNumber: index + 1,
      racerId,
      playerName: name || null,
      grade,
      age,
      winRate: toFloat(globalStats[0]),
      localWinRate: toFloat(localStats[0]),
      global2Rate: toFloat(globalStats[1]),
      local2Rate: toFloat(localStats[1]),
      global3Rate: toFloat(globalStats[2]),
      local3Rate: toFloat(localStats[2]),
      motorNumber: toInt(motorStats[0]),
      motor2Rate: toFloat(motorStats[1]),
      motor3Rate: toFloat(motorStats[2]),
      boatNumberId: toInt(boatStats[0]),
      boat2Rate: toFloat(boatStats[1]),
      boat3Rate: toFloat(boatStats[2]),
    });
  });
  return racers;
}

export function legacyScrapeRaceMeta($) {
  const raceGrade = (() => {
    const el = $(".heading2_title");
    if (!el.length) return null;
    const cls = (el.attr("class") || "").toLowerCase();
    if (cls.includes("is-sg")) return "SG";
    if (cls.includes("is-g1")) return "G1";
    if (cls.includes("is-g2")) return "G2";
    if (cls.includes("is-g3")) return "G3";
    return "ippan";
  })();
  const raceTitle = $(".heading2_titleName").text().trim() || null;
  const raceStage = scrapeRaceStage($);
  const { seriesDay, isFinalDay } = legacyScrapeSeriesDay($);
  return { raceGrade, raceTitle, raceStage, seriesDay, isFinalDay };
}

export function legacyScrapeSeriesDay($) {
  const tabs = $(".tab2_inner");
  const totalDays = tabs.length;
  if (totalDays === 0) return { seriesDay: null, isFinalDay: null };

  let label = null;
  tabs.each((i, el) => {
    const $el = $(el);
    if ($el.closest("li").hasClass("is-active2")) {
      label = $el.find("span").first().text().trim();
      return false;
    }
  });
  if (!label) return { seriesDay: null, isFinalDay: null };

  const isFinalDay = label === "最終日";
  let seriesDay = null;
  if (label === "初日") {
    seriesDay = 1;
  } else if (isFinalDay) {
    seriesDay = totalDays;
  } else {
    const match = label.match(/([０-９]+)日目/);
    if (match) {
      const n = parseInt(normalizeText(match[1]), 10);
      seriesDay = isNaN(n) ? null : n;
    }
  }

  return { seriesDay, isFinalDay };
}
