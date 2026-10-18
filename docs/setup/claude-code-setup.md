# Claude Code セットアップガイド

## 前提条件

- Node.js 18以上
- npm 9以上
- Git
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone git@github.com:your-org/boatrace-ai-predictor.git
cd boatrace-ai-predictor
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

```bash
cp .env.example .env.local
```

`.env.local` を編集し、以下を設定:

| 変数 | 必須 | 取得場所 |
|------|------|----------|
| `SUPABASE_URL` | Yes | Supabase Dashboard > Settings > API |
| `VITE_SUPABASE_URL` | Yes | 同上 |
| `VITE_SUPABASE_ANON_KEY` | Yes | 同上（anon public key） |
| `VITE_GA_MEASUREMENT_ID` | No | Google Analytics 4 |
| `LINEAR_API_KEY` | No | Linear > Settings > API |

**注意**: `SUPABASE_SERVICE_ROLE_KEY` は管理者のみが設定します。通常の開発では不要です。

### 4. Claude Codeの起動

```bash
claude
```

初回起動時、`.claude/settings.json` の権限設定が適用されます。

### 5. 環境確認

```bash
/check-env
```

環境変数の設定状況を確認できます。

## 利用可能なスキル

| スキル | 説明 | 使用例 |
|--------|------|--------|
| `/collect-stats` | 24会場の基本統計を収集 | `/collect-stats` |
| `/analyze-venue` | 指定会場の詳細分析 | `/analyze-venue 03`（江戸川） |
| `/daily-report` | 本日の予測結果レポート | `/daily-report` |
| `/deploy-preview` | Vercel Previewへデプロイ | `/deploy-preview` |
| `/check-env` | 環境変数の確認 | `/check-env` |

## 開発サーバー

```bash
npm run dev
```

http://localhost:5173 でアクセス可能。

## トラブルシューティング

### Q: `SUPABASE_URL is not defined` エラー

`.env.local` ファイルが存在し、正しく設定されているか確認してください。

```bash
cat .env.local | grep SUPABASE
```

### Q: 権限の承認ダイアログが頻繁に出る

`.claude/settings.json` がリポジトリに含まれているか確認してください。

```bash
git status .claude/settings.json
```

tracked でない場合、最新のmasterからpullしてください。

### Q: Prettierが動作しない

```bash
npm install
```

で依存関係を再インストールしてください。

### Q: Linear連携が動作しない

`docs/setup/linear-setup.md` を参照し、APIキーとTeam IDを設定してください。

## 会場コード一覧

分析スキルで使用する会場コード:

```
01: 桐生    02: 戸田    03: 江戸川  04: 平和島  05: 多摩川  06: 浜名湖
07: 蒲郡    08: 常滑    09: 津      10: 三国    11: びわこ  12: 住之江
13: 尼崎    14: 鳴門    15: 丸亀    16: 児島    17: 宮島    18: 徳山
19: 下関    20: 若松    21: 芦屋    22: 福岡    23: 唐津    24: 大村
```

## 参考リンク

- [CLAUDE.md](./.claude/CLAUDE.md) - プロジェクトルール
- [Linear設定](./linear-setup.md) - Linear連携の詳細
