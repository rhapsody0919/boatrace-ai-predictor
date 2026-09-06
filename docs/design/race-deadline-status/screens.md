# 会場ページ レース締切ステータスのライブ表示 画面・コンポーネント洗い出し

`spec.md`のFR1〜FR3に基づく。対象は「会場ページのレースカードに締切ステータスを表示するUI」に限る（やらないことに明記の通り、レース詳細ページ・会場グリッドは対象外）。

## 対象コンポーネント

### 1. `RaceCard.jsx`（`src/components/race/`）— 拡張
- 役割: 会場ページ（`VenueRaceListPage.jsx`）の1R〜12Rレース一覧で使われる、レース1件分のカード。既にグレードバッジ・イン崩れバッジ・的中/外れバッジ・「結果反映待ち」/「中止」バッジ（BOA-254で追加済み）を持つ
- 対応方針: **既存コンポーネントの拡張**。新規コンポーネントは作らない。締切ステータスバッジ（受付中/まもなく締切/締切済み）を新しい分岐として追加する。`cancellationStatus === 'confirmed'`の場合はこの新バッジを出さない（FR3、既存の中止バッジ分岐が優先）
- デザイントークン:
  - 「まもなく締切」: `--color-warning`（既にライト/ダーク両方定義済みの意味トークン、他の警告的表示との整合も取れる）
  - 「受付中」「締切済み」: `--color-gray-600` / `--text-secondary`（既存の「結果反映待ち」「中止」バッジと同系統の低彩度トーン。「受付中」は常時表示される定常状態のため、`--color-success`（的中系で使用中）のような強い意味色は使わず控えめにする）
  - 新規トークンの追加は不要
- 影響範囲: `VenueRaceListPage.jsx`（本日`/venue/:code`・過去日`/races/:date/:code`）に反映される

### 2. `RaceDeadlineCountdown.jsx`（`src/components/race/`）— 新規
- 役割: レースカード内に埋め込む、秒単位の締切カウントダウン表示（「次の締切まで 02:00」）専用の小コンポーネント
- 対応方針: **新規コンポーネント**。既存コードベースにカウントダウン表示の類似実装は無い（grep確認済み）。`RaceCard.jsx`から`startTime`（と`cancellationStatus`）を受け取り、コンポーネント内部で独自の`setInterval`（1秒毎）を持つ。秒単位のタイマーをこの子コンポーネント1つに閉じ込めることで、`RaceCard`本体・`VenueRaceListPage`・他のレースカードの再レンダーには波及させない（spec.mdの非機能要件、BOA-254 ADR 0041と同じ「レンダー範囲の局所化」方針）
- 表示条件: 締切済み・`cancellationStatus === 'confirmed'`のレースでは非表示（数値を出さず何も描画しない）
- デザイントークン: `RaceCard.jsx`のバッジと同系統（`--text-secondary`）で数値を表示。等幅表示が必要な場合は`font-variant-numeric: tabular-nums`を使う（新規CSSクラスまたはインラインstyleで対応、新規トークンは不要）
- `.claude/rules/component-reuse.md`との整合: `App.jsx`とレース詳細ページ（`RaceDetail`系）の両方で同じUIパターンが必要になるケースは今回は無い（spec.mdの「やらないこと」でレース詳細ページは対象外と明記済み）ため、共通化の追加検討は不要

### 3. `src/utils/`配下 — 新規（締切判定ロジック）
- 役割: 締切ステータス（受付中/まもなく締切/締切済み）を計算する新規の独立関数。日付+時刻を組み合わせたDate比較で実装し、既存の`raceStatus.js`（`RACE_STATUS`/`getRaceStatus()`）は一切変更しない
- 対応方針: 新規ファイル（例: `src/utils/raceDeadlineStatus.js`）として切り出す。`RaceCard.jsx`と`RaceDeadlineCountdown.jsx`の両方から参照する共通ロジックのため、コンポーネント内に直書きせずutilに分離する（詳細な関数名・シグネチャは`/step2`で設計する）

## 対象外（`spec.md`の「やらないこと」に基づく確認）

| コンポーネント/画面 | 対象外の理由 |
|---|---|
| `RaceDetailPage.jsx` / `PredictionPanel.jsx` | spec.mdで明示的にスコープ外（レースカード一覧のみが対象） |
| `VenueGridPage.jsx` / `VenueGridCard.jsx`（日別会場グリッド） | 個別レースの状態バッジを表示する仕組みがそもそも無く、今回のスコープにも含めない |
| `src/components/holmes/`配下 | BOA-254調査で確認済みの通り、`RaceCard`とは無関係の別実装。本機能の対象外 |
| 会場ページのヘッダー領域（LIVEバッジ等） | spec.mdで明示的にスコープ外（比較モックの中案・最大案相当のため今回見送り） |

## 新規コンポーネントの要否

新規コンポーネントは`RaceDeadlineCountdown.jsx`のみ（カウントダウン表示、`RaceCard`本体から独立させる技術的な必要性があるため）。締切ステータスバッジ自体は`RaceCard.jsx`への追加分岐で完結し、新規コンポーネント化は不要。
