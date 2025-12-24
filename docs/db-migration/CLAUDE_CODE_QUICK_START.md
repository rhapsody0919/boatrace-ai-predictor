# Claude Code用 - クイックスタートプロンプト

## 🚀 このプロンプトをClaude Codeに渡してください

```
以下のタスクを順番に実装してください。

プロジェクト: ボートレースAI予想システムのJSONファイルからPostgreSQLデータベースへの移行

## 実装タスク

### 1. データベーススキーマの作成
ファイル: `scripts/db/schema.sql`
- 8つのテーブルを作成（詳細は `scripts/db/SCHEMA_DETAIL.md` を参照）
- インデックスと外部キー制約を設定
- 初期データ（venues）をINSERT

### 2. DB接続ユーティリティ
ファイル: `scripts/utils/db.js`
- `pg` ライブラリを使用
- 接続プールの実装
- ヘルパー関数: query, transaction, batchInsert

### 3. スキーマ適用スクリプト
ファイル: `scripts/db/migrate.js`
- schema.sql を読み込んで実行

### 4. データ移行スクリプト
ファイル: `scripts/db/migrate-from-json.js`
- 既存のJSONファイルを読み込んでDBに移行
- 進捗表示とエラーハンドリング

### 5-8. 既存スクリプトのDB対応
以下のスクリプトを環境変数 `USE_DATABASE=true` でDB対応に変更（デフォルトはJSONで後方互換性を維持）:
- `scripts/scrape-to-json.js`
- `scripts/generate-predictions.js`
- `scripts/scrape-results.js`
- `scripts/calculate-accuracy.js`

### 9. データ検証スクリプト
ファイル: `scripts/db/validate-migration.js`
- JSONとDBのデータ件数を比較

### 10. 環境変数テンプレート
ファイル: `.env.example`
- DATABASE_URL
- USE_DATABASE

## 詳細仕様
- `docs/db-migration/DB_MIGRATION_PLAN.md` - 移行計画の詳細
- `scripts/db/SCHEMA_DETAIL.md` - スキーマ設計の詳細
- `docs/db-migration/CLAUDE_CODE_PROMPT.md` - 実装の詳細手順

## 依存関係
package.json に `pg` を追加してください。

## 注意事項
- **後方互換性を維持（デフォルトはJSON使用）**
  - 環境変数 `USE_DATABASE=true` でDB使用、デフォルトは `false`
  - DB使用時もJSONファイルへの書き込みを継続（デュアルライト）
- **エラーハンドリングを適切に実装**
  - DB接続エラー時はJSONにフォールバック
- **トランザクション管理を実装**
- **バッチインサートを使用**
- **本番影響を最小化**
  - フォールバック機能を実装
  - 環境変数で即座にJSONモードに戻せる設計
```

---

## 📝 実装後の確認事項

実装が完了したら、以下を確認してください：

1. **スキーマの適用**
   ```bash
   node scripts/db/migrate.js
   ```

2. **データ移行（テスト）**
   ```bash
   node scripts/db/migrate-from-json.js
   ```

3. **データ検証**
   ```bash
   node scripts/db/validate-migration.js
   ```

4. **スクリプトの動作確認**
   ```bash
   USE_DATABASE=true node scripts/scrape-to-json.js
   ```

---

## 🔗 関連ファイル

- `docs/db-migration/DB_MIGRATION_PLAN.md` - 包括的な移行計画
- `docs/db-migration/CLAUDE_CODE_PROMPT.md` - 詳細な実装手順
- `scripts/db/SCHEMA_DETAIL.md` - スキーマ設計の詳細

