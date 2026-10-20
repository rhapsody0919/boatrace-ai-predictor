# ブログの図の契約（schemaVersion 1）

ブログ記事（`public/blog/*.md`）に図を出すための、記事の作り手（hq の SEO 担当）と部品（`src/components/blog/BlogChart.jsx`）の間の契約。作り手は JSON を1つ書き、記事にタグを1行置くだけで図が出る。見た目とファン役の条件は部品が強制し、JSON からは変えられない。条件を破る JSON は CI（`npm run verify:blog-charts`）で落ちる。

仕様の元: オーナー yes（2026-10-20、hq `drafts/blog-charts-20261020.md`）と、汎用化の追加（2026-10-20 15時、オーケストレーター経由）。

## 1. 記事への書き方

```markdown
本文の段落。

<ryujin-chart src="/blog/charts/fukuoka-water-wind-guide-course-win.json" rows="6"></ryujin-chart>

次の段落。
```

| 規則 | 理由 |
|---|---|
| タグ名・属性名は小文字 | HTML の解析器が小文字にするため。大文字だと部品に届かない |
| `></ryujin-chart>` で閉じる。`/>` で閉じない | `/>` は無視され、後ろの本文を全部子要素として飲み込む |
| 行頭に1行で書き、前後を空行にする。リスト・引用の中に置かない | 前に空行が無いと段落 `<p>` の中に入り、入れ子が壊れる |
| `src` は `/blog/charts/` の下の実在する `.json` | `/blog/{名前}` の1段に置くと、AI ボットにだけ別のファイルへ書き換えられる（`src/config/aiCrawlerBots.js` の `^\/blog\/([^/]+)$`） |
| `rows` は JSON の行の数と同じ整数 | 読み込む前に図の高さを確保する（CLS 対策）。違うと CI が落とす |
| 同じ数字を本文の1行と Markdown の表にも書く | 検索・AI の根拠は本文。図は見やすさのため |

翻訳記事（`-en.md` 等）でも同じ JSON を指してよい。表示の言葉は 5 節の多言語の書き方で持つ。

## 2. JSON の置き場所と名前

- `public/blog/charts/{記事id}-{図id}.json`。`id` はファイル名の拡張子を除いた部分と同じ、`article` は記事 id と同じにする
- 1つの JSON は記事と同じ時点で固定する。図だけ日々更新しない。データを直したら記事の本文と表も同じ PR で直す
- どの記事からも参照されない JSON は CI が落とす

## 3. 形（全種類共通）

```jsonc
{
  "schemaVersion": 1,                 // 契約の版。形を壊す変更をしたら 2 に上げる
  "id": "fukuoka-water-wind-guide-course-win",
  "article": "fukuoka-water-wind-guide",
  "kind": "hbar",                     // 図の種類（判別子）。4 節
  "title": "進入コース別の1着率",       // 図の見出し（h3 相当）
  "description": "福岡は1コースの1着率が59.2%で、全国（55.5%）より高い。",  // 図が示す答えを1文。figure の説明になる
  "unit": "%",                        // 値の単位。"%" のときは 0〜100
  "decimals": 1,                      // 小数の桁（0〜2）。値はこの桁で書く
  "rows": [                           // 行（横棒なら縦に並ぶ項目）
    { "key": "1", "label": "1コース", "boat": 1 }  // boat を書くと艇の公式色の印が付く（1〜6）
  ],
  "switch": {                         // 切り替え。無ければ null。1つまで（形の上で2つ目は書けない）
    "label": "会場",
    "default": "22"                   // 開いたときに出す view の key
  },
  "views": [                          // 切り替えの選択肢ごとの中身。switch が null なら1つだけ
    {
      "key": "22",
      "label": "福岡",
      "badge": {                      // 札。期間・範囲・母数。切り替えると札も替わる
        "scope": "福岡",
        "period": { "from": "2025-10-01", "to": "2026-09-30" },
        "sample": { "value": 1820, "unit": "レース" }
      },
      "series": [
        { "key": "win1", "label": "1着率", "values": [55.2], "counts": [1005] }
        // values は rows と同じ数・同じ順。counts（分子の件数）は任意、書くと札の母数と照合する
      ]
    }
  ],
  "source": {
    "name": "ボートレース公式の競走成績（龍神レーダー集計）",
    "dataVersion": "2026-10-20",      // 集計した日（YYYY-MM-DD）
    "resultPath": "data/analysis/blog-charts/fukuoka-course-win.json"  // 任意。集計結果のリポジトリ内のパス
  },
  "note": "進入コース別（枠番ではない）。中止・不成立のレースを除く。"  // 任意。注記（80字まで）
}
```

### 共通の検査（CI と部品の両方）

