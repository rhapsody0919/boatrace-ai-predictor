調べた日: 2026-11-10

# supabaseDataService.js の参照の一覧と領域の分け方の案（BOA-1391、T6 の下調べ）

コードは変えていない。調べ方: Grep で `supabaseDataService` を `src`・`api`・`scripts`・`e2e`・`sns-video-studio`・`.github` から探した（`node_modules`・`dist`・`data` は除く）。`docs/` は範囲外なので数えない。`sns-video-studio` は当たりが 0 件。

## 表1「参照」

区分の意味:
- import: `import … from "…/supabaseDataService"` がある
- 本文を文字で読む: ファイルの本文を文字（正規表現・文字列）で読んで照らす
- 名だけ: コメント・パス・文字列に名が出るだけで、import も本文の読みも無い

「守りのファイルか」は、パスが `scripts/maintenance/verify-*`・`e2e/` の spec・`scripts/lib/` なら「はい」と読んだ（依頼の文の「以外」は誤記と判断。不明なら PR で直す）。

### 1-a. import（51件）

使う export は、特記が無ければ `supabaseDataService` だけ。呼ぶメソッドは行をまたぐ書き方（`supabaseDataService` の次の行に `.getX`）が多く、この表では数えない（表2の案を決める段で別に洗う）。本文を読む欄はすべて「-」。守りのファイルはすべて「いいえ」。

| ファイル | 区分 | 使う export |
|---|---|---|
| src/services/racerService.js | import | supabaseDataService |
| src/services/dataService.js | import | supabaseDataService・clearCache |
| src/pages/RacersPage.jsx | import | supabaseDataService |
| src/pages/MeetPage.jsx | import | supabaseDataService |
| src/hooks/useThinkingAssistData.js | import | supabaseDataService |
| src/hooks/useCurrentMeetFlyingBoats.js | import | supabaseDataService |
| src/hooks/useAiCopyText.js | import | supabaseDataService |
| src/hooks/useRaceAnalysisData.js | import | supabaseDataService |
| src/hooks/useVenueTendencyStats.js | import | supabaseDataService |
| src/hooks/useVenueRaceSelector.js | import | supabaseDataService |
| src/hooks/useFavoriteRunStats.js | import | supabaseDataService・aggregateRacerCrossStats |
| src/hooks/useSixBoatCourseStats.js | import | supabaseDataService |
| src/hooks/useUnifiedModelAccuracy.js | import | supabaseDataService |
| src/hooks/useRaceEntryFlyingRows.js | import | supabaseDataService |
| src/hooks/useUnifiedVolatilityAccuracy.js | import | supabaseDataService |
| src/components/racer/RacerPerformanceStats.jsx | import | supabaseDataService・aggregateRacerCrossStats |
| src/components/venue/VenueMeetBanner.jsx | import | supabaseDataService |
| src/components/venue/VenueCharacteristicsDetails.jsx | import | supabaseDataService |
| src/components/RacerSearchBox.jsx | import | supabaseDataService |
| src/components/AccuracyDashboard.jsx | import | supabaseDataService |
| src/components/analysis/RacerFormRankingChart.jsx | import | supabaseDataService |
| src/components/analysis/InCautionAccuracyChart.jsx | import | supabaseDataService |
| src/components/analysis/VenueGradeMatrix.jsx | import | supabaseDataService |
| src/components/analysis/VenueRankingChart.jsx | import | supabaseDataService |
| src/components/analysis/RaceCardDataTable.jsx | import | supabaseDataService |
| src/components/analysis/StPredictabilityChart.jsx | import | supabaseDataService |
| src/components/analysis/VenueMotorRanking.jsx | import | supabaseDataService |
| src/components/analysis/OutcomeDistributionTable.jsx | import | supabaseDataService |
| src/components/analysis/RacerBoatReturnRateChart.jsx | import | supabaseDataService |
| src/components/analysis/ExhibitionTimeTopChart.jsx | import | supabaseDataService |
| src/components/analysis/RacerFormChart.jsx | import | supabaseDataService |
| src/components/analysis/MotorConditionChart.jsx | import | supabaseDataService |
| src/components/analysis/LosingTechniqueChart.jsx | import | supabaseDataService |
| src/components/analysis/AttackDefenseAnalysis.jsx | import | supabaseDataService |
| src/components/analysis/TopStartChart.jsx | import | supabaseDataService |
| src/components/analysis/WinningTechniqueChart.jsx | import | supabaseDataService |
| src/components/analysis/NigeOutcomeChart.jsx | import | supabaseDataService |
| src/components/analysis/VolatilityAccuracyChart.jsx | import | supabaseDataService |
| src/components/analysis/ExhibitionTimeTrendChart.jsx | import | supabaseDataService |
| src/components/analysis/RacerTechniqueProfileChart.jsx | import | supabaseDataService |
| src/components/race/basic-info/useBasicInfoData.js | import | supabaseDataService |
| src/components/race/RaceWakuInfoTab.jsx | import | supabaseDataService |
| src/components/race/RaceOddsListTab.jsx | import | supabaseDataService |
| src/components/race/OutcomePatternPreview.jsx | import | supabaseDataService |
| src/components/race/InCautionCard.jsx | import | supabaseDataService |
| src/components/race/RaceBeforeInfoTab.jsx | import | supabaseDataService |
| src/components/race/VenueDaySummaryCard.jsx | import | supabaseDataService |
| src/components/race/RaceNumberStrip.jsx | import | supabaseDataService |
| src/components/race/RacePitReportSection.jsx | import | supabaseDataService |
| src/components/race/RaceResult.jsx | import | supabaseDataService |
| src/components/race/RaceMeetTab.jsx | import | supabaseDataService |

