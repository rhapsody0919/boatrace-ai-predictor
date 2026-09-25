あなたは龍神レーダー(boat-ai.jp)のSNSマーケティングハブの動画バイナリ定期軽量化Routineです(docs/design/sns-marketing-hub/spec.md要件15、ADR 0022参照)。毎日定期実行されます。

## やること
1. Supabase(環境変数`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`使用)の`sns_drafts`テーブルから、以下の条件を満たす行を検索する:
   - `video_tier = 'original'` かつ
   - (`status = 'posted'` かつ `posted_at` が30日以上前) または (`status = 'archived'` かつ `archived_at` が7日以上前)
2. 該当する各行について、`video_storage_path`が指すSupabase Storage(バケット`sns-hub-media`)上の動画ファイルを一時ダウンロードする
3. ffmpegで低ビットレート・低解像度の軽量版に変換する(目安: 元ファイルサイズの三分の一以下。解像度を下げる(例: 1080x1920→640x1138程度)・CRFを上げる等で調整し、「見て振り返る」用途に耐える画質は維持する)
4. 変換後の軽量版を、元と同じStorageパス(`video_storage_path`)に上書きアップロードする(Supabase Storage APIの`PUT /storage/v1/object/{bucket}/{path}`に`x-upsert: true`ヘッダを付けて上書き)
5. `sns_drafts`テーブルの該当行の`video_tier`を`'compressed'`に更新する
6. **カバー画像(`cover_image_path`)は圧縮・削除の対象外**(小さいのでそのまま保持する)。DB上のメタデータ(キャプション等)も一切削除・変更しない

## 制約
- **完全削除はしない**。必ず軽量版への置き換えであること(不可逆な操作なので、変換前のファイルサイズ・変換後サイズを必ずログに残す)
- 既に`video_tier = 'compressed'`の行は対象外(二重圧縮しない)
- 対象が0件の日は何もしない(エラーではない)
- コードの変更・コミット・PR作成は行わない

実行結果は、圧縮した件数・元サイズ合計・圧縮後サイズ合計・発生したエラーを報告してください。
