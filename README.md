# BoatAI

AIを活用したボートレース予想サービスです。選手の過去データ、モーター性能、当地実績などを分析し、レースの予想を提供します。

🔗 **公式サイト**: https://boat-ai.jp/ (DNS反映待ち)

## 機能

- **AI予想**: 選手データ、モーター性能、実績を分析した予想を提供
- **リアルタイムデータ**: 公式サイトから最新のレース情報を自動取得
- **的中率統計**:
  - 単勝、複勝、3連複、3連単の的中率を表示
  - 回収率の推定値を算出
  - 日別・月別の統計
- **レース結果確認**: レース終了後、予想と結果を比較

## 技術スタック

- **フロントエンド**: React + Vite
- **スタイリング**: CSS（カスタム）
- **データ取得**: Node.js + Cheerio（スクレイピング）
- **デプロイ**: GitHub Pages
- **自動化**: GitHub Actions（1時間ごとの自動データ更新）

## セットアップ

### 必要な環境

- Node.js 18以上
- npm または yarn

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/rhapsody0919/boatrace-ai-predictor.git
cd boatrace-ai-predictor

# 依存関係をインストール
npm install
```

### 環境変数の設定

```bash
# .envファイルを作成
cp .env.example .env

# .envファイルを編集してGoogle Analytics IDを設定
# VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:5173/boatrace-ai-predictor/ を開きます。

### Google Analyticsの設定

1. [Google Analytics](https://analytics.google.com/)でアカウントを作成
2. GA4プロパティを作成
3. 測定ID（G-XXXXXXXXXXの形式）を取得
4. Vercelの環境変数に設定:
   - Environment Variable名: `VITE_GA_MEASUREMENT_ID`
   - Value: 取得した測定ID
5. デプロイ後、Google Analyticsでデータが確認できます

## プロジェクト構成

```
boatrace-ai-predictor/
├── src/
│   ├── components/
│   │   ├── AccuracyDashboard.jsx  # 的中率統計ダッシュボード
│   │   └── AccuracyDashboard.css
│   ├── App.jsx                     # メインアプリケーション
│   ├── App.css
│   └── main.jsx
├── scripts/
│   ├── scrape-to-json.js          # レースデータ取得スクリプト
│   ├── scrape-results.js          # レース結果取得スクリプト
│   ├── generate-predictions.js    # AI予想生成スクリプト
│   └── calculate-accuracy.js      # 的中率計算スクリプト
├── data/
│   ├── races.json                 # 当日のレースデータ
│   └── predictions/               # 予想データと結果
│       ├── YYYY-MM-DD.json       # 日別予想データ
│       └── summary.json          # 統計サマリー
├── public/
│   └── data/                     # ビルド時にコピーされるデータ
├── .github/
│   └── workflows/
│       ├── scrape.yml           # 自動データ取得ワークフロー
│       └── deploy.yml           # デプロイワークフロー
└── ISSUES.md                    # 課題リスト

```

## スクリプト

### レースデータ取得

```bash
# 本日のレースデータを取得
node scripts/scrape-to-json.js

# 特定の日付のレース結果を取得
node scripts/scrape-results.js --date=2025-12-08
```

### AI予想生成

```bash
# 本日のレースのAI予想を生成
node scripts/generate-predictions.js
```

### 的中率計算

```bash
# 全予想データの的中率を計算
node scripts/calculate-accuracy.js
```

## デプロイ

### 手動デプロイ

```bash
# ビルド
npm run build

# GitHub Pagesにデプロイ
npm run deploy
```

### 自動デプロイ

- masterブランチへのpushで自動的にGitHub Pagesにデプロイされます
- GitHub Actionsが1時間ごとにレースデータを自動更新します

## データの仕組み

1. **レースデータ取得** (scrape-to-json.js)
   - 公式サイトから当日のレース情報をスクレイピング
   - 選手データ、モーター性能、オッズなどを取得
   - `data/races.json`に保存

2. **AI予想生成** (generate-predictions.js)
   - レースデータを基にAI予想を生成
   - 選手の全国勝率、当地勝率、モーター2率、ボート2率から総合スコアを算出
   - `data/predictions/YYYY-MM-DD.json`に保存

3. **レース結果取得** (scrape-results.js)
   - レース終了後、結果を取得
   - 予想データに結果を追記

4. **的中率計算** (calculate-accuracy.js)
   - 全予想データから的中率を計算
   - 単勝、複勝、3連複、3連単の統計を算出
   - `data/predictions/summary.json`に保存

## 的中率の定義

- **単勝的中**: AI予想の本命（1位予想）が1着になった
- **複勝的中**: AI予想の本命が2着以内に入った
- **3連複的中**: AI予想のトップ3が実際の1-2-3着を全て含んでいた（順序不問）
- **3連単的中**: AI予想のトップ3が実際の1-2-3着と順序も完全一致した

## 注意事項

- 本サイトはAIによる予想を提供するものであり、的中を保証するものではありません
- ボートレースの公式サイトからデータをスクレイピングしています。利用規約に従い、適切な間隔でアクセスしています
- 投資は自己責任で行ってください

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## 課題・改善点

プロジェクトの現在の課題と改善点については [ISSUES.md](./ISSUES.md) を参照してください。

## Linear統合

このプロジェクトはLinearとGitHubを統合して、タスク管理を自動化しています。

### Claude Codeでのタスク管理（推奨）

Claude Codeで壁打ちしながらタスクを整理し、実装中にLinearタスクを自動更新できます。

**セットアップ:**
```bash
# Linear APIキーを設定
export LINEAR_API_KEY="your-api-key"
```

**使用方法:**
```bash
# タスクを作成
npm run linear:create "予測機能の実装" "AI予測ロジックを追加"

# タスクを更新
npm run linear:update BOAT-123 "進行中" "実装を開始"

# コメントを追加
npm run linear:comment BOAT-123 "進捗: 50%完了"

# タスク一覧を表示
npm run linear:list
```

詳細は [Claude Code統合ガイド](./docs/linear-claude-code-integration.md) を参照してください。

### GitHub統合

1. **LinearでGitHub統合を有効化**
   - Linearアプリ → Settings → Integrations → GitHub
   - GitHubアカウントを接続し、リポジトリを選択

2. **コミットメッセージでタスクを参照**
   ```bash
   git commit -m "feat: 機能追加

   Fixes BOAT-123"
   ```

詳細なセットアップ方法は [Linear統合ガイド](./docs/linear-quick-start.md) を参照してください。

## 貢献

Issue や Pull Request を歓迎します。

---

© 2025 ボートレースAI予想