### 1-b. 本文を文字で読む（9件）

読み先は `src/services/supabaseDataService.js` か、`scripts/maintenance/dataLayerSource.js` の `readDataLayerSource()`（同ファイルと `core*.js`・`*Queries*.js` の和）。

| ファイル | 区分 | 使う export | 本文を読む関数名／探す語 | 守りのファイルか |
|---|---|---|---|---|
| scripts/maintenance/verify-motor-window-generation.js | 本文を文字で読む | 不明（本文の字だけ） | getMotorPowerIndex・getMotorGenerationStart ほか（getMotorUsageHistory・getVenueMotorStats 等の名も出る） | はい |
| scripts/maintenance/verify-racer-scoped-race-rows.js | 本文を文字で読む | 不明（本文の字だけ） | getRacerScopedRaceStats | はい |
| scripts/maintenance/verify-racer-entries-paging.js | 本文を文字で読む | FETCH_ALL_BY_IN_ORDER（本文の字） | getRacerVenueStats・getRacerRaceHistory・getRacerScopedRaceStats、`FETCH_ALL_BY_IN_ORDER.race_entries` | はい |
| scripts/maintenance/verify-fetch-all-by-in-order.js | 本文を文字で読む | FETCH_ALL_BY_IN_ORDER（本文の字） | fetchAllByIn・FETCH_ALL_BY_IN_ORDER（関数の領域には属さない補助） | はい |
| scripts/maintenance/verify-race-motor-breakdown.js | 本文を文字で読む | 不明（本文の字だけ） | getRaceMotorBreakdown | はい |
| scripts/maintenance/verify-meet-exclusion.js | 本文を文字で読む | 不明（本文の字だけ） | getMeetScoreboard | はい |
| scripts/maintenance/verify-meet-page-model.js | 本文を文字で読む | 不明（本文の字だけ） | getMeetPage（367行は名の一覧に `supabaseDataService` が出るだけ） | はい |
| scripts/maintenance/verify-full-picture-screen-shared.js | 本文を文字で読む | 不明（本文の字だけ） | getRacerRaceHistory・getLosingTechniqueStats・getRaceOriginalExhibition（先頭のコメントに名。実際に照らす字は不明） | はい |
| scripts/maintenance/verify-no-undef.js | 本文を文字で読む | 不明 | 旧版（#1020 の直前の master）の `src/services/supabaseDataService.js` から groupIntoCurrentMeet の未定義を検出。現行版の本文を読むかは不明 | はい |

