---
description: SDD Step 2 — docs/design/{機能slug}/plan.md（システム設計）を作成する
argument-hint: "<機能slug（kebab-case）>"
---

確定した `docs/design/$1/spec.md` と（UI機能なら）`docs/design/$1/screens.md` から `docs/design/$1/plan.md` を作成する。

含める内容:
- データ設計（Supabase テーブル・カラム追加が必要なら `docs/db-migration/` にマイグレーション案も作成。既存テーブルの `patterns` 配列が2026-03-08以降のデータにしか無い等、既知の制約を踏まえる）
- コンポーネント構成・データフロー（UI機能の場合）/ スクリプト構成・実行タイミング（バッチ・分析機能の場合、`scripts/daily|analysis|maintenance|db/` のどこに置くか）
- 既存サービス層（`src/services/`）・共通ライブラリ（`scripts/lib/`）との連携方法

重要な技術判断（複数案から選ぶもの）は `docs/adr/` にも ADR 形式で出力する（`docs/adr/0000-template.md` をコピーして採番）。技術選定は必ず複数案を比較し、各案の不適合点を明示すること。
