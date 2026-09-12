# 環境変数確認

現在の環境変数設定状況を一覧表示します。

## 実行コマンド

```bash
node -e "
require('dotenv').config({ path: '.env.local' });

const envVars = [
  { name: 'SUPABASE_URL', required: true, category: 'Supabase' },
  { name: 'VITE_SUPABASE_URL', required: true, category: 'Supabase' },
  { name: 'VITE_SUPABASE_ANON_KEY', required: true, category: 'Supabase' },
  { name: 'SUPABASE_SERVICE_KEY', required: false, category: 'Supabase' },
  { name: 'VITE_GA_MEASUREMENT_ID', required: false, category: 'Analytics' },
  { name: 'LINEAR_API_KEY', required: false, category: 'Linear' },
  { name: 'LINEAR_TEAM_ID', required: false, category: 'Linear' },
  { name: 'SENDGRID_API_KEY', required: false, category: 'Email' },
  { name: 'GOOGLE_SERVICE_ACCOUNT_EMAIL', required: false, category: 'Google Sheets' },
  { name: 'GOOGLE_PRIVATE_KEY', required: false, category: 'Google Sheets' },
  { name: 'GITHUB_MERGE_TOKEN', required: false, category: 'GitHub' },
  { name: 'YOUTUBE_CLIENT_ID', required: false, category: 'YouTube' },
  { name: 'YOUTUBE_CLIENT_SECRET', required: false, category: 'YouTube' },
  { name: 'YOUTUBE_REFRESH_TOKEN', required: false, category: 'YouTube' },
];

let currentCategory = '';
envVars.forEach(({ name, required, category }) => {
  if (category !== currentCategory) {
    console.log('\n=== ' + category + ' ===');
    currentCategory = category;
  }
  const value = process.env[name];
  const status = value
    ? '✓ 設定済み (' + value.substring(0, 20) + '...)'
    : (required ? '✗ 未設定（必須）' : '- 未設定');
  console.log(name + ': ' + status);
});

// 必須変数の未設定チェック
const missing = envVars
  .filter(v => v.required && !process.env[v.name])
  .map(v => v.name);

if (missing.length > 0) {
  console.log('\n⚠️  必須変数が未設定です: ' + missing.join(', '));
  console.log('   .env.local を確認してください');
} else {
  console.log('\n✓ 必須変数はすべて設定済みです');
}
"
```

## 出力例

```
=== Supabase ===
SUPABASE_URL: ✓ 設定済み (https://xxxxx.supab...)
VITE_SUPABASE_URL: ✓ 設定済み (https://xxxxx.supab...)
VITE_SUPABASE_ANON_KEY: ✓ 設定済み (eyJhbGciOiJIUzI1N...)
SUPABASE_SERVICE_KEY: - 未設定

=== Analytics ===
VITE_GA_MEASUREMENT_ID: ✓ 設定済み (G-XXXXXXXXXX...)

=== Linear ===
LINEAR_API_KEY: - 未設定
LINEAR_TEAM_ID: - 未設定

=== Email ===
SENDGRID_API_KEY: - 未設定

=== Google Sheets ===
GOOGLE_SERVICE_ACCOUNT_EMAIL: - 未設定
GOOGLE_PRIVATE_KEY: - 未設定

=== GitHub ===
GITHUB_MERGE_TOKEN: - 未設定

=== YouTube ===
YOUTUBE_CLIENT_ID: - 未設定
YOUTUBE_CLIENT_SECRET: - 未設定
YOUTUBE_REFRESH_TOKEN: - 未設定

✓ 必須変数はすべて設定済みです
```

**注意**: このコマンドはローカル`.env.local`のみを確認する。マーケティング関連の連携（GA4/Google Sheets/YouTube/GitHub自動マージ等）は本番運用時にVercel環境変数側にのみ設定されている可能性があるため、「- 未設定」と表示されても実際に機能していないとは限らない。Vercel側の設定状況は別途Vercelダッシュボード・CLIで確認すること。
