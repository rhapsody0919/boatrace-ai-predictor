# 引き継ぎ: BOA-822 /step2 から（2026-10-12）

設計レーン（/step1-spec〜/step1-screens・モック承認）を終えた時点の引き継ぎ。次のセッションは `/step2 in-collapse-caution` から始め、/step3 → design-reviewer・acceptance-test-writer → /step4 の順に進める。報告先はオーケストレーター（/orchestrate のセッション）。

## 作業の場所
- ブランチ `docs/boa-822-in-collapse-caution`（Draft PR #1440、docs だけ）。新しいセッションは自分の worktree でこのブランチを取り込んで続けるか、master から新しいブランチを切って docs をこのブランチから持ってくる
- 計測の基準を取る PR #1442（ai_copy・race_share、画面の変更なし）は別に出してあり、オーケストレーターがマージする。GA4 の4件の登録はユーザーに依頼済み

## 読む順
1. [decisions.md](./decisions.md): Q1〜Q3 と案Y・4回目の検証・モック承認の経緯
2. [spec.md](./spec.md): FR-1〜FR-8・統計検証の節・未確定事項
3. [mock/APPROVED.md](./mock/APPROVED.md): 承認範囲（置き場所は案A＝AI予想タブ。推奨の案B ではない）と承認後の食い違い
4. [screens.md](./screens.md): 画面と部品の作り方
5. [architecture-y.md](./architecture-y.md): system-architect の判定（夜の「日×帯」の表 → 朝に RPC で合計、新しいキー `inCaution`、マイグレーション 149〜151、ADR 0090）。番号はオーケストレーターが確保済み
6. [measurement.md](./measurement.md)・[events-share.md](./events-share.md): 計測
7. [today-impact.md](./today-impact.md)・[inventory.md](./inventory.md): 変える箇所の洗い出し
8. 統計: [analysis/round1.md](./analysis/round1.md)〜[round4.md](./analysis/round4.md)（統計の検証は4回で閉じた。plan の段で数字を新しく出す必要が出たら、オーケストレーター経由でユーザーに回す）

## /step2（plan.md）で決めること
- 夜の表の作り方（Python・`features.py` の `race_ok`、ラウンド「準優／優勝戦／それ以外」の列、帯は 1/100 の整数で、端は「−4.0未満」「+3.0以上」）と、ジョブの起動（JST 2:30頃、`analogyDispatch.js` に1行）
- `generate-unified-predictions.js` で `inCaution` を書く処理（1号艇の欠場・勝率なし・2艇以上の欠場は出さない、1艇欠場は残りの艇で出し注記）。段 `level` は生成のときに1つの関数で決める
- RPC 151 の返し方と直接クエリの代わりの経路（`supabaseDataService.js` getRaces）
- 読み手の切り替えの順（画面・/today 150・SNS 企画・ホーム・一覧・AIコピー → 全部切り替えてから旧キーをやめる）
- /accuracy の新しい集計キー（`in_caution_accuracy`）と「公開前の検証」の値の持ち方（round4 の L の段ごとの値をどこに置くか）
- 展開予測の計算を残す理由（利用先）の確定（spec FR-1、second-opinion 指摘9）
- `/races`（日別の展開予測の的中率を外した後に残る中身）と `/accuracy/history` の扱い
- 4言語の i18n キーと、新しい用語の対訳の登録（`docs/reference/i18n-glossary.md`。イン崩れ注意度・勝率差・崩れやすい／中くらい／堅め・段ごとの実績）
- ダークモードの意味トークンへの置き換え（mock-reviews-v1.md）
- ブログ上位2記事（rough-race-signals・first-mark-prediction-guide）と `/about` の書き直しを同じ公開に入れる段取り。残りのブログ・動画13作品・llms.txt は別チケットに起票

## 決まっていること（覆さない）
- 展開予測は画面から全部外し、計算は残す（Q1）
- 平均ST の直近30走への入れ替えはイン崩れ注意度の中だけ（Q2）。注意度では平均ST を主な理由にしない
- 注意度の値は勝率差の帯の全国実績（案Y）。類似レースの割合は注意度の値にしない
- 公開は計測の基準（10/11〜）を7日以上取ってから
- 本番 DB は読み取りだけ。書き込みはオーナーに SQL を渡す（feedback_prod_sql_user_runs_writes_only）

## 別スコープ
- BOA-851（/today の注目レースの取りこぼし）は codex-ok で別に直す
