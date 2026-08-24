# 選手占い機能（占術検証フェーズ） システム設計

対応spec: [spec.md](./spec.md)

## 全体データフロー

```
race_entries.racer_id（distinct、約1,637人、2026-08-24時点）
        │
        ▼
[scripts/maintenance/scrape-racer-profiles.js]  ← boatrace.jp 選手検索ページ
        │  (birth_date + 支部/出身地等のスナップショット, docs/adr/0019参照)
        ▼
racer_profiles テーブル
        │
        │  race_entries.race_id（"YYYY-MM-DD-VV-RR"）から
        │  extractDateFromRaceId() で対象日を取得
        ▼
[scripts/lib/fortuneTelling/*]  ← 4占術、(racer_id, 対象日) → 0-100スコア
        │
        │  race_results.rank1〜3（複勝圏内フラグ）
        │  race_start_timings.start_timing（ST）
        ▼
[scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js]
        │  scripts/lib/statisticalTests.js（proportionZTest / pearsonCorrelation）
        ▼
data/analysis/racer-fortune-telling/correlation-report-{実行日}.json
```

## データ設計

### racer_profiles テーブル（新規）

マイグレーション: [docs/db-migration/035_create_racer_profiles.sql](../../db-migration/035_create_racer_profiles.sql)

| カラム | 型 | 説明 |
|---|---|---|
| racer_id | INTEGER PK | `race_entries.racer_id`と同じ全国共通登録番号 |
| name | TEXT | 氏名（`racer1_bodyName`） |
| name_kana | TEXT | カナ（`racer1_bodyKana`） |
| birth_date | DATE NOT NULL | 生年月日。Step1で唯一使用するカラム |
| height_cm / weight_kg / blood_type | — | プロフィール項目（Step1では未使用、racer-news-feature向け保存） |
| branch | TEXT | 支部（Step1では未使用） |
| hometown | TEXT | 出身地（Step1では未使用） |
| registration_period | TEXT | 登録期（例: "96期"）（Step1では未使用） |
| grade_at_scrape | TEXT | スクレイピング時点の級別スナップショット。`race_entries.grade`（レース時点、可変）とは別物（Step1では未使用） |
| scraped_at | TIMESTAMPTZ | 取得日時 |

保存対象・スキーマ範囲の判断根拠は [docs/adr/0019-racer-profiles-scraping-scope.md](../../adr/0019-racer-profiles-scraping-scope.md) 参照。

**行を作らない対象**（spec.md「除外」に対応）: プロフィールページに`dl.list3`ブロックが存在しない選手（存在しないtoban・引退済み等）。DB上は単に行が無い状態とし、失敗理由の記録はDBではなく実行時レポート（後述）に残す。

### 既存テーブルとの結合キー

- `racer_profiles.racer_id` ⇔ `race_entries.racer_id`（型はどちらもINTEGER、実データで型一致確認済み）
- 対象日の特定: `race_entries.race_id`から`scripts/lib/dateUtils.js`の`extractDateFromRaceId(raceId)`で日付文字列を取得する（`races`テーブルへの結合は不要）
- 着順: `race_results.rank1`/`rank2`/`rank3`（1〜3着の艇番号）のいずれかに、対象`race_id`における選手の`boat_number`（`race_entries.boat_number`）が含まれるかで複勝圏内フラグを判定する
- ST: `race_start_timings.start_timing`を`(race_id, boat_number)`で結合

## スクリプト構成・実行タイミング

いずれも常時稼働のエンドポイントではなく、手動実行のバッチスクリプト（spec.md非機能要件通り）。

### 1. `scripts/maintenance/scrape-racer-profiles.js`（新規）

`scripts/maintenance/backfill-racer-ids.js`と同じCLI規約（`--dry-run` / `--limit=N` / `--verbose`）を踏襲する。

