# bundle取り込みの追加照合（依頼17）

新規依存・SQLなし。検査は警告のみ。v0の公開保留を維持する。

## 集客レーンに渡す動画契約

bundle.jsonに次の2項目を同梱する（新ファイルではない）。

```json
{
  "video": {"width":1080,"height":1920,"duration_seconds":18,"fps":30,"has_audio":true},
  "video_probe": {"tool":"ffprobe","width":1080,"height":1920,"duration_seconds":18,"fps":30,"has_audio":true,"sha256":"実際のdraft.mp4のSHA-256小文字64桁"}
}
```

videoは生成時の宣言値。video_probeは集客レーンが最終draft.mp4にffprobeを実行した結果。幅・高さは正の整数、尺・fpsは正の有限数、has_audioは音声トラックの有無（boolean）。fpsはavg_frame_rateの分数を数値化、尺はformat.durationを秒へ数値化。複数動画ストリームがあれば主動画を使う。sha256は同じ最終ファイルの実バイトから算出する。変更後は計測・hashを再取得する。

宣言との全項目一致、scene.seconds合計と実測尺、受信したdraft.mp4のSHA-256との一致を照合する。尺の許容差はmax(0.05秒, 実測fpsの1フレーム)、fpsは0.01、幅・高さ・音声有無は完全一致。項目不足・不正型も拒否せず警告とQA保留理由を記録する。既存integrityの不正や不一致の拒否は維持する。

Edgeはffprobeを実行しない。計測値は自己申告であり、hash一致は「計測したと申告されたファイル」の同一性まで。実際の解像度・尺・音声の独立検証や音量・権利確認の証明にはならない。

## 会場・レース

正準VENUE_NAMESはscripts/lib/venueNames.jsで共有し、scripts/lib/supabaseClient.jsからの既存exportを維持する。Edgeからdotenv・DBクライアントを読み込まない。

bundle/source_dataと原文4種のroot・today・target・raceの明示されたrace_id/raceId/race_code/raceCode、venue_code/venueCode、race_number/raceNumber、venue_name/venueNameを照合する。race_codeはYYYY-MM-DD-VV-RR形式のレース識別子。source_data.scope_keyのVC/VA会場コードも照合。類似レースのneighbors等を再帰走査しない。未知の構造・欠落キーを同一性確認済みとしない。

本文・タイトル・ナレーション・scene・YouTube説明は既存bundleRiskFieldsとmatchRiskRulesで他会場名の部分一致を警告する。正準名が唐津の場合の津の重複検出を避ける。比較・引用や一般語内の会場名（津など）も人による確認対象。タグ専用欄は名称検査から除外し、既存ハッシュタグ例外は維持する。

警告は既存risk_flags.x/youtube（id/category/description/matchedPattern）とhold_reasonsに保存。新しい拒否条件・公開経路は追加しない。

## 検証と取り込み

再現テストは既存scripts/maintenance/verify-sns-bundle-import.js内に置き、既存CIゲートから実行。新規ゲートなし。別ゲートとして分割する場合は取り込み側によるverify-registry.jsonへの登録が必要。

api/admin/sns-hub/import-bundle.jsはedge runtime。新しいimportは副作用のないJS正準表のみ。Node依存・JSON import属性・ffprobeは追加しない。
