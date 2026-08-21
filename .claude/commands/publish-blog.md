# ブログ記事公開パイプライン

新規ブログ記事（`public/blog/{slug}.md`）の公開前品質チェックからnote/X下書き生成までを1コマンドで実行します。CLAUDE.mdの「新機能リリース時のブログ記事ルール」「ブログ記事の公開前品質チェック」の実務手順です。

過去に以下の抜け漏れが実際に起きているため、各ステップは省略せず全て実行してください:
- sitemap登録漏れ（`/winning-technique`が長期未インデックス）
- note/X下書き14記事が未投稿で滞留
- featured記事に旧モデル廃止済み機能への言及が残ったまま公開

## 引数
- `$ARGUMENTS`: 記事slug（例: `new-feature-analysis`）。`public/blog/{slug}.md` が存在すること

## 実行手順

### 1. 対象記事の特定

```bash
cat public/blog/$ARGUMENTS.md
grep -n "$ARGUMENTS" src/data/blogPosts.js
```

- `blogPosts.js` に該当エントリがあるか、`featured: true` かを確認する

### 2. 公開前品質チェック（6項目、パス/フェイルを明示）

CLAUDE.mdの基準に従い、以下を実際に検証する。チェックリストで済ませず、フェイルがあれば必ず修正してから次に進む。

1. **数値・データ整合性**: 本文中の数値と表・図解の数値が一致するか、期待値計算式等を再計算する。他記事で言及済みの数値（控除率25%等）と矛盾しないか横断確認する
2. **現行仕様との整合性**: 言及する機能・UI要素・モデル名が現在も実在するか
   ```bash
   grep -rn "3モデル\|本命モデル\|穴モデル" public/blog/$ARGUMENTS.md src/data/blogPosts.js
   ```
   廃止済み用語が残っていないか確認する（過去実例: unified化前の3モデル切替言及）
3. **検索意図の網羅性**: 対象キーワードに対して読者の疑問に答えられているか
4. **用語・表記ルール遵守**:
   ```bash
   grep -n "競艇" public/blog/$ARGUMENTS.md
   ```
   ヒットしたら`.claude/rules/code-style.md`に従い「ボートレース」に置換する
5. **多言語間の一貫性**: `en`/`zh-TW`/`ko`版がある場合、見出し数・主張・数値がja版と一致するか
6. **構造要件**: 文字数（2,000〜3,500字目安）・画像1枚以上・FAQセクション有無
   ```bash
   wc -m public/blog/$ARGUMENTS.md
   grep -n "## よくある質問\|!\[" public/blog/$ARGUMENTS.md
   ```

### 3. note.com下書き生成

```bash
python3 convert_to_note_markdown.py public/blog/$ARGUMENTS.md
mv public/blog/${ARGUMENTS}_note.md note-articles/$ARGUMENTS.md
```

### 4. Xツイート下書き生成

```bash
node scripts/generate-tweet-draft.js $ARGUMENTS
```

`note-articles/tweet-drafts.md` に追記される。

### 5. featured記事の場合: 英語版作成

`blogPosts.js`で`featured: true`なら、同一PRまたは近接PRで英語版を作成する:
- `public/blog/$ARGUMENTS-en.md`
- `src/data/blogPostsEn.js` にエントリ追加

対象言語は英語のみ（zh-TW/koは需要確認前のため対象外）。

### 6. sitemap反映確認

ブログ記事自体は`scripts/generate-sitemap.js`の`getBlogPosts()`が`public/blog/`を自動スキャンするため追加登録は不要。ただし本記事に伴い新しい静的ページ・ルートを追加した場合は:

```bash
npm run verify:sitemap
```

### 7. 完了報告（省略不可）

チャット本文に必ず含める:
- 品質チェック6項目の結果（パス/フェイル、フェイルへの対応）
- note下書きのファイルパス: `note-articles/$ARGUMENTS.md`
- tweet-drafts.md内の該当セクション（日付見出し）
- リマインド文言: 「noteエディタに貼り付けて公開 → 対応ツイートをXに投稿してください」
- featured記事の場合は英語版の有無
