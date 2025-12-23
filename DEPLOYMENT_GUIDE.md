# BoatAI デプロイ手順ガイド

このファイルは、BoatAIを本番環境（Vercel）にデプロイする手順をまとめたものです。

---

## 前提条件

- Node.js と npm がインストールされていること
- Gitがインストールされていること
- GitHubリポジトリへのpush権限があること
- Vercelアカウントがあり、リポジトリと連携されていること

---

## デプロイ手順（通常フロー）

### 1. ローカルでビルドテスト

まず、変更がビルドエラーを起こさないか確認します。

```bash
npm run build
```

**確認ポイント:**
- ✅ `✓ built in X.XXs` が表示される
- ❌ エラーが出た場合は、エラー内容を確認して修正

---

### 2. 変更をステージング

すべての変更をgitに追加します。

```bash
git add -A
```

または、特定のファイルのみ追加する場合:

```bash
git add src/components/Example.jsx
git add public/blog/example.md
```

**確認:**

```bash
git status
```

ステージングされたファイルが表示されます。

---

### 3. コミットメッセージを作成

わかりやすいコミットメッセージを書きます。

```bash
git commit -m "feat: ブログ記事を追加"
```

**コミットメッセージの書き方例:**

- `feat: 新機能追加` - 新機能
- `fix: バグ修正` - バグ修正
- `docs: ドキュメント更新` - READMEなど
- `style: スタイル変更` - CSSなど
- `refactor: リファクタリング` - コード整理
- `perf: パフォーマンス改善`
- `test: テスト追加`

**詳細なコミットメッセージ（HEREDOC）:**

```bash
git commit -m "$(cat <<'EOF'
feat: ブログ記事3本を追加

## 追加記事
- 荒れるレースの見分け方
- 展示航走の見方
- 競艇場別攻略ガイド

## 効果
- SEO強化
- コンテンツ量増加

🤖 Generated with Claude Code (https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### 4. GitHubにプッシュ

```bash
git push
```

**エラーが出た場合:**

#### ケース1: リモートに新しい変更がある

```bash
! [rejected] master -> master (fetch first)
```

**解決法:**

```bash
git pull --rebase
git push
```

#### ケース2: コンフリクトが発生

```bash
git status  # コンフリクトファイルを確認
# ファイルを手動で編集してコンフリクトを解消
git add <ファイル名>
git rebase --continue
git push
```

---

### 5. Vercelで自動デプロイ

GitHubにpushすると、**Vercelが自動的にデプロイを開始**します。

**デプロイ状況の確認:**

1. Vercelダッシュボード（https://vercel.com）にアクセス
2. プロジェクト「boatrace-ai-predictor」を選択
3. 「Deployments」タブで進捗を確認

**デプロイ完了の目安:**
- 通常 1-3分で完了
- 成功すると「Ready」と表示される

---

### 6. デプロイ後の確認

本番環境で正しく動作しているか確認します。

```
https://boat-ai.jp/
```

**確認項目:**

- [ ] トップページが表示される
- [ ] ブログ記事が表示される
- [ ] 新しく追加した機能が動作する
- [ ] レスポンシブデザインが正しい（スマホ確認）
- [ ] コンソールエラーがない（F12で確認）

---

## トラブルシューティング

### ビルドエラーが出る

#### peer dependency エラー

```
npm error ERESOLVE could not resolve
```

**解決法:**

`.npmrc`ファイルが存在するか確認:

```bash
cat .npmrc
```

内容が `legacy-peer-deps=true` であることを確認。

なければ作成:

```bash
echo "legacy-peer-deps=true" > .npmrc
git add .npmrc
git commit -m "fix: Add .npmrc for peer dependency resolution"
git push
```

---

#### import エラー

```
Failed to resolve import "xxxxx"
```

**解決法:**

依存パッケージをインストール:

```bash
npm install
npm run build
```

---

### Vercelデプロイエラー

#### ケース1: ビルドコマンドエラー

Vercelの「Deployments」→「失敗したデプロイ」→「View Build Logs」でエラー内容を確認。

ローカルで同じエラーを再現:

```bash
npm run build
```

エラーを修正後、再度push。

---

#### ケース2: 環境変数エラー

Vercelダッシュボード → Settings → Environment Variables で環境変数を確認。

必要な環境変数:
- `VITE_GA_MEASUREMENT_ID` (Google Analytics)

---

### SPA直接URL遷移エラー

`/blog` などに直接アクセスすると404エラーが出る場合。

**解決法:**

`vercel.json`のリライトルールを確認:

```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/$1"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

