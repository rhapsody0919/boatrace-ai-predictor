# ブログの図の契約（schemaVersion 1）

ブログ記事（`public/blog/*.md`）に図を出すための、記事の作り手（hq の SEO 担当）と部品（`src/components/blog/BlogChart.jsx`）の間の契約。作り手は JSON を1つ書き、記事にタグを1行置くだけで図が出る。見た目とファン役の条件は部品が強制し、JSON からは変えられない。条件を破る JSON は CI（`npm run verify:blog-charts`）で落ちる。

仕様の元: オーナー yes（2026-10-20、hq `drafts/blog-charts-20261020.md`）と、汎用化の追加（2026-10-20 15時、オーケストレーター経由）。審査: system-architect（2026-10-20、P1 4件を反映済み）。

## 1. 記事への書き方

```markdown
本文の段落。

<ryujin-chart src="/blog-charts/fukuoka-water-wind-guide-course-win.json" rows="6"></ryujin-chart>

次の段落。
```

| 規則 | 理由 |
|---|---|
| タグ名・属性名は小文字 | HTML の解析器が小文字にするため。大文字だと部品に届かない |
| `></ryujin-chart>` で閉じる。`/>` で閉じない | `/>` は無視され、後ろの本文を全部子要素として飲み込む |
| 1行に書き、前後を空行にする。リスト・引用・表の中に置かない | 段落の途中に置くと、部品が文の中に埋まる（1行のタグは段落 `<p>` に包まれるが、部品の側でその段落を外す） |
| `src` は `/blog-charts/` の下の実在する `.json` | `/blog/` の下は middleware の対象で、1段（`/blog/x.json`）だと AI ボットにだけ別のファイルへ書き換えられる |
| `rows` は JSON の `rows` の数と同じ整数 | 読み込む前に図の高さを確保する（CLS 対策）。違うと CI が落とす |
| 同じ数字を本文の1行と Markdown の表にも書く | 検索・AI の根拠は本文。図は見やすさのため。`description` の数字が本文にあるかを CI が見る |

翻訳記事（`-en.md` 等）でも同じ JSON を指してよい。その場合は 5 節のとおり、その言語の文字を全項目にそろえる。

## 2. JSON の置き場所と名前

- `public/blog-charts/{記事id}-{図id}.json`。`id` はファイル名の拡張子を除いた部分、`article` は記事 id と同じにする
- 記事と同じ時点で固定する。図だけ日々更新しない。データを直したら記事の本文と表も同じ PR で直す
- どの記事からも参照されない JSON は CI が落とす

## 3. 形（全種類共通）

例は CI を通る実物（`docs/design/blog-charts/example-venue-course-win.json`）。ここでは1つの view と1行だけ抜き出す。

```jsonc
{
  "schemaVersion": 1,
  "id": "example-venue-course-win",
  "article": "example",
  "kind": "hbar",                                  // 図の種類（判別子）。4 節
  "title": "進入コース別の1着率",
  "description": "福岡は1コースの1着率が59.2%で、全国（55.5%）より高い。",
  "axes": {
    "category": { "label": "進入コース" },          // 行の軸
    "value": { "label": "1着率", "unit": "%", "decimals": 1 }  // 値の軸。最小は0、最大は部品が全 view から決める
  },
  "rows": [ { "key": "1", "label": "1コース" } ],               // 枠番（艇番）を行にするときだけ "boat": 1〜6 で艇の色の印を付ける
  "switch": { "label": "会場", "default": "22" },   // 切り替えが無ければ null と書く（キーは省かない）
  "views": [
    {
      "key": "22",
      "label": "福岡",
      "badge": {
        "scope": "福岡",
        "period": { "from": "2025-10-20", "to": "2026-10-19" },
        "sample": { "value": 2363, "unit": "レース" }
      },
      "series": [
        { "key": "win1", "label": "1着率", "values": [59.2], "counts": [1400] }
      ]
    }
  ],
  "source": {
    "name": "ボートレース公式の競走成績（龍神レーダー集計）",
    "dataVersion": "2026-10-20",
    "resultPath": "data/analysis/venue-course-win-rate/venue-course-win-rate.json"
  },
  "note": "進入コース別（枠番ではない）。中止・不成立のレースを除く。"
}
```

