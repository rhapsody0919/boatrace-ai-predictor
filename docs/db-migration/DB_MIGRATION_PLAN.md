# ボートレースAI予想システム - DB移行計画書

## 📋 概要

現在JSONファイルで管理しているレースデータ、予想データ、統計データをPostgreSQLデータベースに移行する計画書です。

**移行の目的:**
- データ量の増加に対応（現在21日分で約87Kトークン/ファイル）
- クエリ性能の向上（日付・会場・レース番号での絞り込み）
- データ整合性の確保（トランザクション管理）
- 運用性の向上（バックアップ・復旧が容易）
- 分析・レポート機能の強化

---

## 🗄️ データベーススキーマ設計

### 推奨DB: PostgreSQL

**理由:**
- リレーショナルデータに最適
- JSON型サポートで柔軟性あり
- 集計・分析クエリが強力
- 無料プランあり（Supabase、Neon、Railway）

### テーブル設計

#### 1. `venues` - ボートレース場マスタ

```sql
CREATE TABLE venues (
    venue_code INTEGER PRIMARY KEY,  -- 1-24
    venue_name VARCHAR(50) NOT NULL,  -- 桐生、戸田、...
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 初期データ（24会場）
INSERT INTO venues (venue_code, venue_name) VALUES
(1, '桐生'), (2, '戸田'), (3, '江戸川'), (4, '平和島'), (5, '多摩川'), (6, '浜名湖'),
(7, '蒲郡'), (8, '常滑'), (9, '津'), (10, '三国'), (11, 'びわこ'), (12, '住之江'),
(13, '尼崎'), (14, '鳴門'), (15, '丸亀'), (16, '児島'), (17, '宮島'), (18, '徳山'),
(19, '下関'), (20, '若松'), (21, '芦屋'), (22, '福岡'), (23, '唐津'), (24, '大村');
```

#### 2. `races` - レース情報

```sql
CREATE TABLE races (
    race_id VARCHAR(20) PRIMARY KEY,  -- '2025-12-05-01-01' (date-venue-race)
    date DATE NOT NULL,
    venue_code INTEGER NOT NULL REFERENCES venues(venue_code),
    race_number INTEGER NOT NULL,  -- 1-12
    start_time TIME,
    weather VARCHAR(20),
    air_temp DECIMAL(4,1),
    wind_direction INTEGER,
    wind_velocity DECIMAL(4,1),
    water_temp DECIMAL(4,1),
    wave_height INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,  -- 将来の拡張データ用（湿度、気圧など）
    scraped_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, venue_code, race_number)
);

CREATE INDEX idx_races_date ON races(date);
CREATE INDEX idx_races_venue ON races(venue_code);
CREATE INDEX idx_races_date_venue ON races(date, venue_code);
CREATE INDEX idx_races_metadata ON races USING GIN (metadata);  -- JSONB検索用
```

**拡張性:**
- `metadata` JSONBカラムで将来のスクレイピングデータ（湿度、気圧など）を追加可能
- 詳細は [SCHEMA_EXTENSIBILITY.md](./SCHEMA_EXTENSIBILITY.md) を参照

#### 3. `racers` - 選手データ（レースごと）

```sql
CREATE TABLE racers (
    id SERIAL PRIMARY KEY,
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    lane INTEGER NOT NULL,  -- 1-6
    name VARCHAR(50) NOT NULL,
    grade VARCHAR(5),  -- A1, A2, B1, B2
    age INTEGER,
    global_win_rate DECIMAL(5,2),
    global_2_rate DECIMAL(5,2),
    local_win_rate DECIMAL(5,2),
    local_2_rate DECIMAL(5,2),
    motor_number INTEGER,
    motor_2_rate DECIMAL(5,2),
    boat_number INTEGER,
    boat_2_rate DECIMAL(5,2),
    metadata JSONB DEFAULT '{}'::jsonb,  -- 将来の拡張データ用（スタート成績など）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(race_id, lane)
);

CREATE INDEX idx_racers_race_id ON racers(race_id);
CREATE INDEX idx_racers_metadata ON racers USING GIN (metadata);  -- JSONB検索用
```

**拡張性:**
- `metadata` JSONBカラムで将来の選手データ（スタート成績、コース取り成績など）を追加可能
- 詳細は [SCHEMA_EXTENSIBILITY.md](./SCHEMA_EXTENSIBILITY.md) を参照

#### 4. `predictions` - AI予想データ

