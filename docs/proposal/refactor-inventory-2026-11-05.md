# リファクタリングの棚卸し（2026-11-05）

オーナーの優先順（2026-11-03）の3段目「リファクタリング」の準備。コードは変えていない。測った起点は origin/master `3852fff2f`。

## 目的と読み方

- 目的: 3段目に入るとき、何から崩すと「触る頻度 × 壊れやすさ」の元が取れるかを、数字つきで決められるようにする
- 並びは「効く量」の順。効く量 = 直近3か月（2026-08-01 以降）の変更回数（`git log -- <file>`）と、そのうち fix の回数、試験の有無（verify / e2e にその名前が出るか）。式は作っていない（目安、根拠なし）。数字を並べて人が読む
- 数え方: 行数は `wc -l`。コミット数・fix 数は `git log --since=2026-08-01`（fix は件名が `fix` で始まる・`fix(` を含むもの）。「試験に出る」は verify-*.js・e2e の本文にメソッド名・ファイル名があるかの文字列検索で、名前が出ても中身を固めているとは限らない（上限の見積もり）
- Codex に回せる = 1件が 5 ファイル・300 行以内に収まり、「手を加えず移す」「試験で固定」で閉じるもの

## 1. 大きすぎるファイル（上位20）

`src/`（`locales/*.json` は翻訳の本体なので別掲、`data/venueGuides*` は文言データ）:

| 順 | 行 | ファイル | 3か月の変更 / fix | 中身 | 試験（verify / e2e のファイル数） |
|---|---|---|---|---|---|
| 1 | 8169 | `src/services/supabaseDataService.js` | 178 / 70 | 89 メソッド（`supabaseDataService` は 1367 行から）、冒頭 1366 行はモジュール内の補助 | 29 / 2。メソッド名が試験に出ないのが 52 個（計 3323 行） |
| 2 | 1976 | `src/data/venueGuidesEn.js`（Ko 1957・ZhTw 1897） | 28 | 会場ガイドの文言データ | 対象外 |
| 3 | 1693 | `src/components/race/RaceMeetTab.jsx` | 40 / 21 | コンポーネント 1 つが 1602 行（`RaceMeetTab` 92 行目〜） | 2 / 0 |
| 4 | 1687 | `src/data/venueSummaryStats.js` | - | 生成物（`build-venue-summary.mjs`）。手で触らない | 3 / 2 |
| 5 | 1549 | `src/components/analysis/MotorConditionChart.jsx` | 39 / 18 | 関数 1 つが 1503 行、`useState/useEffect/useMemo` 24 | 5 / 1 |
| 6 | 1412 | `src/components/race/RaceBasicInfoTab.jsx` | 31 / 14 | コンポーネント 1 つが 1303 行 | 0 / 0 |
| 7 | 1361 | `src/components/race/RaceOddsListTab.jsx` | - | 26 単位。最大 `RaceOddsListTabBody` 721 行 | 1 / 0 |
| 8 | 1167 | `src/pure/seriesPoints.js` | 20（`components/race/seriesPoints.js` 経由） | 純関数 40 本、すでに pure | 4 / 0 |
| 9 | 1164 | `src/components/racer/RacerPerformanceStats.jsx` | 27 / 12 | コンポーネント 1 つが 1028 行 | 2 / 0 |
| 10 | 1143 | `src/utils/assistModel.js` | 19 | 37 単位。`boardModel` 322 行 | 2 / 0 |
| 11 | 1130 | `src/components/race/RaceBeforeInfoTab.jsx` | 25 | コンポーネント 1 つが 1020 行、hooks 18 | 1 / 1 |
| 12 | 1096 | `src/pages/ThinkingAssistPage.jsx` | 31 | `ThinkingAssistBody` 854 行 | 0 / 0 |
| 13 | 987 | `src/data/thinkingAssistCopy.js` | 30 | 文言データ | - |
| 14 | 982 | `src/components/race/basicInfoStats.js` | 36 / 17 | 純関数 + 定数。36 ファイルが import | 6 / 1 |
| 15 | 948 | `src/components/race/assist/LensSummary.jsx` | - | `FlowSummary` 224 行ほか 15 単位 | 0 / 0 |
| 16 | 919 | `src/components/race/raceIndicators.jsx` | 37 / 11 | `buildRowDefs` 1 関数が 630 行 | 1 / 0 |
| 17 | 863 | `src/components/race/PredictionPanel.jsx` | 60 / 18 | コンポーネント 1 つが 738 行 | 0 / 2 |
| 18 | 857 | `src/components/race/RaceWakuInfoTab.jsx` | 21 | - | 1 / 0 |
| 19 | 826 | `src/components/poirot/PoirotExplanation.jsx` | - | - | 0 / 0 |
| 20 | 812 | `src/components/race/analogy/ScenarioTab.jsx` | 20 | - | 0 / 0 |

