# 記事の中身だけの PR の契約（hq の実行役向け）

記事を作って PR を出す側（hq の実行役）と、PR を機械で判定する関門の間の約束。
関門は `scripts/content/check-content-pr.js`（判定の本体は `scripts/lib/contentPrGate.js`、設定は `scripts/content/content-pr-gate.json`）。

**位置づけ**: 今は必須チェック（ブランチ保護の必須の CI）ではなく、判定の道具。必須にするのは④のレーンで行う。

```bash
node scripts/content/check-content-pr.js [--base origin/master]
```

`git diff --raw -z --no-renames <base>...HEAD` の差分（変更後のファイルの型 mode つき）・HEAD の中身・base と HEAD のファイル一覧から判定し、結果の JSON を標準出力に出す。

| 終了コード | 意味 |
|---|---|
| 0 | errors が0 |
| 1 | errors が1件以上 |
| 2 | 判定できない（git の失敗、HEAD にあるはずのファイルを読めない等） |

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
- `judgementWordsFound`: 変えた行・値で見つかった判断が要る句（正規表現は当たった文字列。メタ情報の「競艇」は `競艇`）
- `p1Recorded`: fan と seo-marketer の P1 の件数（関門は通す。記録のため）

## PR に入れてよいもの

これ以外の変更が1つでもあれば error。

| パス | 中身 |
|---|---|
| `public/blog/<name>.md` | 記事の本文（1階層。翻訳の `<id>-en.md`・`-ko.md`・`-zh-tw.md` を含む） |
| `src/data/blog-posts/<id>.json` | 日本語版のメタデータ |
| `src/data/blog-posts/{en,ko,zh-TW}/<id>.json` | 翻訳版のメタデータ |
| `public/images/blog/<name>.jpg` / `.jpeg` | 画像。JPEG だけ（寸法はビルドの時に JPEG のヘッダーから作るため）。拡張子は小文字 |
| `docs/content-manifests/<id>.json` | manifest。PR にちょうど1つ |

- 追加（A）と変更（M）だけ。**削除は許さない**（削除は別の道、通常の PR で行う）。種類の変更（T）も error
- ファイルの型は通常のファイル（mode `100644`）だけ。symlink（`120000`）・実行ビット（`100755`）・gitlink（`160000`）は error
- サブディレクトリ・大文字違い・`.` や `..` を含むパスは error
- 図の JSON（`public/blog-charts/`）はまだ入れられない（図の部品が master に入ってから足す）
- 1つの PR に1記事。変えた .md・JSON はすべて manifest の `id` の記事（日本語版と翻訳版）

## manifest

`docs/content-manifests/<id>.json`。PR に必ず1つ（新規は追加、改稿は変更）。JSON のオブジェクトであること。