```sql
CREATE TABLE predictions (
    id SERIAL PRIMARY KEY,
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    model_type VARCHAR(20) NOT NULL,  -- 'standard', 'safeBet', 'upsetFocus', 将来のモデルも追加可能
    top_pick INTEGER NOT NULL,  -- 本命艇番
    top3 INTEGER[] NOT NULL,  -- [1, 4, 3] のような配列
    confidence INTEGER,  -- 70-95
    ai_scores JSONB,  -- 各艇のAIスコア { "1": 3253, "2": 2890, ... }（拡張可能）
    reasoning TEXT[],  -- 予想理由の配列
    generated_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(race_id, model_type)
);

CREATE INDEX idx_predictions_race_id ON predictions(race_id);
CREATE INDEX idx_predictions_model ON predictions(model_type);
CREATE INDEX idx_predictions_date ON predictions(race_id) INCLUDE (generated_at);
```

**拡張性:**
- `model_type` に新しいモデル（例: 'advanced'）を追加可能（INSERTのみで対応）
- `ai_scores` JSONBで新しいスコア項目を追加可能
- 詳細は [SCHEMA_EXTENSIBILITY.md](./SCHEMA_EXTENSIBILITY.md) を参照

#### 5. `volatility` - 荒れ度スコア

```sql
CREATE TABLE volatility (
    id SERIAL PRIMARY KEY,
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    score INTEGER NOT NULL,  -- 0-100
    level VARCHAR(10) NOT NULL,  -- 'low', 'medium', 'high'
    recommended_model VARCHAR(20) NOT NULL,  -- 'standard', 'safeBet', 'upsetFocus'
    reasons TEXT[],  -- 理由の配列
    calculated_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(race_id)
);

CREATE INDEX idx_volatility_race_id ON volatility(race_id);
CREATE INDEX idx_volatility_score ON volatility(score);
```

#### 6. `results` - レース結果

```sql
CREATE TABLE results (
    id SERIAL PRIMARY KEY,
    race_id VARCHAR(20) NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
    finished BOOLEAN DEFAULT FALSE,
    rank1 INTEGER,  -- 1着艇番
    rank2 INTEGER,  -- 2着艇番
    rank3 INTEGER,  -- 3着艇番
    payouts JSONB,  -- { "win": {"1": 320}, "place": {"1": 110, "4": 240}, ... }
    updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(race_id)
);

CREATE INDEX idx_results_race_id ON results(race_id);
CREATE INDEX idx_results_finished ON results(finished);
CREATE INDEX idx_results_date ON results(race_id) INCLUDE (updated_at);
```

#### 7. `accuracy_stats` - 的中率統計（集計済み）

```sql
CREATE TABLE accuracy_stats (
    id SERIAL PRIMARY KEY,
    model_type VARCHAR(20) NOT NULL,  -- 'standard', 'safeBet', 'upsetFocus'
    venue_code INTEGER REFERENCES venues(venue_code),
    period_type VARCHAR(20) NOT NULL,  -- 'overall', 'yesterday', 'thisMonth', 'lastMonth', 'daily', 'monthly'
    period_value DATE,  -- 日別・月別の場合の日付
    total_races INTEGER DEFAULT 0,
    finished_races INTEGER DEFAULT 0,
    top_pick_hits INTEGER DEFAULT 0,
    top_pick_hit_rate DECIMAL(5,4),
    top_pick_places INTEGER DEFAULT 0,
    top_pick_place_rate DECIMAL(5,4),
    top3_hits INTEGER DEFAULT 0,
    top3_hit_rate DECIMAL(5,4),
    top3_included_hits INTEGER DEFAULT 0,
    top3_included_rate DECIMAL(5,4),
    -- 回収率データ
    recovery_win JSONB,  -- { "totalInvestment": 12000, "totalPayout": 8540, "hitCount": 45, "recoveryRate": 0.712 }
    recovery_place JSONB,
    recovery_trifecta JSONB,
    recovery_trio JSONB,
    calculated_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accuracy_stats_model ON accuracy_stats(model_type);
CREATE INDEX idx_accuracy_stats_venue ON accuracy_stats(venue_code);
CREATE INDEX idx_accuracy_stats_period ON accuracy_stats(period_type, period_value);
CREATE INDEX idx_accuracy_stats_date ON accuracy_stats(calculated_at);
```

#### 8. `venue_recommendations` - 会場別推奨モデル