`locales/*/common.json` は各 3997〜4011 行で、4 言語の合計が 3 か月で 1098 回触られている（ja 277・en 272・ko 278・zh-TW 271）。うち `aiPredictionTab` が 1326 行（約 33%）。同じ場所を 4 ファイルとも同時に変えるので衝突の源（後述 候補 9）。

`api/` の最大は `api/_lib/botPage.js` 682 行、`searchBotIpRanges.js` 609、`botRace.js` 571。どれも 700 行未満で、棚卸しの優先には入れない。

`scripts/lib/`（上位。3 か月の変更が多いのは `scrapeJobs/registry.js` の 47）:

| 行 | ファイル | 大きい単位 |
|---|---|---|
| 1723 | `dataReaders.js` | `extractAccesses` 370 行、`buildLedger` 285 行 |
| 1360 | `snsTodayPlanner.js`（変更 23） | `runTodayPlan` 1 関数 725 行 |
| 1069 | `contentPrGate.js` | - |
| 1060 | `scrapeJobs/registry.js`（変更 47） | `validateRegistry` 238 行。ほかは 23 行以下 |
| 1016 | `dbApplySql.js` | - |
| 964 | `scrapeJobs/monitor.js` | - |

### `supabaseDataService.js` の分け方（単位の案）

メソッドの名前で 5 群に分かれる（行数は各メソッドの次のメソッドまでの行数の和。目安）。

| 群 | メソッド数 | 行 | 例 |
|---|---|---|---|
| motor（モーター） | 16 | 1500 | `getRaceMotorBreakdown` 168・`getMotorWakuStats` 178・`getVenueMotorList` 159・`getMotorUsageHistory` 148 |
| analysis / venue / digest | 30 | 2108 | `getAccuracy` 360・`getRaceStPredictabilityBreakdown` 147・`getOutcomeDistribution` 117・`getMorningDigest` 116 |
| racer | 19 | 1188 | `getRacerScopedRaceStats` 126・`getRaceRacerBoatReturnRate` 135 |
| meet（節） | 8 | 1199 | `getMeetScoreboard` 574・`getMeetPage` 203・`getRaceMeetPrevRuns` 155 |
| other | 16 | 766 | `getRaces`・`getPredictions` ほか |

分ける順は、ファイルを群ごとに切るより先に、**メソッドの中の整形（DB の行 → 表示の値）を pure に出す**（開発効率 plan 段3の型。`getRaceMotorBreakdown` の自前の値の整形が3件目、本ファイル 2645 行目）。取得（`supabase.from(...)`）と整形が同じメソッドに入っているのが、試験が書けない理由。群ごとの切り出しは整形を出した後に、`motorDataService.js` のような別ファイルへ `supabaseDataService` の旧 export から呼ぶ形で行う（呼び出し側の import を変えない）。

## 2. 重複したロジック

`docs/reference/shared-logic-index.md`（生成物）を読み、載っている共通関数があるのに同じものを再実装している箇所を、関数名・定数名の完全一致で数えた。

