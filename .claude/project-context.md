# BoatAI プロジェクトコンテキスト

このファイルは、Claude Codeがプロジェクトを理解するための重要な情報を記録しています。

## 📋 プロジェクト概要

**BoatAI (boat-ai.jp)** は、AIを活用したボートレース予想サイトです。

### 主な機能
- 全国24場のボートレース予想をリアルタイム提供
- 3つの予想モデル（スタンダード、本命狙い、穴狙い）
- 的中結果の自動集計と精度表示
- SNSシェア機能（X、Facebook、LINE）
- レスポンシブデザイン（スマホ・PC対応）

## 🛠 技術スタック

### フロントエンド
- **React 18.3.1** - UIフレームワーク
- **Vite 6.0.3** - ビルドツール
- **react-share 5.2.2** - SNSシェア機能

### バックエンド・データ
- **Node.js** - スクリプト実行環境
- **JSON** - 予想データの保存形式（`data/predictions/`, `public/data/predictions/`）

### デプロイ
- **GitHub Actions** - 自動デプロイ
- **GitHub Pages** - ホスティング
- プロセス: `git push origin master` → GitHub Actions実行 → 自動デプロイ

## 📁 重要なディレクトリ構造

```
boatrace-ai-predictor/
├── src/
│   ├── components/          # Reactコンポーネント
│   │   ├── SocialShareButtons.jsx  # SNSシェアボタン
│   │   ├── HitRaces.jsx            # 的中レース表示
│   │   └── AccuracyDashboard.jsx   # 精度ダッシュボード
│   ├── utils/
│   │   └── share.js         # シェアテキスト生成ロジック
│   ├── pages/               # ページコンポーネント
│   └── App.jsx              # メインアプリケーション
├── data/predictions/        # 予想データ（開発用）
├── public/
│   ├── data/predictions/    # 予想データ（公開用）
│   └── blog/                # ブログ記事（Markdown）
├── scripts/
│   ├── generate-predictions.js    # 予想生成スクリプト
│   └── calculate-accuracy.js      # 精度計算スクリプト
└── .claude/                 # Claude Code設定・ドキュメント
```

## 🔑 重要なファイル

### フロントエンド
- `src/App.jsx` - メインアプリケーション、タブ切り替え、レース表示
- `src/components/SocialShareButtons.jsx` - SNSシェアボタン（X、Facebook、LINE）
- `src/utils/share.js` - シェアテキスト生成（予想、的中）
- `src/components/HitRaces.jsx` - 的中レース一覧表示

### バックエンド
- `scripts/generate-predictions.js` - AI予想生成
- `scripts/calculate-accuracy.js` - 精度計算

### 設定
- `vite.config.js` - Viteビルド設定
- `package.json` - 依存関係

## 🚀 よく使うコマンド

### 開発
```bash
npm run dev          # 開発サーバー起動（localhost:5173）
npm run build        # プロダクションビルド
npm run preview      # ビルド結果のプレビュー
```

### デプロイ
```bash
git add <files>
git commit -m "message"
git push origin master    # 自動的にGitHub Actionsが実行される
```

### スクリプト
```bash
node scripts/generate-predictions.js    # 予想データ生成
node scripts/calculate-accuracy.js      # 精度計算
```

## 🎨 デザイン・UI規則

### カラーテーマ
- プライマリ: `#0066cc` - ボートレースの水をイメージ
- アクセント: `#ff6b35` - 勝利の赤
- 背景: `#f5f5f5` - クリーンなグレー

### レスポンシブ
- モバイルファースト設計
- ブレークポイント: 768px（タブレット）、1024px（デスクトップ）

## 📝 過去の重要な修正

### 2024-12-24
1. **LINEシェアバグ修正**
   - 問題: スマホでLINEシェア時にメッセージが表示されない
   - 原因: LINE APIが`title`パラメータをサポートしていない
   - 解決: `url`パラメータに`message + '\n' + url`を結合
   - ファイル: `src/components/SocialShareButtons.jsx:47`

2. **的中シェアメッセージ改善**
   - 変更: 「全的中」→「単勝・複勝・3連複・3連単」
   - 理由: 具体的な券種を表示してわかりやすく
   - ファイル: `src/utils/share.js:130, 305`

3. **用語統一**
   - 変更: 「競艇」→「ボートレース」（全ファイル）
   - ルール: `.claude/project-rules.md`に記載

## 🔒 用語・表記ルール

**絶対に守ること:**
- ❌ 「競艇」は使用禁止
- ✅ 「ボートレース」を使用

詳細: `.claude/project-rules.md`

## 🐛 トラブルシューティング

### よくある問題

#### 1. git pushが失敗する
```bash
# リモートの変更を取り込む
git stash
git pull --rebase origin master
git stash pop
git push origin master
```

#### 2. ビルドエラー
```bash
# node_modulesを再インストール
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 💡 トークン節約のヒント

### Claude Codeを使う際
1. **このファイルを参照**: 毎回説明する代わりに「`.claude/project-context.md`を確認して」と指示
2. **具体的な指示**: ファイルパスや行番号を明示する
3. **過去の修正を参照**: 「過去の修正」セクションに記載された情報を活用

### プロンプト例
```
良い例: "src/utils/share.jsのgenerateHitRaceShareText関数を修正して"
悪い例: "シェア機能のコードを修正して"（探索が必要）
```

## 📚 関連ドキュメント

- `.claude/project-rules.md` - プロジェクトルール
- `.claude/linear-integration.md` - Linear統合
- `docs/` - その他ドキュメント