2番目のcatch-allルールが必須。

---

## よくある作業パターン

### パターン1: ブログ記事を追加

1. `src/data/blogPosts.js` にメタデータ追加
2. `public/blog/記事ID.md` にマークダウンファイル作成
3. ビルドテスト

```bash
npm run build
```

4. コミット&プッシュ

```bash
git add src/data/blogPosts.js public/blog/記事ID.md
git commit -m "feat: ブログ記事「タイトル」を追加"
git push
```

---

### パターン2: コンポーネント修正

1. `src/components/XXX.jsx` を編集
2. ビルドテスト

```bash
npm run build
```

3. コミット&プッシュ

```bash
git add src/components/XXX.jsx
git commit -m "fix: XXXコンポーネントのバグ修正"
git push
```

---

### パターン3: CSS変更

1. `src/pages/XXX.css` または `src/components/XXX.css` を編集
2. ビルドテスト

```bash
npm run build
```

3. コミット&プッシュ

```bash
git add src/pages/XXX.css
git commit -m "style: XXXページのスタイル調整"
git push
```

---

### パターン4: 設定ファイル変更

`vercel.json`, `package.json`, `.npmrc` など

1. ファイルを編集
2. ビルドテスト（package.jsonの場合は `npm install` も実行）

```bash
npm install  # package.jsonを変更した場合のみ
npm run build
```

3. コミット&プッシュ

```bash
git add vercel.json
git commit -m "fix: Vercel設定を修正"
git push
```

---

## Google Search Console インデックス登録

新しいページを追加したら、Google Search Consoleでインデックス登録をリクエストします。

### 手順

1. https://search.google.com/search-console にアクセス
2. 「URL検査」を選択
3. 新しいページのURLを入力（例: `https://boat-ai.jp/blog/記事ID`）
4. 「インデックス登録をリクエスト」をクリック
5. 数日後にインデックス登録完了

---

## チェックリスト

デプロイ前に必ず確認:

- [ ] `npm run build` が成功する
- [ ] `git status` で変更内容を確認
- [ ] コミットメッセージが適切
- [ ] 不要なファイル（`check-motor.js`など）をコミットしていない

デプロイ後に確認:

- [ ] Vercelデプロイが成功（「Ready」表示）
- [ ] 本番環境で動作確認
- [ ] 新機能・修正が反映されている
- [ ] コンソールエラーがない

---

## 緊急ロールバック手順

デプロイ後に問題が発生した場合、以前のバージョンに戻します。

### 方法1: Vercelダッシュボードから

1. Vercelダッシュボード → Deployments
2. 正常に動作していたデプロイメントを選択
3. 「⋯」メニュー → 「Promote to Production」

### 方法2: Gitで巻き戻し

```bash
# 直前のコミットに戻す
git reset --hard HEAD~1
git push --force

# 特定のコミットに戻す
git log  # コミットIDを確認
git reset --hard <コミットID>
git push --force
```

**⚠️ 注意:** `git push --force` は慎重に使用してください。

---

## サポート

問題が解決しない場合:

1. エラーメッセージをコピー
2. Claudeに相談
3. Vercelサポート（https://vercel.com/support）

---

## まとめ

**基本フロー:**

```bash
# 1. ビルドテスト
npm run build

# 2. ステージング
git add -A

# 3. コミット
git commit -m "メッセージ"

# 4. プッシュ
git push

# 5. Vercelで自動デプロイ（1-3分）

# 6. 確認
# https://boat-ai.jp/
```

この手順に従えば、安全にデプロイできます！