| 重複 | 数 | 根拠（代表） | 既存の共通 |
|---|---|---|---|
| 会場コード→名前の表 | `VENUE_NAMES = {` が src・api に 21 ファイル（`supabaseDataService.js` 856・2194・2267・6607・7682 の5か所、6 つの専門役サービス、分析チャート 9 ファイルほか）、`VENUES = [` が分析チャートに 7 | `src/components/analysis/*Chart.jsx` の先頭、`src/services/{sherlock,poirot,mycroft,moriarty,watson}Service.js` の先頭 | 正準が3つ並立: `scripts/lib/venueNames.js` の `VENUE_NAMES`（索引にも「正準表」と書いてある）・`src/constants/index.js` の `STADIUM_NAMES`・`src/config/venueRules.js` の `VENUE_NAMES` |
| JST の今日 | `jstToday` が 8 か所（`sherlockService`・`poirotService`・`mycroftService`・`moriartyService`・`watsonService`・`supabaseDataService.js` 696・`api/_lib/botRace.js` 81・`botToday.js` 78）、`jstDate` が 5 か所 | 各ファイルの `function jstToday()` が `Date.now() + 9*3600*1000` を自前で書く。同じ式は src・api・scripts/lib で 32 箇所 | `src/utils/dateUtils.js` の `getTodayJST`、`scripts/lib/dateUtils.js` の `getTodayDateJST` |
| レース ID の分解 | `parseRaceId` が 4 か所 | `src/utils/raceId.js` 20、`scripts/lib/raceResultAudit.js` 92、`racelistBackfillRows.js` 34、`scrapeJobs/resultHandlers.js` 43 | `src/utils/raceId.js` |
| 日付の加算 | `addDays` が 6 か所、`daysBetween` が 4 か所 | `scripts/lib/{monthlyScheduleParser,snsDailyRunner,racerCareerJob,dailyReconcileJob,venueTechniquePeriod,scrapeJobs/resultHandlers}.js` | `scripts/lib/dateUtils.js`（`getDateDaysAgo` などはあるが `addDays` 相当が無い可能性。要確認） |
| 日付の「7/28」書式 | `slashDate` が 5 か所（`RaceBasicInfoTab.jsx` 81・`raceIndicators.jsx` 165・`RacerPerformanceStats.jsx` 136 は同一の1行、`inCautionLevel.js` 99、`snsTodayDigestV3.js` 42） | 同じ `ymd.split("-").map(Number).join("/")` | 無し（置き場は `src/utils/formatters.js` が自然。同じ書式の関数が既にあるかは未確認） |
| 率の百分率 | `pct` が 6 以上（`LensSummary.jsx` 41・`WinFollowers.jsx` 6・`assistTheory.js` 18 は丸めの有無が違う） | 丸めの違いが意図的かは未確認 | `inCautionLevel.js` の `pctOf` は別の意味 |
| 級（A1/A2/B1/B2）の並び | `["A1","A2","B1","B2"]` が 6 か所（`todayCourseWin.js` 40、`analogyFormat.js` 62、`ScopeCombo.jsx` 7、`GradeFilterChips.jsx` 3、`assistModel.js` 206、`api/_lib/snsResearchImage.js` 87） | 定数の写し。値は変わらないので壊れにくい | 無し |
| 専門役サービス | `sherlockService`・`poirotService`・`mycroftService`・`moriartyService`・`watsonService` の先頭に会場名の表と `jstToday` が同じ形で並ぶ | 冒頭 35 行ほどが重複 | 上と同じ |

索引に載っていない重複: 日目・締切・グレードの文は、すでに `src/utils/seriesDayLabel.js`・`raceSeriesText.js`・`raceDetailHeading.js`・`raceListDisplay.js` の4つに分かれて存在する（2026-11-04 の Remotion の事故のあとで分割済み）。同じ文を2か所で組む重複は、今回の完全一致の検索では見つからなかった（意味が同じで書き方の違うものは、検索では拾えていない）。

## 3. 死んだコード

| 種別 | 数 | 根拠 |
|---|---|---|
| ESLint `no-unused-vars` 違反 | **294**（`src/` 0・`api/` 0・`scripts/lib/` 1・`scripts/` 残り 293 のうち `scripts/analysis/generated-rules.js` が 195）。生成物を除くと 99（25 ファイル） | `eslint . --rule no-unused-vars=error`（`eslint.config.js` と同じ設定）の実測。plan は 293 と書いていた（2026-10-27）ので動いていない。内訳: `scripts/analysis/recalculate-all-rules.js` 47、`scripts/daily-rule-tracking.js` 11、`scripts/analysis/calibration-report.js` 6、`recalculate-trio-rules.js` 5、ほか 22 ファイルが 1〜3 |
| ほかの ESLint 違反 | `react-refresh/only-export-components` 85、`react-hooks/exhaustive-deps` 12、`no-irregular-whitespace` 13、`react/no-array-index-key` 11 など | 同じ実測。`react-refresh` の 85 は Fast Refresh の警告で、壊れてはいない |
| 呼び出しが無いメソッド | `supabaseDataService` の `getAllRacersLite`（4360 行・約 36 行）・`getRacerGradeCache`（4396 行・約 25 行） | `src/`・`api/`・`scripts/`・`e2e/` を `\bname\b` で検索して定義のほか 0 件。ほかに `getRaceMotorFreshness`・`getVenueMotorSnapshot` は内部の `this.` 呼び出しのみ（生きている） |
| どこからも import されない export | 93 個。うち本当に未使用は 6（`MEET_EXHIBITION_DIFF_THRESHOLD`・`isTodayJST`・`getReliabilityName`・`mergeBlogPr`・`VIEWPORTS`・`COLORS`）、87 個は同じファイルの中でだけ使われていて `export` の付け過ぎ | 自作の検索（`export` 宣言の名前を `\bname\b` で全 JS から検索。同名の別物を拾うので未使用の見積もりは下限寄り）。**注意: `export` の付け過ぎは壊れにくく、効く量は小さい** |
| 使われないファイル | 0 | ファイル名（拡張子を除く）が、他のファイルの import 文字列に出るかの検索。同じ名前の別ファイルがあると見逃すので下限 |
| i18n の未使用キー | **未検証** | 静的な検索では ja の 3145 キー中 950 が「文字列として現れない」と出るが、`aiPredictionTab` が 803 で、`const k = "aiPredictionTab.analogy.scopeNames"` のようにキーを組み立てる書き方（動的な接頭辞を 71 個検出）が多く、大半は偽陽性。信用できる数字にするには実行時のキー使用の記録が要る |
| 未使用の CSS | **未検証** | `src/**/*.css` 合計 34915 行（最大 `AnalogyV16.css` 2830・`ThinkingAssist.css` 2480・`App.css` 1816）。`verify-css-class-collisions.js` は衝突の検査で、未使用の検出ではない。測っていない |