注: `readDataLayerSource` を import する verify は上の他にもある（verify-bot-page-model・verify-motor-championship-generation・verify-jst-date-utils・verify-motor-tab-readability・verify-racer-page-shared・verify-motor-fresh-rate・verify-series-points-stage-rules・verify-race-result-usable・verify-venue-water-profiles・verify-motor-power-shared・verify-venue-payout-shared・verify-motor-waku-generation・verify-bot-race-function）。これらのファイルには `supabaseDataService` の字が無く Grep に当たらないため、表1の件数に入れない。読む関数は表2の最後の列に書いた。

### 1-c. 名だけ（45件）

| ファイル | 区分 | 使う export | 本文を読む関数名／探す語 | 守りのファイルか |
|---|---|---|---|---|
| src/services/supabaseClient.js | 名だけ | - | - | いいえ |
| src/services/racerScopedRaceRows.js | 名だけ | - | - | いいえ |
| src/services/racerRaceHistoryRows.js | 名だけ | - | - | いいえ |
| src/services/analogyService.js | 名だけ | - | - | いいえ |
| src/pure/meetExclusion.js | 名だけ | - | - | いいえ |
| src/pure/raceMotorBreakdown.js | 名だけ | - | - | いいえ |
| src/utils/venuePlaceRates.js | 名だけ | - | - | いいえ |
| src/utils/meetPageModel.js | 名だけ | - | - | いいえ |
| src/utils/losingTechnique.js | 名だけ | - | - | いいえ |
| src/utils/meetGrouping.js | 名だけ | - | - | いいえ |
| src/utils/todayRaces.js | 名だけ | - | - | いいえ |
| src/utils/motorPowerIndex.js | 名だけ | - | - | いいえ |
| src/utils/venuePayoutStats.js | 名だけ | - | - | いいえ |
| src/utils/originalExhibition.js | 名だけ | - | - | いいえ |
| src/utils/racerVenueBoatStats.js | 名だけ | - | - | いいえ |
| src/components/race/basicInfoStats.js | 名だけ | - | - | いいえ |
| src/components/race/startFormation.js | 名だけ | - | - | いいえ |
| src/components/race/raceIndicators.jsx | 名だけ | - | - | いいえ |
| api/accuracy/index.js | 名だけ | - | - | いいえ |
| api/_lib/botToday.js | 名だけ | - | - | いいえ |
| api/_lib/botRace.js | 名だけ | - | - | いいえ |
| e2e/race-entrants-strip.spec.js | 名だけ | - | - | はい |
| e2e/home-sg-now-banner.spec.js | 名だけ | - | - | はい |
| e2e/racer-scoped-stub.js | 名だけ | - | - | いいえ（spec ではない） |
| .github/workflows/e2e-rerecord.yml | 名だけ | - | - | いいえ |
| scripts/maintenance/dependency-rules.cjs | 名だけ（パスの正規表現） | - | `^src/services/supabaseDataService\.js$` | いいえ |
| scripts/maintenance/verify-dependency-rules.js | 名だけ（パスの文字列） | - | - | はい |
| scripts/maintenance/lintBaselines.js | 名だけ（パスの定数 FACADE） | - | - | いいえ |
| scripts/maintenance/dataLayerSource.js | 名だけ（MAIN のファイル名） | - | - | いいえ |
| scripts/maintenance/verify-pr-lane.js | 名だけ（試験データのパス） | - | - | はい |
| scripts/maintenance/verify-ai-copy-text.js | 名だけ（esbuild の onResolve で import を差し替える） | supabaseDataService（差し替えの偽物が export） | getRaceOriginalExhibition（偽物の中身） | はい |
| scripts/maintenance/verify-registry.json | 名だけ | - | - | いいえ |
| scripts/maintenance/verify-venue-place-rates.js | 名だけ | - | - | はい |
| scripts/maintenance/verify-display-coverage.js | 名だけ（`supabaseDataService.js:1328` の行参照） | - | - | はい |
| scripts/maintenance/generate-display-coverage.js | 名だけ（行参照） | - | - | いいえ |
| scripts/maintenance/verify-rpc-output-keys.js | 名だけ | - | - | はい |
| scripts/maintenance/verify-rpc-key-regression.js | 名だけ | - | - | はい |
| scripts/maintenance/verify-query-errors.js | 名だけ | - | - | はい |
| scripts/maintenance/verify-absent-start-rows.js | 名だけ | - | getStDeviationTrend・getRaceStPredictabilityBreakdown（コメントの名。本文を読むかは不明） | はい |
| scripts/maintenance/verify-rank-data-screen-parity.js | 名だけ | - | - | はい |
| scripts/maintenance/verify-api-query-lockdown.js | 名だけ | - | - | はい |
| scripts/maintenance/fix-opening-day-race-id-date.js | 名だけ | - | - | いいえ |
| scripts/daily/generate-predictions.js | 名だけ | - | - | いいえ |
| scripts/lib/raceIndicatorData.js | 名だけ | - | - | はい |
| scripts/analysis/full-picture-boat1-return/analyze-boat1-return-rate-noise.mjs | 名だけ | - | - | いいえ |

