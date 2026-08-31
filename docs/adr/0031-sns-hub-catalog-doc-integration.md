# ADR 0031: フォーマットカタログのドキュメント統合方式

## ステータス
採用

## 背景

`docs/design/sns-hub-admin-ux-improvements/spec.md`要件3「フォーマットカタログ」タブで、`sns_template_variants`テーブルの型一覧に加え、`docs/operation/sns-video-producer-prompt.md`・`docs/operation/x-operations-playbook.md`・`docs/reference/sns-brand-guideline.md`に文章で書かれているペルソナ選定ロジック・デザイン方針を管理画面から確認できるようにする必要がある。

boatAIは`vercel.json`でSPA rewriteのみを行う純粋なクライアントサイドSPAで、SSR・サーバー側ファイルシステムアクセスの仕組みが無い（`docs/reference/seo-architecture-constraints.md`と同じアーキテクチャ制約）。`docs/`配下のMarkdownファイルは`public/`配下のブログ記事(`public/blog/*.md`)と異なりビルド成果物に含まれず、実行時にfetchできない。

## 決定

**該当ドキュメントの関連セクションを、`src/data/`配下の小さな静的データファイル（例: `snsFormatCatalogContent.js`）に人手でキュレーションした要約として書き出し、フロントエンドから直接importして表示する。** 各エントリには元ドキュメントへのGitHub上のリンク（`https://github.com/rhapsody0919/boatrace-ai-predictor/blob/master/{path}`）を添え、「全文はリンク先を参照」という位置づけにする。

ドキュメント本体が更新されてもこの要約データは自動追従しない。spec.mdの「やらないこと」で自動同期パイプラインを明示的にスコープ外としている（2026-08-31、天才エンジニア・天才SNSマーケター議論）ため、この静的キュレーション方式と整合する。要約が古くなった場合は、ドキュメント更新時に手動でこのデータファイルも更新する運用とする。

## 却下した選択肢

- **Edge Functionでリポジトリ内のMarkdownファイルを都度読み込んで返す**: Vercel Edge Runtimeは`fs`によるファイルシステムアクセスを標準サポートしておらず、本プロジェクトの既存`api/admin/sns-hub/*`は全て`runtime: "edge"`で統一されている。Node.js runtimeへの切り替えが必要になり、既存パターンから逸脱する上、デプロイ時のファイル同梱設定も追加で必要になる
- **Markdownを実行時に取得し正規表現・パーサーで構造化データに変換する**: `sns-video-producer-prompt.md`等は自由形式の長文で、見出し構造が今後の編集で変わりうる。パースロジックがドキュメントの表記ゆれに対して壊れやすく、保守コストが高い（天才エンジニア指摘）
- **ビルド時にMarkdownファイルを`public/`にコピーしてfetchする**: 実現可能だが、コピー対象を毎回`vite.config.js`等に追記する運用が発生し、上記の「静的データファイルに直接要約を書く」方式と比べてインフラが1段複雑になる割に得られる利点（全文表示）がこのタブの目的（型・ペルソナ・デザイン方針の概要把握）に対して過剰

## 影響

- 実装コストが最小（新規APIエンドポイント・ビルド設定変更が不要、フロントエンドのみで完結）
- ドキュメント更新時にカタログ側の手動更新を忘れるリスクがある。運用上の注意点として`.claude/CLAUDE.md`等への追記は本ADRの範囲外だが、`docs/design/sns-hub-admin-ux-improvements/plan.md`に留意点として記録する
- 将来的にドキュメント量が増えて手動同期が現実的でなくなった場合は、本ADRを置き換えて動的取得方式を再検討する
