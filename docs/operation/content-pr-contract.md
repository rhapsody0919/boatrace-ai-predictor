# 記事の中身だけの PR の契約（hq の実行役向け）

記事を作って PR を出す側（hq の実行役）と、PR を機械で判定する関門の間の約束。
関門は `scripts/content/check-content-pr.js`（判定の本体は `scripts/lib/contentPrGate.js`、設定は `scripts/content/content-pr-gate.json`）。

```bash
node scripts/content/check-content-pr.js [--base origin/master]
```

`git diff --name-status --no-renames <base>...HEAD` の差分・HEAD の中身・base のファイル一覧から判定し、結果の JSON を標準出力に出す。

| 終了コード | 意味 |
|---|---|
| 0 | errors が0 |
| 1 | errors が1件以上 |
| 2 | 判定できない（git の失敗等） |

## 結果の JSON

```json
{
  "ok": true,
  "errors": [],
  "judgementWordsFound": [],
  "p1Recorded": { "fan": 0, "seo-marketer": 0 },
  "manifest": "docs/content-manifests/<id>.json"
}
```

- `ok`: errors が0のとき true
- `judgementWordsFound`: 変えたファイルで見つかった判断が要る語
- `p1Recorded`: fan と seo-marketer の P1 の件数（関門は通す。記録のため）

## PR に入れてよいパス

これ以外の変更が1つでもあれば error。

| パス | 中身 |
|---|---|
| `public/blog/<name>.md` | 記事の本文（1階層。翻訳の `<id>-en.md`・`-ko.md`・`-zh-tw.md` を含む） |
| `src/data/blog-posts/<id>.json` | 日本語版のメタデータ |
| `src/data/blog-posts/{en,ko,zh-TW}/<id>.json` | 翻訳版のメタデータ |
| `public/images/blog/<name>.jpg` / `.jpeg` | 画像。JPEG だけ（寸法はビルドの時に JPEG のヘッダーから作るため） |
| `docs/content-manifests/<id>.json` | manifest。PR にちょうど1つ |

図の JSON は対象外（部品が master に入ってから足す）。

## manifest

`docs/content-manifests/<id>.json`。PR に必ず1つ（新規は追加、改稿は変更）。

```json
{
  "schema": "content-pr-manifest/v1",
  "id": "<記事の slug>",
  "kind": "new",
  "ticket": "BOA-123",
  "paths": ["public/blog/<id>.md", "src/data/blog-posts/<id>.json", "-public/images/blog/old.jpg"],
  "files": { "public/blog/<id>.md": "<sha256>", "src/data/blog-posts/<id>.json": "<sha256>" },
  "content_sha256": "<sha256>",
  "content_at": "2026-10-20T00:00:00Z",
  "judgement_words": ["的中率"],
  "reviews": [
    { "role": "content-qa", "agent": "content-qa", "result": "pass", "p0": 0, "p1": 0, "reviewed_sha256": "<content_sha256>", "model": "<型番>", "at": "2026-10-20T01:00:00Z" },
    { "role": "wording-editor", "agent": "wording-editor", "result": "pass", "p0": 0, "p1": 0, "reviewed_sha256": "<content_sha256>", "model": "<型番>", "at": "..." },
    { "role": "fan", "agent": "boatrace-fan-reviewer", "result": "pass", "p0": 0, "p1": 0, "reviewed_sha256": "<content_sha256>", "model": "<型番>", "at": "..." },
    { "role": "seo-marketer", "agent": "seo-marketer", "result": "pass", "p0": 0, "p1": 0, "reviewed_sha256": "<content_sha256>", "model": "<型番>", "at": "..." }
  ],
  "author": { "model": "<作り手の型番>", "lane": "<実行役の名前>" },
  "created_at": "2026-10-20T02:00:00Z"
}
```

| 項目 | 意味 | 関門 |
|---|---|---|
| `schema` | 契約の版 | `content-pr-manifest/v1` と一致 |
| `id` | 記事の slug | manifest のファイル名（拡張子なし）と一致 |
| `kind` | `new`（新規）か `revision`（改稿） | どちらか |
| `ticket` | 起票の番号（Linear の `BOA-123` か hq の台帳の番号） | 空でない文字列 |
| `paths` | PR で変えたパス（manifest 自身を除く）。追加・変更はそのまま、削除は先頭に `-` | 差分のパスと集合として完全に一致。重複なし |
| `files` | `paths` のうち削除以外の各パス → HEAD の中身の sha256（16進小文字） | キーが `paths` の削除以外と一致し、値が HEAD の中身と一致 |
| `content_sha256` | 中身全体の指紋（下の計算） | `files` からの計算と一致 |
| `content_at` | 中身ができた時刻（ISO 8601） | 時刻として読める |
| `judgement_words` | 判断が要る語の一覧。PR の中では常に空 | 空の配列（空でなければ error） |
| `reviews` | 4つの役のレビュー（下） | 下の表 |
| `author.model` / `author.lane` | 作り手の型番・実行役の名前 | 空でない |
| `created_at` | manifest を作った時刻（ISO 8601） | 時刻として読める |