```json
{
  "schema": "content-pr-manifest/v1",
  "id": "<記事の slug>",
  "kind": "new",
  "ticket": "BOA-123",
  "paths": ["public/blog/<id>.md", "src/data/blog-posts/<id>.json", "public/images/blog/<id>-ja.jpg"],
  "files": { "public/blog/<id>.md": "<sha256>", "src/data/blog-posts/<id>.json": "<sha256>", "public/images/blog/<id>-ja.jpg": "<sha256>" },
  "content_sha256": "<sha256>",
  "content_at": "2026-10-20T00:00:00Z",
  "judgement_words": [],
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
| `id` | 記事の slug | manifest のファイル名（拡張子なし）と一致。変えた記事の id もすべてこれ |
| `kind` | `new`（新規）か `revision`（改稿） | `new` なら日本語版 JSON の追加がある。`revision` なら日本語版 JSON の追加が無く、base に `src/data/blog-posts/<id>.json` がある（実在する記事の改稿） |
| `ticket` | 起票の番号（Linear の `BOA-123` か hq の台帳の番号） | 空でない文字列 |
| `paths` | PR で変えたパス（manifest 自身を除く） | 空でない（manifest だけの PR は error）。差分のパスと集合として完全に一致。重複なし。先頭の `-`（削除）は error |
| `files` | `paths` の各パス → HEAD の中身の sha256（16進小文字） | キーが `paths` と一致し、値が HEAD の中身と一致 |
| `content_sha256` | 中身全体の指紋（下の計算） | `files` からの計算と一致 |
| `content_at` | 中身ができた時刻 | ISO 8601 で、末尾が `Z` か `±hh:mm`。実在する日時（`2026-02-30`・`T24:00` は error）。小数秒は3桁まで |
| `judgement_words` | 判断が要る語の一覧。PR の中では常に空 | 空の配列（空でなければ error） |
| `reviews` | 4つの役のレビュー（下） | 下の表 |
| `author.model` / `author.lane` | 作り手の型番・実行役の名前 | 空でない |
| `created_at` | manifest を作った時刻 | `content_at` と同じ形 |

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
- `at` が `content_at` と同じ形で、`content_at` 以後、`created_at` 以前。`model` が空でない
- 同じモデルの自己レビューは禁じない

**reviews と時刻は自己申告**。関門は形と整合（役・agent の名前・指紋・件数・時刻の順）だけを見て、実際に審査が行われたことは確かめない。審査の独立性は運用で担保する。

中身を直したら `files`・`content_sha256` が変わるので、4つのレビューをやり直して `reviewed_sha256` をそろえる。

### content_sha256 の計算

1. `files` の各値は、コミットした（HEAD の）ファイルのバイト列そのものの sha256（16進小文字）。作業ツリーのファイルではなく、`git show HEAD:<path>` で取り出した中身で計算する
2. `files` のキー（パス）を昇順（文字コード順。パスは ASCII）に並べる
3. 各パスについて `<path>\t<sha256>\n`（タブ区切り、末尾に改行）の行を作り、そのままつなぐ
4. つないだ文字列を UTF-8 にして sha256 を取り、16進小文字で書く

```bash
git show HEAD:public/blog/<id>.md | shasum -a 256   # files の値
```

```js
import { execFileSync } from "node:child_process";
import { computeContentSha256, sha256Hex } from "./scripts/lib/contentPrGate.js";
const blob = (p) => execFileSync("git", ["show", `HEAD:${p}`]);
const files = Object.fromEntries(paths.map((p) => [p, sha256Hex(blob(p))]));
computeContentSha256(files);
```

## 本文の関門

追加・変更したファイルに当てる。

| 関門 | 対象 | 通る条件 |
|---|---|---|
| 生の HTML | .md | Markdown（GFM。記事の描画と同じ）として読み、`html` のノードが0件。例外は下の「図のタグ」だけ |
| 「競艇」 | .md | 本文に0件。例外は設定の `kyoteiExceptions`（`public/blog/venue-visit-guide-ko.md` の今ある1行。行の中身の完全一致） |
| 「競艇」 | JSON | `metaTitle`・`metaDescription` 以外のすべての文字列値（`title`・`description`・`tags`・`category` 等）に0件。`metaTitle`・`metaDescription` の「競艇」は、変えた値にあれば判断が要るとして error（下の「判断が要る語」） |
| 判断が要る句 | .md の変えた行・足した行、JSON の変えた値 | 0件（下の「判断が要る語」） |
| slug | 足した日本語版 JSON | `id` が `^[a-z0-9]+(-[a-z0-9]+)*$`、末尾が `-en`・`-ko`・`-zh-tw` でない、ファイル名と一致、base に同じ id の JSON も .md も無い |
| .md と JSON の対応 | .md・JSON | 足した日本語版 .md には同じ id の日本語版 JSON（base か HEAD）がある。逆も同じ。翻訳の .md は `<id>-en|-ko|-zh-tw.md` の形で `<id>` の日本語版 JSON がある。翻訳の JSON は id がファイル名と一致し、日本語版 JSON がある |
| 画像 | .md・JSON が参照する `/images/blog/...` | HEAD に実在し、JPEG のヘッダーから幅と高さが読める。足した画像も差し替えた画像も、この PR で変えた .md か JSON のどれかが参照している（別の記事の画像だけを差し替える PR は error） |
| featured | 日本語版 JSON | 新規は `featured: false` で `featuredRank` を置かない。改稿は `featured`・`featuredRank` を base から変えない |
| 内部リンク | .md（日本語版と翻訳版） | `/` で始まるリンクが1本以上。画像（`![..](/..)`）とプロトコル相対（`//`・`/\`）は数えない。参照リンク（`[x][r]` と `[r]: /..`）は数える |

### 生の HTML の数え方

