# レース中止・順延検出の永続化 実装計画

`docs/design/race-cancellation-detection/spec.md`・`screens.md`、および`docs/adr/0039〜0041`の決定に基づく実装計画。

## データ設計

### `races`テーブルへのカラム追加（`docs/db-migration/047_race_cancellation_status.sql`）
ADR 0039・0041の決定に基づく。

```sql
ALTER TABLE races ADD COLUMN IF NOT EXISTS cancellation_status TEXT
  CHECK (cancellation_status IN ('tentative', 'confirmed'));
ALTER TABLE races ADD COLUMN IF NOT EXISTS cancellation_check_streak SMALLINT NOT NULL DEFAULT 0;
```

- `cancellation_status`: `NULL`（通常）/ `'tentative'`（暫定）/ `'confirmed'`（確定）。UI側が参照するのはこの列のみ
- `cancellation_check_streak`: 内部カウンタ。UI側からは参照しない

`race_results.is_cancelled`/`is_no_race`は変更しない（残置、ADR 0039参照）。

## スクリプト構成・実行タイミング

### FR1: `scripts/daily/update-race-info.js`の拡張（発走前の暫定検知）

現状、`fetchRaceInfo()`（201行目）は`racers.length === 0`の場合に`console.warn`のみでnullを返し（225-230行目）、呼び出し元の`run()`は`if (!data) continue;`（300行目）で何もせず読み飛ばしている。ここに以下を追加する。

1. `run()`冒頭で、`targetRaces`（発走1時間前ウィンドウのレース）の`race_id`一覧に対して`races`テーブルから`cancellation_status, cancellation_check_streak`を一括取得し、`race_id`をキーにしたMapを作る
2. 各レースの処理結果（`data === null`か否か）に応じて、レース単位で次の状態遷移を計算する
   - `data === null`（選手情報0人を検出）: `cancellation_check_streak + 1`。新しいstreakが3に達し、かつ現在`cancellation_status`が`NULL`なら`'tentative'`に昇格
   - `data !== null`（正常取得）: 既存の`cancellation_check_streak`が0より大きい、または`cancellation_status === 'tentative'`であれば、`cancellation_check_streak = 0`・`cancellation_status = NULL`にリセット（誤検知からのリカバリ）。それ以外は何もしない
3. 変化があったレースについてのみ、既存の`racesGradeUpdates`（396-407行目）と同じパターンで`supabase.from("races").update({...}).eq("race_id", race_id)`をレースごとに実行する

既存の`entriesRows`/`conditionsRows`/`racesGradeUpdates`の処理には影響を与えない、独立した追加ブロックとして実装する。

### FR2: `scripts/daily/scrape-results.js`の拡張（発走後の確定検知、ADR 0040）

`run()`（276行目）が使う`schedule`をそのまま流用する。既存の`getRacesAfterStart(schedule, 5)`（5〜90分後を対象、`raceSchedule.js`の`maxMinutesAfter`デフォルト値90分と一致）による結果取得処理の後に、以下を追加する。

1. `schedule`から「発走90分超経過」のレースを抽出する（新規ヘルパー、例: `getRacesPastResultWindow(schedule, 90)` を`scripts/lib/raceSchedule.js`に追加。既存の`getRacesAfterStart`と対になる関数として、`minAfterStart > maxMinutesAfter`のレースを返す）
2. 抽出したレースのうち、`race_results`に行が存在せず、かつ`races.cancellation_status`がまだ`'confirmed'`でないものを特定する（`race_results`への軽量な存在確認クエリを1回追加）
3. 該当レースについて`races.cancellation_status = 'confirmed'`を書き込む（`cancellation_check_streak`はそのままでよい、FR1のリセット対象外）

既存の`scrapeRaceResult`・`scrapeAndSaveResults`のロジック・呼び出し順は変更しない。

## 既存サービス層との連携

### `src/services/supabaseDataService.js`（`getPredictions()`）

