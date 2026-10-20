# /today の X 投稿の見出しの日替わり（2案）

/today の X 投稿の1行目（見出し）だけを、2案で日替わりに出す（2026-10-20 オーナー承認、hq 経由）。数字・区分・締切の順は今までどおり機械が作る。

- 案の置き場: `config/today-variants.json`（`default` と `variants` の2案。各案は `id`・`uuid`・`heading`。`heading` の `{date}` に日付の表示が入る）
- 選び方: 日の番号（1970-01-01 からの日数）の偶奇。1週は7日（奇数）なので、週ごとに順が逆になり、同じ曜日に同じ案が続かない（`scripts/lib/snsTodayVariants.js`）
- 札: 下書きの `source_data.today_variant`（`{id, uuid}`）に必ず残す。`uuid` が入っている案は `sns_post_tracking.template_variant_id` にも入る（`sns_template_variants(id)` への外部キー）
- 設定が無い・壊れている（2案でない・同じ id・改行・uuid の形が違う）ときは `default`（それも壊れていれば「本日のデータ一覧（{date}）」）に戻し、札は `default`
- `heading` は1行・80字まで・`{date}` を必ず含む（含まない案は使わず、既定の文に戻る）。日付が消えると、投稿のどこにも「いつのデータか」が出ないため
- 案の中身は hq が機械の検査（禁止語・risk-rules）を通して渡す。入れ替えは `config/today-variants.json` だけを変える小さな PR で行う。/today の X 投稿の型を変える PR なので、x-channel の評価が要る
- 2案が同じ文のあいだ（2026-10-20 の導入時は両方とも既定の文）は配線だけで、比較の実験ではない。その期間の a・b の札の数字は、案の比較に使わない。実際の2案を入れた日を、入れ替えの PR に書く

## 案の札を tracking・下書きに入れる（本番の2行）

`sns_post_tracking.template_variant_id`・`sns_drafts.template_variant_id` は uuid で、`sns_template_variants(id)` への外部キーがある。案の札を入れるには、`sns_template_variants` に /today の2案の行が要る。表は変えず、データの2行だけ。

- 行を入れるのはマイグレーション [`docs/db-migration/171_sns_today_heading_variants.sql`](../db-migration/171_sns_today_heading_variants.sql)。db-apply のワークフローで当てる（オーナーの操作は Run workflow と Approve だけ。手順は [db-apply.md](./db-apply.md)）。適用前・適用後の確認の SQL と戻し方は、ファイルの冒頭のコメント
- id は固定: 案 a `0f88824e-c630-4f94-8c15-475297e4b242`、案 b `be74c247-fa8f-442e-a29f-4d1d7866919a`
- 行が入るまでは、`config/today-variants.json` の `uuid` は `null` のまま動く（札は `source_data.today_variant` にだけ残る）
- 適用を確かめてから、`config/today-variants.json` の案 a・b の `uuid` に上の2つを入れる PR を別に出す。同じ PR で入れない（当てる前にマージされると、外部キー違反で札なしになる）。入れた次の朝の /today から、tracking と下書きに札が入る。その PR では、verify-sns-today-plan の「リポジトリの config の uuid は null のまま」の確認（171 の試験の最後）を消す（当てる前の番人なので）
