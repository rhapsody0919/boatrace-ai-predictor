# 龍神レーダー - ボートレースAI予想サービス

AIを活用したボートレース予想サービスです。選手の過去データ、モーター性能、当地実績などを分析し、3つの予想モデルで最適な舟券戦略を提案します。

**公式サイト**: https://www.boat-ai.jp/

---

## システム概要

```
┌─────────────────────────────────────────────────────────────────┐
│                         ユーザー                                 │
│                    (スマートフォン/PC)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Vercel (ホスティング)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   React SPA (PWA)                        │    │
│  │  - レース一覧・AI予想表示・的中率統計・ブログ           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Edge Functions (キャッシュ層)               │    │
│  │  - /api/races/today      → get_today_races RPC呼出      │    │
│  │  - /api/predictions/DATE → get_predictions_by_date RPC  │    │
│  │  ※ CDNキャッシュ: 5分〜1時間（データ種別による）        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Supabase                                  │
│                                                                  │
│  ┌──────────────────────┐  ┌────────────────────────────────┐  │
│  │  PostgreSQL          │  │  RPC関数（クエリロジック）     │  │
│  │  ・races             │  │  ・get_today_races()           │  │
│  │  ・predictions       │  │  ・get_predictions_by_date()   │  │
│  │  ・accuracy_summary  │  │  ・その他集計関数              │  │
│  └──────────────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ データ書き込み
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (自動化)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 毎時実行 (JST 3:00-22:00, 1時間間隔)                    │    │
│  │ 1. scrape-to-json.js      → 公式サイトからレース取得    │    │
│  │ 2. generate-predictions.js → AI予想生成（3モデル）      │    │
│  │ 3. scrape-results.js      → レース結果取得              │    │
│  │ 4. calculate-accuracy.js  → 的中率・回収率計算          │    │
│  │ 5. Supabaseへ保存 → Vercelデプロイ                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### データの流れ

1. **GitHub Actions** が毎日、公式サイトからデータを取得し **Supabase** に保存
2. ユーザーがサイトにアクセスすると **React SPA** が **Edge Functions** にリクエスト
3. **Edge Functions** は **Supabase RPC関数** を呼び出し、結果をCDNキャッシュして返す
4. 同じリクエストが来たらキャッシュから即座に返す（DBアクセス不要）

---

## 主な機能

### 1. 3つの予想モデル

| モデル | 特徴 | 適したレース |
|-------|------|-------------|
| **スタンダード** | 的中率と配当のバランス重視 | 標準的なレース |
| **本命狙い** | 的中率最優先の堅実型 | 1号艇・A級選手が有力なレース |
| **穴狙い** | 高配当を狙う攻撃型 | 混戦・荒れる展開のレース |

### 2. 荒れ度スコア

各レースの「荒れやすさ」を数値化し、最適なモデルを自動推奨します。

### 3. 会場別ルールエンジン

24会場それぞれの特徴を分析し、回収率100%超えの条件を統計的に発見。会場ごとに最適化されたルールを適用します。

**実装済み会場**: 江戸川、平和島、浜名湖、蒲郡、津、三国、びわこ、鳴門、丸亀、児島、宮島、徳山、芦屋、福岡、大村（15会場・34ルール）

### 4. 的中率統計

- 単勝、複勝、3連複、3連単の的中率・回収率を表示
- 日別・月別・会場別の統計
- モデル別の成績比較

### 5. ブログ

- ボートレース攻略記事
- 会場別攻略ガイド
- 週間実績レポート

---

## 技術スタック

### フロントエンド
- **React 19** + **Vite 7**
- **react-router-dom** - ルーティング
- **Recharts** - グラフ表示
- **react-helmet-async** - SEO対応
- **PWA対応** - オフライン対応、ホーム画面追加

### バックエンド
- **Vercel Edge Functions** - キャッシュ層（Supabase RPCを中継）
- **Node.js** - バッチ処理スクリプト（GitHub Actionsで実行）

### データベース
- **Supabase (PostgreSQL)**
  - races: レース情報・選手データ
  - predictions: AI予測結果
  - accuracy_summary: 的中率統計
  - RPC関数: クエリロジックをDB側に定義

### インフラ
- **Vercel** - ホスティング・CI/CD
- **GitHub Actions** - 日次バッチ処理

---

## ディレクトリ構成

```
boatrace-ai-predictor/
├── src/                      # フロントエンド
│   ├── App.jsx               # メインアプリ
│   ├── components/           # Reactコンポーネント
│   │   ├── Header.jsx
│   │   ├── AccuracyDashboard.jsx  # 的中率統計
│   │   ├── TodaysPicks.jsx   # おすすめレース
│   │   └── ...
│   ├── pages/                # ページコンポーネント
│   │   ├── Blog.jsx
│   │   ├── BlogPost.jsx
│   │   └── ...
│   ├── services/             # サービス層
│   │   ├── dataService.js    # データ取得抽象化
│   │   ├── supabaseDataService.js  # Supabase連携
│   │   └── ruleMatchService.js     # 会場別ルールエンジン
│   ├── data/
│   │   └── blogPosts.js      # ブログ記事メタデータ
│   └── utils/
│       └── dateUtils.js      # 日付ユーティリティ
│
├── api/                      # Vercel Edge Functions（キャッシュ層）
│   ├── races/
│   │   └── today.js          # GET /api/races/today → RPC中継
│   └── predictions/
│       └── [date].js         # GET /api/predictions/YYYY-MM-DD → RPC中継
│
├── scripts/
│   ├── daily/                # 日次実行スクリプト
│   │   ├── generate-predictions.js  # AI予想生成
│   │   ├── scrape-results.js        # 結果取得
│   │   └── calculate-accuracy.js    # 的中率計算
│   ├── analysis/             # 分析用スクリプト
│   │   ├── collect-venue-stats.js   # 会場別統計
│   │   └── find-profitable-strategies.js
│   ├── maintenance/          # メンテナンス用
│   └── lib/                  # 共通ライブラリ
│       └── supabase.js
│
├── data/
│   └── analysis/             # 分析結果JSON
│
├── public/
│   └── blog/                 # ブログ記事 (Markdown)
│
├── .github/
│   └── workflows/
│       ├── scrape.yml              # データ取得・予想生成（毎時実行）
│       ├── update-google-sheets.yml # Google Sheets更新
│       └── linear-sync.yml         # Linear連携
│
└── docs/                     # ドキュメント
    ├── db-migration/         # DBスキーマ・マイグレーション
    └── setup/                # セットアップガイド
