# 48h/7d観測契約（依頼2・2026-10-07）

旧Phase 2のAPI収集対象外方針に対し、今回の依頼が許可するのは収集インターフェースとモックまで。cron登録・本人認可・外部API接続・課金は追加しない。

## 保存・読み取り

136を適用後、管理用 `POST /api/admin/sns-hub/observations` に次のJSONを渡す。CSVからの補完もこの契約へ変換し、`source=csv` と定義・分母を明記する。CSVファイルのパーサー・一括インポート画面は含まない。旧 `/drafts/:id/metrics` は互換性維持のため変更せず、窓のない旧値を比較へ混ぜない。

```json
{
  "draft_id": "00000000-0000-4000-8000-000000000001",
  "window": "48h",
  "external_post_id": "external-video-id",
  "observed_at": "2026-10-10T13:00:00Z",
  "period_start": "2026-10-08T12:00:00Z",
  "period_end": "2026-10-10T12:00:00Z",
  "data_through": null,
  "source": "youtube-analytics",
  "metric_name": "engagedViews",
  "metric_value": null,
  "missing_reason": "API反映遅れ・投稿起点の正確な期間を確認できない",
  "definition": "engagedViews API定義・分母なし・v1",
  "measurement_kind": "period",
  "duration_seconds": 18,
  "curve": []
}
```

期間は `posted_at` 起点の48/168時間。取得時刻と最終データ時点を分ける。値ありの期間データは `data_through=period_end` が必要。日次Analyticsを時間窓へ推測変換しない。累積スナップショットは対象時点での取得のみ値を保存でき、遅れて取った累積値は欠測とする（時刻の許容差は未承認）。率を派生計算しない。分母の名称・値は `denominator_name` / `denominator_value` へ記録できる（未提供はnull）。定義本文にも分母と単位を明記し、定義が違う系列は混ぜない。維持曲線は `audienceWatchRatio` の `curve=[{elapsed_ratio:0.1,value:0.8},...]`。経過割合は0〜1、値は0以上（再視聴により1を超えうる）。昇順・1000点まで。

`GET /observations?window=48h&metric=views` は投稿と当該窓の全観測履歴を500行ずつ取得。比較は最新revisionを取得元・定義・測定種別ごとに選び、チャネル・言語・型・版・尺ごとに分ける。有効値の中央値・全値の分布・欠測理由・投稿ごとの時点と値・曲線を表示。型の版/尺が未確認なら集計値から除外。10本基準は有効な観測本数。未収集投稿は別枠で数える。モックは比較対象外、本番POSTは拒否する。

RPCは投稿行のロック内でrevisionを発番し、追記する。補完で旧値は消さない。同じ内容の再送も新revisionになる。providerの失敗はジョブ結果に残し、値の0置換はしない。`completed`と保存処理は呼び出し側が注入する。永続job・lease・再試行スケジュールは実装していない。

## UTMの停止点

`buildObservationUtm` は確認者・確認日時・証拠参照・一致するURLを必須とするローカル関数。文字列が実際の公開証拠であるかの判断はこの関数で自動化しない。`sns_post_tracking` に投稿/variant、公開URL、UTM付きURL、source=x、medium=social、campaign=sonar-preview、content=draft/variant、証拠を保存する受け皿を用意した。

正式公開証拠の確認主体と判定方式をオーナーが決めるまで、管理API・投稿本文への自動付与は未接続。セッション・新規/再訪はsite-analyticsの別指標で保存する契約を用意したが、サイト分析サービス接続も行わない。Xクリックとサイトセッション、YouTube再生数を合算しない。Shorts本文URLの流入をXと同等と仮定しない。

## 返答02に基づく修正（2026-10-07）

collectorはproviderのobserved_atを起動時刻で置き換えない。返却期間を要求期間と照合し、不一致・遅いsnapshot・最終データ時点不足は値nullと理由へ変換する。不一致の場合だけ保存先の期間を要求窓にし、元の期間と取得時刻・最終時点は欠測理由に残す。通常の期間値の実測時刻・期間は保持する。入力不正や保存失敗はfailedであり、成功した欠測と区別する。

GETは共通の読み始め時刻をcreated_at/posted_atの上限にしてidのgtカーソルで取得する。途中の新規追記を除外し、offset移動による重複を避ける。DBトランザクションsnapshotではなく、遅くcommitした古いcreated_atの行・既存draftの変更/削除まで固定する保証はない。実DBでの並行transaction・負荷検証は取り込み側に残る。

厳密窓はオーナー決定済み。UTMの送信直前ヘッドレス公開確認は依頼5で行い、今回の証拠フィールドは維持する。継続視聴率は定義・出所の決定まで追加しない。

## 返答02cに基づく修正（2026-10-07）

provider入力は保存窓への適合検査と分離し、値・欠測理由・曲線・その他の入力妥当性を変換前に検査する。不正ならfailedとし、その収集結果の全行を保存しない。正常な入力で対象窓不一致・遅いsnapshot・最終データ時点不足がある場合だけ欠測へ変換し、保存用の厳密なvalidateObservationを再度通す。保存APIの検査は緩めない。
