# データ整備・スクレイピング最適化 統合整理（2026-09-15）

## 背景

[BOA-305](https://linear.app/boat-ai/issue/BOA-305)（レース詳細ページのUI/UX改善）を進める前提として、ユーザーから「まずデータ整備が必要」「現状のスクレイピング設計全体の最適化問題も絡む」という指摘があった。既存の関連ドキュメント（`docs/issues/DATA_SCRAPING_GAPS.md`、`docs/proposal/DATA_ACQUISITION_STRATEGY.md`、`docs/proposal/scraping-serverless-migration/investigation.md`、`docs/design/scraping-serverless-migration/spec.md`）とレース詳細ページ側の調査（[race-detail-page-tab-comparison-2026-09-15.md](./race-detail-page-tab-comparison-2026-09-15.md)）を横断して、問題を整理する。

**状況更新（2026-09-15夕方）**: 軸②（サーバーレス移行）は他セッションが設計・実装・Linearチケット起票（[BOA-313](https://linear.app/boat-ai/issue/BOA-313)）まで一貫して担当している。本ドキュメントは進捗を参照するのみで、当該作業には関与しない。

## 問題は3つの異なる軸に分かれる

同じ「スクレイピングがちゃんとできていない」という感覚の中に、実際には性質の異なる3つの問題が混在している。混同すると対策も混同するため、まず軸を分離する。

| 軸 | 問い | 症状の例 |
|---|---|---|
| **① 網羅性（Coverage）** | そもそも何を取得しているか | 今節成績が未取得、オッズが一部券種しか無い、事故情報が無い |
| **② 信頼性（Reliability/Timeliness）** | 対象にしているデータを、確実に・間に合うタイミングで取れているか | 展示データが「レース前に見ると空欄」になる、結果が「レース後に見ると無い」 |
| **③ 正確性（Correctness）** | 取れた値そのものが合っているか | 進入コースが艇番と100%一致するバグ、中止レースが勝率計算に混入するバグ |

## 各軸の現状棚卸し

### 軸①: 網羅性（データ欠落）

レース詳細ページのタブに直結するもの（[race-detail-page-tab-comparison-2026-09-15.md](./race-detail-page-tab-comparison-2026-09-15.md)で確認済み）:

| データ | チケット | 状態 |
|---|---|---|
| 今節成績（節内の日別進入・着順・ST履歴） | [BOA-291](https://linear.app/boat-ai/issue/BOA-291) | Backlog、未着手 |
| 今節得点率 | [BOA-220](https://linear.app/boat-ai/issue/BOA-220) | Backlog、BOA-291とスコープ重複要整理 |
| 事故情報（転覆・エンジン不動足等） | [BOA-279](https://linear.app/boat-ai/issue/BOA-279) | Backlog |
| チルト・プロペラ交換・部品交換・調整重量 | [BOA-221](https://linear.app/boat-ai/issue/BOA-221) | Done |
| オッズ全券種（3連複・2連単・2連複・拡連複） | 未起票 | **確認済み・完全に未取得**（`scrape-odds.js`は`oddstf`単勝複勝・`odds3t`3連単の2ページしか叩いていない。3連単も通常は人気上位3つのみ、発走直前ウィンドウのみ全120通りを`trifecta_all`列に保存、BOA-104） |

会場個別サイト由来（`docs/proposal/competitor-kyoteibiyori/data-coverage-comparison-2026-09-14.md`で確認済み、レース詳細ページより広いスコープ）: [BOA-293](https://linear.app/boat-ai/issue/BOA-293)（進入コース別選手成績、最重要）、[BOA-294](https://linear.app/boat-ai/issue/BOA-294)（水面特性等）、[BOA-295](https://linear.app/boat-ai/issue/BOA-295)（潮汐）、[BOA-296](https://linear.app/boat-ai/issue/BOA-296)（会場レイアウト変更履歴）。

### 軸②: 信頼性（取得タイミングの構造的問題）

追跡チケット: [BOA-313](https://linear.app/boat-ai/issue/BOA-313)（他セッション起票・実装中、状態: In Progress）。

- **根本原因**: `scrape-scheduled.js`オーケストレーターが1回の実行でレース情報・オッズ・展示・結果・予測買い目を直列処理し、実行に4〜10分かかることがある。GitHub Actionsの`concurrency: { cancel-in-progress: false }`により、処理が詰まると**後続のトリガーがまるごとキャンセル**され、展示データ取得の窓（発走30/15/10分前）が失われる
- **実測影響**: 展示データ欠落率が2026-09-12=0.6%→09-13=6.7%→09-14=8.1%と悪化（09-13は福岡で7レース連続欠落）
- **対策**: 時間に厳しい処理（展示→結果→オッズの順）をGitHub ActionsからVercel Serverless Functionsへ段階移行する。cron-job.orgは**既にトリガーとして稼働中**（この移行は「cron-job.orgへの新規移行」ではなく、「cron-job.orgからの呼び出し先をGitHub ActionsからVercel Functionsに変える」という意味）
- **実装進捗（2026-09-15時点、BOA-313より）**: **Phase 1（展示データ）は実装完了・並走検証中**。
  - Step 1（`api/cron/exhibition.js`実装、`CRON_SECRET`設定、単体デプロイ確認）完了 — [PR #637](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/637)（マージ済み）、[PR #639](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/639)（タイムアウト設計を案B＝`waitUntil`で即応答に確定、マージ済み）
  - cron-job.orgに`Vercel Exhibition Cron`ジョブを追加、2分間隔（7:00-23:00 JST）で稼働中（2026-09-14夕方〜）
  - 日次欠落率の自動監視（`exhibition-gap-monitor.yml`）実装済み — [PR #641](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/641)（マージ済み）
  - 外部cronセットアップガイド更新済み — [PR #640](https://github.com/rhapsody0919/boatrace-ai-predictor/pull/640)（マージ済み）
  - **Step 2（並走期間、最低3〜7日間）は進行中**: 2026-09-14分は部分日稼働で欠落率4.2%（閾値2%超過、稼働時間帯が限定的だったことが要因）。2026-09-15が終日稼働の初日で、2026-09-16朝の計測が最初の公平な比較になる見込み
  - Step 3（並走結果に問題なければGitHub Actions側の展示データ処理を無効化）・Step 4（切替後1週間監視）は未着手
  - Phase 2（結果取得）・Phase 3（オッズ）はPhase 1完了後に着手予定、現時点で未着手

### 軸③: 正確性（判明済みバグ）

いずれも既存チケットで捕捉済み: [BOA-257](https://linear.app/boat-ai/issue/BOA-257)（進入コースが艇番と100%一致、スクレイピングバグ）、[BOA-298](https://linear.app/boat-ai/issue/BOA-298)（勝率計算が中止/不成立レースを除外していない）、[BOA-300](https://linear.app/boat-ai/issue/BOA-300)（null判定の実挙動不一致）、[BOA-302](https://linear.app/boat-ai/issue/BOA-302)（「コース」→「枠番」の呼称統一検討）、[BOA-285](https://linear.app/boat-ai/issue/BOA-285)（HTML構造変化の自動検知の仕組み自体が無い）。

## 3軸とレース詳細ページ（BOA-305〜312）の依存関係

| BOA-305配下のタブ | 主に依存する軸 | 具体的な依存先 |
|---|---|---|
| 基本情報（BOA-306） | ①网羅性（一部） | 事故率・決まり手数の集計元データ確認 |
| 枠別情報（BOA-307） | ③正確性 | **BOA-257（進入コースバグ）の影響を直接受ける**。コース別成績を可視化する以上、進入コースの値自体が壊れていると土台から崩れる |
| モータ情報（BOA-308） | なし（既存機能の導線整理のみ） | BOA-265/283で実装済み、軸①②③いずれの影響も薄い |
| 今節成績（BOA-309） | ①网羅性 | BOA-291（データ未取得）が前提条件、着手不可 |
| 直前情報（BOA-304） | **②信頼性（最も強く影響）** | 展示ST・展示タイム・チルト等が直前情報の中核。取得タイミングが信頼できないと、タブを新設しても「−」表示が頻発し体験が改善しない |
| オッズ検索（BOA-310） | ①网羅性＋②信頼性 | オッズ自体の取得範囲確認（①）に加え、`scrape-odds.js`もオーケストレーターの一部で同じconcurrency問題の影響を受ける（②） |
| オッズ一覧（BOA-311） | ①网羅性＋②信頼性 | 同上 |
| 結果（BOA-312） | ②信頼性（間接） | 結果取得もPhase 2として移行対象。ただし現状`RaceResult.jsx`は実装済みで、欠落頻度が低ければ緊急性は低い |

**枠別情報（BOA-307）と直前情報（BOA-304）が、軸③・軸②それぞれの問題を最も強く受けるタブ**である点が今回の整理で明確になった。

## 推奨する着手順序（提案、要ユーザー判断）

1. **軸②（信頼性）は既に他セッション（[BOA-313](https://linear.app/boat-ai/issue/BOA-313)）がPhase 1（展示データ）を並走検証中**。新しいデータ（軸①拡張）を追加しても同じオーケストレーター構造の影響を受ける限り再発するため、土台を直す優先度は妥当。**本セッションはノータッチ、進捗のみ参照する（2026-09-15ユーザー判断で確定）**。BOA-304（直前情報タブ）はBOA-313 Phase 1の切替完了後に着手するのが望ましい
2. **軸③のうちレース詳細ページに直結するもの（BOA-257）を並行して優先**: 枠別情報タブ（BOA-307）の実装が、直しても直さなくても着手できる他タブ（モータ情報等）より後回しにすべき理由になる
3. **軸①の拡張（BOA-291今節成績、オッズ範囲確認等）は、独立した調査部分（現状のデータ範囲を確認するだけの部分）は並行着手して問題ない**。ただし新規スクレイピングの実装自体は、軸②の土台が固まってからの方が「新しく追加したデータも同じ理由で欠落する」という二度手間を避けられる
4. UI実装（BOA-306〜312の各タブ）は、対応するデータが軸①〜③の観点で安定してから着手する（タブごとに個別着手できる設計は維持）

## 未確定事項・ユーザー確認が必要な点

1. ~~軸②（サーバーレス移行）の扱い~~ → **解決済み（2026-09-15）**: 他セッションが設計・Linearチケット起票とも担当する。本セッション・本ドキュメントは参照のみで、当該作業には関与しない
2. BOA-291（今節成績データ取得）とBOA-220（今節得点率）のスコープ重複整理は未実施
