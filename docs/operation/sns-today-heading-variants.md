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
- `post` に書ける項目: `heading`（必須。1行・80字まで・`{date}` を含み、ほかの波かっこを含まない）・`link_lead`（リンクと同じ行の前の文。空なら「今日の一覧はこちら：」）・`link_position`（`after_heading`＝見出しの直後、既定・今の型／`end`＝注意書きの後の末尾／`reply`＝本文に置かず自分への返信）。ほかの項目（thumb・caption 等）は作れない型として、その日は config で送る（理由 `type_unsupported:<項目>`）。hq の型の attributes（文の説明）は、hq がこの3項目に直して入れる
- 行は a・b どちらの日にも効く（hq が基準の型を変えたときに config の PR を待たない）。行が無い・壊れている・表を読めない日は config の a・b で送る（止めない）。理由は下書きの `source_data.content_type.fallback_reason`（`no_schedule_row`・`schedule_unavailable`・`schedule_read_failed`・`reply_not_allowed`・項目の検査の理由）と cron の report の `type_fallback`
- 列の型の日は、見出しの a・b の札を付けない（`source_data.today_variant` は `{id: "schedule", uuid: null}`、`template_variant_id` は null）。札と実際の文面が食い違うと a・b の比較の母数を汚すため（x-channel の審査）。型の比較は `content_type` で行う。config で送った日だけ今までどおり a・b の札
- 型の札: 下書きの `source_data.content_type`（`id`・`side`（a・b。config が壊れて既定の文で送った日は default）・`source`（schedule・config）・中身の3項目）。hq は `id` を読む。config の案の型の id は `config/today-variants.json` の `type_id`（無ければ `today-a`）
- その日の型は、下書きができた後は変えない（一覧の作り直しでも同じ型。途中で列を変えても次の日から）
- 返信（`reply`）: 本文からリンクの行を外し、リンクだけの子の下書き（`source_data.today_reply.parent_draft_id`、`race_id` は `{日付}-today-reply`）と item（`race_id` は `today:{日付}:reply`）を作る。親を承認した後、子の `deadline_queue.parent_job_id` に親の job をつないで公開保留を外してから承認する。送信の runner は親が posted の子だけを選び（`pickDueJobs`）、`snsXSend.js` が親の投稿への返信として送る。自動（`sns_auto_send_control` の x が mode=auto）の日で、`config/today-variants.json` の `reply_enabled` が true のときだけ選べる（既定は false。費用が増えるのでオーナーの判断。外れた日の理由は `reply_not_allowed`・`reply_disabled`）。個別承認の道には親から順につなぐ所が無いため自動の日だけ。子の承認で落ちたら親の item も manual に戻して送らない（リンクの無い親だけを出さない）。子の文に禁止表現があれば親も止める
- 子の承認（自動）に落ちたら、親と子の item を held_manual にして送らない（manual に戻すと親だけが承認されてリンクの無い投稿が出うる）
- 返信は X の投稿が1日1本増える（日次の上限 `daily_limit_x`・月の予約に数える）。子は URL を含むので、月の予約は親と同じ URL つきの額（thread_index=0）で引く
- hq の写し: 子の下書きも format は `today_digest`。投稿の数え方では `source_data.today_reply` のある行を親の投稿と別に扱う（子の url_link_clicks がリンクの押された数）
- 返信の日は日次の上限（本番 `daily_limit_x`=6、2026-10-25 に読み取りで確認）が全貌の X 4本＋/today 1本＋返信 1本でちょうど埋まる。他の道の投稿（`daily_external_count`）があると子が「日次全体上限です」で送れず、親だけが出る日がありうる。hq は子が posted でない日を型の判定から外す
- 測り方の注意（x-channel の審査）: 「リンクを返信に置く」は配信を上げる根拠が弱い（X は 2026-07 に不要と明言したとされる。出典は docs/knowledge/x.md の調査ノート、未確認）。reply の型は親の impressions で読み、子のクリックを親の impressions で割った率を他の日と並べない
- 作れない型: 見出しに当日の数字を入れる型（hq の t03「見出しの1行目に今日いちばん偏った数字」）は、週1回に固定文を入れる口では作れない（固定文の数字はその日の実データと別物になる）。当日の値を機械が差し込む口（例 `{top_stat}`）が要る。それまで t03 は割り当てない
- 返信の子は親と同じ失効（9:30）を持ち、親の公開の後に送る。親が失効の直前に出た日は子が `deadline_expired` で送れず、親だけが出る（runner の通知で分かる）。返信の型を引き継いだ作り直しの回に自動でなくなっていたら（mode を manual に戻した等）、親も子も held_manual にして送らない
- 返信を有効にする前に直す残り（ADR 0094 の追記）: 予算・日次の上限の際で親だけが通る（親子の対の予約が要る）、親の公開の後に一覧が変わると子が送れない

## 型 b（コース別1着率）と a・b の比べ（2026-10-27 hq の依頼、オーナー決定）

型 a＝今の型（見出し＋一覧、ソナーの図 最大4枚）、型 b＝v2「今日走る選手のコース別1着率」（本文は「N回中M回。」で始まる数字の1行、画像は撮影用のページ1枚）。正本は hq drafts/x-today-type-20261027.md §6〜§11。