```sql
CREATE TABLE venue_recommendations (
    id SERIAL PRIMARY KEY,
    venue_code INTEGER NOT NULL REFERENCES venues(venue_code),
    period_type VARCHAR(20) NOT NULL,  -- 'overall', 'thisMonth'
    best_model VARCHAR(20) NOT NULL,  -- 'standard', 'safeBet', 'upsetFocus'
    best_bet_type VARCHAR(20) NOT NULL,  -- 'win', 'place', 'trifecta', 'trio'
    recovery_rate DECIMAL(5,4),
    calculated_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(venue_code, period_type)
);

CREATE INDEX idx_venue_recommendations_venue ON venue_recommendations(venue_code);
CREATE INDEX idx_venue_recommendations_period ON venue_recommendations(period_type);
```

---

## ⏰ 移行タイミングの推奨

### 本番影響を最小化する移行スケジュール

**重要:** 詳細な移行戦略は [MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md) を参照してください。

**推奨移行タイミング:**
- **開発・テスト環境:** いつでも（本番影響なし）
- **ステージング環境:** 平日の深夜（0:00-6:00 JST）または 20:00-22:00 JST
- **本番データ移行:** 
  - **推奨1:** 平日の深夜2:00-4:00 JST（最推奨）
  - **推奨2:** 平日の20:00-22:00 JST（代替案）
    - レース開催が終了している
    - 対応可能な時間帯
    - ⚠️ 段階的トラフィック切り替えが必須

**避けるべきタイミング:**
- ❌ レース開催時間中（10:00-17:00 JST）
- ❌ 週末・祝日
- ❌ データ更新直後（GitHub Actions実行直後）
- ❌ GitHub Actions実行中（20:00実行完了を待つ）

---

## 🔄 移行フェーズ

### フェーズ1: データベース環境構築

**目標:** PostgreSQL環境をセットアップし、スキーマを作成する

**タスク:**
1. PostgreSQL環境の選択とセットアップ
   - 推奨: Supabase（無料プラン、PostgreSQL 15+）
   - 代替: Neon、Railway、Vercel Postgres
2. データベース接続情報の環境変数設定
   - `DATABASE_URL` (接続文字列)
   - `.env` ファイルに追加
3. スキーマ作成スクリプトの作成
   - `scripts/db/schema.sql` を作成
   - 全テーブルとインデックスの定義
4. マイグレーション実行
   - スキーマを適用
   - 初期データ（venues）を投入

**成果物:**
- `scripts/db/schema.sql`
- `scripts/db/migrate.js` (スキーマ適用スクリプト)
- `.env.example` (環境変数テンプレート)

---

### フェーズ2: データ移行スクリプト作成

**目標:** 既存のJSONデータをDBにインポートするスクリプトを作成

**タスク:**
1. JSON読み込みユーティリティ
   - `scripts/db/migrate-from-json.js` を作成
   - `data/races.json` を読み込み
   - `data/predictions/*.json` を読み込み
   - `data/predictions/summary.json` を読み込み

2. データ変換ロジック
   - JSON構造をDBスキーマにマッピング
   - 日付フォーマット変換
   - 配列・オブジェクトの正規化

3. バッチインサート処理
   - トランザクション管理
   - エラーハンドリング
   - 進捗表示

4. データ検証
   - 移行前後のデータ件数比較
   - サンプルデータの整合性チェック

**成果物:**
- `scripts/db/migrate-from-json.js`
- `scripts/db/validate-migration.js` (検証スクリプト)

---

### フェーズ3: データアクセス層の実装

**目標:** DBアクセス用のユーティリティ関数を作成

**タスク:**
1. DB接続モジュール
   - `src/utils/db.js` または `scripts/utils/db.js` を作成
   - PostgreSQL接続プール管理
   - 接続エラーハンドリング

2. クエリ関数の実装
   - `getRacesByDate(date)` - 日付でレース取得
   - `getRaceById(raceId)` - レースIDで取得
   - `getPredictionsByRaceId(raceId)` - 予想データ取得
   - `getResultsByRaceId(raceId)` - 結果データ取得
   - `getAccuracyStats(model, period, venue)` - 統計取得
   - `insertRace(raceData)` - レース挿入
   - `updateRaceResult(raceId, resultData)` - 結果更新
   - `insertPrediction(raceId, modelType, predictionData)` - 予想挿入

3. トランザクション管理
   - 複数テーブル更新時の整合性確保

**成果物:**
- `scripts/utils/db.js` (または `src/utils/db.js`)
- 各クエリ関数の実装

