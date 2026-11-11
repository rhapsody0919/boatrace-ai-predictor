/**
 * Supabase データサービス
 *
 * Supabaseからデータを取得し、既存のJSON形式に変換して返す
 * Phase 2: Edge API経由でCDNキャッシュを活用
 */
import {
  getAvailableDates,
  getMorningDigest,
  getRaceHistorySummary,
  getRaces,
  getSeriesOfDate,
  getTodaysRacesForVenue,
  getUpcomingSeries,
  getVenuesWithTodaysRaces,
} from "./scheduleQueries.js";
export {
  clearCache,
  FETCH_ALL_BY_IN_ORDER,
  aggregateRacerCrossStats,
} from "./core.js";
import { getPredictions } from "./predictionQueries2.js";
import { getAccuracy, getUnifiedModelAccuracy } from "./predictionQueries3.js";
import {
  getInCautionAccuracy,
  getUnifiedTrifectaReference,
  getUnifiedVolatilityAccuracy,
} from "./predictionQueries4.js";
import {
  getCourseWinRateBaseline,
  getNationalAverageOutcomeDistribution,
  getOutcomeDistribution,
  getVenueCharacteristics,
  getVenueTechniquePeriodStats,
  getWinningTechniqueStats,
} from "./venueQueries.js";
import {
  getLosingTechniqueStats,
  getStCourseBaseline,
  getTodaysVenueRanking,
  getTopStartStats,
  getVenueDaySummary,
  getVenueFirstWinRateRanking,
} from "./venueQueries2.js";
import {
  getExhibitionTimeTopStats,
  getNigeOutcomeDistribution,
  getNigeSimulation,
  getVenueGradeBoatStats,
  getVenuesWithGradeStats,
} from "./venueQueries3.js";
import {
  getRaceEntryOfficialRatesBreakdown,
  getRaceRacerFormBreakdown,
  getRaceStPredictabilityBreakdown,
  getRaceWinnerCourses,
} from "./raceQueries.js";
import {
  getRaceEntryWeights,
  getRaceExhibitionBasics,
  getRaceExhibitionTimeBreakdown,
  getRaceOddsSnapshots,
  getRaceOfficialAvgSt,
  getRaceRacerStats,
} from "./raceQueries2.js";
import {
  getRaceEntriesDetail,
  getRaceFinalOdds,
  getRaceRacerBoatReturnRate,
  getRaceResultSummary,
  getRaceTechniqueProfileBreakdown,
} from "./raceQueries3.js";
import {
  getRaceOriginalExhibition,
  getRacePitReport,
  getRaceStartTimings,
} from "./raceQueries4.js";
import {
  getAllRacersLite,
  getAllRacersWithGrade,
  getRacerAggregatedStats,
  getRacerAllPeriodStats,
  getRacerFormSummary,
  getRacerFormTrend,
  getRacerGradeCache,
  getRacerOfficialAvgSt,
  getRacerTechniqueProfile,
} from "./racerQueries.js";
import {
  getRacerRaceHistory,
  getRacerScopedRaceStats,
  getRacerVenueStats,
} from "./racerQueries2.js";
import {
  getExhibitionTimeTrend,
  getRacerBoatReturnRate,
  getStDeviationTrend,
  getTodaysRacerFormRanking,
} from "./racerQueries3.js";
import {
  getRacerAccidentRecords,
  getRacerPeriodStats,
} from "./racerQueries4.js";
import {
  getCurrentMeetFlyingBoats,
  getMeetOriginalExhibitionByRaceBoat,
  getRaceMeetPrevRuns,
  getRacerMeetExhibitionTrendBefore,
} from "./meetQueries.js";
import { getMeetScoreboard } from "./meetQueries2.js";
import { getMeetPage } from "./meetQueries3.js";
import { getMotorGenerationStart } from "./motorQueries.js";
import {
  getMotorPowerIndex,
  getMotorUsageHistory,
  getRaceMotorFreshness,
} from "./motorQueries2.js";
import {
  getRaceMotorBreakdown,
  getVenueMotorChampionshipHistory,
  getVenueMotorSnapshot,
  getVenueMotorStats,
} from "./motorQueries3.js";
import {
  getVenueMotorList,
  getVenueMotorRanking,
  getVenueMotorRanks,
} from "./motorQueries4.js";
import {
  getMotorConditionTrend,
  getMotorRacerWakuStats,
  getMotorWakuStats,
} from "./motorQueries5.js";
import {
  getMotorPartsHistory,
  getRaceMotorMaintenanceBreakdown,
} from "./motorQueries6.js";