| 項目 | 条件 |
|---|---|
| `schemaVersion` | `1` |
| `kind` | 4 節の種類のどれか。予約だけの種類は「未実装」で落ちる（起票して部品に足す） |
| `title` | 1〜40字 |
| `description` | 1〜120字。答えを書く（「〜を示す図」ではなく「〜は〜」） |
| `decimals` | 0〜2。各値の小数の桁がこれを超えない |
| `rows` | 種類ごとの上限以内。`key` は重複しない |
| `switch` | `null` か、`label` と `default` を持つ。`default` は `views` の key のどれか |
| `views` | `switch` が `null` なら1つ、あれば2つ以上。`key` は重複しない |
| `badge` | 全 view に必須。`period.from <= period.to`、`sample.value` は正の整数 |
| `series[].values` | 数（null 不可）、`rows` と同じ数。`unit` が `%` なら 0〜100 |
| `series[].counts` | 任意。あれば整数で、`counts[i] / sample.value * 100` を `decimals` で丸めた値が `values[i]` と一致する |
| `source` | `name` と `dataVersion` 必須 |
| 禁止語 | 文字の項目に「競艇」を書かない（図は画面に出るので meta の例外は使えない） |

### 値の作り方（作り手への決まり）

- 割合は `件数 ÷ 母数 × 100` を `decimals` の桁で1回だけ丸める。4桁に丸めた割合をもう一度丸めない（例: 福岡の1コース 1400÷2363 は 59.2%。0.5925 を経由すると 59.3% になる）。`counts` を書けば CI が照合する
- 全国などの比較の値は、`views` の選択肢の1つ（例 key `all`・label「全国」）として入れる。比較の線などの別の項目は作らない
- 数字の元は `data/analysis/` の集計結果から転記し、記事の側で計算し直さない。`source.resultPath` にそのパスを書く
- 進入コース別の1着率の定義・言える範囲は `docs/reference/venue-course-win-rate.md`（直近1年なら全会場で1,959レース以上。4〜6コースの会場の順位は言わない）

## 4. 図の種類（判別つきの union）

`kind` ごとに `rows`・`series` の上限と描き方が決まる。種類を足すときは、この表に1行足し、部品と検査に1つずつ足す。既存の種類の JSON は壊れない（足すだけなら `schemaVersion` は上げない）。

| kind | 状態 | 行（rows）の上限 | 系列（series）の上限 | 描き方（部品が強制） |
|---|---|---|---|---|
| `hbar` | **実装済み** | 2〜12 | 1 | 横棒。行を縦に並べ、値を棒の右に常に出す |
| `vbar` | 予約 | 2〜8 | 1 | 縦棒。スマホ（768px 未満）では `hbar` で描く |
| `stacked` | 予約 | 2〜12 | 2〜6（合計で1つの棒） | 横の積み上げ。各区分の値を棒の中か下に出す |
| `line` | 予約 | 2〜24（横軸の点） | 1〜6 | 折れ線。各点の値を出す。6本を超えない |
| `scatter` | 予約 | 2〜200（点） | 1 | 散布図。上級向けの記事の「詳しく見る」の中だけ（`details: true` 必須） |
| `table` | 予約 | 1〜24 | 1〜6 | 表だけ。図にしない数字 |

作らないもの（契約に入れない）: 円グラフ、7本以上の折れ線、2つ以上の切り替え、選手個人の切り替え。

## 5. 多言語の書き方

文字の項目（`title`・`description`・`label`・`scope`・`sample.unit`・`source.name`・`note`）は、文字列か、言語ごとの文字列のどちらでも書ける。

```json
"title": { "ja": "進入コース別の1着率", "en": "Win rate by starting course" }
```

`ja` は必須。記事の言語の文字列が無ければ `ja` を出す。札の見出し（「期間」「母数」）・出典の前置き・切り替えの見出しの言葉は部品が4言語で持つ（`src/components/blog/BlogChart.jsx`）。

## 6. 部品が強制すること（JSON では変えられない）

| ファン役の条件 | 部品の動き |
|---|---|
| 開いた時点で答えが出ている | `switch.default` の view を最初の描画で出す。遅延描画（画面に入ってから描く）をしない。`description` を図の上に出す |
| 値を常に出す | 値は HTML の文字として棒の横に出す（ホバー・タップに頼らない） |
| 切り替えは1つまで | 形の上で `switch` は1つ。選択肢が6つまではボタン、7つ以上は選択の箱 |
| スマホでは横棒 | `hbar` は常に横棒。縦棒の種類（`vbar`）は 768px 未満で横棒に切り替える |
| CLS を防ぐ | タグの `rows` から読み込み前の高さを決め、読み込み後も同じ高さで描く。アニメーションをしない |

ほかに部品が出すもの: 札（範囲・期間・母数）、出典の行（出典名・集計日）、注記。読み込み中・失敗は `data-chart-state="loading|ready|error"` で外に示し、AI 向けのスナップショット（`scripts/generate-ai-snapshots.js`）は loading が無くなるまで待つ。失敗は握りつぶさず、図の場所に「図のデータを読み込めませんでした」を出す。

## 7. 例（hbar・会場の切り替え）

`docs/design/blog-charts/example-venue-course-win.json` を参照。

## 8. 変更の手順

- 新しい種類が要るとき: SEO 担当が Linear に「ブログの図の種類の追加（kind 名・使う記事）」を起票する。部品の担当が 4 節の表・部品・検査を足す
- 既存の項目の意味や必須を変えるとき: `schemaVersion` を上げ、部品は旧版も読めるようにする
