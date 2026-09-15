# 全レース関連データ 棚卸しマップ（2026-09-15）

## 目的

「取得できる全てのレース関連データを取得する」「取得タイミングも全体最適化する」という方針のもと、まず**現状把握**として全データ項目を棚卸しする。データの見せ方（UI）は後回しにし、本ドキュメントはデータの取得範囲・正確性・タイミング要件のみに焦点を当てる。`/step1-spec`によるSDD仕様策定（設計フェーズ）の入力資料として使う想定。

## 分類の観点

各データ項目を3つの軸で評価する（[data-readiness-and-scraping-optimization-2026-09-15.md](../competitor-kyoteibiyori/data-readiness-and-scraping-optimization-2026-09-15.md)で定義した軸を踏襲）:

- **①網羅性**: 取得しているか（✅取得済み/⚠️部分的/❌未取得）
- **③正確性**: 取れた値が合っているか（既知バグの有無）
- **②タイミング要件**: いつ取る必要があるか。以下5分類で統一する

| 分類 | 意味 | 例 |
|---|---|---|
| **T1: 発走直前ウィンドウ** | 特定の時間窓を逃すと二度と正確な値が取れない | 展示ST・展示タイム、オッズ |
| **T2: 当日随時更新** | 当日中に進捗が変わるが、多少の遅延は許容できる | 今節成績（当日分）、欠場・中止検出 |
| **T3: レース後1回** | 結果確定後に一度取れればよい | 着順・配当・決まり手・確定天候 |
| **T4: 前日〜当日朝1回** | 開催前に決定済みで当日中は不変 | 出走表選手情報・級別・モーター/ボート番号 |
| **T5: 低頻度・静的** | 月1回以下、大きな変更が無い限り不変 | 選手プロフィール、会場物理特性、潮汐 |

## A. 中央ポータル（boatrace.jp）由来データ

### A-1. 出走表（racelist）— T4（前日〜当日朝1回）