---

### フェーズ4: スクリプトのDB対応

**目標:** 既存スクリプトをDB書き込みに変更

**タスク:**
1. `scripts/scrape-to-json.js` の改修
   - JSON書き込み → DB書き込みに変更
   - `races`, `racers` テーブルに挿入
   - 既存データの更新処理

2. `scripts/generate-predictions.js` の改修
   - `races` テーブルから読み込み
   - `predictions`, `volatility` テーブルに挿入
   - 3モデル分のデータを一括挿入

3. `scripts/scrape-results.js` の改修
   - `predictions` テーブルから読み込み
   - `results` テーブルに更新
   - 既に完了済みのレースはスキップ

4. `scripts/calculate-accuracy.js` の改修
   - `predictions`, `results` テーブルから読み込み
   - `accuracy_stats`, `venue_recommendations` テーブルに集計結果を保存
   - 既存のsummary.json生成は後方互換性のため維持（オプション）

**成果物:**
- 各スクリプトのDB対応版
- 後方互換性のためのJSON出力オプション（移行期間中）

---

### フェーズ5: APIエンドポイントの実装

**目標:** フロントエンド用のAPIエンドポイントを作成

**タスク:**
1. APIサーバーの選択
   - Vercel Serverless Functions（推奨）
   - または Node.js + Express（別サーバー）

2. APIエンドポイント実装
   - `GET /api/races?date=2025-12-05` - レース一覧取得
   - `GET /api/races/:raceId` - レース詳細取得
   - `GET /api/predictions/:raceId` - 予想データ取得
   - `GET /api/results/:raceId` - 結果データ取得
   - `GET /api/accuracy?model=standard&period=overall` - 統計取得
   - `GET /api/venue-recommendations?period=overall` - 会場別推奨取得

3. エラーハンドリング
   - 404, 500エラーの適切な処理
   - ログ出力

4. キャッシュ戦略
   - 静的データ（会場マスタなど）のキャッシュ
   - 統計データのキャッシュ（5分間隔など）

**成果物:**
- `api/` ディレクトリ配下のエンドポイント
- `vercel.json` の設定更新

---

### フェーズ6: フロントエンドのAPI対応

**目標:** フロントエンドをJSONファイル読み込みからAPI呼び出しに変更

**タスク:**
1. `src/App.jsx` の修正
   - `fetch('data/races.json')` → `fetch('/api/races?date=...')`
   - `fetch('data/predictions/...')` → `fetch('/api/predictions/...')`
   - エラーハンドリングの追加

2. `src/components/AccuracyDashboard.jsx` の修正
   - `fetch('data/predictions/summary.json')` → `fetch('/api/accuracy?model=...')`

3. `src/components/HitRaces.jsx` の修正
   - 予想データ取得をAPI経由に変更

4. ローディング状態の改善
   - API呼び出し中の表示

**成果物:**
- フロントエンドのAPI対応版

---

### フェーズ7: 移行実行と検証

**目標:** 実際にデータを移行し、動作確認

**⚠️ 重要: 本番影響を最小化するため、段階的移行を実施**

**推奨実施時間:** **平日の深夜2:00-4:00 JST**

**タスク:**
1. **デュアルライト開始（JSONとDB併用）**
   - スクリプトをDB書き込み対応に変更
   - JSONファイルへの書き込みも継続（後方互換性）
   - 1-2週間の併用期間を設ける

2. データ移行実行
   - `scripts/db/migrate-from-json.js` を実行
   - 全JSONデータをDBにインポート
   - **実施時間: 2:00 JST**

3. データ検証
   - `scripts/db/validate-migration.js` を実行
   - JSONとDBのデータ整合性を確認
   - **実施時間: 2:30 JST**

4. 動作確認
   - スクリプトが正常に動作するか確認
   - APIエンドポイントが正常に応答するか確認
   - フロントエンドが正常に表示されるか確認
   - **実施時間: 3:00 JST**

5. 段階的トラフィック切り替え
   - 10%のトラフィックをAPI経由に（3:30 JST）
   - 問題なければ100%に拡大（4:00 JST）
   - フォールバック機能でJSONに自動切り替え可能

6. パフォーマンステスト
   - クエリ実行時間の測定
   - 同時アクセス時の動作確認
   - APIレスポンス時間の監視

7. ロールバック計画
   - 問題発生時のJSONファイルへの復帰手順
   - 環境変数 `USE_DATABASE=false` で即座に切り替え可能

