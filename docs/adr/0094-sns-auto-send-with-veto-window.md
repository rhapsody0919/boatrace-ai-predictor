# ADR 0094: SNS の全貌 Shorts と X スレッドを、事前通知と止められる期限つきで自動送信する

## ステータス
採用（ユーザー決定 2026-10-12・2026-10-18。docs/design/sns-pdca-loop/spec.md A、plan.md §2〜§4。153 は適用済み、cron `sns-auto-plan`）

## 背景
既存の送信契約（docs/design/sns-hub-x-send・sns-hub-deadline-queue・sns-hub-mobile-approval の contract.md）は、送信を「本人の個別承認」に限り、「過去の承認から自動で queue に入れない」「親子は個別承認」と定めている。`.claude/CLAUDE.md` も SNS 投稿の最終送信を1件ずつのユーザー承認としている。ユーザーは 2026-10-12 に「最初の1週間は1件ずつ承認、その後は機械の検査を通ったものを事前通知し、締切の1時間前までに止められなければ自動で出す」と決めた。

## 決定
- チャネル（X・YouTube）ごとに送信モード（個別承認／自動）を持つ（153 `sns_auto_send_control`）。初期は個別承認・試運転。自動への切り替えはオーナーの1回の操作だけで、条件（実送信5件以上・誤投稿0・要照合の未解決0・止める操作の本番の試験）を満たすまでできない（2026-10-18 ユーザー決定: この条件を置かない。全貌動画は機械の検査と評価役の検査で P0 が0件なら、/today の X 投稿は機械の検査が通れば自動で送る。段階は踏まない。新しい型も自動。事前通知は最小限、止めるのはフラグだけ）（2026-10-20 オーナー決定: 全貌動画も機械の検査だけで判定し、評価役の検査は条件から外した）
- 自動のチャネルでは、検査（禁止表現・龍神側の数値の照合・未認証のリンク先の表示・個別承認の画面と同じ条件）を通り、新しい型でないものだけを、公式締切の3時間前までに Slack へ通知し、通知が届いた後に専用の承認者（`active=false`）で承認する。送るのは締切の60分前（YouTube も60分前に非公開でアップロードを始め、同じ実行で処理の完了を確かめてから公開する。2026-10-13 ユーザー決定）
- 止める操作は「許可のリスト」で効かせる。自動送信の承認者の job は、claim・check・begin_post・youtube_publish_begin のたびに「item が notified・モードが自動・試運転でない」を確かめ、外れたら保留にする
- 既存の契約の「本人の個別承認」はこの ADR の条件でだけ例外にする。各 contract.md にこの ADR への参照を追記する。`.claude/CLAUDE.md` の変更はユーザーが自動モード以外のセッションで行う（docs/design/sns-pdca-loop/rule-change-proposal.md）

## 却下した選択肢
- **期限の経過で自動に切り替える**: 条件を確かめないまま自動に入る
- **承認してから通知する**: 通知が失敗しても job が queue に残って送られる（設計検証の P0）
- **止めるときに job を取り消すだけにする（拒否のリスト）**: claim 済み・送信中の job には効かず、148 のガードで RAISE して止める処理全体が戻る（設計検証の P0）
- **人の承認を残したまま、承認の操作を速くする（スマホの一括承認等）**: ユーザーの決定（止めなければ出す）と違う

## 影響
- 投稿前の人の目視が外れる。新しい型の投稿だけは個別承認を残す（phase2 で新しい型の自律生成を許した理由が人の承認だったため）
- 誤投稿1件、または1週間に「止めた」が3件以上なら個別承認に戻す（spec の運用の段取り）
  - 個別承認の画面は #1645 で撤去し、140 の RPC と表は 163 で削除した。個別承認に戻すときは mode=manual と、drafts の x-send・queue-send（`approve_sns_x_send`）を使う。DB 側の QA・公開証拠の検査（旧 `approve_sns_mobile_channel`）は無くなり、JS の `sendHolds` が担う
- 送信の関数に許可のリストの検査が加わり、transition の分岐が増える。PGlite の verify-sns-* で全経路を固定する