BOA-1057・1104 は、plan（`docs/design/dev-efficiency/plan.md` 118 行）の「`no-unused-vars` を CI のエラーにするには、先に 293 を 0 にする」の前提で、生成物 195 は「生成元を直すか lint 対象から外す」の判断が要る。

## 4. 依存の向きの乱れ

向きの決まり: `src/pure`（鍵・DB・画面に触れない）→ `src/utils`（画面の純粋なユーティリティ）→ `src/services`（DB）→ `src/components`・`src/pages`。`scripts/lib` は Node の側。`api` は Vercel の関数。

| 乱れ | 根拠 | 事故の型 |
|---|---|---|
| `src/config/languages.js` が記事データ（`blogPostsEn/ZhTw/Ko.js`、内部で `import.meta.glob`）を import している（1〜3 行目） | `localizePath` を使うだけの `raceDetailHeading.js`・`pageMeta.js`・`botPageModel.js`・`aiCopyText.js` が、記事データと Vite 専用構文に届く | 2026-11-04 の Remotion の事故（`verify-remotion-src-imports.js` の冒頭）と同じ型。事故は `seriesDayLabel.js` を切り出して回避しただけで、根（`languages.js` が記事を持つ）はそのまま。`raceDetailHeading.js` から `languages.js` に届くことは、検査の自己確認として今も使われている |
| `src/utils` と `src/services` が `src/components/race/basicInfoStats.js` を import（逆向き） | `utils/meetPageModel.js`・`assistModel.js`・`analogyAggregate.js`・`racerConditionStats.js`・`assistSummary.js`・`accidentRate.js`・`racerVenueBoatStats.js`、`services/supabaseDataService.js` ほか、全体で 36 ファイル | `basicInfoStats.js` 自体は画面に触れない純関数だが、`components/` の下にあるので pure の根に入れられない。依存は `scripts/lib/hitCalculator.js`・`utils/raceId.js`・`utils/meetGrouping.js`・`utils/dateUtils.js` に伸びているため、これらを先に pure へ移す連鎖が要る |
| `src/utils` が `src/components/race/{seriesPoints,weatherInfo}.js` を import | `seriesPoints.js` は `src/pure/seriesPoints.js` への再 export の殻（段3で pure へ移したが殻が残り、呼び出しが殻経由のまま）。`scripts/lib/meetBoundaries.js` 19 行目も殻経由 | 殻を消して pure に向け直せば、向きが正しくなる |
| `src/utils` が `src/data` を import | `assistModel.js`・`assistTheory.js`（`thinkingAssistCopy.js`・`theoryCatalog.js`）、`venueSummary.js`（`venueSummaryStats.js`）、`botPageModel.js`（`blogPosts.js`） | `botPageModel.js` は `api/_lib/botPage.js` から Node で読まれる。`blogPosts.js` は `import.meta.glob`（Vite）と fs の二股。`verify-bot-page-model.js` が経路を検査している（守られている）。ほかの3つは画面だけで読まれるので害は小さい |
| `api/` が `src/pages/` を import | `api/_lib/snsXSend.js` 1 行目・`snsResearchImage.js` 8 行目が `src/pages/admin/sns-hub/utils.js`（49 行、`buildPostText`） | 画面の置き場から関数の置き場へ。`buildPostText` を `src/pure` か `scripts/lib` へ移すのが筋。`api` ↔ `src/pages` の向きは検査が無い |
| `src/utils` が `window` / `document` / `localStorage` に触れる | `analytics.js` 27 箇所、`theme.js`・`webShare.js` 各 5、`raceView.js` 2、`assistSession.js` 1 | いずれもブラウザ専用と分かる名前・用途で、Node から読まれる経路には載っていない（`botPageModel` の検査が守る）。優先度は低い |

