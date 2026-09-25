# 共通ロジックの索引

**このファイルは `scripts/maintenance/generate-lib-index.js` が生成する。手で編集しない。**
内容がソースとずれていると `npm run verify:lib-index` がCIで落ちる。

## 使い方

新しいヘルパー・ユーティリティを書く前にここを引く。
同じ問題を解く関数が既にある場合が多く、実測では「既存実装を知らずに再実装した」
fixが2026-08-15以降で26件あった（うち何件かは同一ファイル内に既にあった）。

名前で当たりをつけてファイルを開く、という使い方を想定している。
関数ごとの引数・戻り値はソースのJSDocを見ること。

## scripts/lib — バッチ・取得・集計の共通ロジック

日次バッチ・スクレイピング・Vercel Cron から使う。DBに触れるものと純粋な計算が混在する。

| ファイル | 役割 | 主なexport |
| --- | --- | --- |
| `scripts/lib/archiveDownloader.js` | 公式サイトの静的ファイル・ページを、生のまま保管する取得ループ（fan・月間スケジュールのCLI共通） | readJsonl, fetchOnce, planItems, runArchiveDownload, HARD_MIN_INTERVAL_MS ほか4件 |
| `scripts/lib/beforeInfoParser.js` | 公式の直前情報ページ（boatrace.jp beforeinfo）の全項目パーサー（純関数。DB・取得先に接続しない） | parseStartExhibitionCell, parseBeforeInfoDocument, parseBeforeInfoPage, BEFOREINFO_PARSER_VERSION |
| `scripts/lib/beforeinfoWeather.js` | 公式ページの「水面気象情報」の解析（BOA-358） | convertWindDirection, scrapeObservedPoint, scrapeConditions, hasAnyWeather, resolveObservedAt ほか5件 |
| `scripts/lib/boatcast/boatcastClient.js` | BOATCAST（race.boatcast.jp）への取得の共通部品: URL・間隔の制御・カナリア・403の解釈。 | buildOritenUrl, buildMotorStartUrl, createPacer, fetchBoatcast, checkCanary ほか6件 |
| `scripts/lib/boatcast/motorStartJob.js` | BOATCASTのモーター使用開始日（bc_mst。N26）の日次取得ジョブ（docs/design/boatcast-original-exhibition/… | fetchMotorStartDates, nextHistory, createMotorStartRun, MOTOR_START_JOB, ABORT_AFTER_CONSECUTIVE_FAILURES ほか1件 |
| `scripts/lib/boatcast/oritenJob.js` | BOATCASTのオリジナル展示（bc_oriten。N25）の取得ジョブ（docs/design/boatcast-original-exhibition/）… | processOritenRace, tickOf, takeTick, clearTicks, mergeReport ほか6件 |
| `scripts/lib/boatcast/oritenParser.js` | BOATCASTのオリジナル展示（bc_oriten）ファイルの解析（純関数。DB・取得先に接続しない）。 | normalizeLabel, parseOritenText, parseMotorStartDate, ORITEN_PARSER_VERSION, ORITEN_STATUSES ほか1件 |
| `scripts/lib/boatcast/oritenRows.js` | オリジナル展示の解析結果（oritenParser.js）から、DBへ書く行・未公開（403）時の再試行の判断・ | computeOritenHash, parseLastModified, buildOritenRows, compareLabelsToMap, decideNotPublished ほか1件 |
| `scripts/lib/boatcast/oritenSchema.js` | オリジナル展示・モーター使用開始日の保存先（マイグレーション091）が、接続先のDBに適用済みかの判定。 | detectBoatcastSchema, clearBoatcastSchemaCache, ORITEN_TABLES, MOTOR_START_TABLES, BOATCAST_SCHEMA_CACHE_TTL_MS |
| `scripts/lib/boatcast/probe.js` | BOATCASTへ、Vercel（実際の本番のリージョン）から到達できるかの確認（probe）。 | createBoatcastProbeHandler |
| `scripts/lib/boatcast/publicMap.js` | BOATCASTのオリジナル展示（bc_oriten）の「公開マップ」（会場 × 項目）。事前に凍結した静的な設定。 | venueEntry, publicVenueCodes, isPublicVenue, venueOfRaceId, expectedValueRows ほか4件 |
| `scripts/lib/campaignResultRetrospective.js` | 企画エントリの結果確定後、「なぜ当たった/外れたか」を実データで説明する | buildResultRetrospective |
| `scripts/lib/campaignVolatilityModel.js` | イン崩れ狙い企画（docs/design/sns-hub-campaign-pipeline/）用の買い目生成モデル。 | computeCampaignPicks, MODEL_NAME |
| `scripts/lib/cancellationStatus.js` | レース中止・順延検出の状態遷移ロジック（BOA-254） | isCancellationConfirmed, computeCancellationTransition, CONFIRM_STREAK_THRESHOLD, CANCELLATION_CONFIRMED, CANCELLATION_TENTATIVE |
| `scripts/lib/contentChannels/captureScreenshot.js` | ブログ/note/YouTubeサムネイル用のスクリーンショット取得。 | captureScreenshot |
| `scripts/lib/contentChannels/channelMatrix.js` | ネタ種別→展開先チャネルの対応表（spec.md FR2）。 | getChannelsForTopic, CHANNEL_MATRIX |
| `scripts/lib/contentChannels/coverImageStrategy.js` | ブログ/note/YouTubeサムネイルのカバー画像調達方法を、ネタ種別ごとに決める。 | getCoverImageStrategy |
| `scripts/lib/contentChannels/renderCampaignCard.js` | CampaignEntryCard / CampaignDataExcerptCard | renderCampaignEntryCard, renderCampaignDataExcerptCard, COMPOSITION_IDS |
| `scripts/lib/contentChannels/renderCoverCard.js` | DataQuoteCard（sns-video-studio/remotion/src/DataQuoteCard.jsx）を | renderCoverCard, COMPOSITION_IDS |
| `scripts/lib/contentRevisionHistory.js` | sns_draftsの却下・修正依頼履歴（revision_reason_codes/revision_reason_freetext）を | getRecentRevisions, countReasonCodes |
| `scripts/lib/contentTopics/dailyResultSource.js` | ネタ供給モジュール: 成績（当日結果）。 | getCandidates, id |
| `scripts/lib/contentTopics/dataInsightSource.js` | ネタ供給モジュール: データ知見。 | getCandidates, recordUsage, id |
| `scripts/lib/contentTopics/humorSource.js` | ネタ供給モジュール: ゆるユーモア型。 | getCandidates, recordUsage, id |
| `scripts/lib/contentTopics/index.js` | ネタ供給モジュールのレジストリ。 | collectAllCandidates, topicSources |
| `scripts/lib/contentTopics/newFeatureSource.js` | ネタ供給モジュール: 新機能・既存機能の使い方紹介。 | getCandidates, recordLifehackUsage, id |
| `scripts/lib/contentTopics/triviaSource.js` | ネタ供給モジュール: 豆知識。 | getCandidates, recordUsage, id |
| `scripts/lib/contentTopics/venueCharacteristicSource.js` | ネタ供給モジュール: 会場特性。 | getCandidates, recordUsage, id |
| `scripts/lib/courseEntryTendency.js` | 実進入コース（race_results.actual_course_1〜6、BOA-257）から選手の進入コース傾向を | actualCourseOf, isShiftedByAbsence, buildCourseEntryTendency, ACTUAL_COURSE_SELECT |
| `scripts/lib/dailyReconcile.js` | 日次の照合（N29、完了の定義Cの独立した突合先）の、突合の純関数。DB・取得先に接続しない。 | parseKDay, normalizeCombination, comparePayoutColumns, comparePayoutTable, compareCourses ほか4件 |
| `scripts/lib/dailyReconcileJob.js` | 日次の照合（N29、daily_reconcile）の共通ラッパ向けハンドラー（tasks.md T4b-21）。 | loadReconcileInputs, buildReconcileAlerts, updateHistory, runDailyReconcileJob, FINAL_ATTEMPT_MINUTES_OF_DAY ほか3件 |
| `scripts/lib/dataHealth/checks.js` | 汎用の日次監視（data_health、完了の定義C）の登録表。データセットごとに、次を宣言する。 | validateChecks, DEFAULT_THRESHOLD, DEFAULT_DAYS, DEFAULT_MIN_DENOMINATOR, COUNT_CHECKS ほか1件 |
| `scripts/lib/dataHealth/coverageSpec.js` | 存在充足率（完了の定義A）の指標と、その集計SQLの正本（data-health-report.js と、汎用の日次監視 | literalCoverageSlots, buildCoverageSql, buildMonthlySql, ALL_ODDS_COLUMNS, ODDS_FULL_GRID_SINCE ほか3件 |
| `scripts/lib/dataHealth/evaluate.js` | 汎用の日次監視（data_health）の判定（純粋関数。DB・時計・Slackに触れない）。 | weekdayOf, isDueToday, periodFor, evaluateCountCheck, evaluateEmptyTables ほか6件 |
| `scripts/lib/dataHealth/functions.js` | 汎用の日次監視（data_health）が呼ぶDB関数の定義（SQLの正本）。 | renderFunctionDdl, renderInlineSql, MAX_RANGE_DAYS, TABLE_ROWS_TABLES, DATA_HEALTH_FUNCTIONS ほか2件 |
| `scripts/lib/dataHealth/job.js` | 汎用の日次監視 data_health（完了の定義C）の実行。api/cron/data-health.js が、共通ラッパ | createRpcCaller, readDeliveredKeys, runDataHealthChecks, runDataHealthJob, DATA_HEALTH_JOB ほか1件 |
| `scripts/lib/dateUtils.js` | 日付ユーティリティ（バックエンド用） | getTodayDateJST, getYesterdayDateJST, getDateDaysAgo, formatDateForUrl, parseDateArg ほか7件 |
| `scripts/lib/deployHookPolicy.js` | Vercel Deploy Hook を叩くかどうかの判定（BOA-361）。 | decideDeployHook, DEPLOY_HOOK_WINDOW_MINUTES |
| `scripts/lib/erDiagramFromDdl.js` | docs/db-migration/ のSQL DDLからmermaid erDiagramを機械的に導出する。 | parseTablesFromSql, findLinkedMigrations, buildMermaidErDiagram, DB_MIGRATION_DIR, DESIGN_DIR |
| `scripts/lib/fakeSupabaseClient.js` | 検証用の偽のSupabaseクライアント（メモリ上のテーブル。DB・ネットワークに接続しない）。 | fakeClient |
| `scripts/lib/fanPeriodParser.js` | 公式「レーサー期別成績」ファイル（fan）の全項目パーサー（純関数。ネットワーク・DB・fsに触れない） | parseFanId, fanIdOf, buildFanUrl, fanArchiveRelPath, listFanIds ほか14件 |
| `scripts/lib/fanPeriodRows.js` | fan中間形式（fan-period/v1）→ DBの行への変換（純関数） | courseColumns, buildStatsRows, buildProfileSyncRows, FAN_TABLES, STATS_COLUMNS ほか1件 |
| `scripts/lib/fortuneTelling/index.js` | 4占術の共通インターフェース | FORTUNE_SYSTEMS |
| `scripts/lib/fortuneTelling/kyuseiKigaku.js` | 九星気学（本命星 + 年盤） | calculateScore |
| `scripts/lib/fortuneTelling/rokuseiSenjutsu.js` | 六星占術（運気リズム） | calculateScore |
| `scripts/lib/fortuneTelling/sexagenaryCycle.js` | 六十干支（日柱）の共通計算ロジック | getDayGanzhiIndex, getGanzhiLabel, STEMS, BRANCHES |
| `scripts/lib/fortuneTelling/shichuSuimei.js` | 四柱推命（日柱まで。時柱は出生時刻不明のため省略、spec.md準拠） | calculateScore |
| `scripts/lib/fortuneTelling/westernAstrology.js` | 西洋占星術（太陽星座ベースのトランジット計算） | calculateScore |
| `scripts/lib/ghaSkipGate.js` | GitHub Actions 側の取得を止める判定（フェイルセーフ付きSKIP。自動フェイルオーバー）。 | evaluateJobHealth, decideFromRows, jobKeysFor, createRestJobStateClient, shouldSkipOnGha ほか5件 |
| `scripts/lib/googleServiceAuth.js` | Googleサービスアカウント認証の共通ヘルパー（BOA-139） | getGoogleAuthClient |
| `scripts/lib/harville.js` | — | normalizeProbs, impliedProbsFromOdds, condSecond, condThird, exactaProb ほか6件 |
| `scripts/lib/hitCalculator.js` | 的中判定ユーティリティ | calculateHits, isWinHit, isPlaceHit, isShowHit, isTrifectaHit ほか3件 |
| `scripts/lib/isDirectRun.js` | そのモジュールが `node <path>` で直接実行されたかを判定する。 | isDirectRun |
| `scripts/lib/isotonic-regression.js` | — | IsotonicCalibrator |
| `scripts/lib/kbArchiveRows.js` | K/B中間形式（kb-day/v1）→ アーカイブ表（kb_archive_*）の行への変換 | raceTimeToSeconds, classifyStage, buildArchiveRows, KB_ARCHIVE_TABLES |
| `scripts/lib/kbFileParser.js` | 公式ダウンロードデータ（Kファイル=競走成績、Bファイル=番組表）の全項目パーサー | buildKbUrl, kbArchiveRelPath, decodeLzhText, decodeLzhBytes, classifyKFileVenues ほか9件 |
| `scripts/lib/kbResultsBackfillRows.js` | K/Bアーカイブ（kb-day/v1、scripts/lib/kbFileParser.js）から race_results の欠損行を | classifyMissingResult, buildRaceFactsForDay, buildRaceResultRow, MISSING_STATUS |
| `scripts/lib/kelly-criterion.js` | — | kellyFraction, halfKelly, quarterKelly |
| `scripts/lib/kfileParser.js` | 公式成績ファイル（Kファイル）のダウンロード・解凍・パース（BOA-257） | fetchKFileText, parseKFileText, parseKFileRankings, _internal |
| `scripts/lib/latestByRaceId.js` | 行の配列から、IDフィールド（既定はrace_id）ごとにタイムスタンプフィールド | latestByRaceId |
| `scripts/lib/monthlyScheduleParser.js` | 月間スケジュール（boatrace.jp race/monthlyschedule）の全項目パーサー（純関数。ネットワーク・DB・fsに触れない） | buildMonthlyScheduleUrl, parseYm, listYms, parseMonthlySchedule, mergeMonthlySchedules ほか8件 |
| `scripts/lib/motorPretestJob.js` | 前検タイム・節時点のモーター/ボート2連対率（N23、motor_pretest_stats）の共通ラッパ向けハンドラー（tasks.md T4b-20）。 | fetchMotorPretest, findMotorPretestDriftAlerts, buildCoverageAlerts, runMotorPretestJob, MOTOR_PRETEST_CONCURRENCY ほか3件 |
| `scripts/lib/motorPretestParser.js` | 公式のモーター抽選結果・前検タイム（boatrace.jp race/rankingmotor）のパーサー（純関数。DB・取得先に接続しない） | buildMotorPretestUrl, readHeaderLabels, competitionRanks, parseMotorPretestHtml, MOTOR_PRETEST_PARSER_VERSION ほか1件 |
| `scripts/lib/motorPretestRows.js` | 前検タイム（N23、motor_pretest_stats）の、行の組み立て・期待件数の算出・書き込み。 | buildMotorPretestRows, writeMotorPretestRows, loadExpectedRacers, summarizeVenueCoverage, MOTOR_PRETEST_TABLE ほか1件 |
| `scripts/lib/oddsParser.js` | boatrace.jp オッズページの共通パーサー | parseOddsTable, parseTrifectaAll, parseTrioAll, parseRangeOddsValue, parseExactaAll ほか2件 |
| `scripts/lib/openingDayBackfill.js` | 節の初日の欠落（racesに1行も無い会場日）を、公式サイトの過去日ページから補うCLI | parseOnly, selectTargets, buildRaceRows, createThrottledFetch, tallyOutcomes ほか10件 |
| `scripts/lib/optionalColumns.js` | 「マイグレーション未適用のDBでも壊れない」書き込みの共通処理 | isColumnMissingError, stripColumns, createOptionalColumnState, upsertWithOptionalColumns |
| `scripts/lib/parametric-calibration.js` | — | solveLinear, PlattCalibrator, BetaCalibrator, OddsAwareCalibrator |
| `scripts/lib/payoutCalculator.js` | 配当・回収率ユーティリティ | calculateRecoveryRate, getTrifectaKey, getTrioKey, calculateHitRate, payoutToRecoveryRate ほか1件 |
| `scripts/lib/pitReportJob.js` | ピットレポート（選手コメント）の取得ジョブ（BOA-379、docs/design/pit-comments/plan.md）。 | buildPitReportUrl, fetchPitReportHtml, processPitReportRace, createPitReportSlotHandler, createPitReportStore ほか3件 |
| `scripts/lib/pitReportParser.js` | 公式のピットレポート（boatrace.jp race/pitreport）のパーサー（純関数。DB・取得先に接続しない） | splitConfidence, parsePitReportHtml, PIT_REPORT_PARSER_VERSION, PIT_REPORT_STATUSES |
| `scripts/lib/pitReportRows.js` | ピットレポートの解析結果（pitReportParser.js）から、DBへ書く行・スロットの結果（outcome）・ | isPitReportCandidate, pendingRetrySec, outcomeForStatus, computeContentHash, buildPitReportRows ほか5件 |
| `scripts/lib/pitReportSchema.js` | ピットレポートの保存先（マイグレーション085: race_pit_reports・race_pit_comments）が、接続先のDBに | detectPitReportSchema, clearPitReportSchemaCache, PIT_REPORT_TABLES, PIT_SCHEMA_CACHE_TTL_MS |
| `scripts/lib/placementDistribution.js` | 2着・3着のコース別統計分布 | getPlacementBaseline, PLACEMENT_DISTRIBUTION, GLOBAL_PLACEMENT_AVERAGE |
| `scripts/lib/pointRankJob.js` | 得点率（B2、racer_series_points）の共通ラッパ向けハンドラー（tasks.md T4b-12-1、plan.md §4.3）。 | runPointRankJob, POINT_RANK_CONCURRENCY |
| `scripts/lib/pointRankParser.js` | boatrace.jp 得点率一覧ページ（pointrank）の共通パーサー | parsePointRankTable |
| `scripts/lib/preRaceRows.js` | 出走表・直前情報の全項目の解析結果（scripts/lib/raceListParser.js・beforeInfoParser.js）から、DBへ書く行を作る | formatJstHm, buildRaceEntryRows, buildRaceConditionRow, buildExhibitionRows, planDeadlineUpdates |
| `scripts/lib/preRaceSchema.js` | 出走表・直前情報の新しい列（マイグレーション081・082）が、接続先のDBに適用済みかの判定 | PRE_RACE_SCHEMA_TARGETS, detectPreRaceSchema, clearPreRaceSchemaCache, PRE_RACE_OPTIONAL_COLUMN_GROUPS |
| `scripts/lib/preciousPaths.js` | gitに入らない「取り直しが高くつくデータ」の置き場所。 | PRECIOUS_PATHS, BACKUP_DIR_FROM_HOME |
| `scripts/lib/predictionOddsDerive.js` | 買い目オッズ（prediction_odds）を、予想の買い目（predictions）と、オッズの最新スナップショット | trioKeyOf, buildPredictionOddsRow, percentDiff, percentileOf, summarizePredictionOddsDiff ほか2件 |
| `scripts/lib/predictionRefresh.js` | 予測の再計算（predictions のリフレッシュ）を、どこが・いつ起動するかの方針（案1、BOA-353 T4b-03、 | isRefreshOnVercelEnabled, isOddsRefreshSkippedOnGha, isOddsSkippedOnGha, collectGhaRefreshRaceIds, refreshAfterExhibition ほか1件 |
| `scripts/lib/raceConditionsWriter.js` | race_conditions への書き込み（気象列を含む）の共通処理（BOA-358） | isObservedAtColumnMissing, upsertRaceConditions, OBSERVED_AT_COLUMN |
| `scripts/lib/raceEntriesKbRestore.js` | 出走表（race_entries）の複製汚染を、公式Bファイル（番組表）から復元するための純粋関数（BOA-422） | indexBEntriesByRace, compareRace, buildRestoredRow, buildRestorePlan, COLUMNS_FROM_B ほか4件 |
| `scripts/lib/raceIndicatorData.js` | データ出走表11指標のデータ取得（AI予想モデル大規模改修 Task6a） | fetchStPredictability, fetchReturnRate, fetchTechniqueProfile, fetchExhibitionTrend, fetchRacerForm ほか1件 |
| `scripts/lib/raceListParser.js` | 公式の出走表ページ（boatrace.jp racelist）の全項目パーサー（純関数。DB・取得先に接続しない） | scrapeSeriesDay, scrapeRaceMeta, parseRaceListDocument, parseRaceListPage, RACELIST_PARSER_VERSION |
| `scripts/lib/raceNoticesJob.js` | レース特記事項（A5、race_special_notes）の共通ラッパ向けハンドラー（BOA-353 T4b-11-1、plan.md §2.2）。 | runRaceNoticesJob, RACE_NOTICES_CONCURRENCY |
| `scripts/lib/raceResultAudit.js` | 既存の race_results の誤り（Q6: 返還・不成立の払戻¥100、非完走艇の着順）を特定する純関数群。 | analyzeRaceFromDb, parseRaceId, summarizeDbFindings, isRefundedKFinish, kDayToRaceFacts ほか4件 |
| `scripts/lib/raceResultFix.js` | 既存の race_results の誤り（Q6）を、公式の結果ページの再取得で修正するための計画づくりと書き込み。 | buildFixPlan, applyFixPlan, FIX_RESULT_COLUMNS, FIX_EXTRA_COLUMNS |
| `scripts/lib/raceResultParser.js` | 公式の結果ページ（boatrace.jp raceresult）の全項目パーサー（純関数。DB・取得先に接続しない） | parseRaceSeconds, parseStartCell, classifyRaceStatus, parseRaceResultPage, RESULT_PARSER_VERSION ほか2件 |
| `scripts/lib/raceResultRows.js` | 結果ページの全項目（scripts/lib/raceResultParser.js）から、DBへ書く行・旧形式の解析結果を作る（純関数）。 | toLegacyResult, buildResultExtras, buildTimingRows, buildPayoutRows |
| `scripts/lib/raceResultSchema.js` | 結果系の新しい列・テーブル（マイグレーション077〜079）が、接続先のDBに適用済みかの判定。 | detectResultSchema, clearResultSchemaCache, RESULT_SCHEMA_TARGETS, SCHEMA_CACHE_TTL_MS |
| `scripts/lib/raceSchedule.js` | レーススケジュール管理モジュール | getRaceSchedule, getRacesInWindow, getRacesAfterStart, getRacesPastResultWindow, getRacesBeforeStart |
| `scripts/lib/raceSeriesRows.js` | 節（開催）の確定結果（mergeMonthlySchedules の series）→ race_series の行への変換（純関数） | buildSeriesRows, SERIES_TABLE, SERIES_COLUMNS |
| `scripts/lib/raceStageParser.js` | racelist ページの `.title16_titleDetail__add2020` から開催ステージ名 | scrapeRaceStage |
| `scripts/lib/raceStatusJob.js` | 中止・順延の早期確定（race_status、共通ラッパ cronWrapper.js の continuous ジョブ）。 | runRaceStatusJob, RACE_STATUS_CONCURRENCY, CONFIRM_REASON |
| `scripts/lib/raceStatusParsers.js` | 開催場一覧（race/index）と結果ページ（raceresult）から、中止・順延の告知を読み取る純粋関数。 | raceIndexUrl, raceResultUrl, classifyStatusText, parseVenueStatuses, isRaceCancelledPage |
| `scripts/lib/racelistBackfillRows.js` | 出走表（racelist）過去分バックフィルの、行の組み立て・URL・アーカイブパス（純関数。DB・取得先に接続しない） | parseRaceId, buildRacelistUrl, racelistArchiveRelPath, buildFillRow, buildFillRowsForRace ほか2件 |
| `scripts/lib/racerNews/dedup.js` | — | isAlreadyProcessed |
| `scripts/lib/racerNews/officialGradeAnnouncements.js` | — | collectGradeAnnouncementNews |
| `scripts/lib/racerNews/pendingReview.js` | — | listPending, listAll, hasItemForSourceUrl, addPendingItem, updateStatus ほか3件 |
| `scripts/lib/racerNews/templates.js` | — | generateGradeAnnouncementNews |
| `scripts/lib/racerNewsJob.js` | 選手ニュース（B5、racer_news・racer_news_pending）の共通ラッパ向けハンドラー（tasks.md T4b-15-1）。 | runRacerNewsJob |
| `scripts/lib/racerProfileSync.js` | — | parseArgs, fetchHtmlWithRetry, parseProfileHtml, getProfileUrl, toSeasonStatsRow ほか16件 |
| `scripts/lib/racerProfilesJob.js` | 選手プロフィール・期別成績（B6、racer_profiles）の共通ラッパ向けハンドラー（tasks.md T4b-16-1）。 | resolveChunkSize, runRacerProfilesJob, RACER_PROFILES_CHUNK, RACER_PROFILES_CONCURRENCY |
| `scripts/lib/racerSeasonStats.js` | — | getSeasonStatsUrl, isRacerPageNotFound, derivePeriodLabel, parseSeasonStatsHtml, scrapeSeasonStats ほか2件 |
| `scripts/lib/racesInit/digest.js` | 朝の初期化（races-init）の shadow で記録する、レースごとのダイジェスト（純粋関数。DB・取得先に接続しない）。 | raceIdOf, digestScrapedRace, digestScrapedVenue, digestDbRace, compareRaceDigests |
| `scripts/lib/racesInit/ghaSkip.js` | GitHub Actions 側の朝の初期化（morning-init.js）を止める変数 SKIP_MORNING_INIT_ON_GHA の判定（純粋関数）… | decideMorningInitOnGha, FALLBACK_FROM_JST_HOUR |
| `scripts/lib/racesInit/job.js` | 朝の初期化（A8、races・race_entries・predictions の初期化）の共通ラッパ向けハンドラー（tasks.md T4b-07-4、 | backoffMinutes, resolveVenuesLimit, isBreakerOpenError, runRacesInitJob, createPredictCodeOnTick ほか2件 |
| `scripts/lib/racesInit/predictCodeCheck.js` | 予測ロジックの変更検知による再生成（WS4b T4b-07-5、plan.md §4.2(d)・設計判断(g)）。 | hashFiles, computePredictCodeHash, checkPredictCodeChange, PREDICT_CODE_HASH_JOB, PREDICT_LOGIC_FILES |
| `scripts/lib/rawHtmlArchive.js` | 取得した生HTMLの保管（optimal-scraping-design.md §2.2・承認済みQ1）の最小実装。 | rawHtmlPath, archiveRawHtml, RAW_HTML_BUCKET |
| `scripts/lib/reportComparison.js` | 定点観測レポート（search-console-report.js / i18n-demand-report.js）の | findPreviousReport, findRecentReports, detectTrend, perDay, formatDelta |
| `scripts/lib/riskRules.js` | SNSマーケティングハブ Phase 2用 risk-rules.json 決定的照合ユーティリティ | checkRiskRules |
| `scripts/lib/schemaDetect.js` | 「マイグレーションの列・テーブルが、接続先のDBに適用済みか」の判定（共通処理） | createSchemaDetector, DEFAULT_SCHEMA_CACHE_TTL_MS |
| `scripts/lib/scrapeJobs/circuitBreaker.js` | ホスト単位のサーキットブレーカー（BOA-368、plan.md §2.2・§8、ADR-0067）。 | createCircuitBreaker, BreakerOpenError |
| `scripts/lib/scrapeJobs/cleanup.js` | 予定表の保守（scrape-cleanup、plan.md §3.9・T4a-11）。日次（JST 04:00）。 | cleanupCutoffs, runCleanup, SLOT_RETENTION_DAYS |
| `scripts/lib/scrapeJobs/concurrency.js` | 並列度の上限つきの map（取得先への負荷を抑える。plan.md §8）。 | mapWithConcurrency, createSemaphore |
| `scripts/lib/scrapeJobs/cronWrapper.js` | Vercel Cron 向けの共通ラッパ（plan.md §2.2）。各データセットの api/cron/*.js は、これを経由する。 | isAuthorized, defaultWorker, shouldEnsureSlots, runScrapeJob, createScrapeCronHandler ほか2件 |
| `scripts/lib/scrapeJobs/dailyJob.js` | 日次ジョブの共通部分（plan.md §4.3）。 | resolveTargetDate |
| `scripts/lib/scrapeJobs/expectedUnpublished.js` | 発売開始の遅れ（想定内の未公開。BOA-386・完了の定義Bの見直し）: 「発走60分前のオッズが、その窓（±3分）の間は | laterOffsetsOf, firstRaceIdSet, slotDeadlineOf, isPastWindow, isExtensionSuccess ほか8件 |
| `scripts/lib/scrapeJobs/htmlFetch.js` | politeFetch（Response を返す）を、既存のスクレイパー（scrape-to-json.js・scrape-pcexpect.js）が受け取る | makeFetchHtml |
| `scripts/lib/scrapeJobs/monitor.js` | データ取得の監視（完了の定義C、plan.md §7）。予定表（scrape_slots）とジョブ状態（scrape_job_state）から、 | livenessCheckable, percentile, computeWindowStats, aggregateByJob, evaluateExpired ほか14件 |
| `scripts/lib/scrapeJobs/oddsDigest.js` | オッズ取得（A3）の shadow で記録する result_digest（scrape_slots.result_digest）の計算。 | computeOddsDigest, ODDS_DIGEST_FULL_KEYS |
| `scripts/lib/scrapeJobs/oddsHandlers.js` | オッズ取得（A3）の Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関数の組み立て）。 | parseOddsRaceId, shouldProbeWinFirst, createOddsSlotHandler |
| `scripts/lib/scrapeJobs/outcomes.js` | スロット・ジョブの結果（outcome）の扱い（純粋関数）。 | isFinalOutcome, truncateError, applyZeroRowGuard, computeRetryAt, FINAL_OUTCOMES ほか2件 |
| `scripts/lib/scrapeJobs/pcexpectHandlers.js` | 公式コンピュータ予想（B1、external_predictions）の Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関… | parsePcexpectRaceId, createPcexpectSlotHandler |
| `scripts/lib/scrapeJobs/politeFetch.js` | 取得先（boatrace.jp 等）への、負荷に配慮した取得（ADR-0067・BOA-368、plan.md §2.2・§8）。 | hostKeyOf, parseRetryAfterMs, createPoliteFetch, DEFAULT_USER_AGENT, FetchError |
| `scripts/lib/scrapeJobs/preRaceDigest.js` | レース情報（A1）・展示（A2）の shadow で記録する result_digest（scrape_slots.result_digest）の計算。 | computeRaceInfoDigest, computeExhibitionDigest, RACE_ENTRY_DIGEST_COLUMNS, RACE_CONDITION_DIGEST_COLUMNS, EXHIBITION_DIGEST_COLUMNS |
| `scripts/lib/scrapeJobs/preRaceHandlers.js` | レース情報（A1）・展示（A2）の Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関数の組み立て）。 | parsePreRaceId, createScheduleLoader, createRaceInfoSlotHandler, createExhibitionSlotHandler, createRefreshingCronHandler ほか5件 |
| `scripts/lib/scrapeJobs/predictionOddsHandlers.js` | 買い目オッズ（A4、prediction_odds）を、A3（オッズ取得、race_odds）の成功フックから導出する（BOA-404、 | fetchPredictionsByModel, fetchLatestRaceOdds, deriveRowsForRaces, buildShadowDigest, deriveAndUpsertPredictionOdds ほか3件 |
| `scripts/lib/scrapeJobs/registry.js` | ジョブレジストリ: 窓・許容幅・再試行・リース・並列度・実行時間の定義（plan.md §3.6・§4.3・§4.4）。 | isScheduledDate, isCatchupOffset, graceMinFor, graceOverridesOf, windowJobNames ほか5件 |
| `scripts/lib/scrapeJobs/resultDigest.js` | 結果取得（A6）の shadow で記録する result_digest（scrape_slots.result_digest）の計算。 | pickResultColumns, pickStartTimingColumns, computeResultDigest, RESULT_DIGEST_COLUMNS, START_TIMING_DIGEST_COLUMNS |
| `scripts/lib/scrapeJobs/resultHandlers.js` | 結果取得（A6）まわりの Vercel Cron ハンドラー（共通ラッパ cronWrapper.js に渡す関数の組み立て）。 | parseRaceId, addDays, overdueWindows, createResultSlotHandler, createResultOnTick ほか4件 |
| `scripts/lib/scrapeJobs/schemaErrors.js` | 「予定表のテーブル・関数がDBに無い」エラーの判定。 | isScrapeSchemaMissingError, isClaimByOffsetMissingError, SCRAPE_SCHEMA_OBJECTS |
| `scripts/lib/scrapeJobs/store.js` | 予定表（scrape_slots）・ジョブ状態（scrape_job_state）へのアクセス（Supabase実装）。 | createSupabaseStore, TICK_WRITE_INTERVAL_MS |
| `scripts/lib/scrapeJobs/testing/fakeSupabaseClient.js` | テスト用のインメモリの Supabase クライアント（PostgREST の、検証に必要な部分だけ）。DB・取得先に接続しない。 | createFakeSupabaseClient |
| `scripts/lib/scrapeJobs/testing/memoryStore.js` | テスト用のインメモリのストア（store.js と同じインターフェース）。共通ラッパの検証（verify-scrape-jobs.js）専用。 | createMemoryStore |
| `scripts/lib/scrapeJobs/time.js` | 予定表（scrape_slots）まわりの時刻計算（純粋関数。実行環境のタイムゾーンに依存しない） | toJstDateString, jstStartOfDay, jstMinutesOfDay, raceStartInstant, slotDeadline ほか2件 |
| `scripts/lib/scrapeJobs/venueDailyJob.js` | 会場公式サイトから、会場ごとに取得する日次ジョブの共通の流れ（B3 会場別モーター成績・B4 進入コース別選手成績。 | runVenueDailyJob |
| `scripts/lib/scrapeJobs/venueJobSupport.js` | 会場ごとに取得する日次ジョブ（B3 会場別モーター成績・B4 進入コース別選手成績。tasks.md T4b-14・T4b-13）の | updateHealthForDate, isTransientReason, reasonFromError, previouslySettledVenues, driftAlertsToReport |
| `scripts/lib/snsCampaigns.js` | 企画型（キャンペーン型）SNS投稿パイプライン用 sns_campaigns / sns_campaign_entries | createCampaign, getCampaign, getActiveCampaigns, findQualifyingRaces, getRaceIdsWithResults ほか6件 |
| `scripts/lib/snsStrategyInsights.js` | SNSマーケティングハブ Phase 2用 sns_strategy_insights 共通操作関数 | getActiveInsights, getProposedInsights, createInsight |
| `scripts/lib/snsTopics.js` | SNSコンテンツ ネタ生成ライン用 sns_content_types / sns_target_accounts / | getActiveContentTypes, getContentTypeByKey, getTopicCategories, getActiveTopicCategoryByKey, enabledChannelsOf ほか13件 |
| `scripts/lib/statisticalTests.js` | 統計検証ユーティリティ（正規近似ベース、外部ライブラリ非依存） | normalCDF, pearsonCorrelation, pearsonPValue, proportionZTest |
| `scripts/lib/supabaseClient.js` | バッチ処理用 Supabaseクライアント | fetchAll, supabase, isSupabaseEnabled, VENUE_NAMES, VENUE_CODES |
| `scripts/lib/turnPrediction.js` | 1マーク展開予測ロジック v5（バックエンド用） | predictFirstMarkV2, predictFirstMark |
| `scripts/lib/unchangedRows.js` | 「変更の無い行は書かない」ための共通ライブラリ（WS8(b)、BOA-349） | normalizeTimestamp, roundToScale, normalizeValue, diffRows, planWriteAll ほか8件 |
| `scripts/lib/unifiedModel.js` | 新AI予想モデル「unified」のスコアリング本体（AI予想モデル大規模改修 Task6b/Task8, ADR0009, FR1/FR2/FR6） | calculateUnifiedScores, softmaxProbabilities |
| `scripts/lib/venueEntryCourseStats/driftHealth.js` | 進入コース別選手成績ページ（BOA-293、FR-6 Phase 6c）の、会場公式サイトのHTML構造変化の検知。 | isEntryCourseStructuralDriftReason, findEntryCourseStatsDriftAlerts, ENTRY_COURSE_STRUCTURAL_DRIFT_REASONS |
| `scripts/lib/venueEntryCourseStats/parser.js` | parser - 進入コース別選手成績（`/modules/raceinfo/?page=index_racecourse`）の | parseEntryCourseHtml |
| `scripts/lib/venueEntryCourseStats/venueConfig.js` | venueConfig - 進入コース別選手成績スクレイピング対象会場設定（BOA-293） | buildEntryCourseUrl, VENUE_ENTRY_COURSE_STATS_CONFIG, EXCLUDED_VENUES |
| `scripts/lib/venueEntryCourseStatsJob.js` | 進入コース別選手成績（B4、venue_entry_course_stats）の共通ラッパ向けハンドラー（tasks.md T4b-13-1）。 | runVenueEntryCourseStatsJob, ENTRY_COURSE_CONCURRENCY |
| `scripts/lib/venueMotorStats/driftHealth.js` | 会場公式サイトのHTML構造変化を検知するための、日次スクレイピング結果の | updateVenueHealth, findDriftAlerts, STRUCTURAL_DRIFT_REASONS, DRIFT_ALERT_THRESHOLD_DAYS |
| `scripts/lib/venueMotorStats/parserUtils.js` | parserUtils - 会場公式サイトのモーター成績パーサー間で共通の変換・DOM操作 | normalizeText, toIntOrNull, toFloatOrNull, toStrictIntOrNull, parseBestTime ほか5件 |
| `scripts/lib/venueMotorStats/parsers/gamagori.js` | gamagori - 蒲郡専用パーサー（BOA-264） | parseGamagoriMotorTable |
| `scripts/lib/venueMotorStats/parsers/genericTable.js` | genericTable - 会場公式サイトのモーター成績テーブルの汎用パーサー（BOA-264） | parseGenericMotorTable, _internal |
| `scripts/lib/venueMotorStats/parsers/miyajimaPdf.js` | miyajimaPdf - 宮島専用パーサー（BOA-264） | parseMiyajimaMotorPdf |
| `scripts/lib/venueMotorStats/venueConfig.js` | venueConfig - 会場別モーター成績スクレイピング設定（BOA-264） | VENUE_MOTOR_STATS_CONFIG, EXCLUDED_VENUES |
| `scripts/lib/venueMotorStatsJob.js` | 会場別モーター成績（B3、venue_motor_stats）の共通ラッパ向けハンドラー（tasks.md T4b-14-1）。 | runVenueMotorStatsJob, VENUE_MOTOR_STATS_CONCURRENCY |
| `scripts/lib/venueParameters.js` | 会場別パラメータ | getVolatilityThreshold, getVenueType, VENUE_1COURSE_WIN_RATE, VENUE_1COURSE_AVG, VENUE_VOLATILITY_THRESHOLD ほか2件 |
| `scripts/lib/volatilityFactors.js` | イン崩れ因子（複合スコア・会場内パーセンタイル変換） | calculateVolatilityComposite, toVolatilityPercentile |
| `scripts/lib/winningTechniques.js` | 決まり手ユーティリティ | toTechniqueKey, getDefaultDistribution, TECHNIQUES, TECHNIQUE_NAMES, COURSE_DEFAULT_DISTRIBUTION ほか1件 |

## src/utils — 画面の純粋なユーティリティ

表示の整形・判定。DBアクセスは持たない。

| ファイル | 役割 | 主なexport |
| --- | --- | --- |
| `src/utils/aiCopyPrompts.js` | race-ai-copy機能の分析依頼プロンプト種別定義 | getAiCopyPromptOptions, getAiCopyPromptText, AI_COPY_PROMPT_TYPES |
| `src/utils/analytics.js` | — | getCookieConsent, setCookieConsent, initAdSense, initTrackingIfConsented, initGA ほか5件 |
| `src/utils/blogFaqSchema.js` | — | extractFaqItems, buildFaqPageSchema |
| `src/utils/colors.js` | カラーユーティリティ | getRecoveryColorClass, MODEL_COLORS, BOAT_COLORS, HIT_COLORS, COLORS |
| `src/utils/courseBaseline.js` | ST考察の「同コース・同級別の平均との差」の算出（phase a FR-1） | indexBaseline, getBaselineCell, diffFromBaseline, expectedBreakoutCount, METRIC_DIRECTION |
| `src/utils/dateUtils.js` | 日付ユーティリティ（フロントエンド用） | getJSTNow, getNowHHMMJST, getTodayJST, getYesterdayJST, getDaysAgoJST ほか9件 |
| `src/utils/digestMetrics.js` | digestMetrics - 「本日のデータ一覧」（BOA-402）の指標計算（純関数） | computeSkillDelta, computePredicted, computeZScore, computeConsistency, computeFeaturedScore ほか11件 |
| `src/utils/formatters.js` | フォーマット関数 | formatPercent, formatDate, formatDateLocalized, formatDateShort, formatDateObject ほか2件 |
| `src/utils/meetGrouping.js` | meetGrouping - 節（開催）のグルーピング共通ロジック | groupIntoCurrentMeet |
| `src/utils/pitReportUrl.js` | ピットレポート（選手コメント）の公式URL導出と、取得対象レースの判定（BOA-379） | buildPitReportUrl, isPitReportCandidate, PIT_REPORT_GRADES, PIT_REPORT_MIN_RACE_NUMBER_NON_SG |
| `src/utils/raceCancellation.js` | 開催中止・順延の判定を1箇所に集める。 | isRaceCancelled, isCancellationSuspected, CANCELLATION_CONFIRMED, CANCELLATION_TENTATIVE |
| `src/utils/raceDeadlineStatus.js` | — | getDeadlineDate, getDeadlineStatus, DEADLINE_STATUS |
| `src/utils/raceId.js` | selectedRace からDBの race_id（YYYY-MM-DD-VV-RR）を導出する | getRaceId, parseRaceId |
| `src/utils/raceStatus.js` | レース単位の状態（締切前/締切後・結果反映待ち/結果確定）を判定する。 | getRaceStatus, RACE_STATUS |
| `src/utils/raceTimeOfDay.js` | 1Rの発走時刻から開催時間帯（モーニング/デイ/サマータイム/ナイター/ミッドナイト）を | getTimeOfDay, getVenueTimeOfDay, TIME_OF_DAY |
| `src/utils/share.js` | SNSシェア関数 | shareRacePredictionToX, shareHitRaceToX, shareDailyStatsToX, generatePredictionShareText, generateTurnHitShareText |
| `src/utils/stConsideration.js` | ST考察（安定率・出遅率・抜出）の算出（phase a FR-1） | deriveRaceStContext, computeStConsideration, computeStHistogram, getStHistory, STABLE_THRESHOLD ほか3件 |
| `src/utils/theme.js` | — | getTheme, setTheme, subscribe |
| `src/utils/turnPrediction.js` | 決まり手ユーティリティ（フロントエンド用） | TECHNIQUE_NAMES |
| `src/utils/venueUtils.js` | — | VENUE_CODE_TO_BLOG_ID, getVenueBlogId, getVenueGuidePath |
| `src/utils/volatilityLevel.js` | getVolatilityLevel - イン崩れ指数（percentile）からレベルを判定する共通ヘルパー | getVolatilityLevel |
| `src/utils/webShare.js` | Web Share API 対応判定ヘルパー | canShareVideo, shareVideoFile, downloadFileBlob |
| `src/utils/wilson.js` | wilson - 二項比率のWilson信頼区間（純関数） | wilsonLowerBound, wilsonLowerBoundFromRate, isSmallSample |

## src/services — 画面のデータ取得

Supabaseへのクエリ。クライアントの生成は supabaseClient.js に一本化されている（ADR-0069）。

| ファイル | 役割 | 主なexport |
| --- | --- | --- |
| `src/services/adlerModel.js` | アドラー予想 共有モデルロジック（純粋関数のみ） | rankPermutations |
| `src/services/adlerService.js` | アドラー予想 データ取得・推論サービス | getAdlerModelInfo, getAdlerPredictions |
| `src/services/adminRuleService.js` | 管理者向けルール分析サービス | getRuleApplicationHistory, getWeeklyPerformance |
| `src/services/dataService.js` | データ取得サービス | dataService |
| `src/services/moriartyService.js` | — | getMoriartyStats, getMoriartyRecommendations, getMoriartyROIHistory, getMoriartyVenueBreakdown, getMoriartyCalibrationData |
| `src/services/mycroftService.js` | マイクロフト予想 データ取得サービス | venueName, getMycroftModelInfo, getMycroftPredictions |
| `src/services/poirotService.js` | — | getPoirotPredictions |
| `src/services/racerService.js` | 選手個別ページ用データ取得サービス | getRacerPageData, getRacerCurrentMotorStatus, getRacerStats |
| `src/services/ruleMatchService.js` | 会場別ルールマッチングサービス | getMatchingRules, getBetTypeName, getReliabilityName, hasRulesForVenue, getRulesForVenue ほか6件 |
| `src/services/sherlockModel.js` | シャーロック予想 共有モデルロジック（純粋関数のみ） | mean, buildFeatures, softmax, predictConditionalLogit, impliedProbs ほか5件 |
| `src/services/sherlockService.js` | シャーロック予想 データ取得・推論サービス | getSherlockModelInfo, getSherlockPredictions |
| `src/services/snsHubService.js` | SNSマーケティングハブ 管理画面用サービス層 | getDrafts, getApprovers, approveDraft, mergeBlogPr, publishYoutube ほか19件 |
| `src/services/supabaseClient.js` | Supabase クライアント（フロントエンド用） | supabase |
| `src/services/supabaseDataService.js` | Supabase データサービス | clearCache, aggregateRacerVenueBoatStats, aggregateRacerCrossStats, supabaseDataService |
| `src/services/watsonService.js` | ワトソン予想 データ取得サービス | getWatsonModelInfo, getWatsonPredictions |

---

対象 198 ファイル / export 985 件。