### 件数

- 1-a: 51 + 1-b: 9 + 1-c: 45 = 105 件。これに自分自身 `src/services/supabaseDataService.js`（1368行の定義）を足すと Grep の当たりは 106 ファイル（`.maker-brief.md` は範囲外）。
- 照合: 同じ範囲の Grep の結果は 106 ファイル（264 箇所）で、表の 105 件＋自分自身 1 件と一致した。
- `aggregateRacerCrossStats` の import は 2 件（useFavoriteRunStats・RacerPerformanceStats）、`clearCache` の import は 1 件（dataService.js。ほかは `dataService.clearCache()` を呼ぶ App.jsx・VenueGridPage.jsx で、本ファイルを直接は参照しない）、`FETCH_ALL_BY_IN_ORDER` を import するファイルは 0 件（本文の字として読む verify が 2 件）。

## 表2「関数の領域」

案（分け方は未決定）。`export const supabaseDataService = {` は 1368 行から 8015 行の `};` まで。2 スペースのメソッドは 89 個（regex `^  (async )?名\(` で数えた。`名: () =>` の形は無いことを確認していない。ここに出ない形があれば「不明」）。名の頭で分けた。メソッドは領域ごとにまとまっていないので、行の範囲は「その領域の最初と最後のメソッドの開始行」で、間に他の領域が混ざる。