/**
 * Supabase データサービス
 */
export const supabaseDataService = {
  getRaces,
  getUpcomingSeries,
  getSeriesOfDate,
  getRaceWinnerCourses,
  getPredictions,
  getAccuracy,
  getAvailableDates,
  getRaceHistorySummary,
  getVenueTechniquePeriodStats,
  getVenueCharacteristics,
  getNationalAverageOutcomeDistribution,
  getOutcomeDistribution,
  getWinningTechniqueStats,
  getVenuesWithTodaysRaces,
  getTodaysRacesForVenue,
  getRaceEntryOfficialRatesBreakdown,
  getCurrentMeetFlyingBoats,
  getRaceMeetPrevRuns,
  getRaceMotorBreakdown,
  getRaceMotorFreshness,
  getMotorPowerIndex,
  getMotorUsageHistory,
  getVenueMotorStats,
  getVenueMotorChampionshipHistory,
  getVenueMotorRanking,
  getVenueMotorSnapshot,
  getVenueMotorRanks,
  getVenueMotorList,
  getMotorGenerationStart,
  getMotorWakuStats,
  getMotorRacerWakuStats,
  getRaceRacerFormBreakdown,
  getRacerFormTrend,
  getRacerFormSummary,
  getRacerTechniqueProfile,
  getRacerAggregatedStats,
  getRacerOfficialAvgSt,
  getRacerAllPeriodStats,
  getCourseWinRateBaseline,
  getAllRacersLite,
  getRacerGradeCache,
  getAllRacersWithGrade,
  getRacerVenueStats,
  getRacerScopedRaceStats,
  getRacerMeetExhibitionTrendBefore,
  getMeetOriginalExhibitionByRaceBoat,
  getRacerRaceHistory,
  getRacerBoatReturnRate,
  getMotorConditionTrend,
  getMotorPartsHistory,
  getRaceStPredictabilityBreakdown,
  getStDeviationTrend,
  getRaceExhibitionTimeBreakdown,
  getRaceMotorMaintenanceBreakdown,
  getRaceEntryWeights,
  getRaceExhibitionBasics,
  getExhibitionTimeTrend,
  getRaceRacerStats,
  getRaceOfficialAvgSt,
  getRaceOddsSnapshots,
  getRaceFinalOdds,
  getUnifiedModelAccuracy,
  getUnifiedVolatilityAccuracy,
  getInCautionAccuracy,
  getRaceEntriesDetail,
  getRaceResultSummary,
  getRaceRacerBoatReturnRate,
  getTodaysRacerFormRanking,
  getTodaysVenueRanking,
  getVenueDaySummary,
  getVenueFirstWinRateRanking,
  getRaceTechniqueProfileBreakdown,
  getTopStartStats,
  getLosingTechniqueStats,
  getStCourseBaseline,
  getMeetScoreboard,
  getMeetPage,
  getRacerPeriodStats,
  getRacerAccidentRecords,
  getNigeSimulation,
  getNigeOutcomeDistribution,
  getExhibitionTimeTopStats,
  getUnifiedTrifectaReference,
  getRaceStartTimings,
  getVenueGradeBoatStats,
  getVenuesWithGradeStats,
  getRacePitReport,
  getRaceOriginalExhibition,
  getMorningDigest,
};
