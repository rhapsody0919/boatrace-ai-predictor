# 環境セットアップ確認

新しい開発者向けに、環境設定の状況を対話形式で確認し、不足があればガイドを提供します。

## 確認手順

### 1. 依存関係の確認

```bash
npm ls --depth=0 2>/dev/null | head -5
```

`node_modules` が存在しない場合:
- `npm install` を実行するよう案内

### 2. 環境変数ファイルの確認

```bash
ls -la .env.local 2>/dev/null || echo "NOT_FOUND"
```

ファイルが存在しない場合:
- `.env.example` を `.env.local` にコピーするよう案内
- 必須項目（SUPABASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY）の設定を案内

### 3. 必須環境変数のチェック

以下の変数が設定されているか確認:

```bash
node -e "
require('dotenv').config({ path: '.env.local' });
const required = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const optional = ['VITE_GA_MEASUREMENT_ID', 'LINEAR_API_KEY', 'LINEAR_TEAM_ID'];

console.log('=== 必須変数 ===');
required.forEach(v => {
  const val = process.env[v];
  console.log(v + ': ' + (val ? '✓ 設定済み' : '✗ 未設定'));
});

console.log('\n=== オプション変数 ===');
optional.forEach(v => {
  const val = process.env[v];
  console.log(v + ': ' + (val ? '✓ 設定済み' : '- 未設定'));
});
"
```

### 4. Gitの設定確認

```bash
git config user.name && git config user.email
```

### 5. 開発サーバーの起動テスト

必須変数が設定されている場合のみ:

```bash
npm run dev -- --port 5174 &
sleep 3
curl -s http://localhost:5174 | head -5
kill %1 2>/dev/null
```

## 結果サマリー

確認結果を以下の形式でまとめて表示:

```
=== 龍神レーダー 環境セットアップ結果 ===

✓ 依存関係: インストール済み
✓ .env.local: 設定済み
✓ SUPABASE_URL: 設定済み
✓ VITE_SUPABASE_URL: 設定済み
✓ VITE_SUPABASE_ANON_KEY: 設定済み
- LINEAR_API_KEY: 未設定（オプション）

次のステップ:
- npm run dev で開発サーバーを起動
- /daily-report で本日のレポートを確認
```

不足がある場合は、具体的な解決手順を案内してください。
