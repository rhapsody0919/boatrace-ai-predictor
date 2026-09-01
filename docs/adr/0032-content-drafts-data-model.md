# ADR 0032: ブログ/note下書きのデータモデル

## ステータス
採用

## 背景
`content-multi-channel-pipeline`（ネタ駆動マルチチャネルパイプライン）で、ブログ・note向けの下書き（タイトル・本文・タグ・画像orYouTubeリンク）を保存する場所が必要になった。既存の`sns_drafts`テーブル（X/TikTok動画下書き用、035番マイグレーション）は`content_group_id`（同一アイデアから派生した言語/PF違いをまとめるID）・`platform`（ENUM制約なし、コメントで将来拡張を想定済み）を既に持つ。

## 決定
`sns_drafts`テーブルを拡張し、`platform`に`'blog'`/`'note'`を追加する形で使う。新規テーブルは作らない。

既存列の意味を以下のように転用する:
- `caption_text` → ブログ/note本文（TEXT型のため長さ制約なし、2,000〜3,500字でも問題なく格納できる）
- `hashtags` → note投稿タグ
- `cover_image_path` → 画像を使う場合のパス
- `format` → ネタのカテゴリ（`new-feature`/`venue-characteristic`/`data-insight`/`daily-result`）

新規列を2つ追加する:
- `title TEXT` — 既存スキーマにタイトル専用列が無いため新設（ブログ・noteとも必須）
- `embed_video_url TEXT` — 画像の代わりにYouTube動画を埋め込む場合のURL（新機能ネタでnote本文に使う）
- `pr_url TEXT` — ブログ下書きに対応するDraft PRのURL（承認時のマージ処理で参照する）

`video_storage_path`・`video_tier`はblog/note行では常にNULL（既存の設計通り、プラットフォームごとに使わない列がNULLになるのは`sns_drafts`の元々の設計方針と一致）。

## 却下した選択肢
**新規テーブル`content_drafts`を作る案**: ブログ/note専用の列（title等）を素直に持てるが、承認/却下フロー・reason codes・content_group_idによる紐付け・管理画面のカード表示ロジックを丸ごと複製することになる。動画とテキストで下書きの「形」は違うが、ライフサイクル（pending_review→approved→posted、revision/redo、insight参照）は完全に同じであり、テーブルを分けるとこのライフサイクル管理ロジックの二重実装が発生する。

## 影響
- マイグレーションは列追加のみ（`ALTER TABLE sns_drafts ADD COLUMN ...`）で済み、既存データへの影響なし
- 管理画面の`DraftCard`コンポーネントは、`draft.platform`が`blog`/`note`かどうかで表示を分岐する必要がある（`screens.md`の`TextDraftPreview`参照）
- 将来YouTube以外の新チャネル（例: Instagram）を追加する際も、同じ拡張パターンで対応できる