- 材料: 朝の一覧の `morning_digest_days.notes.courseWin`（RPC 183 `compute_today_course_win_stats`、`scripts/daily/generate-morning-digest.js` の `fetchCourseWin`）。候補は率で絞らない全員、級は各走の級
- 中身: `src/utils/todayCourseWin.js` の `buildCourseWinSheet`。段は 1号艇（1コース、最大3）と 4号艇（4コース、A1・A2、最大2）。並べは「縮めた値−その選手の級の全国平均」の大きい順。本文の人は1コースの段の1行目。差（「を上回る」）を書くのは、その人の正確な二項の上側確率がその日の1コースの候補数 K で割った水準（0.025/K）以下の日だけ
- 本文と検査: `scripts/lib/snsTodayCourseWinPost.js`。本文の検査（未取得の印・順位の言い切り・線なしの差・名前の空白・リンク・免責・加重280）が1つでも外れたら型 a で送る。本文と画像が同じ行・同じ窓から作られたことは、撮影のときの指紋の一致（ページの `data-today-sheet-key` が計画の指紋と同じときだけ撮れる）で保証する（計画の中の `image_key_mismatch` は、ほかの呼び出し元のための検査）
- 画像: `/share/today-sheet?date=&from=&skip=`（`src/pages/TodaySheet.jsx`、noindex）を 1080×1350 で撮る。ページは値をサーバーから読み、出来上がりの指紋を `data-today-sheet-key` に出す。計画は自分の指紋と同じときだけ撮る。撮れなければ 8:30 までやり直し、過ぎたら型 a
- 型 b を出さない日（型 a で送る）: 材料なし（183 の未適用など）・形の版違い・1コースが0行・合計1行・検査の不合格・撮影の失敗。作り直しの回に b を作れなくなった日も型 a へ倒す（その日の型を変えない決まりの唯一の例外。送らないより a を送る）。理由は `source_data.content_type.fallback_reason`（`course_win:…`）と Slack の知らせ
- config の b の `heading` は本文に使わないが、作り直しで型を引き継ぐ条件（`content_type.heading`）に要るので消さない
- `experiment` を置いた日から、見出しの a・b の日替わり（日の偶奇、171 の札）は止まり、比べの外の日は全部 a（札 a）になる。`experiment` の鍵ごと消すと前の偶奇に戻り、型 b が1日おきに比べの外で出るので消さない（止めるときは `start` を null に）
- 比べの形は `experiment.mode` で選ぶ。`pairs`（既定）は連続2日を1組、組の中で `sha256(seed:組の番号)` の1ビットでどちらの日を b にするかを決める（日付と設定だけで決まり、作り直しても変わらない。`start` が null の間・組の数を過ぎた後は全部 a、組の日は型の列（PD02）を使わない。理由 `experiment_pair`）。`all_b` は `start` から `days` 日を毎日 b、その後は a（b の日は型の列を使わない。理由 `experiment_all_b`）
- 始め方: 183 を本番に当て、翌朝の一覧で `notes.courseWin.status='ok'` を確かめ、撮影用のページが本番で出ることを確かめてから、`start` に1日目（翌日以降）を入れる小さな PR を出す
- 今の設定（2026-10-28 オーナー決定、hq のセッション。原文「a の型は過去数日ずっと出ているはずなので、それを比較に使えば良い。b で比較ができるようになるまでずっと出して欲しい」）: `mode: "all_b"`・`start` 2026-10-29・`days` 30。10/29〜11/27 が毎日 b、11/28 から a（`verify-today-type-b.js` で固定）。基準は過去の a の日（10/19〜25 の6日分、log 表示の SD 0.70）で、計測と判定は hq（DS）が持つ。終わりは判定ができるまで、最短 b 30日。途中は hq が日別の値と中央値だけを出す。延ばすときは `days` を増やす PR（`start` は変えない）。b を出せない日は今までどおり型 a に落ち、理由を `fallback_reason` に残す
- 前後比べなので、曜日・開催の並び・季節・アカウントの伸び（フォロワーの増減）と型の差を分けられない。組の中の比べ（`pairs`）より言い切りが弱く、差が出ても「b の期間は a の期間より多かった」までしか言えない
- 記録: `source_data.content_type` に `side`（割り当て）・`sent`（実際に送った型）・`experiment`・`mode`（`pairs`／`all_b`）、`pairs` は `pair`・`slot`、`all_b` は `day`（`start` からの日数 0〜）。`pairs` の a の日は `b_feasible`（その日 b を出せたか。DB を読まない分）。b の日は `source_data.course_win`（指紋・段ごとの K・線・正確な確率・本文の人）。`utm_content` は「日付-実際に送った型」

### 比べの読み方（始める前に決めておく。data-scientist・x-channel の審査）

- 下は `pairs` の読み方（10/27 の審査）。`all_b`（10/29〜の今の設定）の読み方は hq（DS）が持ち、上の「前後比べ」の限界がかかる

- 主の分析は割り当てどおり（ITT）: `content_type.side` と組で、組の中の差 log1p(b の 48h 表示) − log1p(a の 48h 表示) を取る。検定は組の中の符号の入れ替え（10組なら 2^10 通りの正確な並べ替え検定）。表示の比の点推定と95%区間で出す
- 実際に送った型（`sent`・`content_type.id`・`utm_content`）での集計は参考にとどめ、b を出せなかった日数と理由を必ず並べる。両方の日で b を出せた組（a の日の `b_feasible` が true）だけの感度分析も並べる
- GA4 の流入（副）も、`utm_content` の日付から `side` に引き直して数える
- 送れなかった日（`no_candidates`・朝に作れなかった）がある組は、組ごと外す（割り当ての前の条件なので偏らない）
- 10組で見分けられるのは、1投稿の σ≈0.77（5本の目安）なら検出力80%で表示の約2.7〜2.9倍。差が出なければ「約3倍未満の差は10組では確認できない」と書き、差が無い証拠にしない。5組で組の中の SD だけを見直し、1.0 を超えたら20組（約2倍まで）
- 限界: b の日の保存・フォローが翌日の a に及ぶ（差を小さく見せる）、目新しさの効果は20日では分けられない。型の束（本文・画像・リンクの位置）の差としてしか言えない