| データ | 状態 | 保存先 | 現在の実行基盤 | 関連チケット |
|---|---|---|---|---|
| 選手名・級別・年齢・全国/当地成績・モーター/ボート番号と成績 | ✅ | `race_entries` | `morning-init.js`→`scrape-to-json.js`（races テーブルが空の時のみ1回、`scrape-scheduled.yml`と同一concurrencyグループ内） | - |
| 体重 | ❌（ページ上に存在するがパース時に破棄） | - | 同上 | [BOA-288](https://linear.app/boat-ai/issue/BOA-288) |
| 今節成績（節内の日別進入・着順・ST履歴） | ❌ | - | 未実装 | [BOA-291](https://linear.app/boat-ai/issue/BOA-291)（**T2要素を含む、下記参照**） |
| 今節得点率 | ❌ | - | 未実装 | [BOA-220](https://linear.app/boat-ai/issue/BOA-220)（BOA-291とスコープ重複要整理） |
| ラウンド種別（予選/準優勝戦/優勝戦） | ❌（`.title16_titleDetail__add2020`に平文で存在） | - | 未実装 | [BOA-226](https://linear.app/boat-ai/issue/BOA-226) |

**タイミング要件の注記**: 今節成績のうち「過去の開催日分」はT4相当（一度確定すれば変わらない）だが、「当日分」は当日のレース結果が確定するたびに更新が必要なT2要素を含む混合型。設計時にこの2つを分けて扱う必要がある。

### A-2. 直前情報（beforeinfo）— T1（発走直前ウィンドウ）

| データ | 状態 | 保存先 | 現在の実行基盤 | 関連チケット |
|---|---|---|---|---|
| 展示タイム・展示ST | ✅（欠落率の問題あり） | `exhibition_data` | Vercel Function（`api/cron/exhibition.js`、cron-job.org 2分間隔、[BOA-313](https://linear.app/boat-ai/issue/BOA-313) Phase 1で移行済み） | BOA-313 |
| 天気・気温・風向・風速・水温・波高 | ✅ | `race_conditions` | `update-race-info.js`（発走60分前ウィンドウ、`scrape-scheduled.js`内） | - |
| 展示スタート表の「コース」列（進入予想） | ❌ | - | 未実装 | [BOA-290](https://linear.app/boat-ai/issue/BOA-290) |
| 当日体重・調整重量 | ❌ | - | 未実装 | [BOA-289](https://linear.app/boat-ai/issue/BOA-289)（体重は対応中/一部Done） |
| チルト角度・プロペラ交換・部品交換 | ✅（Done） | - | [BOA-221](https://linear.app/boat-ai/issue/BOA-221) | 完了 |
| 選手コメント | ❌ | - | 未実装 | [BOA-273](https://linear.app/boat-ai/issue/BOA-273)（AI言語化検討） |
| 前検タイム・周回タイム・周り足・直線タイム | ❌ | - | 未実装 | [BOA-266](https://linear.app/boat-ai/issue/BOA-266) |

### A-3. 結果（raceresult）— T3（レース後1回）

| データ | 状態 | 保存先 | 現在の実行基盤 | 関連チケット |
|---|---|---|---|---|
| 1〜3着艇番・タイム | ✅ | `race_results` | `scrape-results.js`（`runResults`、`scrape-scheduled.js`内、`getRacesAfterStart(schedule, 5)`＝発走5分後以降を対象に再試行） | - |
| 決まり手 | ✅ | `race_results.winning_technique` | 同上 | - |
| 進入コース | ⚠️（艇番と100%一致するバグ） | `race_results.course_1〜6` | 同上 | [BOA-257](https://linear.app/boat-ai/issue/BOA-257)（最重要） |
| 各艇ST | ✅ | `race_start_timings` | 同上 | - |
| 配当（単勝/複勝/3連複/3連単/2連単/2連複/拡連複） | ✅ | `race_results.payout_*` | 同上 | - |
| 事故・失格等の備考 | ❌ | - | 未実装（「着」列のテキストを読んでいない） | [BOA-279](https://linear.app/boat-ai/issue/BOA-279) |
| 確定天候（結果取得時の再取得） | ❌ | - | 未実装、朝の1回取得のみ | `DATA_ACQUISITION_STRATEGY.md`のPhase2候補 |

### A-4. オッズ（oddstf/odds3t/odds3f等）— T1（発走直前ウィンドウ、券種ごとに複数スナップショット）

| データ | 状態 | 保存先 | 現在の実行基盤 | 関連チケット |
|---|---|---|---|---|
| 単勝・複勝（全艇） | ✅ | `race_odds` | `scrape-odds.js`（`runOdds`、`scrape-scheduled.js`内、ODDS_WINDOWS=[60,30,15,10,5]分前 各±3分） | - |
| 3連単（人気上位3つ、通常時） | ✅ | `race_odds.trifecta_popular_*` | 同上 | - |
| 3連単（全120通り、発走直前ウィンドウのみ） | ✅ | `race_odds.trifecta_all`（JSON、[BOA-104](https://linear.app/boat-ai/issue/BOA-104)） | 同上 | - |
| 3連複（全通り） | ⚠️**新発見**: `parseTrioAll()`パーサーは既存（`scripts/lib/oddsParser.js`）だが、呼び出し元は`scrape-prediction-odds.js`のみで**AI予想の特定組み合わせだけ**を取得。全通りの網羅取得はしていない | `prediction_odds`（限定的） | `scrape-prediction-odds.js`（`runPredictionOdds`、predictions確定後） | [BOA-314](https://linear.app/boat-ai/issue/BOA-314)（要訂正、下記参照） |
| 2連単・2連複・拡連複（全通り） | ❌完全に未取得。パーサーも未実装 | - | 未実装 | [BOA-314](https://linear.app/boat-ai/issue/BOA-314) |

**BOA-314への訂正が必要**: 「3連複は完全に未取得」としていたが、パーサー（`parseTrioAll`）は既存かつAI予想向けに部分的に呼ばれている。全通り網羅の欠如は変わらないが、ゼロから作るのではなく既存パーサーを転用できる点は着手コストに影響する。

### A-5. SG/G1限定ページ（pitreport等）— T4/T5

| データ | 状態 | 関連チケット |
|---|---|---|
| ピットレポート・得点率一覧・得点率早見表 | ❌完全に未対応 | [BOA-292](https://linear.app/boat-ai/issue/BOA-292)（対象がSG/G1のみのため優先度低） |

## B. 選手プロフィール（レーサー検索ページ）— T5（低頻度・静的）

| データ | 状態 | 保存先 | 現在の実行基盤 | 関連チケット |
|---|---|---|---|---|
| 支部・出身地・身長・体重・血液型・生年月日 | ⚠️（データはあるが自動更新なし） | `racer_profiles` | `scripts/maintenance/scrape-racer-profiles.js`（**手動実行のみ、GitHub Actions等の自動ジョブが無い**） | [BOA-297](https://linear.app/boat-ai/issue/BOA-297)（Canceled、テーブル自体は存在すると判明）。**自動更新ジョブが無い点は未解決のまま残っている**（新規課題として要起票） |
| フライング休み・前期/今期未消化フライング数 | ❌ | - | 未実装 | [[vup_feature_analysis_skill]]メモリで既知 |

## C. 会場個別公式サイト（24会場）由来データ — T5中心（一部T2/T1混在の可能性）

現行のスクレイピングパイプラインは中央ポータルのみが対象で、**会場独自サイトは一切取得していない**（[BOA-282](https://linear.app/boat-ai/issue/BOA-282)横断調査で判明）。

| データ | 対象会場 | 状態 | タイミング要件 | 関連チケット |
|---|---|---|---|---|
| 進入コース別選手成績（枠→実進入コース遷移確率） | 12/24会場で個別選手データ確認済み | ❌未取得 | T4〜T5（当日出走選手の傾向データ、開催前に概ね決まる） | [BOA-293](https://linear.app/boat-ai/issue/BOA-293)（最重要、BOA-257の代替材料） |
| 潮汐表（潮位・満干潮時刻） | 鳴門・若松・大村・丸亀・徳山 | ❌未取得 | T5（天文計算ベースで数日先まで既知、静的に近い） | [BOA-295](https://linear.app/boat-ai/issue/BOA-295) |
| 会場レイアウト変更履歴 | 唐津で確認済み | ❌未取得 | T5（年数回のイベント） | [BOA-296](https://linear.app/boat-ai/issue/BOA-296) |
| 水面特性・モーター/ボートランキング・前検ランキング・コンピ指数・得点率・出目データ・高配当ランキング等 | 会場により様々 | ❌未取得、価値精査未着手 | 混在（前検ランキング等はT1〜T2に近い可能性） | [BOA-294](https://linear.app/boat-ai/issue/BOA-294) |
| 体重履歴一覧表（PDF） | 宮島のみ確認 | ❌未取得 | T5 | BOA-288関連 |
| 兵庫支部選手プロフィール（出身地・生年月日・血液型・インタビュー） | 尼崎 | 中央の`racer_profiles`と重複、インタビュー本文のみ新規性あり | T5 | 新規性低い、優先度低 |

**技術的制約**: 24会場は複数のCMSベンダーに分かれる（`/modules/`パス構成の共通CMS群と、レガシーな静的HTML/ASP構成群）。単一スクレイパーでは対応できず、CMSベンダー単位でのテンプレート共通化を検討する余地がある（[data-coverage-comparison-2026-09-14.md](../competitor-kyoteibiyori/data-coverage-comparison-2026-09-14.md)参照）。

## D. 現在の実行基盤の全体像（タイミング要件とのクロス集計）

| 実行基盤 | 対象データ | トリガー | 状態 |
|---|---|---|---|
| `scrape-scheduled.yml`→`morning-init.js` | 出走表（T4） | 当日races テーブルが空の場合のみ、5分毎リトライで自然救済 | 稼働中、比較的頑健 |
| `scrape-scheduled.yml`→`scrape-scheduled.js`（レガシー、GitHub Actions） | 天候更新(T1寄り)・結果(T3)・オッズ(T1)・予測買い目オッズ(T1) | cron-job.org 5分毎トリガー、`concurrency: cancel-in-progress: false` | **BOA-313が問題視する構造がまだ残っている**（展示のみPhase1で移行済み、結果・オッズは未移行） |
| Vercel Function（`api/cron/exhibition.js`） | 展示データ(T1) | cron-job.org 2分間隔（7:00-23:00 JST） | 稼働中・並走検証中（BOA-313 Phase1） |
| `scripts/maintenance/scrape-racer-profiles.js` | 選手プロフィール(T5) | **自動実行ジョブなし、手動実行のみ** | 要改善（新規課題） |
| （無し） | 会場個別サイト全般(C節) | - | 未着手 |

**重要な観察**: 「結果」「オッズ」は依然としてBOA-313が問題視するレガシーGitHub Actionsオーケストレーターの中にあり、**展示データだけが先行して問題を解消した状態**。今回の全体最適化を考える上で、Phase 2（結果）・Phase 3（オッズ）を含めた完了、および会場個別サイト・選手プロフィールの自動化まで含めた「実行基盤の統一」が本丸になる。

## E. 未確定・要確認事項（次の`/step1-spec`で詰めるべき論点）

1. **今節成績（T2要素）をどの基盤に乗せるか**: 当日随時更新が必要なら、レガシーオーケストレーターに追加せず、BOA-313のVercel Functionsパターンで新規設計すべき
2. **会場個別サイト（24会場、C節）の実行基盤**: 現状ゼロからの新規構築。CMSベンダー単位のテンプレート共通化を先に検討するか、価値の高い会場（BOA-293対象の12会場等）から個別実装するか
3. **選手プロフィール自動化**: 手動実行のみという運用課題を、自動化スコープに含めるか（低頻度更新でよいためGitHub Actionsの日次/週次ジョブで十分と思われる）
4. **BOA-314の再スコープ**: 3連複は`parseTrioAll`が既存のため、2連単・2連複・拡連複より着手コストが低い可能性。券種ごとに優先順位を分けるか
5. **オッズ全券種取得の保存設計**: 4券種×レース数×スナップショット数で急激にレコードが増える可能性。`trifecta_all`と同じJSON列方式を全券種に踏襲するか、正規化した別テーブルにするかの設計判断が必要
