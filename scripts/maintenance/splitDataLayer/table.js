/**
 * splitDataLayer/table.js - 振り分けの表と名前の決まり（scripts/maintenance/split-data-layer.mjs、BOA-1432）。
 * 設計: hq の drafts/ryujin-target-architecture-20261110.md §3。表に無いメソッド・表にあって元に無いメソッドがあれば止める
 */
export const MAX_LINES = 400;
export const SERVICE_FILE = "supabaseDataService.js";
export const SERVICE_OBJECT = "supabaseDataService";
// 別の領域から読んでよい領域（scripts/maintenance/dependency-rules.cjs の domain-direct の pathNot と同じ）
export const SHARED_AREAS = ["prediction", "meet"];

// メソッドの振り分け（判断: getStDeviationTrend・getExhibitionTimeTrend・getTodaysRacerFormRanking→racer、
// getRaceMotorMaintenanceBreakdown→motor、getRacerMeetExhibitionTrendBefore→meet）。上の単位は表に持たず使うメソッドから導く
export const METHOD_TABLE = {
  core: [],
  schedule: [
    "getRaces",
    "getUpcomingSeries",
    "getSeriesOfDate",
    "getAvailableDates",
    "getRaceHistorySummary",
    "getVenuesWithTodaysRaces",
    "getTodaysRacesForVenue",
    "getMorningDigest",
  ],
  venue: [
    "getVenueTechniquePeriodStats",
    "getVenueCharacteristics",
    "getNationalAverageOutcomeDistribution",
    "getOutcomeDistribution",
    "getWinningTechniqueStats",
    "getCourseWinRateBaseline",
    "getTodaysVenueRanking",
    "getVenueDaySummary",
    "getVenueFirstWinRateRanking",
    "getTopStartStats",
    "getLosingTechniqueStats",
    "getStCourseBaseline",
    "getNigeSimulation",
    "getNigeOutcomeDistribution",
    "getExhibitionTimeTopStats",
    "getVenueGradeBoatStats",
    "getVenuesWithGradeStats",
  ],
  prediction: [
    "getPredictions",
    "getAccuracy",
    "getUnifiedModelAccuracy",
    "getUnifiedVolatilityAccuracy",
    "getInCautionAccuracy",
    "getUnifiedTrifectaReference",
  ],
  race: [
    "getRaceWinnerCourses",
    "getRaceEntryOfficialRatesBreakdown",
    "getRaceRacerFormBreakdown",
    "getRaceStPredictabilityBreakdown",
    "getRaceExhibitionTimeBreakdown",
    "getRaceEntryWeights",
    "getRaceExhibitionBasics",
    "getRaceRacerStats",
    "getRaceOfficialAvgSt",
    "getRaceOddsSnapshots",
    "getRaceFinalOdds",
    "getRaceEntriesDetail",
    "getRaceResultSummary",
    "getRaceRacerBoatReturnRate",
    "getRaceTechniqueProfileBreakdown",
    "getRaceStartTimings",
    "getRacePitReport",
    "getRaceOriginalExhibition",
  ],
  racer: [
    "getRacerFormTrend",
    "getRacerFormSummary",
    "getRacerTechniqueProfile",
    "getRacerAggregatedStats",
    "getRacerOfficialAvgSt",
    "getRacerAllPeriodStats",
    "getAllRacersLite",
    "getRacerGradeCache",
    "getAllRacersWithGrade",
    "getRacerVenueStats",
    "getRacerScopedRaceStats",
    "getRacerRaceHistory",
    "getRacerBoatReturnRate",
    "getStDeviationTrend",
    "getExhibitionTimeTrend",
    "getTodaysRacerFormRanking",
    "getRacerPeriodStats",
    "getRacerAccidentRecords",
  ],
  meet: [
    "getCurrentMeetFlyingBoats",
    "getRaceMeetPrevRuns",
    "getRacerMeetExhibitionTrendBefore",
    "getMeetOriginalExhibitionByRaceBoat",
    "getMeetScoreboard",
    "getMeetPage",
  ],
  motor: [
    "getRaceMotorBreakdown",
    "getRaceMotorFreshness",
    "getMotorPowerIndex",
    "getMotorUsageHistory",
    "getVenueMotorStats",
    "getVenueMotorChampionshipHistory",
    "getVenueMotorRanking",
    "getVenueMotorSnapshot",
    "getVenueMotorRanks",
    "getVenueMotorList",
    "getMotorGenerationStart",
    "getMotorWakuStats",
    "getMotorRacerWakuStats",
    "getMotorConditionTrend",
    "getMotorPartsHistory",
    "getRaceMotorMaintenanceBreakdown",
  ],
};
export const AREAS = Object.keys(METHOD_TABLE);

// core は core.js・core2.js…、ほかは <領域>Queries.js・<領域>Queries2.js…（意味の名前は付けない）。
// core を *Queries* にしないのは domain-direct が core を別の領域と数えないようにするため
export function fileNameOf(area, index) {
  const n = index === 0 ? "" : String(index + 1);
  return area === "core" ? `core${n}.js` : `${area}Queries${n}.js`;
}

// 出したファイルの名前（"./x.js" でも可）から領域。出したファイルでなければ null
export function areaOfFile(source) {
  const base = source.replace(/^\.\//, "");
  if (/^core[0-9]*\.js$/.test(base)) return "core";
  const m = /^([A-Za-z]+)Queries[0-9]*\.js$/.exec(base);
  return m ? m[1] : null;
}
