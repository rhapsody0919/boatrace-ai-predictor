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
- 171 は 2026-10-20 に本番へ適用済み（db-apply）。同じ日に `config/today-variants.json` の案 a・b の `uuid` を入れた。行が無い間は `null` で動く作り（札は `source_data.today_variant` にだけ残る）
- 適用を確かめてから、`config/today-variants.json` の案 a・b の `uuid` に上の2つを入れる PR を別に出す。同じ PR で入れない（当てる前にマージされると、外部キー違反で札なしになる）。入れた次の朝の /today から、tracking と下書きに札が入る。その PR では、verify-sns-today-plan の「リポジトリの config の uuid は null のまま」の確認（171 の試験の最後）を消す（当てる前の番人なので）

## 型の列とリンクの置き場（PD02、2026-10-25 hq の依頼）

hq の毎日の PDCA（`~/hq/platform/pdca_daily.py`）が /today の型を日ごとに割り当てる。a・b の札（日の偶奇）は今までどおりで、中身だけを「型の列」から引く。

- 置き場: 本番 DB の表 `sns_today_type_schedule`（マイグレーション [174](../db-migration/174_sns_today_type_schedule.sql)）。1行が1日（`day`・`type_id`・`post`）
- 入れ方: hq が週1回、先の7日分の JSON を作り、`node --env-file=.env.local scripts/sns/push-today-types.js <JSON> --dry-run` で検査してから `--dry-run` なしで入れる（全貌の `push-full-picture.js` と同じ道。鍵は本リポジトリの .env.local だけ）。検査は cron と同じ関数（`normalizeTypeScheduleRow`）と禁止表現（risk-rules.json）。1行でも落ちたら何も入れない。日付は JST の今日〜13日後
- 置き場をここにした理由: hq は本番 DB を読み取り専用（claude_ro、ADR-0096）でしか持たず、Vercel の鍵も持たない。DB の表なら新しい鍵を増やさず（hq は既に龍神のスクリプトを .env.local で動かしている）、cron が service key で読め、hq が claude_ro で入った行を読み返せる。リポジトリの config だと週1回の PR が要る
- `post` に書ける項目: `heading`（必須。1行・80字まで・`{date}` を含む）・`link_lead`（リンクと同じ行の前の文。空なら「今日の一覧はこちら：」）・`link_position`（`after_heading`＝見出しの直後、既定・今の型／`end`＝注意書きの後の末尾／`reply`＝本文に置かず自分への返信）。ほかの項目（thumb・caption 等）は作れない型として、その日は config で送る（理由 `type_unsupported:<項目>`）。hq の型の attributes（文の説明）は、hq がこの3項目に直して入れる
- 行は a・b どちらの日にも効く（hq が基準の型を変えたときに config の PR を待たない）。行が無い・壊れている・表を読めない日は config の a・b で送る（止めない）。理由は下書きの `source_data.content_type.fallback_reason`（`no_schedule_row`・`schedule_unavailable`・`schedule_read_failed`・`reply_not_allowed`・項目の検査の理由）と cron の report の `type_fallback`
- 型の札: 下書きの `source_data.content_type`（`id`・`side`（a・b）・`source`（schedule・config）・中身の3項目）。hq は `id` を読む。config の案の型の id は `config/today-variants.json` の `type_id`（無ければ `today-a`）
- その日の型は、下書きができた後は変えない（一覧の作り直しでも同じ型。途中で列を変えても次の日から）
- 返信（`reply`）: 本文からリンクの行を外し、リンクだけの子の下書き（`source_data.today_reply.parent_draft_id`、`race_id` は `{日付}-today-reply`）と item（`race_id` は `today:{日付}:reply`）を作る。親を承認した後、子の `deadline_queue.parent_job_id` に親の job をつないで公開保留を外してから承認する。送信の runner は親が posted の子だけを選び（`pickDueJobs`）、`snsXSend.js` が親の投稿への返信として送る。自動（`sns_auto_send_control` の x が mode=auto）の日だけ選べる（個別承認の道には親から順につなぐ所が無いため）。子の承認で落ちたら親の item も manual に戻して送らない（リンクの無い親だけを出さない）。子の文に禁止表現があれば親も止める
- 返信は X の投稿が1日1本増える（日次の上限 `daily_limit_x`・月の予約に数える）。子は URL を含むので、月の予約は親と同じ URL つきの額（thread_index=0）で引く
- hq の写し: 子の下書きも format は `today_digest`。投稿の数え方では `source_data.today_reply` のある行を親の投稿と別に扱う（子の url_link_clicks がリンクの押された数）