| 領域 | メソッドの数 | 行の範囲（開始行） | 名の頭・メンバー | その領域の本文を文字で読む verify |
|---|---|---|---|---|
| A 一覧・節・予想・的中 | 8 | 1373–1975（連続） | getRaces・getUpcomingSeries・getSeriesOfDate・getRaceWinnerCourses・getPredictions・getAccuracy・getAvailableDates・getRaceHistorySummary | 不明（verify-bot-page-model・verify-bot-race-function が readDataLayerSource を読むが、出る名は getSeriesOfDate・getRaces のみで自前の関数との区別は未確認） |
| B 会場・今日 | 10 | 2018–7800 | getVenueTechniquePeriodStats・getVenueCharacteristics・getVenuesWithTodaysRaces・getTodaysRacesForVenue・getTodaysRacerFormRanking・getTodaysVenueRanking・getVenueDaySummary・getVenueFirstWinRateRanking・getVenueGradeBoatStats・getVenuesWithGradeStats | verify-venue-payout-shared（getTodaysVenueRanking・getVenueDaySummary）・verify-venue-water-profiles（getVenueCharacteristics） |
| C モーター | 16 | 2640–5380 | getRaceMotorBreakdown・getRaceMotorFreshness・getRaceMotorMaintenanceBreakdown・getMotor*（PowerIndex・UsageHistory・GenerationStart・WakuStats・RacerWakuStats・ConditionTrend・PartsHistory）・getVenueMotor*（Stats・ChampionshipHistory・Ranking・Snapshot・Ranks・List） | verify-motor-window-generation・verify-motor-championship-generation・verify-motor-waku-generation・verify-motor-power-shared・verify-motor-tab-readability・verify-motor-fresh-rate・verify-race-motor-breakdown |
| D 選手 | 16 | 3984–7512 | getRacer*（FormTrend・FormSummary・TechniqueProfile・AggregatedStats・OfficialAvgSt・AllPeriodStats・GradeCache・VenueStats・ScopedRaceStats・MeetExhibitionTrendBefore・RaceHistory・BoatReturnRate・PeriodStats・AccidentRecords）・getAllRacersLite・getAllRacersWithGrade | verify-racer-scoped-race-rows・verify-racer-entries-paging・verify-racer-page-shared・verify-full-picture-screen-shared（getRacerRaceHistory） |
| E レース詳細 | 16 | 2358–7909 | getRace*（RacerFormBreakdown・EntryOfficialRatesBreakdown・MeetPrevRuns・StPredictabilityBreakdown・ExhibitionTimeBreakdown・EntryWeights・ExhibitionBasics・RacerStats・OfficialAvgSt・EntriesDetail・ResultSummary・RacerBoatReturnRate・TechniqueProfileBreakdown・StartTimings・PitReport・OriginalExhibition） | verify-full-picture-screen-shared（getRaceOriginalExhibition）。verify-absent-start-rows は名がコメントに出るだけで本文を読むかは不明。verify-race-result-usable は読む関数が不明 |
| F オッズ | 3 | 5651–7701 | getRaceOddsSnapshots・getRaceFinalOdds・getUnifiedTrifectaReference | 見つからず（名が出る verify なし） |
| G 節 | 4 | 2396–7238 | getMeetScoreboard・getMeetPage・getMeetOriginalExhibitionByRaceBoat・getCurrentMeetFlyingBoats | verify-meet-exclusion・verify-meet-page-model。verify-series-points-stage-rules は getMeetScoreboard の名が出る（読み方は不明） |
| H 展示・ST | 5 | 5172–7675 | getExhibitionTimeTrend・getExhibitionTimeTopStats・getStDeviationTrend・getStCourseBaseline・getTopStartStats | 不明（verify-absent-start-rows が getStDeviationTrend の名を出すが本文を読むか未確認） |
| I 傾向・決まり手 | 7 | 2079–7580 | getOutcomeDistribution・getNationalAverageOutcomeDistribution・getWinningTechniqueStats・getLosingTechniqueStats・getNigeSimulation・getNigeOutcomeDistribution・getCourseWinRateBaseline | verify-venue-water-profiles（getNationalAverageOutcomeDistribution）・verify-full-picture-screen-shared（getLosingTechniqueStats） |
| J 精度・朝のまとめ | 4 | 5785–7969 | getUnifiedModelAccuracy・getUnifiedVolatilityAccuracy・getInCautionAccuracy・getMorningDigest | 見つからず（名が出る verify なし） |
| 計 | 89 | 1373–7969 | | |

領域に属さない（全体を読む）もの: verify-fetch-all-by-in-order（fetchAllByIn・FETCH_ALL_BY_IN_ORDER、いずれもメソッドの外の補助）、verify-jst-date-utils（読む語は不明）、verify-no-undef（旧版の未定義の名の検出）。メソッドの外の補助（`clearCache`・`FETCH_ALL_BY_IN_ORDER`・`fetchAllByIn`・`aggregateRacerCrossStats`（8083行））は表2に入れない。