## 追記: 全貌の Shorts は、承認した文と送る文が完全版の URL の分だけ違う（2026-10-20、BOA-912・マイグレーション 172）
- 全貌動画の YouTube は、1レースで完全版と Shorts（入口版）の2件を送る。Shorts の説明文には完全版の URL を入れるが、完全版の URL は完全版を公開するまで決まらない
- そこで「承認した版をそのまま送る」の例外を1つだけ置く。承認するのは、説明文に置き場所 `{full_url}` をちょうど1つ含む文。送る時（upload の直前、承認版のハッシュの照合の後）に、親（`parent_job_id` の完全版の job）の公開済みの動画 ID で `https://youtu.be/<id>` に置き換える（`fillFullUrl`、api/_lib/snsDeadlineQueue.js）
- 違いは URL だけで、置き換えは承認した文と親の external_post_id（complete の後は変わらない、158）から決まる。送った文を別に残す列は持たない
- 待ち合わせは X のスレッドと同じ `parent_job_id`。runner は親が posted でない子を選ばず、DB は claim で parent_not_posted として止める。親の無い `{full_url}` は送る前の検査（unresolved_placeholder）で止める（個別承認の道で置き場所が出ないため）
- 却下: 完全版の公開後に cron が Shorts の文を作って承認する（承認の経路が cron に入り、個別承認のときの扱いが分かれる）。完全版の公開後に作り手が Shorts だけ入れ直す（締切に間に合わない）

## 追記: /today の返信の型は、親と子の2件の item・job になる（2026-10-25、PD02・マイグレーション 174）
- hq の型の列で link_position=reply の日は、/today を本文（親）とリンクだけの返信（子、`source_data.today_reply.parent_draft_id`）の2件にする。子の item は kind=digest・race_id `today:{日付}:reply`。待ち合わせは Shorts・X のスレッドと同じ `parent_job_id`
- 選べるのは自動（mode=auto）の日で、`config/today-variants.json` の `reply_enabled` が true のときだけ（既定は false）。X の投稿が1日1本増え、月の予約を URL つきの額で2本分引く（158 は thread_index=0 を URL つきの額で引き、親の claim で子の分を一緒に引かない）ので、有効にするかは費用の線のオーナーの判断
- 止める操作: 親だけ止めると子は親を待ったまま失効で切れる。子の承認に落ちたら、親と子の item を held_manual にして送らない。返信の型の日に自動でなくなっていたら、作り直しの回に親も子も held_manual にする
- 残る壊れ方（有効にする前に直す）: (1) 予算・日次の上限の際で親だけが通る（親子の対で予約する transition_sns_send_139 の置き換えが要る）、(2) 親の公開の後に一覧の版・欠場が変わると子が source_changed で送れない（子は親の公開の後は版の照合を外す例外が要る）

## 追記: 優勝戦の画像（finals_image）は、止める窓なしで今すぐ送り、期限は締切の5分前（2026-10-26、hq FT02・マイグレーション 176）
- 優勝戦の「展示を見た直前の思考の順」の画像4枚の X 投稿は、展示の後に作るので、締切の60分前に送る・30分前に切れるこの ADR の時刻に収まらない。送る時刻は push の2分後（veto_until＝今、177 で2分遅らせた）、期限は締切の5分前、締切の15分前を過ぎて届いたものは受け取らない（scripts/sns/push-finals-image.js。177 で8分から15分に改め、投票のリプを期限までに送る分を残す）
- 期限の照合（transition_sns_send_139 の expires_at = 締切 − expiry_minutes）は sns_x_send_control の1行の値で全部に効くので、item の kind で分ける（kind=finals_image だけ5分）。snapshot に分数を持たせない（依頼側が自分の期限を決められるため）
- 自動送信の許可は `.claude/CLAUDE.md` の例外（全貌動画・/today）に無い。許可のフラグ `sns_auto_send_control.finals_image_enabled`（x の行、既定 false）を置き、false の間は push が何も書かず、送り手も claim・check・begin_post で held（finals_image_disabled）にする。true にするのはオーナーの yes の後で、`.claude/CLAUDE.md` の例外に足すのはオーナー本人
- 1レース1件: item の variant=finals と 172 の一意の索引（race_id, channel, variant）。同じ優勝戦の全貌（full_picture・x・main）とは両立する
- 残る壊れ方: 送り手（sns-send、2分ごと・リース300秒）の前の実行が長いと、締切の15分前に近い push は期限に間に合わず held（deadline_expired）になり得る。JST 23時台より後の締切は cron が動かず送れない

