# 龍神レーダー クイックリファレンス

このファイルは、よくあるタスクの手順を記録しています。トークン節約のため、Claude Codeはこのファイルを参照してください。

## 📊 Linear統合（タスク管理）

### 基本コマンド

```bash
# タスクを作成
npm run linear:create "タイトル" "説明"

# タスクを更新
npm run linear:update BOAT-123 "進行中" "コメント"

# コメントを追加
npm run linear:comment BOAT-123 "進捗報告"

# タスク一覧を表示
npm run linear:list

# タスク詳細を表示
npm run linear:get BOAT-123
```

### 実装時の標準フロー

```bash
# 1. タスク作成
npm run linear:create "LINEシェアバグ修正" "スマホでメッセージが表示されない問題を修正"
# → タスクID: BOAT-123

# 2. 進行中に更新
npm run linear:update BOAT-123 "進行中" "実装を開始"

# 3. 実装...

# 4. 完了に更新
npm run linear:update BOAT-123 "完了" "実装完了。テスト済み"

# 5. コミット＆プッシュ（タスクIDを含める）
git commit -m "fix: LINEシェアバグ修正

Fixes BOAT-123

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push origin master
```

## 🚀 デプロイフロー

### 標準デプロイ
```bash
git add <変更したファイル>
git commit -m "commit message

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push origin master
```

**重要:**
- GitHub Actionsが自動的に実行される
- デプロイは約2-3分で完了
- ビルドエラーがないか確認すること

### リモートの変更がある場合
```bash
git stash
git pull --rebase origin master
git stash pop
git push origin master
```

## 📝 コード修正の定番パターン

### 1. SNSシェアテキストの修正

**ファイル:** `src/utils/share.js`

**関数:**
- `generatePredictionShareText()` - 予想シェア用（273-281行目）
- `generateHitRaceShareText()` - 的中シェア用（324-330行目）

**修正例:**
```javascript
// メッセージバリエーションを修正
const messages = [
  `新しいメッセージ1`,
  `新しいメッセージ2`,
  // ...
];
```

### 2. SNSシェアボタンの修正

**ファイル:** `src/components/SocialShareButtons.jsx`

**よくある修正:**
- LINEシェア: `url={lineTitle ? \`${lineTitle}\\n${shareUrl}\` : shareUrl}`
- Xシェア: `title={title}`, `hashtags={hashtags}`
- Facebookシェア: `quote={title}`, `hashtag={\`#${hashtags[0]}\`}`

### 3. UIテキストの修正

**ファイル:** `src/App.jsx`, `src/components/*.jsx`

**注意事項:**
- ❌ 「競艇」は使用禁止 → ✅ 「ボートレース」を使用
- 用語統一を必ず確認

### 4. ブログ記事の修正

**ディレクトリ:** `public/blog/*.md`

**形式:** Markdown
**注意:** メタデータ（タイトル、日付、タグ）を変更した場合は `src/data/blogPosts.js` も更新

## 🔍 コード検索のコツ

### よく検索するパターン

#### SNSシェア関連
```bash
# シェアボタンコンポーネント
grep -r "SocialShareButtons" src/

# シェアテキスト生成
grep -r "generatePredictionShareText\|generateHitRaceShareText" src/

# LINE シェア
grep -r "LineShareButton" src/
```

#### 用語チェック
```bash
# 「競艇」が残っていないか確認（使用禁止）
grep -r "競艇" src/ public/ --exclude-dir=node_modules
```

#### 的中関連
```bash
# 的中レース表示
grep -r "HitRaces" src/

# 券種表示
grep -r "hitTypes" src/
```

## 🎯 よくあるタスク

### タスク1: シェアメッセージの変更

**手順:**
1. `src/utils/share.js` を開く
2. 該当する関数を見つける（`generatePredictionShareText` または `generateHitRaceShareText`）
3. `messages` 配列を修正
4. コミット＆プッシュ

**関連ファイル:**
- `src/utils/share.js` - テキスト生成ロジック
- `src/components/SocialShareButtons.jsx` - ボタンコンポーネント

### タスク2: 用語の統一変更

**手順:**
1. プロジェクト全体で検索・置換
2. 以下のファイルを確認:
   - `src/**/*.jsx`
   - `src/**/*.js`
   - `public/blog/*.md`
   - `*.md` (ドキュメント)
3. コミット＆プッシュ

**チェック項目:**
- ソースコード内の文字列
- コメント
- ドキュメント
- ブログ記事

### タスク3: UIコンポーネントの修正

**手順:**
1. `src/components/` または `src/App.jsx` を特定
2. 該当箇所を修正
3. ローカルで動作確認: `npm run dev`
4. コミット＆プッシュ

**よく修正するコンポーネント:**
- `App.jsx` - メインアプリ、タブ、レース表示
- `HitRaces.jsx` - 的中レース一覧
- `AccuracyDashboard.jsx` - 精度ダッシュボード
- `SocialShareButtons.jsx` - SNSシェアボタン

## 🐛 デバッグ方法

### ローカルで確認
```bash
npm run dev
# ブラウザで http://localhost:5173 を開く
```

### ビルドエラーの確認
```bash
npm run build
# エラーメッセージを確認
```

### よくあるエラー

#### エラー1: モジュールが見つからない
```bash
npm install
```

#### エラー2: ビルドが失敗する
```bash
# キャッシュをクリア
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

## 📊 データ構造

### 予想データ (JSON)
```json
{
  "date": "2025-12-24",
  "venue": "戸田",
  "raceNumber": 1,
  "prediction": {
    "topPick": 1,
    "top3": [1, 2, 3],
    "aiScores": [85.5, 78.2, 72.1]
  },
  "result": [1, 2, 3],
  "hitTypes": [
    { "type": "単勝" },
    { "type": "複勝" },
    { "type": "3連複" },
    { "type": "3連単" }
  ]
}
```

## 💡 効率化のヒント

### Claude Code使用時

**トークン節約:**
1. ファイルパスを明示する（探索を減らす）
2. 関数名・行番号を指定する
3. このファイルを参照する

**良いプロンプト例:**
```
"src/utils/share.js の generateHitRaceShareText 関数（324-330行目）の
メッセージバリエーションを変更して"
```

**悪いプロンプト例:**
```
"シェア機能のメッセージを変更して"
（→ 探索が必要、トークンを消費）
```

### Git コミットメッセージ

**テンプレート:**
```
<type>: <短い説明>

<詳細な説明（必要に応じて）>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**type の例:**
- `feat`: 新機能
- `fix`: バグ修正
- `refactor`: リファクタリング
- `docs`: ドキュメント
- `style`: スタイル変更

## 🔗 関連ファイル

- `.claude/project-context.md` - プロジェクト全体のコンテキスト
- `.claude/project-rules.md` - 遵守すべきルール