### reviews の関門

- 4つの役（`content-qa`・`wording-editor`・`fan`・`seo-marketer`）がちょうど1行ずつ
- `agent` が、設定の `allowedReviewAgents` でその役に許された名前

| role | 許す agent（初期値） |
|---|---|
| content-qa | `content-qa` |
| wording-editor | `wording-editor` |
| fan | `boatrace-fan-reviewer`、`discussion-panel` |
| seo-marketer | `seo-marketer` |

  hq の観点表でレビューする場合は `hq-review:<名前>` の形の名前を使い、設定の一覧に足す（コードは変えない）。
- 4行の `reviewed_sha256` が `content_sha256` と同じ（レビューした中身と出す中身が同じ）
- `result` が `pass`
- `p0` が4つの役すべてで0。`p1` は content-qa と wording-editor で0。fan と seo-marketer の `p1` は件数を `p1Recorded` に記録するだけで通す
- `at` が `content_at` 以後、`created_at` 以前。`model` が空でない
- 同じモデルの自己レビューは禁じない

中身を直したら `files`・`content_sha256` が変わるので、4つのレビューをやり直して `reviewed_sha256` をそろえる。

### content_sha256 の計算

1. `files` のキー（パス）を昇順（文字コード順。パスは ASCII）に並べる
2. 各パスについて `<path>\t<sha256>\n`（タブ区切り、末尾に改行）の行を作り、そのままつなぐ
3. つないだ文字列を UTF-8 にして sha256 を取り、16進小文字で書く

```js
import { computeContentSha256, sha256Hex } from "./scripts/lib/contentPrGate.js";
const files = { "public/blog/x.md": sha256Hex(readFileSync("public/blog/x.md")) };
computeContentSha256(files);
```

`files` の各値は、コミットした（HEAD の）ファイルのバイト列そのものの sha256。改行の変換等をかける前の中身ではない。

## 本文の関門

追加・変更したファイルだけに当てる。削除には当てない。

| 関門 | 対象 | 通る条件 |
|---|---|---|
| 生の HTML | .md | 本文に `<` の直後が英字・`/`・`!` のものが0件。フェンスのコードブロックとインラインコードの中は数えない |
| 「競艇」 | .md | 本文に0件。例外は設定の `kyoteiExceptions`（`public/blog/venue-visit-guide-ko.md` の今ある1行。行の中身の完全一致） |
| 「競艇」 | JSON | `title`・`description` に0件（`metaTitle`・`metaDescription` は許す） |
| 判断が要る語 | .md・JSON の文字列 | 0件（下の「判断が要る語」） |
| slug | 足した日本語版 JSON | `id` が `^[a-z0-9]+(-[a-z0-9]+)*$`、末尾が `-en`・`-ko`・`-zh-tw` でない、ファイル名と一致、base に同じ id の JSON も .md も無い |
| 画像 | .md・JSON が参照する `/images/blog/...` | HEAD に実在し、JPEG のヘッダーから幅と高さが読める。足した画像は、変えた .md か JSON のどれかが参照している |
| featured | 日本語版 JSON | 新規は `featured: false` で `featuredRank` を置かない。改稿は `featured`・`featuredRank` を base から変えない |
| 内部リンク | .md（日本語版と翻訳版） | `](/` で始まるリンクが1本以上 |

内部リンクの関門は、今 master にある内部リンクの無い記事（設定の `internalLinkGrandfathered`）の改稿だけ免除する。新規には効かない。内部リンクを足したら一覧から外す（外し忘れは `verify-content-pr-gate.js` が落とす）。

## 判断が要る語

実行役は、判断が要る語がある記事は PR にせず、オーナーの判断へ回す（2026-10-20 オーケストレーター決定）。PR に来た時点で道を外れているので、関門は error にする。

- 変えた .md と JSON の文字列に、設定の `judgementWords`（初期値: 的中率・回収率・必ず・絶対・儲か・稼げ・勝てる・保証・利益・メタの「競艇」）が1つでもあれば error
- `judgement_words` が空でなければ error

## 検査

関門そのものの検査は `npm run verify:content-pr-gate`（`scripts/maintenance/verify-content-pr-gate.js`、tier ci）。