## 追記: 優勝戦の思考投稿の本投稿へのリプ2つ（投票・展示後）と、リプの子の枠の予約（2026-10-26、hq FT02・マイグレーション 177）
- オーナー 2026-10-26 決定: daily_limit_x=8（全貌4・/today 1・優勝戦3）。2026-10-27 の本番は 9（数字で見たらの分を上げた。182 の読み取り）、思考投稿の後は 11（下の today_thinking の追記）。優勝戦は本投稿（締切の約3時間前、展示前の版）・投票のリプ（本投稿の直後、4択、締切で閉じる）・展示後のリプ（締切の25〜13分前、画像4枚）の3本で、1本ずつ数える。許可は 176 の finals_image_enabled を3本に共通にする（全部か無し）
- 子は本投稿の job を deadline_queue.parent_job_id に持つ（/today の reply・全貌の Shorts と同じ待ち合わせ）。子の item も kind=finals_image で variant（finals_poll・finals_reply）だけを分ける。期限の5分・許可の照合・B 通り道の A の予定の数え・自動の承認者の notified の要求がそのまま効く
- 投票は承認した版に入れる: 下書きの source_data.x_poll（選択肢と締切 closes_at）を snapshot.poll に写し、approve_sns_x_send が下書きとの一致を照合する。X の duration_minutes は送る時に「今から締切までの分（5〜10080）」で決める（承認するのは締切。分は送る時刻から決まる）
- 枠の予約: transition_sns_send_139 は、通り道 B でない X の claim・begin_post で、まだ claim していないリプの子（素材のスレッドでない）を v_need に足す。親は自分の子の分の空きが無ければ claim できない（親だけ送って子が上限で止まる穴、174 の追記の (1) のうち日次の側を塞ぐ）。子でない job は、他の親（今日 claim 済み）の子の枠も取らない。子どうしは先に claim した方が通る
- 残る壊れ方: (1) 枠に余りが無い（8＝予定の本数）。送れなかった試行も1枠使うので、その日に全貌のやり直しがあると本投稿は push の事前検査で落ちる (2) 月の予算の親子の対の予約はまだ無い（174 の追記の (1) のうち予算の側） (3) push（hq の Mac）と送り手（Vercel の cron）は別々にデプロイされるので、許可を入れるのは送り手の本番に 177 の対のコードが入った後だけ（古い送り手は snapshot.poll を無視して本文だけを送る） (4) X の投票の仕様（リプに付けられるか、和文の25字の数え方）は一次の文書で未確認。400 なら begin_post の後なので要照合に残る

## 追記: 「数字で見たら」の集計の画像1枚（research_image）は、レースを持たず、送る時刻から60分の窓で送る（2026-10-27、hq XR01・マイグレーション 179・180）
- X に週3本（月・水・金 19:00）出す集計ランキングの画像1枚の投稿。集計・画像・本文は hq が作り、scripts/sns/push-research-image.js が受け取る（15:00 に作り、送る時刻の予定に入れる）
- レースを持たないので、item の race_id は research:{YYYY-MM-DD}:{slug}（送る日の JST と題の札）。1日1本は 179 の一意の索引 (channel, left(race_id, 19)) で守る（送った後も2本目は入らない）
- 締切は送る時刻＋120分、期限は締切の60分前（送る時刻から60分）。この締切はレースの公式締切ではなく形の上の値（item の CHECK と期限の照合のため）。通知は push の時（15:00）に止める SQL と一緒に送り、3時間前の通知・止める窓は置かない。期限は finals_image と同じく item の kind で分ける（kind=research_image だけ60分）
- 根拠の鮮度は集計の時刻から24時間（kind=research_image だけ）。直近1年の集計なので、他の kind の max_source_age_seconds（本番 14400）を当てると、15:00 に作り 19:00 に送る形で止まるため
- 本文にリンクを置かない型なので、送る直前のリンク先の表示の確認（tasks 10）は無い。代わりに readCurrent が DB の item の kind・許可・同じ日に送ったか・本文（禁止表現・加重280・リンクなし）・画像1枚を読み直し、preflight は送る文にリンクが無いことを確かめる（public_check='none' を返すのは item が research_image のときだけ）
- 自動送信の許可は `.claude/CLAUDE.md` の例外（(1)〜(3)）に無い。許可のフラグ `sns_auto_send_control.research_image_enabled`（x の行、既定 false）を置き、false の間は push が何も書かず、送り手も claim・check・begin_post で held（research_image_disabled）にする。true にするのはオーナーの yes の後で、`.claude/CLAUDE.md` の例外に足すのはオーナー本人

