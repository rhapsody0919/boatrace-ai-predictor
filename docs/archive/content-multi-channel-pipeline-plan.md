# システム設計

対象: `spec.md`・`screens.md`で確定した内容の実装設計。技術判断の詳細根拠は該当ADRを参照。

## データ設計

### 1. `sns_drafts`テーブル拡張（ADR 0032）

新規列3つを追加する（マイグレーション: `docs/db-migration/042_content_drafts_columns.sql`）。

| 列名 | 型 | 用途 |
|---|---|---|
| `title` | TEXT | blog/note下書きのタイトル |
| `embed_video_url` | TEXT | note本文に埋め込むYouTube動画URL（画像の代替） |
| `pr_url` | TEXT | blog下書きに対応するDraft PRのURL |

既存列の転用（新規マイグレーション不要）:
- `platform`: `'blog'` / `'note'` を新たに使う（ENUM制約なし、既存設計のまま）
- `caption_text`: ブログ/note本文
- `hashtags`: noteタグ
- `cover_image_path`: 画像パス（embed_video_urlと排他、どちらか一方は必須）
- `format`: ネタカテゴリ（`new-feature`/`venue-characteristic`/`data-insight`/`daily-result`）
- `content_group_id`: 同一ネタから派生したblog/note/X/TikTok/YouTube行を紐付ける

### 2. ネタ使用履歴（ADR 0033）

`data/analysis/content-topics/venue-characteristic-history.json`・`data/analysis/content-topics/data-insight-history.json`をRoutineが読み書きする。新規機能ネタ・成績ネタは履歴管理不要（前者は`missingContentIndex`が既に対象を特定、後者は「今日」が一意なため）。

### 3. `sns_strategy_insights`テーブル（変更不要）

`platform`列が元々ENUM制約なしで将来拡張を想定済み（039番マイグレーションのコメント参照）。`'blog'`/`'note'`をそのまま使えるため、スキーマ変更は不要。`/growth-pdca`等の調査スキル側から、このテーブルへの書き込み（`source: 'own-metrics'`, `platform: 'blog'`等）を追加する対応のみで済む。

## スクリプト・Routine構成

### ネタ供給モジュール（新規: `scripts/lib/contentTopics/`）

共通契約に従う4モジュール（+将来の拡張枠）:

```
scripts/lib/contentTopics/
├── index.js                    # レジストリ。全モジュールを配列で保持し、Routineはこれを回すだけ
├── newFeatureSource.js         # missingContentIndex検知結果をラップ
├── venueCharacteristicSource.js
├── dataInsightSource.js
└── dailyResultSource.js
```

各モジュールは`{ id, getCandidates(history) }`を export する。`index.js`は全モジュールを配列で持ち、Routineは`for (const source of topicSources) { const candidates = await source.getCandidates(...) }`のように回すだけでよい（新規5系統目は配列に1行足すだけ）。

### チャネルレンダラー（新規: `scripts/lib/contentChannels/`）

ネタ1件から、対象チャネル分のコンテンツを生成する。

```
scripts/lib/contentChannels/
├── blogRenderer.js      # public/blog/{slug}.mdの内容＋src/data/blogPosts.jsエントリを生成
├── noteRenderer.js      # blogRendererの出力を受け取り、convert_to_note_markdown.py相当の変換＋画像/動画リンク付与
├── youtubeRenderer.js   # サムネイル生成（Remotion still）＋タイトル・説明文・タグ生成
└── channelMatrix.js     # ネタ種別→対象チャネルのマッピング定義（spec.md FR2）
```

### 品質自己レビュー（新規: `scripts/lib/contentQualityReview.js`）

spec.md FR4の多層防御を実装する。生成パスとは別関数として切り出し、既存の`.claude/CLAUDE.md`ブログ品質チェック6項目を基準にPass/Failを判定する。数値検証は元データとの再計算突合を行う（既存の分析スクリプト関数を再利用して計算し、下書き内の数値と比較）。

### Routine構成

**既存Routine（変更）**: `sns-hub-content-generation`
- `generate-daily`/`generate-evergreen`ペイロードの`platforms`にYouTubeを追加できるよう対応（`api/admin/sns-hub/generate.js`の`VALID_PLATFORMS`に`"youtube"`を追加するのみ、既存の拡張コメント通り）
- YouTube生成時はサムネイル生成ステップを追加

**新規Routine**: `content-multi-channel-pipeline`（cron、毎晩実行）
1. `scripts/lib/contentTopics/`の全モジュールを回し、その晩のネタ候補を集める
2. データ知見/成績ネタは実データ取得を試行。失敗時はそのネタを見送る（FR4）
3. `channelMatrix.js`で対象チャネルを決定
4. 各チャネルレンダラーを実行
5. `contentQualityReview.js`で自己採点、Failなら修正して再採点
6. Pass後、`sns_drafts`にblog/note行をINSERT（`content_group_id`共有）。ブログはDraft PRも同時に作成（既存のTask 30検証と同じ手順、`gh pr create --draft`）、PR URLを`pr_url`列に保存
7. 頻度上限（1晩1本、非機能要件）を超えたら生成を打ち切る

## 管理画面・API連携

### 新規APIエンドポイント（`api/admin/sns-hub/`配下、既存middleware.jsのBasic認証を自動継承）

- `merge-blog-pr.js`: `draftId`を受け取り、対象行の`pr_url`からPR番号を特定し、GitHub API（ADR 0034のFine-grained PAT使用）で`gh pr merge`相当の操作を行う。成功後、`sns_drafts.status`を`posted`に更新
- `publish-youtube.js`: `draftId`を受け取り、Supabase Storageから動画・サムネイルを取得し、YouTube Data API v3（ADR 0035のOAuthリフレッシュトークン使用）で`videos.insert`→`thumbnails.set`を実行。成功後、`status`を`posted`に更新し、発行されたYouTube URLを`source_data`に記録

### `src/services/snsHubService.js`への追加関数

- `mergeBlogPr(draftId)`: 上記エンドポイントを呼ぶ
- `publishYoutube(draftId)`: 上記エンドポイントを呼ぶ
- 既存の`getDrafts(status)`はプラットフォームで絞り込んでいないため変更不要（`screens.md`のタブ側でプラットフォームフィルタを追加）

### `session-start-check.js`への追加（FR4b）

`checkContentQualityAudit()`を追加。直近7日以内に公開されたblog/note下書き（`sns_drafts`から`status='posted'`かつ`platform in ('blog','note')`）から1〜2件をランダム抽出し提示する。

## 未確定（実装時に確定）

- `contentTopics/dataInsightSource.js`が参照する「分析ツール15タブ」の具体的なタブID一覧とデータ取得関数の対応表
- 履歴JSONファイルの正確なスキーマ（ADR 0033に方向性のみ記載）
- 品質チェックの数値再計算ロジックの実装（既存分析関数のうちどれを再利用できるかの棚卸し）
