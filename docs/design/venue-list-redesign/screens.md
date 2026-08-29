# 開催場一覧ページ再設計 screens

`docs/design/venue-list-redesign/spec.md`を元に、影響する画面・コンポーネントを洗い出す。

## 重要な発見（step2への申し送り）

`race_conditions`テーブルに`series_day`（開催日目）・`is_final_day`（最終日フラグ）・`race_title`（大会名）が既に存在する（`docs/db-migration/001_schema.sql`）。FR-1の「開催日目」表示に新規スクレイピングは不要だが、現行`getRaces()`（`src/services/supabaseDataService.js`）のSELECT文・Edge API `/api/races/today`のレスポンスには含まれていない。spec.mdの「追加のAPI呼び出しなし」は正確には「APIの呼び出し回数は増えないが、レスポンスに含むフィールドの拡張（`race_conditions`のJOIN追加）が必要」に訂正する。`/step2`でRPC/Edge APIのレスポンス拡張を設計すること。

## 画面一覧

### 1. 会場一覧ページ（新設、既存`/`を置き換え）
- 役割: 24会場を固定グリッドで表示するトップページ。FR-1に対応
- 新規/流用: 新規ページ。既存`App.jsx`のデータ取得部分（`dataService.getRaces()`呼び出し・`allVenuesData` state管理、31-43行目・132行目付近）は流用可能。UIは全面新規（既存の`<select>`ドロップダウンとは別物）
- 過去日付版（`/races/:date`）にも同じグリッドを表示する（ユーザー確定: 統一する）。対象日付をpropsで受け取る設計にし、本日ページ・過去日付ページの両方から共通利用する

### 2. 会場別レース一覧ページ（新設）
- 役割: 選んだ会場の1R〜12Rを一覧表示する中間ページ。FR-2に対応
- 新規/流用: 新規ページ・新規ルート。レースカードの表示ロジック（グレードバッジ・荒れ度バッジ・的中バッジ）は既存`RaceCard.jsx`をそのまま流用可能。既存`App.jsx`の`.race-grid`セクション（619行目付近、`races.map`でRaceCardをレンダリングする部分）をこのページに切り出す形が妥当
- 日程タブ（複数日開催時の日付切替）は新規UI。データ源は`race_conditions.series_day`/`is_final_day`（上記「重要な発見」参照）

### 3. レース詳細ページ（新設・ディープリンク対応）
- 役割: 個別レースの分析画面。FR-3に対応
- 新規/流用: 新規ルートのみ新設。画面の中身は完全に既存コンポーネント流用（`PredictionSection`・`RaceBottomNav`・`RaceNavCard`は既にApp.jsx/RaceDetail.jsxで共通化済み）
- 既存`RaceBottomNav`/`RaceNavCard`（BOA-118実装済み）は既に「会場切り替えピル」＋「前後レースボタン」を持つが、`onNavigate`/`onVenueChange`は現状state切り替え（`selectedRace`/`selectedVenueId`のsetState）。ディープリンク化に伴い、これらをルート遷移（`useNavigate`）ベースに変更する必要がある

### 4. App.jsx（既存、大幅変更）
- 役割: 現状は`tab="races"`で会場選択・レース一覧・分析セクションを1ページに詰め込んでいる（884行）
- 変更: 会場一覧UI・レース一覧UI・分析表示ロジックを1〜3の新規ページ/ルートへ分割する。`hit-races`/`accuracy`/`privacy`等の他タブのシェルとして残る部分と、`races`タブから分割される部分の切り分けが必要（詳細な分割方針は`/step2`で設計）

### 5. RaceDetail.jsx（既存、統合対象）
- 役割: 過去日付（`/races/:date`）版の同一UI。App.jsxと同じ`VenueSelector`/`RaceCard`/`PredictionSection`/`RaceBottomNav`/`RaceNavCard`を流用中
- 変更: 会場一覧グリッド化・レース一覧の中間ページ化に合わせて、App.jsxと同じ新規ページ群を日付パラメータ付きで共有する（ユーザー確定: 過去日付ページも統一する）

### 6. RaceHistory.jsx（既存、変更なし）
- 役割: `/races`、過去90日分の日付一覧（月別グループ）ページ。会場ではなく日付を選ぶ入り口
- 変更: 対象外。今回の3階層ナビ（会場一覧→レース一覧→詳細）とは別の「日付を選ぶ」導線として現状維持する