## 追記: X の日の枠を出し物（item の kind）ごとに取り置く（2026-10-27、hq per-type-workflow-review P0-2・マイグレーション 182）
- 取り置きの数は表 `sns_x_kind_reserves`（kind・daily_count・曜日）に置く。正本は hq の config/x-slots.json で、本番の送り手は hq のファイルを読めないので DB に写す。書くのはオーナー、照合は `scripts/sns/x-slots-check.js`（読み取りだけ）
- claim（transition_sns_send_139）は、177 の全体の検査に加えて「他経路 + その出し物の試行と予定 + Σ他の出し物の max(取り置き, 試行と予定) + 必要な本数 ≤ daily_limit_x」を見る（関数 sns_x_slot_room。取り込みも同じ関数で予定に入れる前に確かめる）。先に claim した出し物が、他の出し物の取り置きの残りを使わない。取り置きを越えた分は取り置かれていない残りを早い者勝ちで使う
- 止め方を変える: 取り置きで入らない claim は例外にせず held（error_code=kind_slot_full）にし、runner が Slack に1回知らせる（177 の「日次全体上限です」の例外は残す）。取り置きは後から空かないので、queued のまま2分ごとに知らせ続けない
- 通り道 B と kind=race は取り置きが0なので、取り置かれていない残りだけを使い、無ければ held。子（リプ）にも同じ式を当てる（親の claim が子の分を数え、他の claim は claim 済みの親の子を予定に数える）
- 残る壊れ方: (1) 取り置きの合計＋他経路が上限を越える日は、取り置きの中でも後から来た出し物が止まる（DB では拒まず、取り込みと照合が警告する） (2) 取り置きはその日の締切が過ぎても・許可が off でも解けない (3) 取り込みの確かめは目安で、同時に2本を受けると両方通りうる（正は claim）

## 追記: /today の対象レースの思考投稿（today_thinking）は、優勝戦の思考投稿と同じ型で別の種類にする（2026-10-27、オーナー決定・BOA-1169・マイグレーション 189）
- 本投稿（画像4枚＋本文）・直後の4択の投票のリプ・締切の25〜13分前の展示後の画像4枚のリプの3本。push は scripts/sns/push-finals-image.js（bundle の format は today_thinking_image・today_thinking_reply）。item の kind は today_thinking、variant は thinking・thinking_poll・thinking_reply。時刻の窓・bundle の形・画像・投票は優勝戦と同じ
- 期限は締切の5分前（transition_sns_send_139 の v_expiry_min、優勝戦と同じ）。優勝戦の段は見ず、代わりに race_id がその日の /today の X 投稿の対象（scripts/sns/today-picks.js の featured か list）であることを push の機械の検査に入れる。本文に URL を付けない（3本とも。extractUrls が1つでも返せば拒否。オーナー 2026-10-27）
- 自動送信の許可は `sns_auto_send_control.today_thinking_enabled`（x の行、既定 false）。false の間は push が何も書かず、送り手も claim・check・begin_post で held（today_thinking_disabled）にする。true にするのはオーナーの yes の後で、`.claude/CLAUDE.md` の例外に足すのもその後
- 枠: 取り置き today_thinking 6（2レース×3本）・full_picture 0・daily_limit_x 11（オーナー 2026-10-27）。月水金は取り置きの合計11＝上限で残り0。取り置きは旗が off でも解けないので、行と上限は 189 に入れず、旗 on と同じトランザクションで、その日の最初の X 送信より前にオーナーが当てる
- readCurrent は source_data のキーで振り分けるので、新しい種類は別のキー（today_thinking）にし、枝の中で item の kind も確かめる（食い違えば投げる）
- 残る壊れ方: (1) 全貌の X は取り置き0なので、月水金は送れず、他の曜日は取り置かれていない残りの1本を先に来た出し物と取り合う (2) /today の X 投稿が送れなかった日（held 等）でも、下書きが archived でなければ対象として受け取る

