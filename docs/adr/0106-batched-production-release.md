# ADR-0106: 本番のデプロイを1日3回の定時にまとめて出す

## 状況

- Vercel の費用が PT 2026-11-03〜05 で平均 $13.8/日。内訳は Build CPU $8.5・Function Storage $1.9・Deployment Storage $1.7（Vercel の請求、`list_billing_charges`）。hq の合格線は「1日 $5 以下を3日、本番デプロイ 1日3回以下」
- master への push は約59本/日（人・Claude の PR 22・Codex の PR 14・機械生成の文書 16・台帳・録画・sitemap 4・hq の記事と data 3）。push ごとに本番がビルドされ、READY は約55本/日（2026-11-04 00:00Z〜11-06 02:21Z の131本のうち115本）
- 機械生成の文書（docs/ だけ）のコミットも READY になる。同じ枝の同時ビルドを1本にしたため直前の PR のビルドが CANCELED になり、`VERCEL_GIT_PREVIOUS_SHA` が古いまま diff にその PR が入るため。Ignored Build Step（BOA-908）は正しく動いているが、push ごとのビルドの本数そのものは減らせない
- オーナー 2026-11-06 決定: 「本番のデプロイは master への push ごとではなく、まとめて出す」

## 決定

1. master の push ごとの本番デプロイを止める（vercel.json の `git.deploymentEnabled` に `"master": false`）。Production Branch は master のまま
2. Vercel Cron `/api/cron/release-dispatch`（UTC `45 2,8,20 * * *` = JST 05:45・11:45・17:45）が出す（`scripts/lib/releaseDispatch.js`）。20分後（UTC `5 3,9,21 * * *`。同じパスで、UTC の分が30より前の起動を拾い直しとみる）は、定時が「待つ」で終わったときだけ判定し直す拾い直し
   - 今の本番の版（関数の `VERCEL_GIT_COMMIT_SHA`）と、読んだ master の先の sha を GitHub の compare API で比べる。差分が無い・サイトに関係ないものだけ（`isSiteIrrelevant`、BOA-908 と同じ判定）・files が空なら何もしない
   - master の検査（Post-merge Checks・Quality Gates）は、出す範囲（本番の版の次〜master の先）のコミットの run で見る（[automated] の push で skipped になった run は除く）。範囲の中で走っている run が1本でもある・master の先が10分以内のコミットなら「待つ」。範囲の中で落ちた run は、落ちた step ごとに、後の run で同じ step が走って通っていれば直ったとみる。quality-gates の ml-tests の pytest は push の差分で走るかが決まるので、後の run の成功だけでは直ったとみない（Codex の審査 P1）。直っていない step が残る（cancelled・timed_out を含む）・jobs を読めない・読んだ run が範囲の一番古いコミットまで届かない（1ページ100本を3ページまで。compare の commits が250件で足りないときも）なら出さず Slack に出す。この検査の読み方は審査で4回指摘された（[automated] の skipped・走っている run・push の差分で走る step・読む本数）。原因は「run の成功が範囲全体の合格を意味しない」ことで、上の決まりに固定した
   - それ以外なら Deploy Hook（master に結び付けたもの。Vercel の環境変数 `RELEASE_DEPLOY_HOOK_URL`）を叩く。Hook は受け付けた時点の master の先をビルドするので、判定の後の数秒に入ったコミットは検査を待たずに出る（許容）
   - 前回叩いたのに本番の版が動いていなければ、叩かずに Slack に出し続ける。ビルドの失敗と、出た後の Instant Rollback（A→B を出した後に A へ戻した）は本番の版だけでは区別できないため（Codex の審査 P1）。Vercel で確かめ、直したら手で出す。本番の版が動けば自動に戻る
   - 本番の版が前に出した版より古い（Instant Rollback）なら出さずに Slack に出し続ける。巻き戻した本番に壊れた master を黙って出し直さない。master を直して手で出すか、mode を off にする
   - 出すべき差分が13時間を過ぎて残る（shadow のまま・待つが続く）なら `last_report.alerts` で知らせる。cron 自身の死活は scrape-monitor がレジストリの `livenessStaleMin`（13時間、shadow・live の間）で見る
   - モードのゲート（`scrape_job_state.mode` の job=`release_dispatch`）。行が無い間は off。shadow は叩かず、叩くはずだったかだけを残す。off にすると何も知らせないので、止めるのは切り替えを戻すとき（下の「切り替えの順」の戻し方）と Instant Rollback の後だけ