### 7. VenueSelector.jsx（既存、廃止候補）
- 役割: 現行の`<select>`ドロップダウン。App.jsx/RaceDetail.jsxの両方で使用中
- 変更: 新設の会場一覧グリッドに置き換わるため、両ページからの参照が無くなる見込み。他画面からの参照有無を実装時に確認してから削除可否を判断する（spec.mdの未確定事項3）

## 新規コンポーネント

### VenueGrid（新規）
- 役割: 24会場を固定順（会場コード順）で並べるグリッドコンテナ
- 配置: `src/components/race/`に追加し、barrel export（`index.js`）に追加
- 会場一覧ページ（本日/過去日付共通）で共有する

### VenueGridCard（新規）
- 役割: 1会場分のカード。開催中/非開催で表示を出し分ける
- 表示要素: 会場名（既存`venues.*`i18nキー使用）、開催日目（`series_day`/`is_final_day`から算出、「初日」「N日目」「最終日」を判定）、次レース時刻、グレードバッジ（既存`GRADE_CONFIG`流用）、時間帯アイコン（新規）
- spec.mdの「将来拡張への配慮」を反映し、BOA-222（ランキングサマリー統合）で後からバッジを追加できる余白領域を確保する

### 時間帯アイコン判定ユーティリティ（新規）
- 役割: モーニング/デイ/ナイター/ミッドナイトを`start_time`から判定する
- 新規: 現状コード内に該当ロジックが存在しない（`src/`全体を検索して未実装を確認済み）。`src/utils/`に新規ユーティリティ関数を追加する想定

### レース一覧の日程タブ（新規）
- 役割: 会場別レース一覧ページで、開催期間中の日付を切り替えるタブ
- 新規: `race_conditions.series_day`/`is_final_day`を使って開催期間の日付一覧を構築するロジックが必要（詳細は`/step2`）

## コンポーネント再利用方針まとめ

| コンポーネント | 分類 | 備考 |
|---|---|---|
| `VenueGrid` | 新規 | 会場一覧ページの中核 |
| `VenueGridCard` | 新規 | グレードバッジは`GRADE_CONFIG`を流用 |
| 時間帯アイコン判定 | 新規 | 未実装ロジック |
| 日程タブ | 新規 | `race_conditions`のJOIN拡張が前提 |
| `RaceCard.jsx` | 既存を流用 | タップ時の挙動のみ`analyzeRace`(state切替)→ルート遷移に変更 |
| `PredictionSection.jsx` | 既存をそのまま流用 | レース詳細ページの中身そのもの |
| `PredictionPanel.jsx` | 既存をそのまま流用 | `PredictionSection`経由で使用 |
| `RaceBottomNav.jsx` | 既存を拡張 | `onNavigate`/`onVenueChange`をstate切替からルート遷移に変更 |
| `RaceNavCard.jsx` | 既存を拡張 | 同上 |
| `RaceResult.jsx` / `RaceReview.jsx` | 既存をそのまま流用 | `PredictionSection`経由で使用 |
| `VenueSelector.jsx` | 廃止候補 | 参照箇所ゼロ確認後に削除 |
| `RaceHistory.jsx` | 変更なし | 今回のスコープ外 |

## デザイントークン

- 流用可能: `--color-grade-sg/g1/g2/g3`（グレードバッジ、`src/styles/design-tokens.css`）、`--surface-card`/`--border-hairline`（カード背景・枠線）、`--color-success`/`--color-error`（的中バッジ、`RaceCard.jsx`で使用中の色と統一）
- 新規CSSが必要な箇所: 24枠固定グリッドのレイアウト（`grid-template-columns`等、モバイル320px〜で崩れない列数調整）、時間帯アイコンのビジュアル、開催日目/次開催表示のタイポグラフィ、日程タブのUI

## 未解決点（解決済み、実装結果を記録）

- ~~`race_conditions`テーブルのJOINをどのAPI層で追加するか~~ → RPC層（`get_today_races`/`get_predictions_by_date(_light)`）で追加した（`docs/db-migration/038_add_series_day_to_race_rpcs.sql`）
- ~~過去日付の`series_day`データが欠損している場合のフォールバック表示~~ → `series_day`/`is_final_day`自体が実データ0件と判明したため、日程タブ・開催日目表示は今回スコープ外とし[BOA-226](https://linear.app/boat-ai/issue/BOA-226)に切り出した。フォールバック表示は不要になった
- ~~一般戦（`race_grade`が`ippan`）のバッジ表示方針~~ → `GRADE_CONFIG`に`ippan`エントリを追加せず、現状維持（バッジ非表示）のまま実装した。一般戦はグレードレースと違って明示表示の必要性が低いと判断（暗黙の決定だったため実装時に明文化）