**成果物:**
- 移行完了報告
- パフォーマンス測定結果
- ロールバック手順書

**詳細:** [MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md) を参照

---

### フェーズ8: 本番環境へのデプロイ

**目標:** 本番環境にDB移行版をデプロイ

**タスク:**
1. 本番DB環境のセットアップ
   - Supabase本番プロジェクト作成
   - 接続情報の設定

2. 本番データ移行
   - 本番DBへのデータインポート

3. デプロイ
   - Vercelへのデプロイ
   - 環境変数の設定

4. モニタリング
   - エラーログの監視
   - パフォーマンス監視

**成果物:**
- 本番環境の稼働確認

---

## 📝 技術的な詳細

### データベース接続

**推奨ライブラリ:** `pg` (node-postgres)

```javascript
// scripts/utils/db.js
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export default pool;
```

### トランザクション管理

```javascript
// 例: レースと選手データの一括挿入
const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  // races テーブルに挿入
  await client.query('INSERT INTO races ...');
  
  // racers テーブルに一括挿入
  await client.query('INSERT INTO racers ...');
  
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### バッチインサート

```javascript
// 大量データの効率的な挿入
const values = races.map((race, i) => 
  `($${i*10+1}, $${i*10+2}, ...)`
).join(', ');

await pool.query(`
  INSERT INTO races (race_id, date, venue_code, ...)
  VALUES ${values}
  ON CONFLICT (race_id) DO UPDATE SET ...
`, flattenedValues);
```

---

## ⚠️ 注意事項

### データ整合性

- 外部キー制約を適切に設定
- トランザクションで複数テーブルの更新を保護
- レースIDの一意性を保証

### パフォーマンス

- インデックスを適切に設定（日付、会場コード、モデル種別など）
- 大量データのクエリはページネーションを実装
- 統計データは事前集計してキャッシュ

### 後方互換性

- **デュアルライト期間を設ける（1-2週間）**
  - JSONとDBの両方に書き込み
  - 問題発生時は即座にJSONに切り替え可能
- 既存のスクリプトが動作するよう、JSON出力オプションを残す
- 環境変数 `USE_DATABASE=false` でJSONモードに戻せる
- フロントエンドはAPI失敗時にJSONファイルにフォールバック

### エラーハンドリング

- DB接続エラーの適切な処理
- リトライロジックの実装
- ログ出力の充実

---

## 📊 移行チェックリスト

### フェーズ1: 環境構築
- [ ] PostgreSQL環境のセットアップ
- [ ] 環境変数の設定
- [ ] スキーマ作成スクリプトの作成
- [ ] マイグレーション実行

### フェーズ2: データ移行
- [ ] 移行スクリプトの作成
- [ ] データ変換ロジックの実装
- [ ] テストデータでの移行実行
- [ ] データ検証

### フェーズ3: データアクセス層
- [ ] DB接続モジュールの作成
- [ ] クエリ関数の実装
- [ ] トランザクション管理の実装

### フェーズ4: スクリプト改修
- [ ] scrape-to-json.js のDB対応
- [ ] generate-predictions.js のDB対応
- [ ] scrape-results.js のDB対応
- [ ] calculate-accuracy.js のDB対応

### フェーズ5: API実装
- [ ] APIエンドポイントの実装
- [ ] エラーハンドリング
- [ ] キャッシュ戦略の実装

### フェーズ6: フロントエンド対応
- [ ] App.jsx のAPI対応
- [ ] AccuracyDashboard.jsx のAPI対応
- [ ] HitRaces.jsx のAPI対応

### フェーズ7: 移行実行
- [ ] 本番データの移行
- [ ] 動作確認
- [ ] パフォーマンステスト

### フェーズ8: 本番デプロイ
- [ ] 本番DB環境のセットアップ
- [ ] 本番データ移行
- [ ] Vercelデプロイ
- [ ] モニタリング設定

---

## 🎯 成功基準

1. **データ整合性:** 全JSONデータがDBに正確に移行されている
2. **パフォーマンス:** APIレスポンスが1秒以内
3. **可用性:** 99.9%以上の稼働率
4. **後方互換性:** 既存のスクリプトが動作する（オプション付き）

---

## 📚 参考資料

- PostgreSQL公式ドキュメント: https://www.postgresql.org/docs/
- Supabase: https://supabase.com/docs
- node-postgres: https://node-postgres.com/
- Vercel Serverless Functions: https://vercel.com/docs/functions