`raceData`オブジェクトを構築している箇所（`startTime: race.start_time?.substring(0, 5)`と同じ場所、812行目付近および1066行目付近の2箇所）に1行追加する。

```js
const raceData = {
  raceNo: race.race_number,
  startTime: race.start_time?.substring(0, 5) || "",
  cancellationStatus: race.cancellation_status ?? null, // 追加
  // ...
};
```

`getPredictions()`の主要select句（892-963行目付近）に`cancellation_status`を追加する必要がある（現状の`races`テーブルのselectフィールド一覧に無いため）。

この1箇所の変更で、`VenueRaceListPage.jsx`（`rawData: race`として`RaceCard`に渡される）・`RaceDetailPage.jsx`側の`prediction`propの両方に自動的に伝播する（両者とも同じ`getPredictions()`の返り値を参照しているため、追加の配線は不要）。

## コンポーネント構成（`screens.md`参照）

### `RaceCard.jsx`（FR4）

```js
const cancellationStatus = racePrediction?.cancellationStatus;
const isCancelled = cancellationStatus === "confirmed";
// isAwaitingResultとisCancelledは排他（isCancelledを先に判定する）
```

既存の「結果反映待ち」バッジ（101-116行目）の分岐を次のように変更する。

```js
{isCancelled ? (
  <span style={{ /* 既存のawaitingResultバッジと同じスタイル、--color-gray-600流用 */ }}>
    {t("raceCard.cancelled")}
  </span>
) : (
  isAwaitingResult && (
    <span style={{ /* 既存のまま */ }}>
      {t("raceCard.awaitingResult")}
    </span>
  )
)}
```

`cancellationStatus === "tentative"`の場合は分岐せず、既存の表示（`isAwaitingResult`等）をそのまま使う（spec.md FR4、確定前は通常表示を維持する方針）。

### `PredictionPanel.jsx`（FR5）

```js
const isCancelled = prediction?.cancellationStatus === "confirmed";
```

既存の`isAwaitingResult`バナー（171-185行目）と同様の位置に、`isCancelled`を優先する排他分岐を追加する。

```js
{isCancelled ? (
  <div style={{ /* 既存のawaitingResultBannerと同じスタイル */ }}>
    {t("panel.cancelledBanner")}
  </div>
) : (
  isAwaitingResult && (
    <div style={{ /* 既存のまま */ }}>{t("panel.awaitingResultBanner")}</div>
  )
)}
```

## 多言語対応

`raceCard.cancelled`・`panel.cancelledBanner`の2キーを`src/locales/{ja,en,ko,zh-TW}/common.json`に追加する（既存の`raceCard.awaitingResult`・`panel.awaitingResultBanner`と同じ名前空間）。文言は「中止」（日本語）に相当する表現とし、「競艇」表記は使わない。

## テスト方針

- ユニットテスト新設: FR1のstreak計算・状態遷移ロジック（3回連続で`tentative`に昇格、正常検知でリセットされる、`confirmed`は上書きされない）を純粋関数として切り出しテストする
- `RaceCard.jsx`・`PredictionPanel.jsx`の分岐（`cancellationStatus`が`confirmed`/`tentative`/`null`の3パターン）を確認する
- `npm run build`・`npm run test:e2e`（`RaceCard`は共通コンポーネントのため実行必須、CLAUDE.md準拠）

## 未確定事項の解消状況
spec.mdに残っていた3件の未確定事項は、本plan.mdで以下の通り解消した。

- **発走後「確定」までの待機時間** → 90分（ADR 0040、既存`getRacesAfterStart`のデフォルト値と一致させる）
- **`races`新カラムの正式なカラム名・型** → `cancellation_status`（TEXT）・`cancellation_check_streak`（SMALLINT）（ADR 0039・0041）
- **確定検知ロジックの実装場所** → `scripts/daily/scrape-results.js`の拡張（ADR 0040）

残る未確定事項:
- **Linear上の優先度設定**: 未設定。ユーザーが別途判断