既存の関所: `verify-pure-imports.js`（`src/pure` と `scripts/lib/pure` の中の import と global）、`verify-remotion-src-imports.js`（`sns-video-studio/remotion/src` から `languages.js`・`blogPosts*.js` への到達）、`verify-bot-page-model.js` など。**`src/utils` 全体や `api` の向きを検査するものは無い**。

## 5. 試験の弱い所

「大きい関数」で、verify も e2e も名前が出ないもの（`supabaseDataService` はメソッド名で、ほかはファイル名で検索）。

| 対象 | 行 | verify / e2e |
|---|---|---|
| `supabaseDataService.getAccuracy` | 360 | 0 / 0 |
| `getVenueMotorList` | 159 | 0 / 0 |
| `getRaceMeetPrevRuns` | 155 | 0 / 0 |
| `getRaceRacerBoatReturnRate` | 135 | 0 / 0 |
| `getRaceExhibitionTimeBreakdown` | 126 | 0 / 0 |
| `getOutcomeDistribution` | 117 | 0 / 0 |
| `getMorningDigest` | 116 | 0 / 0 |
| `getTodaysRacerFormRanking` | 113 | 0 / 0 |
| `getRaceTechniqueProfileBreakdown` | 112 | 0 / 0 |
| `getNigeOutcomeDistribution` | 95 | 0 / 0 |
| `RaceBasicInfoTab.jsx` | 1303 | 0 / 0 |
| `ThinkingAssistPage.jsx`（`ThinkingAssistBody` 854） | 1096 | 0 / 0 |
| `LensSummary.jsx` | 948 | 0 / 0 |
| `PoirotExplanation.jsx` | 826 | 0 / 0 |
| `ScenarioTab.jsx` | 812 | 0 / 0 |
| `RaceMeetTab.jsx`（1602 行の1コンポーネント） | 1693 | 2 / 0（e2e は `race-detail-tabs`・`smoke` に名前が出ず、別名の `meet-*.spec` はある。名前では測れない） |
| `PredictionPanel.jsx` | 863 | 0 / 2（e2e のみ。fix 18） |
| `scripts/lib/snsTodayPlanner.js` `runTodayPlan` | 725 | 3 verify（名前が出る） |

試験が薄く、かつ fix が多い順（効く量の上位）は `supabaseDataService.js`（fix 70）・`RaceMeetTab.jsx`（21）・`PredictionPanel.jsx`（18）・`MotorConditionChart.jsx`（18）。

## 6. 開発効率 plan 段3の続きと重なるもの

段3の進み（`.git/orchestrator/foundation-plan-2026-10-27.md`、`docs/design/dev-efficiency/plan.md` 77〜85・130 行）: 1件目 `meetExclusionsOf` → `src/pure`（#1837 #1843）、2件目 `buildRacerScopedRaceRows`（#1844 #1845）済み、**3件目 `getRaceMotorBreakdown` が未**、そのあと ADR-0072 のランナーの見直し。

| 候補 | 段3との関係 |
|---|---|
| 候補 1（`getRaceMotorBreakdown` の整形） | 段3の3件目そのもの。続きとして書く |
| 候補 3（`basicInfoStats.js` を pure へ） | 段3の「pure の根を広げる」の次。`meetExclusion`・`seriesPoints`・`raceStageConfig` と同じ殻方式（本体を `src/pure` に移し、元の場所に再 export の殻を残す） |
| 候補 4（`languages.js` と記事データの切断） | 段1bの `verify-pure-imports` の範囲外（`src/config`）。独立 |
| 候補 10（`no-unused-vars` を CI へ） | plan 179 行「BOA-1015〜1018・1024 の解消 → `no-unused-vars` を入れる」の続き。数は 293 → 294 で解消は進んでいない |