- フェンスのコードブロック・4字下げのコードブロック・インラインコードの中は `code`・`inlineCode` なので数えない
- 自動リンク `<https://…>` は `link` なので数えない
- HTML のコメント `<!-- -->` は `html` なので数える
- フェンスに見えても CommonMark でフェンスにならないもの（タブの字下げ、情報文字列に `` ` `` を含む等）は、その後の HTML を数える

### 図のタグ（生の HTML の唯一の例外）

次をすべて満たす行だけを許す。形の正本は `src/utils/blogChartTag.js` の `parseBlogChartLine`。

```markdown

<ryujin-chart src="/blog-charts/<name>.json" rows="3"></ryujin-chart>

```

- 前後が空行の1行で、行がタグだけ（mdast では html ノードだけの段落、またはブロックの html ノードで、その1行全体）。1行目や、末尾の改行が無い最後の行は、前や後の行が無いことを空行と同じに扱う
- 属性は `src`（`^/blog-charts/[a-z0-9-]+\.json$`）→ `rows`（1〜12 の整数）の順で、この2つだけ。二重引用符
- 閉じタグ `></ryujin-chart>` が必須（`/>` は不可）
- `src` の JSON（`public/blog-charts/<name>.json`）が HEAD か base（master）に実在する。図の JSON はまだ PR に入れられないので、今は master に実在するものだけが通る
- コードの中の `<ryujin-chart …>` は数えない（上と同じ）

### 内部リンクの免除

今 master にある内部リンクの無い記事（設定の `internalLinkGrandfathered`、89本。画像のリンクしか無い記事を含む）の改稿だけ免除する。新規には効かない。内部リンクを足したら一覧から外す（外し忘れは `verify-content-pr-gate.js` が落とす）。

## 判断が要る語

実行役は、判断が要る句がある記事は PR にせず、オーナーの判断へ回す（2026-10-20 オーケストレーター決定）。PR に来た時点で道を外れているので、関門は error にする。何を判断の対象にするかはユーザーの判断 (a)（2026-10-20）。

**語の一覧の正本は `scripts/content/content-pr-gate.json`**。hq の検査はこのファイルを読み、写さない。

### 見る範囲: 変えた行・足した行だけ

| ファイル | 見る範囲 |
|---|---|
| 足したファイル | 全行（JSON は全部の文字列値） |
| 変えた .md | base（分岐元）と HEAD を行で比べ、HEAD で新しく現れた行だけ。並べ替えただけの行は見ない |
| 変えた JSON | base と値が変わった文字列値だけ（キーの道筋で比べる。配列は base の同じ配列に無い要素の文字列） |

触っていない行・値に「回収率150%」等があっても、改稿の PR は落ちない。

### 句と正規表現

誤解を生む句だけを見る。「保証」「必ず」「絶対」「利益」「的中率」「回収率」の単語だけは、もう判断の対象にしない。

| 設定 | 照合 | 初期値 |
|---|---|---|
| `judgementPhrases` | 部分一致 | 必ず当たる・必ず勝てる・必ず儲か・絶対に当たる・絶対に勝てる・絶対儲か・的中保証・的中を保証・儲かる・儲けられる・稼げる・利益が出る・利益を保証・負けない・損しない・元が取れる |
| `judgementPatterns` | 正規表現（フラグ `gu`） | 回収率が100%以上の数字の主張（`回収率` の後6字以内に3桁以上の数と `%`。半角・全角とも）。100% 未満の的中率・回収率はデータの記述として通す |
| `judgementAllowedLines` | 部分一致。含む行は句の判定から外す | 保証するものではありません・保証されません・保証はありません・保証しません・保証はしません |

`judgementAllowedLines` は免責の決まり文の逃げ道。句の一覧は単語より狭いので、ふつうは効かない。「的中保証はしません」のような否定文を通すためのもの。

### 「競艇」

- 本文（.md）と、JSON の `metaTitle`・`metaDescription` 以外の値の「競艇」は、上の「本文の関門」の `[kyotei]` の error（差分の行に限らず全部）
- JSON の `metaTitle`・`metaDescription` の「競艇」は、変えた値にあれば判断が要るとして `[judgement]` の error（メタ情報の例外を使うかはオーナーの判断）。句の一覧ではなく「競艇」の関門の側で見る

### manifest

- `judgement_words` が空でなければ error（今までどおり）

## 検査

関門そのものの検査は `npm run verify:content-pr-gate`（`scripts/maintenance/verify-content-pr-gate.js`、tier ci）。