- 処理対象: `race_entries`のdistinct `racer_id`のうち、`racer_profiles`に未登録のもの（差分実行が可能、再実行しても既存行は再取得しない）
- 各`racer_id`について`https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban={racer_id}`を取得し、cheerioで`dl.list3`のdt/ddペアをパース
- `dl.list3`が存在しない（＝プロフィール無し）場合は失敗としてスキップ、DBには何も書かない
- レート制限: リクエスト間500ms（`backfill-racer-ids.js`の50msより長めに設定。選手検索ページは短時間の連続アクセスを想定した導線ではないため、より丁寧な間隔にする。約1,637人 × 0.5秒 ≒ 14分で完了する規模）
- User-Agent: 既存スクリプトと同じ`BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)`を使用
- 完了時、標準出力に成功/失敗件数を表示し、`data/analysis/racer-fortune-telling/profile-scrape-report.json`に実行日時・成功数・失敗数・失敗`racer_id`一覧を保存する（spec.md受入基準「成功・失敗の内訳を件数で報告」に対応）

### 2. `scripts/lib/fortuneTelling/`（新規ディレクトリ）

4占術の共通インターフェース実装。

- `index.js` — `FORTUNE_SYSTEMS`配列をexport。各要素は`{ id, name, calculateScore(birthDate, targetDate) }`
- `westernAstrology.js`（西洋占星術、太陽星座ベーストランジット）
- `shichuSuimei.js`（四柱推命、日柱まで）
- `kyuseiKigaku.js`（九星気学、本命星+年盤）
- `rokuseiSenjutsu.js`（六星占術、運気リズム）
- 各`calculateScore(birthDate, targetDate)`は**0-100の数値スコア**を返す形式に最初から統一する（spec要件2「4占術間で比較検証できる形式」に対応。実装ごとに5段階/独自スケール等バラバラにすると比較検証時に正規化処理が別途必要になるため、実装時点で揃える）
- 同一入力に対し常に同一出力を返す純粋関数として実装する（spec受入基準「決定論的・再現性がある」に対応。外部APIやランダム要素を持たない）

### 3. `scripts/lib/statisticalTests.js`（新規）

統計検証の共通ユーティリティ。手法の選定根拠は [docs/adr/0020-fortune-correlation-statistical-method.md](../../adr/0020-fortune-correlation-statistical-method.md) 参照。

- `normalCDF(z)` — 標準正規分布の累積分布関数（近似）
- `pearsonCorrelation(x, y)` — Pearson相関係数
- `pearsonPValue(r, n)` — 相関係数のp値（t統計量を正規近似）
- `proportionZTest(successCount, trials, baselineP)` — 二項比率の正規近似z検定

既存の`scripts/analysis/collect-venue-stats.js`・`verify-threshold-logic.js`に同種の手書きロジックが重複して存在するが、それらの改修（重複排除）は本チケットのスコープ外とする（既存分析結果の再現性検証が別途必要になり過剰なため）。

### 4. `scripts/analysis/racer-fortune-telling/validate-fortune-correlation.js`（新規、Step1のメイン分析）

- `racer_profiles`と`race_entries`（`racer_id IS NOT NULL`）を結合し、対象データセットを構築
- 各行について`race_entries.race_id`から対象日を抽出し、4占術それぞれのスコアを計算
- 複勝圏内フラグ（`race_results`から判定）とSTフラグ（`race_start_timings`）を結合
- 占術ごとに、スコアの5分位バケット×複勝率の`proportionZTest`、およびSTとの`pearsonCorrelation`/`pearsonPValue`を実行
- 結果を`data/analysis/racer-fortune-telling/correlation-report-{実行日}.json`に保存（spec.md「4. 検証結果レポート」対応。4占術横並び比較用に、占術IDをトップレベルキーにした構造にする）

## 既存サービス層・共通ライブラリとの連携

- Supabaseクライアント: 全スクリプトで`scripts/lib/supabaseClient.js`を再利用（新規クライアント生成禁止）
- 日付処理: `scripts/lib/dateUtils.js`の`extractDateFromRaceId`を再利用
- `src/services/`との連携: 無し（本Step1は画面変更が無いバッチ・分析機能のため）

## 未確定事項（spec.mdから持ち越し、Step3/Step4で対応）

- 生年月日取得の目標成功率（実測後に判断）
- 統計的有意性の採用閾値（検証結果を見てユーザーが判断）
- 5分位バケットで実際にサンプル数が偏らないか（占術によっては同じ生年月日パターンが集中する可能性があり、実行後に確認が必要）