```

---

## データフロー

### 朝の処理

```
1. scrape-to-json.js
   ボートレース公式サイトから当日のレース情報を取得
   ↓
2. generate-predictions.js
   ・選手データ（全国勝率、当地勝率、級別）
   ・モーター性能（2連率）
   ・ボート性能（2連率）
   ・会場別ルール
   → 3モデル分の予想を生成
   ↓
3. Supabase に保存
   - races テーブル
   - predictions テーブル
```

### 夜の処理

```
1. scrape-results.js
   レース結果を取得
   ↓
2. calculate-accuracy.js
   予想と結果を照合し、的中率・回収率を計算
   ↓
3. Supabase に保存
   - predictions テーブル（結果追記）
   - accuracy_summary テーブル
```

---

## AI予想アルゴリズム

### スコア計算式

```javascript
// 基本スコア
baseScore =
  全国勝率 × 12 +
  当地勝率 × 8 +
  モーター2率 × 0.5 +
  ボート2率 × 0.3 +
  級別ボーナス  // A1=15, A2=10, B1=5, B2=0

// 枠番補正
lane1Bonus = 10  // 1号艇ボーナス

// 会場別ルール補正
venueRuleBonus = ruleMatchService.evaluate(prediction, venue)

// 最終スコア
finalScore = baseScore + lane1Bonus + venueRuleBonus
```

### 荒れ度スコア

```javascript
荒れ度 =
  (1号艇の弱さ) +
  (上位選手の差が小さい) +
  (外枠にA級選手がいる) +
  (モーター性能の逆転現象)

→ 0-100で数値化し、low/medium/high に分類
```

---

## 的中率の定義

| 券種 | 的中条件 |
|------|---------|
| **単勝** | AI本命が1着 |
| **複勝** | AI本命が2着以内 |
| **3連複** | AIトップ3が1-2-3着を含む（順不同） |
| **3連単** | AIトップ3が1-2-3着と順序も一致 |

---

## 環境変数

### Vercel (本番)

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

### ローカル開発 (.env.local)

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

---

## ローカル開発

```bash
# リポジトリをクローン
git clone https://github.com/rhapsody0919/boatrace-ai-predictor.git
cd boatrace-ai-predictor

# 依存関係をインストール
npm install

# 環境変数を設定
cp .env.example .env.local
# .env.local を編集

# 開発サーバーを起動
npm run dev
```

ブラウザで http://localhost:5173 を開きます。

---

## デプロイ

### 自動デプロイ

- `master` ブランチへのpushで自動的にVercelにデプロイ
- `develop` ブランチはプレビュー環境にデプロイ

### 手動デプロイ

```bash
npm run build
# Vercel CLIまたはダッシュボードからデプロイ
```

---

## 実績（参考）

> 実績は日々変動します。最新の数値はサイトの「的中率」ページでご確認ください。

- 単勝的中率: 約30-35%
- 複勝的中率: 約50-55%
- 3連複的中率: 約8-12%
- 3連単的中率: 約2-4%

---

## 注意事項

- 本サイトはAIによる予想を提供するものであり、的中を保証するものではありません
- 投資は自己責任で行ってください
- ギャンブル依存症にご注意ください

---

## ライセンス

MIT License

---

## 関連リンク

- [公式サイト](https://www.boat-ai.jp/)
- [ブログ](https://www.boat-ai.jp/blog)
- [GitHub](https://github.com/rhapsody0919/boatrace-ai-predictor)
