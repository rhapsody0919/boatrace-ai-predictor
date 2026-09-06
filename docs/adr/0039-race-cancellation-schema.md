# ADR 0039: レース中止状態の保存先スキーマ

## ステータス
採用

## 背景
BOA-254（レース中止・順延の検出結果をDBに永続化する）で、`race_results.is_cancelled`/`is_no_race`カラムがどのパイプラインからも書き込まれていないことが判明した。原因は`race_results.rank1`/`rank2`/`rank3`が`NOT NULL`制約であり、着順が存在しない中止レースの行を作成できないため。発走前の暫定検知・発走後の確定検知の両方について、どこに状態を保存するかを決める必要がある。

## 決定
`races`テーブルに新カラム`cancellation_status`（TEXT、CHECK制約で`'tentative'`/`'confirmed'`/`NULL`の3値）を1列追加し、暫定検知・確定検知の両方をこの1列で表現する。`races`テーブルは発走前から行が存在し、`rank1`等の制約を持たないため問題なく書き込める。

## 却下した選択肢
- **`race_results`のスキーマ変更（`rank1`〜`rank3`をNULL許容化）**: 既存カラムをそのまま使えるが、`rank1`等を非NULL前提で参照している既存コード（`scrape-results.js`の的中判定、各種集計クエリ、型定義）への影響範囲を洗い出す必要があり、変更の副作用が広範囲に及ぶ。BOA-243の調査で確立した「既存のNOT NULL制約に触れず、新しい独立したフラグとして実装する」方針とも整合しない
- **`is_tentatively_cancelled`/`is_confirmed_cancelled`のような複数boolean列**: 状態は本質的に「無→暫定→確定」という単一方向の進行であり、2つのbooleanで表現すると理論上「両方true」のような不整合な組み合わせを許してしまう。単一の列挙型テキスト列の方が状態機械として正確で、消費側（`getPredictions()`・`RaceCard.jsx`・`PredictionPanel.jsx`）の分岐も単純になる

## 影響
- 既存の`race_results.is_cancelled`/`is_no_race`カラムはそのまま残置する（削除・マイグレーションはスコープ外）。将来これらを使う別の仕組みができた場合は、`races.cancellation_status`との使い分けを別途整理する必要がある
- `is_cancelled`（中止）と`is_no_race`（不成立）の区別は、`races.cancellation_status`では表現しない（spec.mdの合意通り、UI上は「中止」に統一するため区別不要と判断）