### 項目（必は必須、任は任意。書いていないキーは誤り）

| 場所 | キー | 必/任 | 中身 |
|---|---|---|---|
| 最上位 | `schemaVersion` | 必 | `1` |
| | `id` | 必 | ファイル名と同じ |
| | `article` | 必 | 記事 id（`src/data/blog-posts` にある） |
| | `kind` | 必 | 4 節の種類 |
| | `title` | 必 | 1〜40字。図の見出し |
| | `description` | 必 | 1〜120字。既定の view の答えを1文で（「〜を示す図」でなく「〜は〜」）。数字は既定の view か key `all` の値だけ |
| | `axes` | 必 | 4 節の種類ごとの軸 |
| | `rows` | 必 | 行。`key`（文字列、重複なし）・`label`・`boat`（任、1〜6。行が枠番（艇番）で key が "1"〜"6" のときだけ。進入コースの行には付けない。枠番と誤読されるため） |
| | `switch` | 必 | `null` か `{ label, default }`。`default` は views の key のどれか |
| | `views` | 必 | `switch` が `null` なら1つ、あれば2つ以上。key は文字列で重複なし |
| | `source` | 必 | `name`・`dataVersion`（YYYY-MM-DD）必、`resultPath` 任 |
| | `note` | 任 | 注記。1〜80字 |
| view | `key`・`label` | 必 | 切り替えの選択肢 |
| | `description` | 任 | この view を選んだときに最上位の `description` の代わりに出す答え。数字はこの view か `all` の値だけ |
| | `badge` | 必 | `scope`（範囲）・`period`（`from` ≦ `to` ≦ `source.dataVersion`）・`sample`（`value` 正の整数・`unit`） |
| | `series` | 必 | 種類ごとの上限以内 |
| series | `key`・`label` | 必 | |
| | `values` | 必 | 数（文字列・null は不可）。`rows` と同じ数・同じ順。小数は `axes.value.decimals` 桁まで |
| | `counts` | `unit` が `%` なら必 | 分子の件数（整数）。`rows` と同じ数 |
| | `totals` | 任 | 行ごとの分母。無ければ全行 `badge.sample.value` |

### 値の作り方と照合

- 割合は `件数 ÷ 分母 × 100` を `decimals` の桁で1回だけ丸める。4桁に丸めた割合をもう一度丸めない（例: 福岡の1コース 1400÷2363 は 59.2%。0.5925 を経由すると 59.3% になる）
- CI は整数で照合する: `round(counts × 100 × 10^d ÷ 分母) == values × 10^d`
- 全国などの比較の値は、`views` の選択肢の1つ（key `all`・label「全国」）として入れる。比較の線などの別の項目は作らない
- 数字の元は `data/analysis/` の集計結果から転記し、記事の側で計算し直さない。`source.resultPath` にそのパスを書く
- 進入コース別の1着率の定義・言える範囲は `docs/reference/venue-course-win-rate.md`（直近1年なら全会場で1,959レース以上。4〜6コースの会場の順位は言わない）
- 値の表示の桁は部品が `decimals` でそろえる（`16` は `16.0%` と出る）。作り手は 0 を書き足さなくてよい

### CI のエラーの形

全件を1回で出す。`{ファイル}: {JSONのパス}: {期待} / 実際: {値}`

```
public/blog-charts/x.json: views[3].series[0].values[2]: counts 323/2409 から 13.4 / 実際: 13.5
public/blog-charts/x.json: views[0].series[0].count: 契約に無いキー（counts の綴り違い?）
```

### 文字の検査

文字の項目に「競艇」と、`scripts/maintenance/check-deprecated-terms.js` の廃止語を書かない（図は画面に出るので meta の例外は使えない）。

## 4. 図の種類（判別つきの union）

`kind` ごとに軸・行・系列・高さの決め方が決まる。種類を足すときは、この表に1行足し、部品と検査に1つずつ足す。

