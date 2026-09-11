# ADR 0042: 締切ステータス計算に使うレース日付の取得方法

## ステータス
採用

## 背景
BOA-243（会場ページ締切ライブステータス）で、締切判定を"HH:MM"文字列比較ではなく日付+時刻を組み合わせたDate比較で行う方針が決まっている（`docs/design/race-deadline-status/spec.md`制約）。`RaceCard.jsx`は現状カレンダー日付（`race_date`）を直接は保持しておらず、`race.startTime`（"HH:MM"）のみを持つ。Date比較を行うには、レースの暦日をどこから取得するかを決める必要がある。

## 決定
`race.id`（`VenueRaceListPage.jsx`のマッピングで`id: race.raceId`として既に渡されている、`"YYYY-MM-DD-VV-RR"`形式）を、既存の`parseRaceId()`（`src/utils/raceId.js`、`RaceDetailPage.jsx`の日付抽出で既に使われている関数）でパースし、`date`フィールドを取り出して使う。新規の`src/utils/raceDeadlineStatus.js`がこの関数を内部で呼び出し、`startTime`と組み合わせてDateオブジェクトを構築する。

## 却下した選択肢
- **`VenueRaceListPage.jsx`から新規propとして`date`を渡す**: 既存の`nowHHMM`propと同じパターンで実装できなくはないが、`race.id`に既に同じ情報が含まれているため、新しいpropを追加する必然性が無い。propが増えるとRaceCardの呼び出し元（Holmes系等、無関係な箇所を除く）すべてに影響する可能性を検討する手間が増える
- **データ取得層（`getPredictions()`）に`race_date`を新規フィールドとして追加する**: BOA-254で「Edge API経由のRPCまで同じフィールドを反映しないと本番で機能しない」という教訓を得たばかりであり、同種の広い変更（直接クエリ・RPC・`transformEdgeResponse`の3箇所）を今回のためだけに行うのは過剰。`race.id`から既存関数で復元できる情報を、わざわざデータ層で重複して持つ理由が無い

## 影響
- `parseRaceId()`は`RaceCard.jsx`が受け取る`race.id`（`raceId`ではなく`id`という別名で渡されている点に注意、`VenueRaceListPage.jsx`のマッピング参照）に対して呼び出す
- `race.id`が不正な形式の場合（`parseRaceId`が`null`を返す場合）、締切ステータス・カウントダウンは表示しない（既存の他バッジと同様、フォールバックとして「何も表示しない」を選ぶ。エラー表示等は行わない）
