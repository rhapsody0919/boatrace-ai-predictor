# YouTubeプロフィールUTMと週次CSV（依頼13）

## プロフィールリンクの手動設定

`src/utils/snsObservations.js` の `buildYoutubeProfileUtm` に、オーナーが公開を確認した `destinationUrl` と `releaseEvidence`（url、confirmed_by、confirmed_at、reference）を渡す。既存の `buildObservationUtm` と同様、証拠の実在は人が確認する。既存のX関数は変更しない。

生成例（リンク先を人が確認した後の設定用）:
`https://www.boat-ai.jp/?utm_source=youtube&utm_medium=social&utm_campaign=profile&utm_content=profile`

1. オーナーがリンク先の正式公開と表示を確認し、証拠参照・確認者・日時を記録する。
2. オーナーがYouTubeのチャンネル編集画面でプロフィールの外部リンクを生成URLへ置き換える。
3. 保存後の公開プロフィールから、リンク先と4つのUTM値を確認する。
4. サイト流入はchannel帰属として別途記録する。特定動画への配賦、Shorts説明欄への自動挿入は行わない。

本実装は生成関数のみ。設定変更・実リンク確認・サイト分析接続は未実施。

## CSVダウンロード（hq返答 2026-10-08）

管理画面の「指標」タブで公開開始日・終了日（JST、両端を含む）とチャネル（X / YouTube / 両方）を選び、「CSVをダウンロード」を押す。投稿済みの各投稿について48h・7dを出力する。観測窓未終了・未観測の投稿も予定行を出す。制作時間・traffic.csvは出力しない。

認証付き `GET /api/admin/sns-hub/observations?export=csv&start=YYYY-MM-DD&end=YYYY-MM-DD&platform=all`（x/youtubeも可）。UTF-8・CRLF・全セル引用のposts.csv。式として扱われる先頭文字はアポストロフィで保護する。HTMLフォールバック・非成功応答はダウンロードしない。期間指定は公開コホートであり、観測取得日による絞り込みではない。

### 行と来歴

136の生履歴・revisionは変更しない。週次用は**draft_id×windowに1行**。各指標について、取得元・定義をまたぐ全履歴のうち `observed_at` が最新の行を採る（最新が欠測なら旧値に戻さない）。同時刻はrevisionの大きい方、さらにsource・definition・idの辞書順で決める。mockは除外し、読み始めより未来の観測は含めない。

- 行の `revision` はその投稿×窓の対象履歴件数+1（未観測予定行は1）。136のrevisionとは別のexport用世代番号。追記専用履歴が同じなら再出力でも同じ番号。行をまとめて一度の取得と扱わない。
- `aggregation_rule` に選択・束ね方を記載。`<指標>_revision/source/definition/observed_at/data_through/period_start/period_end/measurement_kind/missing_reason/denominator_name/denominator_value` に採用した来歴を残す。
- Xの `url_link_clicks` は `link_clicks`、`engagedViews` は `engaged_views` として出力。他の136指標も値と来歴を出す。率を派生計算しない。YouTubeの `stayed_to_watch_percent` は空欄＋未収集。
- 行の `observed_at` は採用指標の最新観測日時。未観測は空欄。`data_through` は採用指標の最小時点、1つでも不明なら空欄。指標の日時は来歴列でそれぞれ保持する。架空日時で補わない。
- `period_start/end` は公開から指定窓までの要求期間。Xの主指標2つが欠測でなく、各指標の期間・data_throughが要求期間に一致するときだけ `coverage=exact`。その他はmissing。YouTube継続率はmissing。
- `source_export` はX主指標順（link_clicks, impressions）のsource・definition・measurement_kindをJSON配列で保持。原本名や取得日時は混ぜない。比較層に使うときも来歴列を確認する。
- `content_type_id` はformat、`variant` はtemplate_variant_id。`content_version` は型の版/素材の版の対応が未確認のため空欄＋理由。`source_timezone`・`traffic_scope` も136に専用フィールドがないため空欄＋理由。日時のオフセットから原本タイムゾーンを推測しない。
- 外部投稿IDは同じ投稿の両窓の観測履歴に記録されたID、YouTubeでは既存source_data.youtube_video_idも照合する。一致する確認済みIDだけ出力、不明・不一致は空欄＋理由。draft_idを外部IDに代入しない。

集客レーン `out/system/weekly-insight-README.md` の必須18列は保持する。欠測日時の受け入れはhqが集客レーンへ別に依頼する。**現行生成器は欠測observed_at/data_throughで停止する**。外部IDが不明な複数投稿についても、draft_idを用いた未観測行の識別を取り込み側と集客レーンで確認する。生成器修正・実観測の補完はこのパッチの対象外。

### 取得と検証

投稿と観測を500行ずつidカーソルで全件取得する。観測は投稿へのinner joinで公開期間・チャネル・投稿済みに制限。共通の読み始め時刻をcreated_at/posted_at/observed_atの上限に使う。136の既存取得と同様、トランザクションsnapshotではないため遅いcommit・途中の既存投稿変更/削除の完全固定は保証しない。大規模データのEdge実行時間・実PostgRESTの照合は取り込み側で確認する。

既存CIゲート `scripts/maintenance/verify-sns-observations.js` にCSV・API認証・1201投稿の全件取得・JST境界・ゼロ/欠測・引用符/改行・複数指標revisionの再現検証を追加した。APIをdata URLで読むテストは新importを元ファイル基準の絶対URLへ置換する。

同ゲートの `--ui` オプションで `snsObservationCsvUi.js` を呼び、env読込/外部通信を防いだ専用Viteサーバーで実ブラウザのダウンロード、入力必須、HTML/500応答の拒否、ライト/ダークを検証する。専用経路はappType=customでSPAフォールバックを使わず登録する。UIモードはChromium導入済み環境で取り込み側が実行する。

```sh
node scripts/maintenance/verify-sns-observations.js
node scripts/maintenance/verify-sns-observations.js --ui
npm run verify:ci
```

新依存・SQLなし。145は未使用。既存ゲートへの追加なのでverify-registry.jsonの新規登録は不要。UIモードを自動ゲートに追加する場合は **verify-registry.jsonへの登録が必要**（取り込み側が担当）。プロフィールの手動設定・公開確認は引き続きオーナーの操作で行う。