| kind | 状態 | 軸（axes） | 行（rows） | 系列（series） | values の形 | 高さを決めるもの | 描き方（部品が強制） |
|---|---|---|---|---|---|---|---|
| `hbar` | **実装済み** | `category`・`value` | 2〜12 | 1 | 行ごとに数1つ | `rows` | 横棒。行を縦に並べ、値を棒の右に常に出す。目盛りは全 view 共通 |
| `vbar` | 予約 | `category`・`value` | 2〜8 | 1 | 同上 | `rows` | 縦棒。スマホ（768px 未満）では `hbar` で描く |
| `stacked` | 予約 | `category`・`value` | 2〜12 | 2〜6（区分） | 同上。区分の `counts` の和＝分母 | `rows` | 横の積み上げ。各区分の値を出す |
| `line` | 予約 | `category`（`type`: category・date）・`value` | 2〜24（横軸の点） | 1〜6 | 行ごとに数1つ（欠けは null を許す） | 固定 | 折れ線。値の出し方は実装の前に visual-designer と決める |
| `scatter` | 予約 | `x`・`y`（それぞれ label・unit・decimals） | 2〜200（点） | 1 | 行ごとに `[x, y]` | 固定 | 散布図。上級向けの記事の「詳しく見る」の中だけ（`details: true` 必須） |
| `table` | 予約 | `category`・`value` | 1〜24 | 1〜6 | 行ごとに数1つ | `rows` | 表だけ。図にしない数字 |

予約の種類を書いた JSON は「未実装の種類」で CI が落ちる。要るときは 7 節の手順で起票する。

作らないもの（契約に入れない）: 円グラフ、7本以上の折れ線、2つ以上の切り替え、選手個人の切り替え。

## 5. 多言語の書き方

文字の項目（`title`・`description`・各 `label`・`scope`・`sample.unit`・`source.name`・`note`）は、文字列か、言語ごとの文字列のどちらでも書ける。

```json
"title": { "ja": "進入コース別の1着率", "en": "Win rate by starting course" }
```

日本語の記事だけから参照される JSON は文字列でよい。翻訳記事（`-en.md` 等）から参照される JSON は、その言語のキーが全文字項目にそろっていることを CI が確かめる（日本語が混ざって出るのを防ぐ）。札の見出し・出典の前置き・切り替えの見出しの言葉は部品が4言語で持つ。

## 6. 部品が強制すること（JSON では変えられない）

| ファン役の条件 | 部品の動き |
|---|---|
| 開いた時点で答えが出ている | `switch.default` の view を最初の描画で出す。遅延描画（画面に入ってから描く）をしない。答え（`description`）を図の上に出す |
| 値を常に出す | 値は HTML の文字として棒の横に出す（ホバー・タップに頼らない） |
| 切り替えは1つまで | 形の上で `switch` は1つ。選択肢が6つまではボタン、7つ以上は選ぶ箱 |
| スマホでは横棒 | `hbar` は常に横棒。縦棒の種類（`vbar`）は 768px 未満で横棒にする |
| CLS を防ぐ | タグの `rows` から読み込み前の高さを決め、読み込み後も同じ高さで描く。見出し・答え・注記は行数の上限つきの固定の高さ。アニメーションをしない |

ほかに部品が出すもの: 札（範囲・期間・母数）、出典の行（出典名・集計日）、注記。図は `<figure>` で、札と出典は `<figcaption>` に文字で入る。読み込み中・失敗は `data-chart-state="loading|ready|error"` で外に示し、AI 向けのスナップショット（`scripts/generate-ai-snapshots.js`）は loading が無くなるまで待ち、error の記事は失敗として数える。失敗は握りつぶさず、図の場所に「図のデータを読み込めませんでした」を出す。

## 7. 変更の手順

- 新しい種類が要るとき: SEO 担当が Linear に「ブログの図の種類の追加（kind 名・使う記事）」を起票する。部品の担当が 4 節の表・部品・検査を足す。新しい種類と、その種類だけのキーを足すのは版を上げない
- 既存の種類の項目の意味・必須・型を変えるとき: `schemaVersion` を上げ、同じ PR で全 JSON を書き換える。部品は最新版だけを読む（部品と JSON は同時にデプロイされる）
