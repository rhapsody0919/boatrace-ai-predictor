# ドキュメントルール

## 禁止事項
以下はGit履歴で追跡可能なため**記載しない**：
- 最終更新日、変更履歴、問い合わせ先、著者

## ドキュメントの配置場所

| 種類 | 配置場所 | 例 |
|------|----------|-----|
| DBスキーマ・マイグレーション | `docs/db-migration/` | テーブル定義、RPC関数 |
| リファレンス資料 | `docs/reference/` | 設計書、仕様書、分析ガイド |
| 運用ガイド | `docs/operation/` | ルール運用手順 |
| 既知の問題 | `docs/issues/` | バグ調査・対応状況 |
| 提案・検討 | `docs/proposal/` | 新機能提案、比較検討（未採用） |
| 設計・実装資料 | `docs/design/` | 採用され実装中 or 実装済みの設計書 |
| セットアップ | `docs/setup/` | 環境構築手順 |
| 廃案・不要 | `docs/archive/` | 廃案になった提案、古くなった資料 |
| 分析結果 | `data/analysis/` | JSON形式で保存 |
| ブログ記事 | `public/blog/` | Markdown形式 |
| note.com記事 | `note-articles/` | Markdown形式 |

## 新規ドキュメント作成フロー

```
既存ドキュメントを検索
  → 追記で対応できる？ → Yes → 既存に追記
  → No → 上記テーブルから適切なディレクトリを選択
       → kebab-case でファイル名を付ける
       → ルートディレクトリには絶対に置かない
```

## チェックリスト
- [ ] 既存ドキュメントを検索したか？
- [ ] 既存ドキュメントへの追記で対応できないか？
- [ ] 適切なディレクトリに配置したか？
- [ ] **ルートに置いていないか？**

## ファイル命名規則

- **すべてのファイルは `kebab-case`**（例外: `README.md`, `TODO.md`, `AGENTS.md`）
- `AGENTS.md` はルート配置の例外。Codex CLI 等の外部ツールがリポジトリルート直下を規約上前提にするため（`docs/operation/sdd-and-codex-review.md` 参照）
- スクリプト: `analyze-venue-{コード}.js`, `find-{対象}.js`, `verify-{ルール名}.js`
- 分析結果: `venue-{コード}-analysis.json`, `rule-{ルール名}-verification.json`
- 会場分析ディレクトリ: `data/analysis/venue-{コード}/`
