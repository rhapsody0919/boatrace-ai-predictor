# 全レース関連データ取得・タイミング最適化 plan

対応spec: [spec.md](./spec.md)

## 全体アーキテクチャ

```
                        タイミング分類
  T1(発走直前ウィンドウ)          T2(当日随時)         T4/T5(前日〜低頻度)
        │                          │                       │
        ▼                          ▼                       ▼
  Vercel Function              Vercel Function        GitHub Actions
  (BOA-313パターン踏襲)         (新規・軽量)             (既存 or 新規、低頻度)
  cron-job.org 1-2分間隔        cron-job.org 15-30分間隔  日次/週次/半年次
        │                          │                       │
        ▼                          ▼                       ▼
  FR-4(オッズ全券種)            FR-1(特記事項)          FR-2(期別成績)
  FR-3当日分(今節成績)                                  FR-5(profiles自動化)
                                                        FR-6(会場個別サイト)
                                                        FR-7(残存ギャップ)
```

原則（[BOA-313](https://linear.app/boat-ai/issue/BOA-313)を前提とした拡張）: T1に分類されるものは新規にレガシーGitHub Actionsオーケストレーター（`scrape-scheduled.js`）へ追加しない。T4/T5の低頻度データは、既存のconcurrency問題の影響を受けないため、新規にGitHub Actionsの定期ジョブを作ってよい（BOA-313の対象外）。詳細判断はADR-0056参照。

## FR-1: レース特記事項ページ

### データ設計

新規テーブル `race_special_notes`:

| カラム | 型 | 説明 |
|---|---|---|
| id | bigint PK | - |
| venue_code | int | 会場コード |
| race_date | date | 対象日 |
| category | text | `accident`\|`equipment_change`\|`absence` |
| racer_id | int, nullable | 対象選手の登録番号（分かる場合） |
| boat_number | int, nullable | 艇番（分かる場合） |
| detail_text | text | 表示テキストそのまま（構造化しきれない情報の保険） |
| structured_data | jsonb, nullable | 種別ごとの構造化データ（例: absenceなら`{type: "途中帰郷"\|"即日帰郷"\|"即刻帰郷", replacement_racer_id}`） |
| scraped_at | timestamptz | - |

3区分（BOA-318/319/320）を1テーブルに統合する理由: 同一ページから1回のリクエストでまとめて取得できるため、取得ロジックを共有できる（ADR不要、自明な設計）。

### スクリプト構成

新規 `scripts/daily/scrape-race-information.js`（`run(schedule, date)`パターン踏襲）。会場・日付単位（レース番号非依存）のため、開催中の全会場を1日十数回巡回すれば十分。

### 実行タイミング

新規 Vercel Function `api/cron/race-notices.js`、cron-job.org 30分間隔（7:00-23:00 JST）。ADR-0056の原則に従い、レガシーオーケストレーターには追加しない。

## FR-2: 選手期別成績ページ（能力指数・フライング回数・出遅れ回数）

### データ設計

`racer_profiles`テーブルを拡張（既存の身長・体重等と同じ選手マスタのため新規テーブルは作らない）:

| 追加カラム | 型 | 説明 |
|---|---|---|
| ability_index | int, nullable | 能力指数（級別審査に使う公式複合スコア） |
| flying_count_period | int, nullable | 直近期のフライング回数 |
| false_start_count_period | int, nullable | 直近期の出遅れ回数（選手責任） |
| period_label | text, nullable | `2026-first`\|`2026-second`等、集計対象期の識別子 |
| official_win_rate_period | numeric, nullable | 公式集計の勝率（自社`racer_aggregated_stats`との検算用） |
| official_updated_at | timestamptz, nullable | 本データの取得日時 |

### スクリプト構成

`scripts/maintenance/scrape-racer-profiles.js`を拡張し、既存の選手プロフィール取得と同じ巡回で`data/racersearch/season?toban=`も取得する（FR-5の自動化と同一ジョブに統合、選手一覧を二重に巡回しない）。

### 実行タイミング

新規GitHub Actionsワークフロー（週次、日曜深夜等）。低頻度・静的データ（T5）でありBOA-313の対象外。半年に一度の集計期間切り替わり（5/1, 11/1）直後は差分が大きくなるため、その週だけ実行頻度を上げる運用を検討（tasks.mdで判断）。

### 自社集計値との検算

期別成績ページの勝率・2連対率・3連対率・出走回数・優出回数・優勝回数を`racer_aggregated_stats`の対応値と突き合わせ、乖離があれば自社集計ロジックのバグの可能性として調査する（`.claude/rules/analysis.md`のデータ精度検証パターンを踏襲）。

### F休み期間の自社計算検証

`flying_count_period`と、既存の`race_results`/`race_start_timings`から取得できる各F発生日を組み合わせ、公式ルール（1回=30日、2回=90日、3回=180日、半年区切り）で休み期間を計算できるか検証する。可能であれば日和の「F休み期間」相当のスクレイピングは不要になる。検証タスクはtasks.mdで扱う。

**注意（[BOA-323](https://linear.app/boat-ai/issue/BOA-323)、2026-09-15発見、本spec対象外）**: `race_start_timings`はPR #612由来のリグレッションで2026-09-10以降ほぼ全レースで欠損している（決まり手も同様）。F発生日の検出もこのテーブルに依存するため、BOA-323が解消するまでは直近期間のF検出も同じ穴を引き継ぐ。本FRの検証タスク着手前にBOA-323の修正状況を確認すること。

## FR-3: 今節成績（節内の日別進捗）

### 技術判断（ADR-0053参照）

「racelistページを直接スクレイピングする」か「自社`race_results`等から導出計算する」かの選択がある。**ADR-0053で自社導出を採用**（理由はADR参照）。

### データ設計

新規ビュー/集計関数（テーブルではなくクエリ）: `getSeriesResultsByRacer(racerId, venueCode, meetStartDate)`（`supabaseDataService.js`に追加）。既存の`races`（`series_day`列、[BOA-226](https://linear.app/boat-ai/issue/BOA-226)実装後）・`race_results`・`race_entries`をJOINして、当該選手の当該節・当該日までの進入・着順・STを引く。

「得点率」（節内の順位に応じた公式ポイント制）は自社計算が必要。公式ルール（1着=得点最大、着順が下がるごとに減点、優勝戦は加重等）を`docs/reference/`に一次情報源つきでまとめてから実装する（[BOA-220](https://linear.app/boat-ai/issue/BOA-220)と統合）。

**注意（[BOA-323](https://linear.app/boat-ai/issue/BOA-323)、2026-09-15発見、本spec対象外だが直接影響あり）**: ADR-0053で「自社`race_results`から導出する」と決めたが、PR #612由来のリグレッションで2026-09-10以降`winning_technique`・`race_start_timings`がほぼ全レースで欠損している（悪化継続中）。**BOA-323が解消するまでは、FR-3で導出する直近期間の今節成績（進入・着順は影響薄いが、STは大半欠損）が同じ穴を引き継ぐ**。FR-3の実装着手前にBOA-323の修正・バックフィル状況を確認すること。BOA-323自体は軸③（正確性・可用性のバグ）に分類され、[BOA-257](https://linear.app/boat-ai/issue/BOA-257)と同様に本specのスコープ外・独立した緊急対応が望ましい。

### 実行タイミング

過去日分: 導出クエリのため追加スクレイピング不要（T4相当、`races`/`race_results`が揃っていれば計算可能）。当日分: 当日のレース結果が確定するたびに反映されるため、`scrape-results.js`（結果取得、BOA-313 Phase 2でVercel Functions移行予定）の完了に連動する。**BOA-313 Phase 2の完了を待つのが望ましい**（結果取得自体の信頼性が今節成績の当日分の信頼性の上限になるため）。

## FR-4: オッズ全券種

### 技術判断（ADR-0054参照）

保存方式は**既存の`trifecta_all`と同じJSON列方式を採用**（理由はADR参照）。

### データ設計

`race_odds`テーブルに追加:

| 追加カラム | 型 | 説明 |
|---|---|---|
| trio_all | jsonb, nullable | 3連複全通り（既存`parseTrioAll()`を呼び出し元拡張のみで対応） |
| exacta_all | jsonb, nullable | 2連単全通り（新規パーサー要実装） |
| quinella_all | jsonb, nullable | 2連複全通り（新規パーサー要実装） |
| wide_all | jsonb, nullable | 拡連複全通り（新規パーサー要実装） |

### スクリプト構成

`scripts/lib/oddsParser.js`に`parseExactaAll`/`parseQuinellaAll`/`parseWideAll`を追加（`parseTrifectaAll`/`parseTrioAll`と同じパターン）。`scripts/daily/scrape-odds.js`の`run()`を拡張し、`odds2tf`/`oddsk`等の該当ページを追加取得する（正確なURLパスは実装時にHTML構造を確認、spec.md未確定事項）。

### 実行タイミング

既存の`scrape-odds.js`と同じ実行基盤。**BOA-313 Phase 3（オッズのVercel Functions移行）と同時に実装するのが最も手戻りが少ない**。Phase 3着手前に本FRだけ先行実装する場合は、レガシーオーケストレーター内の`runOdds`拡張として一時的に実装し、Phase 3移行時に他のオッズ処理と一緒に移す。

## FR-5: racer_profiles自動更新化

FR-2のスクリプト・実行基盤設計に統合済み（同一ジョブで選手プロフィールと期別成績を同時取得する）。追加のデータ設計は無い。

## FR-6: 会場個別公式サイト（24会場）

### 技術判断（ADR-0055参照）

**CMSベンダー単位のテンプレート共有を優先し、テンプレート化できないサイトのみ個別実装する**方針を採用（理由はADR参照）。

### 段階実装

1. **Phase 6a（調査）**: 24会場を実際にCMS構造で分類する（`/modules/`パス構成の共通CMS群、レガシー静的HTML/ASP群、その他）。各会場のToS本文を確認する（spec.md未確定事項）
2. **Phase 6b（テンプレート実装）**: 分類ごとに1つの共有パーサーを実装し、複数会場に適用する
3. **Phase 6c（データ別実装）**: [BOA-293](https://linear.app/boat-ai/issue/BOA-293)（進入コース別選手成績、12会場で確認済み・最重要）から着手し、[BOA-294](https://linear.app/boat-ai/issue/BOA-294)（水面特性等）・[BOA-295](https://linear.app/boat-ai/issue/BOA-295)（潮汐）・[BOA-296](https://linear.app/boat-ai/issue/BOA-296)（レイアウト変更履歴）を続ける

### データ設計

新規テーブル（会場サイトごとに形式が異なるため、汎用的なJSON格納 + 会場別の解釈ロジックをアプリ層に持つ設計を基本とする）:

| テーブル | 用途 |
|---|---|
| `venue_entry_course_stats` | BOA-293、選手×枠→実進入コース遷移確率 |
| `venue_tide_data` | BOA-295、潮汐（潮位・満干潮時刻） |
| `venue_layout_changes` | BOA-296、レイアウト変更履歴（変更日・内容） |
| `venue_misc_data` | BOA-294、水面特性・モーター/ボートランキング等（項目が会場ごとに大きく異なるためjsonb中心） |

### 実行タイミング

T4〜T5中心（開催前〜低頻度）のため、会場ごとのGitHub Actions定期ジョブ（日次〜週次）で対応。BOA-294の一部項目（前検ランキング等）がT1〜T2寄りの可能性はPhase 6a調査で個別確認する。

## FR-7: 残存する個別ギャップ

各既存チケット（BOA-288/290/266/273/292）単体で完結させる。本plan.mdでは扱わない。

## FR-8: 実行タイミング基盤へのマッピング（まとめ）

| FR | タイミング分類 | 実行基盤 | 備考 |
|---|---|---|---|
| FR-1 特記事項 | T2 | 新規Vercel Function（30分間隔） | ADR-0056 |
| FR-2 期別成績 | T5 | 新規GitHub Actions（週次） | FR-5と統合 |
| FR-3 今節成績・過去日分 | T4 | スクレイピング不要（自社導出、ADR-0053） | - |
| FR-3 今節成績・当日分 | T2 | BOA-313 Phase 2（結果）完了後に対応 | 依存あり |
| FR-4 オッズ全券種 | T1 | 既存`scrape-odds.js`拡張→BOA-313 Phase 3で正式移行 | 依存あり |
| FR-5 profiles自動化 | T5 | FR-2と同一ジョブ | - |
| FR-6 会場個別サイト | T4〜T5中心 | 会場別GitHub Actions定期ジョブ | 一部T1〜T2の可能性、要個別確認 |
| FR-7 残存ギャップ | 個別 | 各チケットの既存設計に従う | - |

## 既存サービス層・共通ライブラリとの連携

- `src/services/supabaseDataService.js`: FR-2（能力指数等）・FR-3（今節成績導出クエリ）の新規取得関数を追加する場所
- `scripts/lib/oddsParser.js`: FR-4の新規パーサー追加場所
- `scripts/lib/raceSchedule.js`: FR-1（会場・日付単位の巡回対象決定）で再利用
- `scripts/maintenance/scrape-racer-profiles.js`: FR-2/FR-5の拡張対象
- `scripts/daily/scrape-odds.js`: FR-4の拡張対象

## マイグレーション草案

以下は設計レビュー用の草案。実際のマイグレーション番号・詳細なカラム型は実装時（`/step4`）に確定する（現行mainブランチの最新マイグレーション番号を都度確認し直すこと。本plan作成時点でのworktree内最新は058だが、並行セッションの作業により059以降が既に存在する可能性が高い）。

- `docs/db-migration/060_race_special_notes.sql`（草案、FR-1）
- `docs/db-migration/061_racer_profiles_season_stats.sql`（草案、FR-2）
- `docs/db-migration/062_race_odds_all_combinations.sql`（草案、FR-4）

## 未確定事項（spec.mdから引き継ぎ、加えて本plan策定で新たに生じたもの）

| 項目 | 内容 | いつ・誰が決めるか |
|---|---|---|
| （spec.mdの6項目） | 24会場ToS確認、BOA-291/220重複整理、オッズ保存設計、24会場着手順序、BOA-313 Phase2/3完了時期、racer_profiles更新頻度 | ADR-0053〜0055・本plan.mdで一部確定済み。残りは`/step3`（tasks.md）で確定 |
| オッズ2連単/2連複/拡連複の正確なURLパス（`odds2tf`等は仮称） | 実装時にHTML構造を直接確認する必要がある | `/step4`実装時、着手担当者が確認 |
| 得点率の公式計算ルール | 着順→得点の対応表を一次情報源から確認する必要がある | `/step4`実装時、FR-3着手担当者が確認 |
| 24会場の実際のCMS分類結果 | Phase 6a調査が完了するまで不明 | `/step3`のtasks.md作成時、またはPhase 6a調査タスクの完了時 |
