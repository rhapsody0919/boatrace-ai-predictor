# ADR 0084: レース詳細のタブ・艇の選択を URL のクエリに書き戻す

## ステータス

採用（2026-10-02、ユーザー判断。BOA-493 / PR #1140・#1174、関連 BOA-691 / PR #1146）

## 背景

レース詳細（`/race/:raceId`）で「どのタブ・どの艇を見ているか」は、コンポーネントの state だけにあった。「この艇を見て」と共有しても、受け取った人は既定のタブ・艇未選択で開く。

既存のディープリンクは `/winning-technique?tab=X` だけで、**マウント時に初期値として読むだけ**（状態の変更を URL へ書き戻していない）。レース詳細で書き戻す方式を採ると、このリポジトリで初の事例になる。

判断材料（Linear BOA-493 のコメント）で比べた案:

| 案 | 共有の仕方 | 戻るボタン | GA4 の PV |
|---|---|---|---|
| A. 現状維持 | 共有できない | 前のページへ | 変化なし |
| B. 初期値として読むだけ＋コピーのボタン | 専用ボタンのみ | 前のページへ | 変化なし |
| C. 選ぶたびに replace で書き戻す | アドレスバー・共有シートがそのまま使える | 前のページへ | 対策しないと選ぶたびに+1 |
| D. 選ぶたびに push で書き戻す | 同上 | 選択を1つずつ巻き戻す | 同上 |

## 決定

C を採る。

1. **選ぶたびに `history.replace` で `?tab=`・`?boat=` を書き戻す。** push にしない（戻るボタンが選択を巻き戻さない）
2. **既定の状態ではクエリを付けない。** 既定のタブ（確定前は基本情報、確定後は結果）・艇未選択なら素の `/race/:raceId`
3. **開いたときは URL から読む。** 今のタブ構成に無い `tab`（確定前の `result` 等）は既定で開く。`boat` は 1〜6 以外を無視する
4. **書き戻しの土台は、その時点の実際の URL（`window.location.search`）にする。** react-router の `setSearchParams` は関数形式でも描画時点の値を渡すため、それを土台にすると、反映前に続けて押した操作が前の書き戻しを消す（#1140 で入れて CI を赤くした不具合、#1174 で修正）
5. **GA4 の page_view は、レース詳細の `tab`・`boat` を除いた URL で数える。** PageViewTracker は `pathname + search` の変化ごとに送るので、除かないと押した回数だけ PV が増える（BOA-531 で直した計測を崩さない）。除くのはレース詳細だけで、`/winning-technique?tab=` はタブごとに数える
6. **canonical はクエリ無しのまま。** クエリ付き URL を別ページとして索引させない

実装は `src/utils/raceUrlState.js`（`parseBoatParam`・`pageViewPath`）、`PredictionPanel.jsx`（`setRaceParam`）、`RaceTabs.jsx`（`initialTabId`）、`AppRouter.jsx`（PageViewTracker）。

## 影響・制約

- 共有ボタン（X・Facebook・LINE）は、今見ているページの URL（言語・`tab`・`boat` 込み）を送る（BOA-691）
- `index.html` に静的な `og:url` を置かない。Facebook は `og:url` が指す URL を辿ってその情報を使う（[Facebook のドキュメント](https://developers.facebook.com/docs/sharing/webmasters/getting-started/versioned-link/)）。SPA では JS を実行しないクローラーに全ページで index.html が見えるため、トップ固定の `og:url` があるとレースや記事の共有がトップ扱いになる。URL を持つページは `useSocialMeta` が `og:url` を付ける
- レースごとのリンクプレビュー（会場・R・本命をカードに出す）は SPA の制約で出せない（`docs/reference/seo-architecture-constraints.md`）。Edge Function でのボット判定か SSG が要る
- 言語のリダイレクト・言語切替はクエリを保つ。前後のレースへのリンクはクエリを持たないので、レースを移ると選択は消える

## 他のページへ広げるとき

同じ方式（replace で書き戻す）を他のページに入れる場合は、5（PV の除外）を必ずそのページのパスにも足す。書き戻しのたびに PV が増えないことは `e2e/race-detail-url-state.spec.js` の page_view のテストと同じ形で固定する。続けて操作したときに前の書き戻しを消さないことも、同じ spec の「同じタスクの中で2つのクリックを発火させる」テストの形で固定する。
