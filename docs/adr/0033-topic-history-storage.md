# ADR 0033: ネタ使用履歴の保存方式

## ステータス
採用

## 背景
`content-multi-channel-pipeline`のネタ供給モジュール（会場特性・データ知見の2系統）は、同じ切り口・型を連続で使わないためのローテーション管理が必要。「直近何を使ったか」の履歴をどこに保存するかを決める必要がある。

## 決定
JSONファイルとして`data/analysis/content-topics/{category}-history.json`に保存する（`category`は`venue-characteristic`/`data-insight`）。

既存の`data/analysis/x-posts/history.json`・`data/analysis/tiktok-posts/history.json`と全く同じパターン（投稿・生成の履歴をJSON配列としてgit管理下のファイルに残す）を踏襲する。`.claude/rules/documentation.md`の配置ルール（分析結果はdata/analysis/にJSON形式で保存）とも一致する。

## 却下した選択肢
**新規Supabaseテーブルを作る案**: クエリはしやすくなるが、このデータは書き込み頻度が低く（1晩1回程度）、読み取りもRoutine自身が次回生成時に1回読むだけで、複雑な集計・検索は不要。DBに置くほどの必然性が無く、既存のJSON履歴ファイル運用パターン（x-posts/tiktok-posts）との一貫性を崩してまで採用する理由が無い。

**既存の`sns_drafts`テーブルから逆算して履歴を求める案**（専用の履歴ファイルを持たず、下書きテーブルの`format`列を集計して「直近使った型」を都度計算する）: blog/noteの下書きが`sns_drafts`に統合されたことで理論上は可能だが、「直近3回で同じ型を使っていないか」のような判定ロジックをSQL集計に依存させるより、Routine側で単純なJSON配列を読み書きする方が実装・デバッグとも単純。

## 影響
- 新規マイグレーション不要
- 会場特性系: `{category: "venue-characteristic", entries: [{venueCode, angle, usedAt}]}`形式を想定
- データ知見系: `{category: "data-insight", entries: [{tabId, usedAt}]}`形式を想定（`tabId`は分析ツールの既存タブID）
- 具体的なJSON構造の確定は実装時（`/step4`）に行う