## 候補の表（効く量の順）

効く量は、直近3か月の変更回数と fix の回数、試験の薄さ、将来の予定への近さ（BOA-1020 が `getRaceMotorBreakdown` を変える予定、など）で並べた。式ではなく読み物としての順。

| # | 候補 | 根拠（数字） | 規模 | Codex に回せるか | 先に要る試験 |
|---|---|---|---|---|---|
| 1 | `getRaceMotorBreakdown` の整形を pure へ（段3の3件目） | `supabaseDataService.js` 変更 178・fix 70。plan: この整形に fix 5 件・110 行、次に BOA-1020 が変える。本体 168 行（2645〜）、キャッシュ鍵 v11 まで上がっている | 1 PR・3 ファイル（新規 `src/pure/motorBreakdown.js`・service・verify） | 切り出しは Claude（DAL の変更を含む。plan 166 行）。移した純関数の verify の追加は Codex 可 | 切り出しの前に、今の出力を固定する verify（過去レース・当日・新モーター・取得失敗の4形） |
| 2 | `RaceMeetTab.jsx` の分割（1コンポーネント 1602 行） | 変更 40・fix 21・e2e に名前なし・verify 2。節ページの中心 | 大。段階: 行の組み立てを pure へ（数 PR）→ 見出し・表を小コンポーネントへ | 段階の各 PR は可（1 PR ≒ 1 つの純関数 + verify、300 行以内に切る）。全体は不可 | 組み立てを出す前に、`meet-page.spec` / `meet-form-nav.spec` が今の表示を固定しているか確認し、足りない表の形は先に e2e で固定 |
| 3 | `basicInfoStats.js` を `src/pure` へ（殻つき） | 36 ファイルが import、変更 36・fix 17、逆向き（`utils`・`services` から `components` へ）。pure に移す前提の `hitCalculator`・`raceId`・`meetGrouping`・`dateUtils` の連鎖 | 3 PR: (a) 依存4つを pure へ（殻つき）、(b) `basicInfoStats` を移す（殻つき）、(c) 呼び出し側を殻から直す | (a)(b) は可（殻方式で 2〜5 ファイル）。(c) は 36 ファイルなのでまとめない | `verify-pure-imports.js` が通ることが試験（既存）。移すだけなので新規の verify は不要。6 つの既存 verify が回帰を見る |
| 4 | `languages.js` から記事データを切る（Remotion の事故の根） | 事故 2026-11-04（21:28 から全動画が落ちた）。`languages.js` が記事 3 本の import を持つ。5 ファイルが `localizePath` のためだけに import | 小。`localizePath` 等を `src/pure/localizePath.js`（記事に触れない）へ、`languages.js` は再 export と記事の登録 | 可（4〜5 ファイル） | `verify-remotion-src-imports.js` の自己確認（`raceDetailHeading.js` から `languages.js` に届く）が変わるので、同じ PR で期待値を直す。`localizePath` の verify を足す |
| 5 | 会場名の表を1つにそろえる | `VENUE_NAMES` が 21 ファイル + 正準が3つ並立。専門役サービスと分析チャート 9 ファイル | 中。正準を `scripts/lib/venueNames.js` に決め、`src/constants` の `STADIUM_NAMES` と `venueRules.js` を再 export にし、残りを import へ。1 PR 5 ファイル×5 PR | 可（各 PR 5 ファイル以内の機械的置き換え） | 各ファイルの表が正準と同じ文字列か（`24` 会場の比較）を `verify-venue-names.js`（新規）で先に固定。差があれば直す前にオーナー報告 |
| 6 | `MotorConditionChart.jsx` の分割（1関数 1503 行） | 変更 39・fix 18・hooks 24・verify 5 / e2e 1 | 大。段階: データ取得の hook → 系列の組み立てを pure → 描画 | 段階の各 PR は可。全体は不可 | 系列の組み立て（`getRaceMotorBreakdown` の戻りを使う）を先に verify で固定。候補 1 のあとに行う（戻りの形が変わるため） |
| 7 | `RaceBasicInfoTab.jsx` の分割（1303 行）と `slashDate` の重複 3 か所の統合 | 変更 31・fix 14・verify 0 / e2e 0（試験が全く無い）。`slashDate` が 3 ファイルで同一 | 大。まず `slashDate` を `formatters.js` へ（小）、そのあと組み立てを出す | `slashDate` の統合は可。分割は段階ごとに可 | 表の6形（期別・今節・会場別など）を e2e で固定してから出す |
| 8 | JST の今日・日付加算・`parseRaceId` の統合 | `jstToday` 8・`addDays` 6・`parseRaceId` 4 か所。同じ式が src・api・scripts/lib で 32 箇所 | 中。共通を `scripts/lib/dateUtils.js` / `src/utils/raceId.js` に決め、置き換え。日付の取り違えは本番で気付きにくい | 可（1 PR 5 ファイル以内で、置き換えのたびに既存の verify が回帰を見る） | `jstToday` を UTC 15:00 の境でそろえる verify を先に（前日にずれない。`verify-bot-page-model.js` に近い試験が既にある） |
| 9 | `locales/*/common.json` を名前空間で分ける | 4 言語で 3 か月に 1098 回。`aiPredictionTab` が 1326 / 4011 行。衝突とレビューの重さの源。`i18n.js` は `import.meta.glob("./locales/*/common.json")` | 中。`aiPredictionTab` を `aiPredictionTab.json` へ（4 言語 + `i18n.js` + `verify-i18n-consistency.js` = 6 ファイル）。残りは別 PR | 条件つきで可（`i18n.js` の読み込みの変更を含む。6 ファイルで 5 を超えるので、i18n.js と verify を先の PR、JSON の移動を後の PR に分ける） | `verify-i18n-consistency.js` が複数ファイルを読めるようにするのが先。ここが通れば機械的な移動 |
| 10 | `no-unused-vars` を CI のエラーに（BOA-1057・1104 の完了） | 違反 294（`generated-rules.js` 195 + `recalculate-all-rules.js` 47 + 残り 52）。`src/`・`api/` は 0 | 小〜中。生成物は生成元を直すか lint から外す。残りは 22 ファイルの削除 | 可（ファイルごとに削除、1 PR 5 ファイル以内で 5 PR ほど） | 試験は不要（削除だけ）。最後に `eslint.config.js` の `no-unused-vars` が `error` で通ること |
| 11 | `PredictionPanel.jsx` の分割（738 行 1コンポーネント） | 変更 60（`src/components` で最多）・fix 18・verify 0 / e2e 2 | 中〜大 | 段階ごとに可 | 表示の形を固定する e2e（予想の6状態）を先に |
| 12 | `RaceBeforeInfoTab.jsx`（1020 行）・`RacerPerformanceStats.jsx`（1028 行）の分割 | 変更 25・27、fix 12 | 大 | 段階ごとに可 | 候補 2・6・7 と同じ型。最初の1件の結果を見てから |
| 13 | `src/pages/admin/sns-hub/utils.js` の `buildPostText` を `api` から切る | `api/_lib/snsXSend.js` 1 行目・`snsResearchImage.js` 8 行目が `src/pages/` を import（49 行のファイル） | 小。`buildPostText` を `scripts/lib/` へ、画面側は再 export | 可（3 ファイル） | `verify-sns-*.js` が本文を固定済み（`buildPostText` の出力）か確認 |
| 14 | 死んだ 2 メソッドと 6 export の削除 | `getAllRacersLite`・`getRacerGradeCache`（約 61 行）、`export` の未使用 6 | 小。ただし本ファイルは変更が多く衝突しやすい | 可（3 ファイル） | 不要（呼び出しゼロの確認を PR に書く） |
| 15 | `snsTodayPlanner.js` `runTodayPlan`（725 行 1 関数）の分割 | 変更 23。verify 3 が名前を出す | 中〜大 | 段階ごとに可 | 送信に近い。優先度は SNS 側の担当と相談 |
| 16 | 未使用の i18n キー・未使用 CSS の洗い出し | 測れていない（上述） | 調査 | 調査は可 | 実行時のキー使用の記録（`saveMissing` 相当）を E2E で取る仕組みが要る |

