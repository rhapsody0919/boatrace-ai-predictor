# レース荒れ度ムード演出アニメーション - 画面洗い出し

`spec.md`のFR1〜FR5に基づき、影響する画面・コンポーネントを洗い出す。

## 影響する画面

| 画面 | 経路 | 影響内容 |
|------|------|---------|
| ホーム（本日の予想） | `App.jsx` | `PredictionPanel`を埋め込み表示。レースカード選択後のパネル内に演出が追加される |
| レース詳細ページ | `src/pages/RaceDetail.jsx`（`/races/:date`） | `PredictionPanel`を表示。同上 |

`.claude/rules/component-reuse.md`のチェックリストどおり、**`PredictionPanel.jsx`は既にApp.jsx/RaceDetail.jsx共通の実装点**（BOA-194実装時に確認済みのパターンを踏襲）。今回もこの共通コンポーネント内に実装すれば、両画面に自動反映され画面ごとの個別対応は不要。

## コンポーネント構成

### 新規コンポーネント

| コンポーネント | 役割 | 新規/拡張 |
|--------------|------|----------|
| `RaceMoodEffect.jsx`（`src/components/race/`） | イン崩れ指数レベル（high/low/standard）に応じたムード演出アニメーション本体。艇番・決まり手・確率等の具体的予測内容は一切描画しない、装飾専用コンポーネント | 新規 |

**新規コンポーネントにした理由**: 既存コンポーネントの中に「予測内容を含まない装飾専用アニメーション」を担うものが無い（`VolatilityDisplay`はテキスト＋バーの情報表示コンポーネントであり、責務が異なる。`FirstMarkAnimation`は撤去済みで、かつ艇番別の着順を描画する設計のため今回の要件＝「具体的予測内容を含まない」と根本的に矛盾し流用不可）。

### 既存コンポーネントの変更

| コンポーネント | 変更内容 |
|--------------|---------|
| `PredictionPanel.jsx` | `AiAnalysisSection`内、`VolatilityDisplay`と同じ`{prediction.volatilityPercentile != null && (...)}`ブロック内に`RaceMoodEffect`を追加。**新しい表示条件分岐は増やさない**（既存のisFinished・volatilityPercentile存在チェックをそのまま再利用） |

### データ取得

新規のSupabaseクエリ・APIコールは無し。`PredictionPanel.jsx`が既に保持している`prediction.volatilityPercentile`・`prediction.volatilityPercentileIsFallback`（`VolatilityDisplay`に渡しているものと同一）をそのまま`RaceMoodEffect`にも渡す。

## レベル判定・状態

`VolatilityDisplay.jsx`内の既存ロジック（`percentile >= 0.7 ? "high" : percentile <= 0.3 ? "low" : "standard"`）と同じ基準を`RaceMoodEffect`側でも使う（表示の一貫性のため、ロジックの二重実装ではなく共有ヘルパー化を`/step2`で検討）。

| 状態 | 条件 | 演出 |
|------|------|------|
| high（警戒） | percentile >= 0.7 | 強めのムード演出（具体的トーンは`/step2`で決定） |
| standard（本命有利〜標準） | 0.3 < percentile < 0.7 | 標準の演出 |
| low（本命堅い） | percentile <= 0.3 | 穏やかな演出 |
| フォールバック | `isFallback === true`（サンプル数不足でデータ収集中） | 演出を表示しない（`VolatilityDisplay`の「データ収集中」表示と同じ理由。実データに基づかない演出を表示すると誤解を招くため） |
| データ無し | `percentile === null \| undefined` | 演出を表示しない（`VolatilityDisplay`と同じガード） |

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

### デザイントークンで表現できる部分
- レベル別の配色: `VolatilityDisplay.jsx`が現在ハードコードしている`#ff9800`/`#4caf50`/`#2196f3`は、それぞれ`--color-warning-light`/`--color-success-light`/`--color-info`と完全一致する。`RaceMoodEffect`では新規にハードコードせず、これらのCSS変数を使う（`VolatilityDisplay`側の是正は本タスクのスコープ外）
- 角丸・余白: `--radius-md`/`--radius-sm`等の既存トークン

### 新規CSSが必要な部分
- アニメーション本体の形状・動き（SVG/framer-motionのkeyframe定義）はレベルごとに新規実装が必要。具体的な意匠は`/step2`で複数案を検討する
- `prefers-reduced-motion`時の代替表示（BOA-194の`AiCopyBanner`で確立した`useReducedMotion()`パターンを踏襲）

## 依存関係

- `framer-motion`: 既存依存関係を再利用（新規パッケージ追加なし、ADR 0014と同じ方針）
- 新規の外部アセット（画像・動画ファイル）は無し（spec.mdのFR4で明記）
