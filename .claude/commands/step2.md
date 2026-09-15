---
description: SDD Step 2 — docs/design/{機能slug}/plan.md（システム設計）を作成する
argument-hint: "<機能slug（kebab-case）>"
---

引数 `$ARGUMENTS` は機能slug（kebab-case）。以降 `{slug}` と表記する。

確定した `docs/design/{slug}/spec.md` と（UI機能なら）`docs/design/{slug}/screens.md` から `docs/design/{slug}/plan.md` を作成する。

含める内容:
- データ設計（Supabase テーブル・カラム追加が必要なら `docs/db-migration/` にマイグレーション案も作成。既存テーブルの `patterns` 配列が2026-03-08以降のデータにしか無い等、既知の制約を踏まえる）。**新規テーブル、または既存テーブルとの新規リレーション（外部キー）を1つでも導入する場合、マイグレーション案作成後に`node scripts/maintenance/generate-er-diagram.js {slug}`を実行し、出力されたmermaid `erDiagram`ブロックをそのままデータ設計節に貼り付ける**（手で描いて記憶に頼るのではなく、実際のDDLから機械的に逆算する。`npm run verify:er-diagram`で全設計ドキュメントを横断検証できる。詳細は`.claude/CLAUDE.md`の図解ルール参照）
- コンポーネント構成・データフロー（UI機能の場合）/ スクリプト構成・実行タイミング（バッチ・分析機能の場合、`scripts/daily|analysis|maintenance|db/` のどこに置くか）
- 既存サービス層（`src/services/`）・共通ライブラリ（`scripts/lib/`）との連携方法

重要な技術判断（複数案から選ぶもの）は `docs/adr/` にも ADR 形式で出力する（`docs/adr/0000-template.md` をコピーして採番）。技術選定は必ず複数案を比較し、各案の不適合点を明示すること。