## 上位10件の Codex 用の起票案

起票するときは `## Codex 用` の5項目（AGENTS.md・`feedback_codex_ok_needs_codex_section`）を足す。マイグレーションを含むものは無い。

1. **`getRaceMotorBreakdown` の今の出力を verify で固定する**（候補 1 の前段）: 過去レース・当日・新モーター（freshness あり）・会場公式の取得失敗（`fetchFailed`）の4形の戻りを、`getRaceMotorBreakdown` へフェイクの `supabase` を差して固定する `verify-race-motor-breakdown.js`（登録つき）。コードは変えない。切り出し本体は Claude が続ける（DAL の変更）。
2. **`basicInfoStats.js` の依存4つを `src/pure` へ**（候補 3 の a）: `scripts/lib/hitCalculator.js` の `isPlaceHit`・`isShowHit`、`src/utils/raceId.js`、`meetGrouping.js`、`dateUtils.js` の `getDaysAgoJST` を、手を加えず `src/pure/` に移し、元の場所に再 export の殻を残す。`verify-pure-imports.js` が通ること。1 PR 5 ファイル以内になるよう、依存ごとに分ける。
3. **`basicInfoStats.js` 本体を `src/pure` へ（殻つき）**（候補 3 の b、2 の後）: 本体を移し、`src/components/race/basicInfoStats.js` を再 export の殻にする。呼び出し側の import は変えない。既存の 6 つの verify が通ること。
4. **`localizePath` を記事データから切る**（候補 4）: `src/config/languages.js` の `localizePath` と言語コードの定義を `src/pure/localizePath.js`（記事に触れない）へ移し、`languages.js` は再 export と記事の登録だけにする。`raceDetailHeading.js`・`pageMeta.js`・`botPageModel.js`・`aiCopyText.js` の import を新しい場所へ。`verify-remotion-src-imports.js` の自己確認（`raceDetailHeading.js` から `languages.js` に届く）の期待値を同じ PR で直す。
5. **会場名の表を `scripts/lib/venueNames.js` に一本化 1/5**（候補 5）: まず `verify-venue-names.js` で、`src/constants/index.js` の `STADIUM_NAMES`・`src/config/venueRules.js` の `VENUE_NAMES`・`supabaseDataService.js` の5か所の表が正準と同じ 24 会場の文字列かを固定。違いがあれば直さず報告。続きの 2/5〜5/5 は、`src/services/*Service.js` の5つ、分析チャート 9 ファイルを5ファイルずつ。
6. **`slashDate` を `formatters.js` に統合し、`RaceBasicInfoTab.jsx` の組み立てを1つ出す**（候補 7 の前段）: `RaceBasicInfoTab.jsx` 81・`raceIndicators.jsx` 165・`RacerPerformanceStats.jsx` 136 の同一の1行を `src/utils/formatters.js` の1関数にし、3 ファイルを import に。ほかは触らない。
7. **JST の今日・`addDays`・`parseRaceId` の統合 1/3**（候補 8）: `jstToday` の5つの専門役サービスを `getTodayJST` に置き換える（5 ファイル）。UTC 15:00 の境の verify を先に足す。2/3 は `scripts/lib` の `addDays` 6 か所、3/3 は `parseRaceId` 3 か所。
8. **`no-unused-vars` 違反の削除 1/5**（候補 10）: `scripts/analysis/recalculate-all-rules.js` の 47 件ほか、`scripts/` の 22 ファイルを5ファイルずつ。削除だけで動きは変えない。`generated-rules.js` の195件は生成元を確かめてから別件。
9. **`aiPredictionTab` を `locales/{lang}/aiPredictionTab.json` に分ける 1/2**（候補 9）: まず `i18n.js` の読み込みと `verify-i18n-consistency.js` を、複数ファイルを読めるように直す（動きは変えない）。次の PR で `aiPredictionTab` の 4 言語の JSON を移す。
10. **`buildPostText` を `api` から切る**（候補 13）: `src/pages/admin/sns-hub/utils.js` の `buildPostText` を `scripts/lib/snsPostText.js` へ移し、`api/_lib/snsXSend.js`・`snsResearchImage.js` の import を直す。画面側は再 export。`verify-sns-*.js` が通ること。

候補 2・6・11・12（大きいコンポーネントの分割）は、1〜3 のうち1件の結果（試験で固定してから出す型が機能するか）を見たあとに起票する。候補 14（死んだメソッド）は `supabaseDataService.js` に触る別の PR と衝突しやすいので、候補 1 の切り出しのあとに。

## 今回測れなかったもの

- i18n の未使用キー・未使用 CSS: 静的な検索が動的キーで偽陽性だらけのため数字を出していない（候補 16）
- 「意味が同じで書き方の違う重複」: 名前の完全一致でしか拾っていない。日目・締切・グレードの文は4つの `src/utils` ファイルに分かれていることだけ確認
- 効く量の式: 変更回数・fix 数・試験の有無を並べただけで、点数にはしていない
- 試験の有無: 名前が出るかの文字列検索であり、網羅の度合いは見ていない
