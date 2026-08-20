# システム仕様書

龍神レーダー予測システムの詳細仕様。3つのAIモデルによる順位予測と、1マーク展開予測を組み合わせたシステム。

> **関連ドキュメント:**
> - [database-design.md](./database-design.md) - データベース設計書
> - [analysis-guide.md](./analysis-guide.md) - 分析ガイド
> - [design-system.md](./design-system.md) - デザインシステム

---

## 目次

1. [用語定義](#用語定義)
2. [システム構成](#システム構成)
3. [予測モデル](#予測モデル)
4. [展開予測](#展開予測)
5. [データモデル](#データモデル)
6. [データフロー](#データフロー)
7. [ルールマッチング](#ルールマッチング)
8. [ページ別仕様](#ページ別仕様)
9. [API・サービス仕様](#apiサービス仕様)

---

## 用語定義

### 基本用語

| 用語 | 定義 | 例 |
|------|------|-----|
| **予測 (prediction)** | AIモデルが出力した1レースの順位予測 | 1-2-3（1着:1号艇、2着:2号艇、3着:3号艇） |
| **モデル (model)** | 予測アルゴリズムの種類 | standard, safeBet, upsetFocus |
| **展開予測 (turnPrediction)** | 1マーク旋回時の展開パターン予測 | 「1コース逃げ 52%」 |
| **ルール (rule)** | 特定条件下で賭けを推奨する判定ロジック | 「江戸川7R以降、conf80以上なら3連単」 |
| **ルール適用 (rule application)** | 1つの予測に1つのルールがマッチしたこと | 1レースに3ルールがマッチ → 3件のルール適用 |
| **レース (race)** | ボートレースの1つのレース | 2026-02-05 江戸川 7R |
| **結果 (result)** | レースの確定着順と配当 | 着順: 1-3-2、単勝配当: 150円 |

### データの関係

```
1つのレース → 3つの予測（モデル別） → 1つの展開予測
                                     → 複数のルールがマッチ可能
```

---

## システム構成

### アーキテクチャ

```
[ボートレース公式サイト]
        ↓ スクレイピング
[data/races.json] ← scrape-to-json.js
        ↓
[generate-predictions.js]
    ├── 3モデルの順位予測
    ├── 1マーク展開予測
    ├── ボラティリティ計算
    └── Supabase書き込み
        ↓
[React SPA (Vite)]
    ├── PredictionPanel（予測表示の統合コンポーネント）
    ├── FirstMarkAnimation（展開予測アニメーション）
    ├── AttackDefenseTable（攻防データ）
    └── RuleMatch（ルール適合チェック）
```

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React + Vite + react-router-dom |
| データベース | Supabase (PostgreSQL) |
| デプロイ | Vercel (SPA + Edge Functions) |
| CI/CD | GitHub Actions |
| アニメーション | framer-motion |

---

## 予測モデル

### 3つのAIモデル

| モデルID | 表示名 | 特性 |
|---------|--------|------|
| `standard` | スタンダード | バランス型。全国勝率×150 + 級別ボーナス + 枠順補正 |
| `safeBet` | 本命狙い | 堅実型。1号艇・A1級に大きなボーナス |
| `upsetFocus` | 穴狙い | 高配当型。モーター/ボート重視、枠順補正を逆転 |

### スコア計算の主要因子

```
AIスコア = 全国勝率 × 重み
         + 級別ボーナス（A1: +400, A2: +250, B1: +100）
         + 枠順補正（モデルごとに異なる）
         + モーター2連率 × 重み
         + ボート2連率 × 重み
         + 当地勝率ボーナス
         + 展開予測ボーナス（1マーク優位性）
         + 展示データボーナス（展示タイム・ST）
```

### confidence（信頼度）

1位と2位のスコア差から算出。70〜95の範囲にクランプ。

---

## 展開予測

### 概要

1マーク旋回時の展開パターンを統計的に予測するシステム。`scripts/lib/turnPrediction.js` で実装（v4）。

### v4 の主な改善点

| 改善 | 内容 |
|------|------|
| **統一コース勝率フレームワーク** | 逃げ・非逃げを同一スケール（`COURSE_BASE_WIN_RATE × techniqueRate`）で計算。v3 では逃げの rawProb が非逃げの約9.5倍大きく、正規化後も逃げが過大評価されていた |
| **レースコンディション統合** | 会場1コース勝率・風速・波高から `upsetFactor`（0〜1）を算出。荒れやすいレースで逃げ確率を最大25%抑制、非逃げを最大15%押し上げ |
| **defense adjustment** | 非逃げの確率に1コースの被攻撃脆弱性を反映。`0.6 + 0.4 * (defenseRate / avgDefenseRate)` で、差し・まくりなど攻め手に応じた補正 |

### 入力データ

| データ | ソース |
|--------|--------|
| 展示ST / デフォルトST(0.15) | exhibition_data / beforeinfo |
| 選手の平均ST | racer_aggregated_stats.avg_st（展示STと55:45でブレンド） |
| 選手の攻撃分布 (逃げ/差し/まくり等) | racer_aggregated_stats.attack_distribution |
| 選手の防御分布 (逃がされ/差され等) | racer_aggregated_stats.defense_distribution |
| モーター2連率 | race_entries |
| 会場コード・風速・波高 | race_entries（v4で追加） |

### 出力

```javascript
{
  patterns: [                    // 上位3パターン
    { course: 1, technique: "逃げ", probability: 0.52, name: "1コース逃げ" },
    { course: 3, technique: "まくり差し", probability: 0.18 },
    { course: 2, technique: "差し", probability: 0.15 }
  ],
  technique: "逃げ",             // 最有力決まり手
  probability: 0.52,
  winnerCourse: 1,
  distribution: [...],           // 各コース勝率分布
  boatStrengths: [...]           // 各艇の総合力
}
```

### Supabaseへの保存

展開予測は `predictions.feature_contributions` JSONB カラムに保存される。
フロントエンドはこのデータを読み取り、`FirstMarkAnimation` と `AttackDefenseTable` で表示。

---

## データモデル

> **詳細は [database-design.md](./database-design.md) を参照**

### predictions テーブル

3モデルの予測データを格納。1レースにつき3レコード（standard, safeBet, upsetFocus）。

| カラム | 型 | 説明 |
|--------|-----|------|
| `race_id` | string | レースID。形式: `YYYY-MM-DD-会場コード-レース番号` |
| `model_id` | string | `standard`, `safeBet`, `upsetFocus` |
| `top_pick` | int | 1着予測の艇番 (1-6) |
| `top_2nd` | int | 2着予測 |
| `top_3rd` | int | 3着予測 |
| `confidence` | int | 信頼度 (70-95) |
| `feature_contributions` | JSONB | 展開予測 (turnPrediction) + 選手統計 (racerStats) |
| `is_hit_*` | boolean | 的中フラグ（結果取得後に更新） |
| `payout_*` | int | 配当（結果取得後に更新） |

**race_id の例:**
```
2026-02-05-03-07
    │       │  └─ レース番号（07 = 7R）
    │       └──── 会場コード（03 = 江戸川）
    └──────────── 日付
```

### ルール定義（コード内）

`src/services/ruleMatchService.js` に34ルールをハードコード（15会場対応）。

```javascript
{
  id: 'E03-W001',
  patternName: 'EDOGAWA-WIN-NO2-CONF70',
  description: '2号艇推し×conf70-80',
  betType: 'win',           // win/place/trio/exacta
  stats: { samples: 12, hits: 6, recovery: 203 },
  reliability: 'highest',
  check: (pred, raceNo, conf, predSorted, has1) => {
    return pred.topPick === 2 && conf >= 70 && conf < 80
  }
}
```

### 賭け種別 (betType)

| betType | 日本語 | 的中条件 | 配当カラム |
|---------|--------|----------|-----------|
| `win` | 単勝 | 1着のみ一致 | `payout_win` |
| `place` | 複勝 | 1着または2着に含まれる | `payout_place_1` or `payout_place_2` |
| `trio` | 3連複 | 3艇が順不同で一致 | `payout_trifecta` |
| `exacta` | 3連単 | 3艇が順番通り一致 | `payout_trio` |

---

## データフロー

### GitHub Actions ワークフロー

| ワークフロー | スケジュール | 実行内容 |
|-------------|------------|---------|
| `scrape.yml` | 毎時（JST 3-22時） | フルパイプライン（スクレイプ→予測→結果→精度→デプロイ） |
| `scrape-exhibition.yml` | 15分間隔（JST 9-17時） | 展示データ取得→予測再生成（Supabaseのみ、デプロイなし） |
| `aggregate-stats.yml` | 毎日 JST 23:00 | 選手集計統計の更新（racer_aggregated_stats） |

### フルパイプライン（scrape.yml）

```
[1. 出走表・展示データ取得]
    │ scrape-to-json.js → data/races.json
    ▼
[2. 予測生成]
    │ generate-predictions.js
    │ → races, race_entries, predictions, exhibition_data, race_conditions
    ▼
[3. 結果スクレイピング]
    │ scrape-results.js (continue-on-error)
    │ → race_results, race_start_timings, predictions(的中更新)
    ▼
[4. 精度統計更新]
    │ calculate-accuracy.js (continue-on-error)
    │ → models テーブル更新（3モデル×4券種）
    ▼
[5. git commit & push → Vercel deploy]
```

#### calculate-accuracy.js の処理

`predictions` テーブルから全モデル（standard/safeBet/upsetFocus）の成績を集計し、`models` テーブルを更新。

| 券種 | 的中判定カラム | 配当カラム | models保存先 |
|------|-------------|----------|-------------|
| 単勝 | is_hit_win | payout_win | hit_rate_win / recovery_rate_win |
| 複勝 | is_hit_place | payout_place | hit_rate_place / recovery_rate_place |
| 3連複 | is_hit_trifecta | payout_trifecta | hit_rate_trifecta / recovery_rate_trifecta |
| 3連単 | is_hit_trio | payout_trio | hit_rate_trio / recovery_rate_trio |

### 選手統計集計パイプライン（aggregate-stats.yml）

毎日 JST 23:00 に実行。当日のレース結果を含む全データから選手統計を再集計する。

```
[race_results + race_start_timings + race_entries]
    │ aggregate-racer-stats.js --all
    │ → racer_aggregated_stats 更新
    │   (avg_st, attack_distribution, defense_distribution 等)
    ▼
[翌日の generate-predictions.js で最新統計を使用]
```

### ページ読み込み時の処理

```
[ユーザーがページを開く（/ または /races/:date）]
    │
    ├─▶ [Supabaseから予測データ取得]
    │     predictions + feature_contributions (展開予測・選手統計)
    │
    ├─▶ [Supabaseから結果データ取得]
    │     race_results
    │
    └─▶ [ルールマッチング]
          各予測に対してVENUE_RULESをチェック → /picks で表示
```

---

## ルールマッチング

### 概要

`ruleMatchService.js` に34ルールをハードコード。各予測に対してルール条件をチェックし、マッチしたルールをおすすめレースとして表示（`/picks`）。

```
1つのレース → 1つの予測 → 複数のルールがマッチ可能 → 複数のルール適用
```

### 累積成績 (getOverallPerformance)

**ファイル:** `src/services/ruleMatchService.js`

| 指標 | 計算方法 | 注意点 |
|------|---------|--------|
| レース数 | `totalSamples` | **実際はルール適用数**（結果ありのみ） |
| 的中数 | `totalHits` | 的中したルール適用数 |
| 的中率 | `totalHits / totalSamples * 100` | パーセント表示 |
| 投資 | `totalSamples * 100` | 1ルール適用 = 100円と仮定 |
| 回収 | `totalPayout` | 的中時の配当合計 |
| 回収率 | `totalPayout / (totalSamples * 100) * 100` | パーセント表示 |

**重要: 「レース数」の実態**

```javascript
// getOverallPerformance() 内のカウントロジック
for (const pred of allPredictions) {
  for (const rule of rules) {
    if (rule.check(...)) {
      if (result) {           // 結果がある場合のみカウント
        totalSamples++        // ← これが「レース数」として表示される
      }
    }
  }
}
```

- 1レースに3ルールがマッチ → totalSamples += 3
- 表示上は「レース数」だが、実際は「ルール適用数（結果あり）」

### 履歴件数 (getRuleApplicationHistory)

**ファイル:** `src/services/adminRuleService.js`

| 指標 | 計算方法 | 注意点 |
|------|---------|--------|
| total | Supabaseのcount | 予測データの行数 |
| historyItems.length | ループで生成 | ルール適用数（結果の有無問わず） |

**注意:** `total` と `historyItems.length` は異なる可能性がある。

```javascript
// 現在の実装
const { data: predictions, count } = await supabase
  .from('predictions')
  .select('*', { count: 'exact' })  // count = 予測データ数

// historyItemsはルール適用ごとに生成
for (const pred of predictions) {
  const rules = getMatchingRules(...)
  for (const rule of rules) {
    historyItems.push({...})  // ルールごとに1件
  }
}

return { data: historyItems, total: count }  // totalは予測数、dataはルール適用数
```

### 週別パフォーマンス (getWeeklyPerformance)

**ファイル:** `src/services/adminRuleService.js`

- 日付ごとにルール適用数と配当を集計
- 週単位（月曜始まり）でグループ化
- 累積値を計算

---

## ページ別仕様

### / (トップページ) および /races/:date

**対象ユーザー:** 一般ユーザー

#### レースカード

- 当日（または指定日）の全レースを会場別に表示
- 「AI予想を見る」ボタンで予測セクションを展開

#### 予測セクション（PredictionPanel）

`PredictionPanel` コンポーネントが両ページで共通使用される。

**表示順序:**

| 順番 | コンポーネント | 内容 |
|------|-------------|------|
| 1 | VolatilityDisplay | レースのボラティリティ（荒れ度） |
| 2 | ModelDescription | 選択中モデルの説明 |
| 3 | ModelSwitcher | 3モデル切替タブ |
| 4 | FirstMarkAnimation | 1マーク展開予測アニメーション（SVG） |
| 5 | AttackDefenseTable | 選手の攻撃/防御分布データ（下記表示ルール参照） |
| 6 | SocialShareButtons | SNSシェアボタン |

#### 超展開データ（AttackDefenseTable）の表示ルール

全コース合計勝利数に応じて表示を段階的に切り替える。

| 全コース合計勝利数 | 表示 | スタイル |
|----------------|------|---------|
| 0〜1勝 | 全国平均値（%表示） | 薄字・イタリック（`.ad-default-value`） |
| 2〜4勝 | 実データ + ※マーク | やや薄く表示（`.ad-reference-value`） |
| 5勝以上 | 実データ | 通常表示 |

- 全国平均値は14,155レースの集計データ（`DEFAULT_ATTACK`, `DEFAULT_DEFENSE`）
- 凡例セクションに薄字・※マークの説明を表示
| 7 | RaceResult | レース結果（的中判定表示） |
| 8 | PredictionTable | 3モデル別の順位予測テーブル |
| 9 | VenueGuide | 会場ガイドリンク |

#### 統計的な注目ポイントのルール（PredictionTable内）

優先度順に最大5件を表示。AI予想上位（top3）に含まれる選手の insight は優先度 +1。

| ルール | 優先度 | トリガー条件 |
|-------|-------|------------|
| スタート力の差 | 7 | avgST ≤ 0.12 かつ stStddev ≤ 0.04 |
| 荒れ度の示唆 | 7 | score ≥ 65（波乱）or ≤ 35（堅い） |
| 展開予測の決まり手 | 6 | probability ≥ 0.35 |
| 展示タイムの優位性 | 6 | 最速が他艇平均より0.05秒以上速い |
| コース勝率の注目 | 5 | 当該コース勝率 ≥ 40%（10走以上） |
| 当地勝率の優位性 | 5 | ≥ 6.0 かつ 2位と1.0以上差 |
| 好モーター | 4 | motor2Rate > 40% |
| 総合力の大差 | 4 | 1位と2位のboatStrengths差 ≥ 0.20 |
| 高全国勝率 | 3 | winRate ≥ 7.0 |

**ローディング演出:**
- PredictionLoadingOverlay が3ステップのプログレスを表示
- 各セクションはframer-motionで段階的にフェードイン

### /picks（今日のおすすめ）

**対象ユーザー:** 一般ユーザー

#### サマリーセクション

| 表示項目 | データソース | 説明 |
|---------|-------------|------|
| 投資 | `overallPerformance.totalInvestment` | ルール適用数 × 100円 |
| 回収 | `overallPerformance.totalPayout` | 的中配当合計 |
| 回収率 | `overallPerformance.recovery` | 回収 / 投資 × 100 |
| レース数 | `overallPerformance.samples` | ルール適用数（結果あり） |
| 的中数 | `overallPerformance.hits` | 的中ルール適用数 |

#### 注目レース

**表示条件:**
- 回収率 100% 以上、サンプル数 10 件以上、`reliability` が `high` 以上

### /admin/rules（管理者ダッシュボード）

**対象ユーザー:** 管理者（URLを知っている人のみ）

| タブ | 内容 |
|------|------|
| 概要 | 累積成績、全ルールテーブル（ソート可）、週別推移グラフ |
| 会場別 | 会場セレクタ → 選択会場のルール一覧 |
| 本日 | 今日適用されたルール一覧（結果あり/なし区別） |
| 履歴 | 日付範囲フィルタ、300件/ページ、ルール適用詳細テーブル |

---

## API・サービス仕様

### ruleMatchService.js

会場別ベッティングルールのマッチングと成績追跡。34ルール・15会場対応。

| 関数 | 用途 |
|------|------|
| `getMatchingRules(prediction, venueCode, raceNo)` | 予測にマッチするルール一覧 |
| `getOverallPerformance()` | 全体の累積成績 |
| `getTopPerformingRules(options)` | 成績順のルール一覧 |
| `getTodaysMatchingRaces(today)` | 今日のルールマッチレース |
| `getRulePerformanceByVenue(venueCode)` | 会場別のルール成績 |
| `getAvailableVenues()` | ルールが定義されている会場一覧 |

### adminRuleService.js

| 関数 | 用途 |
|------|------|
| `getRuleApplicationHistory(startDate, endDate, limit, offset)` | ルール適用履歴 |
| `getWeeklyPerformance()` | 週別累積パフォーマンス |

### supabaseDataService.js

| 関数 | 用途 |
|------|------|
| `fetchRaces(date)` | 指定日のレース一覧取得 |
| `fetchPredictions(raceId)` | 3モデルの予測データ取得（feature_contributions含む） |
| `fetchRaceResult(raceId)` | レース結果取得 |
| `fetchExhibitionData(raceId)` | 展示データ取得 |

### turnPrediction.js (scripts/lib/)

| 関数 | 用途 |
|------|------|
| `predictFirstMark(players, raceConditions?)` | 1マーク展開予測 v4（統一フレームワーク + レースコンディション） |
| `predictFirstMarkV2(players, raceConditions?)` | 同上（内部実装） |

---

## 会場コード一覧

```
01:桐生    02:戸田    03:江戸川  04:平和島  05:多摩川  06:浜名湖
07:蒲郡    08:常滑    09:津      10:三国    11:びわこ  12:住之江
13:尼崎    14:鳴門    15:丸亀    16:児島    17:宮島    18:徳山
19:下関    20:若松    21:芦屋    22:福岡    23:唐津    24:大村
```

---

## 既知の仕様上の注意点

### 1. 「レース数」の表示

- 画面上の「レース数」は実際には「ルール適用数（結果あり）」
- 1レースに複数ルールがマッチすると、複数カウントされる
- 将来的に「ユニークレース数」と「ルール適用数」を分けて表示することを検討

### 2. 履歴の件数表示

- `total` は予測データ数を表示
- 実際の履歴アイテム数（ルール適用数）とは異なる場合がある
- ページネーションは予測データ数に基づく

### 3. サマリーの遡及計算

- ルールを削除すると、過去の成績も再計算される
- 「現在アクティブなルールで運用開始日から賭けていたら」という仮想成績
- 過去にルールが存在していたかどうかは考慮されない
