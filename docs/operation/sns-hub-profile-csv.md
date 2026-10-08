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

## CSV実装前の判断事項

参照した受け渡し仕様は集客レーンの `out/system/weekly-insight-README.md`（判断17）。依頼の `out/reports/weekly/README.md` は存在せず、週次報告のリンクも実配置と異なったため、実ファイルを確認した。

CSVの必須列:
`dataset_kind,platform,external_post_id,content_type_id,content_version,race_id,published_at,window,revision,observed_at,period_start,period_end,data_through,source_timezone,coverage,source_export,traffic_scope,missing_reason`

制作時間の列は追加しない。traffic.csvの週次セッション集計は今回の投稿観測書き出しとは別。

| 項目 | 現在の136 | 週次受け渡し | 対応案（未承認） |
| --- | --- | --- | --- |
| 行・revision | 指標×source×definition×measurement_kindごとに採番 | 投稿×窓×revisionの一行。主指標を横持ち | 指標を束ねるexport用revisionの契約を決める。異なる取得時刻・定義の行を黙って束ねない |
| 日時欠測 | data_through=nullを許す。未観測投稿にはobserved_atもない | 生成器はobserved_at/period_start/period_end/data_throughを無条件に日時解析 | 欠測時の空欄を生成器が受け入れる形をhqで判断。エクスポート日時を観測日時へ代入しない |
| YouTube主指標 | stayed_to_watch_percentは136の許可指標にない | stayed_to_watch_percent。engagedViews/viewsとは別 | 空欄と「未収集」を渡す。指標追加や率の代用はこの変更で行わない |
| source_timezone / traffic_scope | 保存契約に専用フィールドがない | 比較層と原本条件 | 原本の確認に基づく保存先・定義を決める。ISO日時から原本タイムゾーンを推定しない |
| content_version | template_variant_idは型の版。bundle_version_hashは素材の版 | 投稿の固定情報 | どちらをcontent_versionとするか確認する。素材更新と型更新を同一視しない |

推奨: 欠測日時は空欄を維持し、生成器側の受け入れ契約と横持ちrevisionの契約を先に確定する。生観測履歴を別の長形式CSVにする案は、判断17のposts.csvと互換ではないため、独断で置き換えない。

期間フィルタの候補は「JSTの公開日（開始・終了日とも指定日を含む）」、チャネルはx/youtube/両方、48h/7dを両方書き出す。公開コホートと観測取得期間を混同しない。仕様確定後、認証付きAPIの全ページ取得、欠測理由、CSV引用符・改行・ゼロ、1000行超、複数指標revision、未観測投稿を検証する。

CSV画面・API・SQLはまだ追加していない。SQLが必要な場合はhq予約の145を使用するが、本パッチに145は含まない。