3. 時刻の理由: 05:45 は朝の SNS（7:00〜）の前に前日の夜までのマージを出す。11:45 は朝のマージ（JST 6〜10時に多い、hq の記事は10時）を出す。17:45 は午後のマージ（15〜17時に多い）を夜の SNS（21:30）の前に出す。ビルドに約7分かかる。GitHub の schedule は数時間遅れる（update-sitemap の 14:30 UTC が 18:39〜22:49 UTC に来た、bot-html-parity の 03:00 UTC が 08:28〜10:15 UTC）ので使わない
4. 手で出す（障害の修正で次の定時まで待てないとき）: オーナーが Vercel の Settings > Git > Deploy Hooks の `release` の URL を叩くか、Deployments で master の最新から Create Deployment する。全体が壊れたときの第一手は Instant Rollback。手で出した回は「1日3回の線の外」として報告に書く。手で出した後に新しいマージが無ければ、次の定時は差分が無く何もしない

## 選ばなかった案

- 専用の枝 `production` を Production Branch にして GitHub Actions が早送りする: .github/workflows を変えたコミットを含む早送りは、GitHub App のトークンに Workflows: write が要る。ryujin-bot（master-guard の bypass が always）にそれを足すと ADR-0097 の身元の分け方が崩れる。production の枝を守る ruleset も別に要る（system-architect の審査 2026-11-06 の P1-1・P1-2）
- タグ: Vercel はタグを本番に出さない
- ignoreCommand で [automated] だけ飛ばす: 機械生成の文書のビルドは直前の PR のビルドの代わりなので、飛ばしても本数はほぼ減らない（上の「状況」）
- Preview で作って手で昇格する: push ごとのビルドが残るので費用が減らない

## 切り替えの順（どの時点でマージしても壊れない）

1. PR 1（定時の起動・判定・文書）をマージ。今までどおり push ごとに本番に出るので、cron も本番に入る。行が無いのでモードは off（何もしない）
2. オーナー: Deploy Hook を作り、`RELEASE_DEPLOY_HOOK_URL` を Vercel の Production の環境変数に入れ、`release_dispatch` を shadow にする（PR 1 の本文の手順）。shadow の間は叩かない
3. PR 2（`"master": false` の1行）をマージし、同じ時にモードを live にする。PR 2 のコミット自体は本番に出ないが、vercel.json はサイトに関わるので次の定時で出る
   - PR 2 だけを先にマージすると本番が止まったままになり、何も知らせない。PR 2 は 2 が済むまでマージしない

## 古い版が最大約12時間動くことの決まり

- マイグレーション: master に入った SQL が本番のコードより先に当たりうる。足すだけのものは先に当ててよい。今の本番のコードで壊れるもの（列・関数を消す・名前を変える、RPC の出力のキーを変える）は、それを要らなくするコードが定時で出た後に当てる（expand → 定時で出す → contract）。db-apply の DRY_RUN（db-apply.yml）を外す前に、マイグレーションごとの before-code / after-code の印と、本番の版にコードが入っているかの関門を入れる
- SNS: hq の作り手は master のコードで、送り手（sns-send 等の cron）は出ている版で動く。新しい型の `sns_auto_send_control.<型>_enabled` を入れるのは定時で出た後
- cron: vercel.json の crons の追加・時刻の変更は次の定時から効く
- 「本番に出たか」は枝の先ではなく出ている版の sha で見る（Vercel の関数の中なら `VERCEL_GIT_COMMIT_SHA`、外からは GitHub の deployment の environment `Production`）

## 結果の見込み

- 本番のデプロイ: 最大3回/日（差分が無い・サイトに関係ない・master が赤い枠は0）。手で出した日は4回になりうる
- 費用（推測。本番と Preview の Build CPU の内訳は測っていない）: 本番のビルドが約55→3本/日になる。Preview も約47本/日（READY 8割）あり、同じ Build CPU に入る。Deployment・Function Storage は保存のデプロイの本数に比べて減るとみて、保存の7日を過ぎた後に $6〜8/日。$5 の線には Preview の削減が別に要る見込み
