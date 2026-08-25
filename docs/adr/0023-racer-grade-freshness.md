# ADR 0023: 選手個別ページの級別表示データソース

## ステータス
採用

## 背景
選手個別ページ（[[racer-news-feature]]）に表示する級別（A1/A2/B1/B2）のデータソース候補が2つある。

- `racer_profiles.grade_at_scrape`: racer-fortune-telling Step1でのスクレイピング時点のスナップショット（[docs/adr/0019](./0019-racer-profiles-scraping-scope.md)で「Step1では未使用」と明記済み）
- `race_entries.grade`: 選手が出走するたびに記録される、その時点の級別

級別は年2回（前期・後期）の成績で昇降級するため、`grade_at_scrape`は時間経過とともに実態と乖離する。

## 決定
**`race_entries`から取得した「その選手の最新出走時点の`grade`」を表示する。**

`race_entries.race_id`は`YYYY-MM-DD-VV-RR`形式のゼロ埋め文字列のため、`ORDER BY race_id DESC LIMIT 1`で辞書順ソートしても日付降順と一致する（[[racer-fortune-telling]]のplan.mdで確立済みの`extractDateFromRaceId`と同じ前提）。追加のインデックスや複雑なクエリを必要とせず、既存の`racer_id`インデックス（想定）で足りる。

## 却下した選択肢
- **`racer_profiles`を定期的に再スクレイピングして`grade_at_scrape`を更新し続ける**: 新たな定期実行ジョブ（cron等）の追加運用コストが発生する。boatrace.jp選手検索ページへの定期アクセスも増える。級別以外の項目（生年月日・支部等）は不変のため再スクレイピングする理由が無く、級別1項目のためだけに定期ジョブを持つのは過剰
- **`racer_aggregated_stats`から取得する**: このテーブルは選手の統計集計用（勝率・ST等）であり級別は保持していない（[[racer-fortune-telling]]実データ確認時点で未確認だが、集計テーブルの性質上、級別のような「現在のステータス」を持つ設計にはなっていない可能性が高く、level追加は本チケットのスコープ外）

## 影響
- 出走実績が無い選手（`race_entries`に一件も無い）は級別が表示できない。この場合は「情報がありません」の空状態表示にする（screens.mdの「プロフィールが無い選手」と同様の扱い）
- `racer_profiles.grade_at_scrape`はracer-fortune-telling側で作成済みのまま残すが、racer-news-feature側では参照しない（デッドカラムになるが、削除するとracer-fortune-telling側の設計変更になるため本チケットでは触らない）
