# 展望素材v0のローカル保留取り込み

管理画面の「展望素材の取り込み」で、同じ素材フォルダーのファイルを複数選択する。
`POST /api/admin/sns-hub/import-bundle` は既存と同じ管理者認証を使用する。
`multipart/form-data` の `files` フィールドをファイル数だけ繰り返す。ディレクトリやZIPは送らない。

## 受け入れるファイルと容量

- 必須: `bundle.json`・`qa.json`・`integrity.json`。
- 任意（不足時は公開不可理由を記録）: `script.txt`・`x-draft.txt`・`draft.mp4`・`scene-1.png`〜`scene-3.png`、`facts`・`similar`・`scenario`・`layer` の `.json` と `.meta.json`。
- multipartの境界等を含めて4 MiB。JSONは各1.5 MiB、MP4/PNGは各2 MiB、テキストは各64 KiB。最大18添付、実際の対応名は17種類。
- 同名の重複・未知の名前・パス・空ファイル・不正なMIME/シグネチャ・不正JSON・添付済みファイルのハッシュ不一致・容量超過は登録前に拒否する。
- `schema_version=ryujin-preview/0` のみ。段は `racecard` / `exhibition`。layerのメタの `racecard (fixed)` は固定段として記録し、展示後の出力と読み替えない。
- 原文のハッシュは `.meta.json` と照合し、添付された出典に対してclaimsの値を確認する。原文や照合用ハッシュが未提供なら不足を記録する。数値不一致・QA不合格も公開不可として保留登録する。
- MP4/PNGは型のシグネチャ検査まで。再生品質・全編視聴・OCR・広告評価の合格を表す検査ではない。

## 保存・重複・失敗

全添付の実バイトSHA256を名前順にまとめたハッシュを素材版にする。QAや追加添付を変えた場合は別版。
すべてのファイルを既存の非公開 `sns-hub-media` の `bundle-imports/<版ハッシュ>/<ファイル名>` に保存してから、RPCでX/YouTubeを各1件、`ja`・`pending_review` で一括登録する。
返答は各チャネルの `created` / `duplicate`、下書きID、共通group、公開不可理由。

同じ版・チャネル・言語の一意制約と素材台帳の行ロックを使用する。再取り込みでは既存下書き（アーカイブ済みを含む）を上書きしない。片側が存在すれば不足側だけを補完する。
DB登録は一つのトランザクションなので、片側の失敗では全体がロールバックする。
保存失敗では下書きを登録しない。保存済みファイルは同じパスに再試行できる。未登録ファイルの自動削除は行わない（並行取り込みで使うファイルを削除しないため）。

groupは `sns_bundle_imports.id`、生成元は `bundle_import_id` で区別する。topic経路の `content_group_id=sns_topics.id` は変えず、topic/target/Routineを作らない。
`template_variant_id` はNULL。元のローカルID・元bundle・source manifest・QAは保存する。
正式公開情報はNULLと不足理由を素材台帳に保存する。

## 公開・修正の保留

既存risk警告は既存の `risk-rules.json` でチャネル別に照合し、`risk_flags` に保存する。
公開不可はそれと独立した `publish_blocked` / `publication_hold_reasons`。
承認API・YouTube公開APIは外部への送信前に409で拒否し、DBトリガーもv0の公開状態への変更と由来の除去を拒否する。
v0の公開フラグ・QAを書き換えても解除できない。正式素材の公開証拠・確認主体・QA合格条件は別の依頼で決める。

v0の修正はローカルで再生成して新しい版を取り込む。管理画面の修正ボタンとredo APIもv0では拒否し、既存の自動修正Routineにローカル素材を渡さない。
不要な旧版は既存の非表示操作を使用する。

## 取り込み側の確認

135をオーナーが適用してからAPI/画面を提供する。134との取り込み順、Storageの許可MIME・バケット容量設定、実行環境でのmultipartとJSON importを確認する。新しい鍵は不要。
`npm run verify:sns-bundle-import` は実サービスへ接続せずPGliteと保存モックで検証する。
提供実例を照合する場合は `node scripts/maintenance/verify-sns-bundle-import.js --sample=<素材フォルダー>`。
