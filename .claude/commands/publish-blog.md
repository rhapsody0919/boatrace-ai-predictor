---
description: ブログ記事の公開前品質チェック一括実行（note/X展開はsns-hubパイプラインが別途担当）
argument-hint: "<記事slug>（例: new-feature-analysis）"
---

# ブログ記事公開パイプライン

ブログ記事（`public/blog/{slug}.md`）の公開前品質チェックを1コマンドで実行します。`.claude/rules/content-ops.md` の「新機能リリース時のブログ記事ルール」「ブログ記事の公開前品質チェック」の実務手順で、下の2（7観点）は `content-qa` が読む正本です。note/Xチャネルへの展開はsns-hubパイプラインが別途担うため、このコマンドの対象外。各ステップは省略せず全て実行してください。

## 引数
- `$ARGUMENTS`: 記事slug（例: `new-feature-analysis`）。`public/blog/{slug}.md` が存在すること

## 実行手順

### 1. 対象記事の特定

```bash
cat public/blog/$ARGUMENTS.md
cat src/data/blog-posts/$ARGUMENTS.json
```

- `src/data/blog-posts/$ARGUMENTS.json` があるか、`featured: true` かを確認する（形は `node scripts/maintenance/verify-blog-post-files.js`）

### 2. 公開前品質チェック（7項目、パス/フェイルを明示）

`.claude/rules/content-ops.md` の基準に従い、以下を実際に検証する。チェックリストで済ませず、フェイルがあれば必ず修正してから次に進む。

1. **数値・データ整合性**: 本文中の数値と表・図解の数値が一致するか、期待値計算式等を再計算する。他記事で言及済みの数値（控除率25%等）と矛盾しないか横断確認する
2. **現行仕様との整合性**: 言及する機能・UI要素・モデル名が現在も実在するか
   ```bash
   node scripts/maintenance/check-deprecated-terms.js
   ```
   出力のうち、この記事のファイルの行に廃止済み用語（`docs/reference/deprecated-terms.json`）が無いか確認する
3. **検索意図の網羅性**: 対象キーワードに対して読者の疑問に答えられているか
4. **用語・表記ルール遵守**:
   ```bash
   grep -n "競艇" public/blog/$ARGUMENTS.md
   ```
   ヒットしたら`.claude/rules/code-style.md`に従い「ボートレース」に置換する
5. **多言語間の一貫性**: `en`/`zh-TW`/`ko`版がある場合、見出し数・主張・数値がja版と一致するか
6. **構造要件**: 文字数（2,000〜3,500字目安。既存の長文記事の改稿で超える場合は、理由を明示する）・画像1枚以上・FAQセクション有無。**データ・数値を扱う記事は、比較対象が3件以上ある場合や複数の指標を並べる場合、文章だけで羅列せず表や図解で構造化する**
   ```bash
   wc -m public/blog/$ARGUMENTS.md
   grep -n "## よくある質問\|!\[" public/blog/$ARGUMENTS.md
   ```
7. **実装との照合**: 記事に書いた指標の定義・集計の期間・名称・確かめる先のタブ名を、今のコード（`src/`・`api/`・`scripts/`）と画面に1つずつ照らす。過去の時点の値・実例は「当時の値」と明記されているかを見る（2026-10-13 追加。#1511 の記事が4つのレビューを通ったのに、定義・期間・因子・タブ名が実装と食い違っていたため）

### 2.5 4つのレビュー（段階0 F の条件）

次の4つを通し、結果を PR コメントに書く。どれかで不合格・P0・P1 が出たら直して、そのレビューを回し直す。

1. `content-qa`（上の7観点）で不合格が0
2. `wording-editor` で P0・P1 が0
3. ファンのレビュー（`boatrace-fan-reviewer` か `discussion-panel`）で P0・P1 が0
4. `seo-marketer` で P0・P1 が0

4つとも通れば、オーケストレーターがユーザーの承認なしでマージしてよい（`.claude/skills/orchestrate/SKILL.md` 4節の段階0 F）。事業・法務・ブランドの表記、「競艇」の例外、誇大・的中率・回収率の表現、原稿の主張を変える改稿はユーザーに回す。

### 3. featured記事の場合: 英語版作成

`src/data/blog-posts/$ARGUMENTS.json`が`featured: true`なら、同一PRまたは近接PRで英語版を作成する:
- `public/blog/$ARGUMENTS-en.md`
- `src/data/blog-posts/en/$ARGUMENTS.json`（英語版のメタデータ。1記事1ファイル）

対象言語は英語のみ（zh-TW/koは需要確認前のため対象外）。

### 4. sitemap反映確認

ブログ記事自体は`scripts/generate-sitemap.js`の`getBlogPosts()`が`public/blog/`を自動スキャンするため追加登録は不要。ただし本記事に伴い新しい静的ページ・ルートを追加した場合は:

```bash
npm run verify:sitemap
```

### 5. 完了報告（省略不可）

チャット本文に必ず含める:
- 品質チェック7項目の結果（パス/フェイル、フェイルへの対応）
- 4つのレビューの結果（P0・P1 の件数と対応）
- featured記事の場合は英語版の有無
