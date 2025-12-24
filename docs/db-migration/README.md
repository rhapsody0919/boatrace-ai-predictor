# DB移行関連ドキュメント

このディレクトリには、JSONファイルからPostgreSQLデータベース（Supabase）への移行に関するすべてのドキュメントが含まれています。

## 📚 ドキュメント一覧

### 🚀 クイックスタート

1. **[CLAUDE_CODE_QUICK_START.md](./CLAUDE_CODE_QUICK_START.md)**
   - Claude Codeに渡す簡潔なプロンプト
   - 実装タスクの概要
   - **最初に読むべきドキュメント**

### 📋 詳細仕様

2. **[CLAUDE_CODE_PROMPT.md](./CLAUDE_CODE_PROMPT.md)**
   - Claude Code用の詳細な実装プロンプト
   - 各タスクの詳細仕様
   - 実装のヒントと注意事項

3. **[DB_MIGRATION_PLAN.md](./DB_MIGRATION_PLAN.md)**
   - 包括的な移行計画書
   - 8フェーズの移行手順
   - 技術的な詳細と注意事項

4. **[SCHEMA_DETAIL.md](../scripts/db/SCHEMA_DETAIL.md)**
   - データベーススキーマ設計の詳細
   - 各テーブルのカラム定義
   - インデックスと制約
   - よく使うクエリパターン

5. **[SCHEMA_EXTENSIBILITY.md](./SCHEMA_EXTENSIBILITY.md)** ⭐ **重要**
   - スキーマの拡張性評価
   - 将来の拡張（新しいデータ、新しいモデル）への対応方法
   - 改善されたスキーマ設計

### 🔍 比較・検討資料

6. **[DB_PLATFORM_COMPARISON.md](./DB_PLATFORM_COMPARISON.md)**
   - Firebase vs Supabase の比較
   - 無料プランの制限と使用量見積もり
   - このプロジェクトへの適合性

7. **[TECH_STACK_COMPATIBILITY.md](./TECH_STACK_COMPATIBILITY.md)**
   - Supabase移行後の技術スタック互換性
   - Vercel、GitHub Actions、Reactなどの使用可否
   - 追加で必要な実装

### 🛡️ 移行戦略

8. **[MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md)** ⭐ **重要**
   - 本番影響を最小化する移行戦略
   - 移行タイミングの推奨
   - 段階的移行（デュアルライト）の実装
   - ロールバック計画
   - リスク管理

---

## 🎯 使い方

### Claude Codeに実装を依頼する場合

1. **最初に読む:** [CLAUDE_CODE_QUICK_START.md](./CLAUDE_CODE_QUICK_START.md)
   - このファイルの内容をClaude Codeにそのまま渡してください

2. **詳細が必要な場合:** [CLAUDE_CODE_PROMPT.md](./CLAUDE_CODE_PROMPT.md)
   - より詳細な実装手順が必要な場合に参照

3. **スキーマ設計を確認:** [SCHEMA_DETAIL.md](../scripts/db/SCHEMA_DETAIL.md)
   - データベースのテーブル設計を確認

### 移行計画を理解する場合

1. **[DB_MIGRATION_PLAN.md](./DB_MIGRATION_PLAN.md)** を読む
   - 全体の移行計画を把握

2. **[MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md)** ⭐ **必読**
   - 本番影響を最小化する移行戦略
   - 移行タイミングの推奨
   - 段階的移行の実装方法

3. **[TECH_STACK_COMPATIBILITY.md](./TECH_STACK_COMPATIBILITY.md)** を読む
   - 既存の技術スタックとの互換性を確認

4. **[DB_PLATFORM_COMPARISON.md](./DB_PLATFORM_COMPARISON.md)** を読む
   - なぜSupabaseを選んだのかを理解

---

## 📂 ファイル構成

```
docs/db-migration/
├── README.md                          # このファイル
├── CLAUDE_CODE_QUICK_START.md        # クイックスタートプロンプト
├── CLAUDE_CODE_PROMPT.md             # 詳細実装プロンプト
├── DB_MIGRATION_PLAN.md              # 移行計画書
├── SCHEMA_EXTENSIBILITY.md           # スキーマ拡張性設計 ⭐
├── MIGRATION_STRATEGY.md             # 移行戦略（本番影響最小化）⭐
├── DB_PLATFORM_COMPARISON.md         # プラットフォーム比較
└── TECH_STACK_COMPATIBILITY.md       # 技術スタック互換性

scripts/db/
└── SCHEMA_DETAIL.md                  # スキーマ設計詳細
```

---

## 🔗 関連ファイル

- `scripts/db/schema.sql` - データベーススキーマ（実装後）
- `scripts/utils/db.js` - DB接続ユーティリティ（実装後）
- `scripts/db/migrate.js` - スキーマ適用スクリプト（実装後）
- `scripts/db/migrate-from-json.js` - データ移行スクリプト（実装後）

---

## 📝 実装の流れ

1. **Supabaseプロジェクト作成**
   - https://supabase.com でアカウント作成
   - プロジェクト作成
   - 接続情報を取得

2. **Claude Codeに実装を依頼**
   - `CLAUDE_CODE_QUICK_START.md` の内容を渡す

3. **スキーマ適用**
   ```bash
   node scripts/db/migrate.js
   ```

4. **データ移行**
   ```bash
   node scripts/db/migrate-from-json.js
   ```

5. **動作確認**
   ```bash
   USE_DATABASE=true node scripts/scrape-to-json.js
   ```

---

## ❓ よくある質問

### Q: どのファイルをClaude Codeに渡せばいいですか？
A: [CLAUDE_CODE_QUICK_START.md](./CLAUDE_CODE_QUICK_START.md) をそのまま渡してください。

### Q: 既存の技術スタックは使えますか？
A: はい。Vercel、GitHub Actions、Reactなどはそのまま使用可能です。詳細は [TECH_STACK_COMPATIBILITY.md](./TECH_STACK_COMPATIBILITY.md) を参照してください。

### Q: なぜSupabaseを選んだのですか？
A: PostgreSQLベースで、無料プランで十分運用可能だからです。詳細は [DB_PLATFORM_COMPARISON.md](./DB_PLATFORM_COMPARISON.md) を参照してください。

### Q: 本番環境への影響はありますか？
A: 段階的移行により影響を最小化します。詳細は [MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md) を参照してください。推奨移行タイミングは平日の深夜2:00-4:00 JSTです。

### Q: 移行中にサービスが停止しますか？
A: いいえ。デュアルライト（JSONとDB併用）により、ゼロダウンタイムで移行できます。問題発生時は即座にJSONモードに戻せます。

---

## 📚 参考リンク

- Supabase公式: https://supabase.com
- Supabaseドキュメント: https://supabase.com/docs
- PostgreSQL公式: https://www.postgresql.org/
- node-postgres: https://node-postgres.com/

---

## 📋 レビュー情報

このドキュメントセットは2025年12月23日にレビューされ、システム仕様を考慮した移行計画と本番影響を最小化する戦略が追加されました。

**レビューサマリー:** [REVIEW_SUMMARY.md](./REVIEW_SUMMARY.md)

