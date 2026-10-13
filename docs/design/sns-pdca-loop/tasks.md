# SNS PDCA ループ: タスク

[spec.md](spec.md)・[screens.md](screens.md)・[plan.md](plan.md) の実装順。1タスク＝1コミット〜1PR。**オーナー**の印はユーザーが行う作業（Claude は本番に書かない）。**待ち**の印はユーザーの回答が要るもの。

L0（実装、paused=true のまま）→ L1（試運転）→ L2（1件ずつ承認7日）→ L3（自動）の関門は spec の「運用の段取り」。

## 実装の順番（2026-10-13 見直し、hq・オーケストレーター経由）

集客の一番の詰まりが「X の送信」と「YouTube・X の数字の取り込み」なので、下の PR の番号の順ではなく次の順で進める。タスクの番号は変えない。

1. **PR-1**（DB 153・154）
2. **送信の接続**: 16 X の OAuth → 17 X adapter → 18 YouTube adapter → 19 cron `sns-send`（dry_run は claim の前で止める）→ 13 止めるリンク・14 管理 API のうち止める・モードの切り替え → 20 費用。既存の個別承認（スマホ承認・本人）の job を、実 adapter で送れるところまで。ここで L1（試運転）に入れる
3. **48h/7d の取り込み**: 21 cron `sns-metrics` → 23 UTM → 22 cron `sns-daily`
4. **素材 v1**: 6・7・8
5. **検査**: 9・10・11
6. **自動承認・事前通知・画面**: 12、14 の残り、15
7. **改善案**: 24・25・25b

## PR-1 DB（153・154）

- [x] **1. 153 の置き換える関数を書く**
  本番の `pg_get_functiondef` を土台に、153 の「置き換える既存の関数」6つ（取り込み・公開保留のトリガー・approve・transition_sns_send_139・transition_sns_x_send のラッパと youtube_call_guard・posted で item を sent にする）を CREATE OR REPLACE で書く。置き換える前の定義を `docs/db-migration/153-runbook.md` に戻し方として保存する。`transition_sns_x_send` は SECURITY DEFINER を維持
- [x] **2. 154 を確定する**（累積値の許容差15分は 2026-10-13 決定）
- [ ] **2b. L0 の前に YouTube の権限を確かめる**: 投稿用の `YOUTUBE_REFRESH_TOKEN`（scope は youtube.upload）で、非公開の動画1本を `videos.update` で公開に切り替えられるか、カスタムサムネイルが 403（チャンネルの電話番号の確認）にならないかを試す。できなければオーナーにトークンの取り直し（`youtube` の scope）か電話番号の確認を頼む
- [x] **3. PGlite の検証を足す**
  既存の `scripts/maintenance/verify-sns-*.js` に足す（新しい verify を作るなら `verify-registry.json` に登録）。最低限の再現テスト: v0 は今までどおり公開できない／v1 は検査合格だけ公開できる／スレッド6件を1つの素材で作れる／6件のスレッドが日次上限で途中で切れない／YouTube の claim は X の月の台帳を消費しない／URL つきの親と子で予約額が違う／同じレースの item は2つ作れない／自動送信の承認者は mode=auto・notified でだけ通る／止めた後の claim・check・begin_post が held になり youtube_publish_begin は拒否される／通知前（notifying）は approve できない／dry_run=true は claim しない／veto_until 前の X・YouTube の claim は進まない（YouTube も60分前にアップロードを始める 2026-10-13 決定に合わせた）／子は親が posted でないと claim しない／`renew_sns_x_send_period` は期間の途中で拒否／`reserve_sns_x_read` は残りの送信分を割るとき false／posted で metric_jobs が2件できる／147 のトリガー `sns_diff_approval` と矛盾しない
- [x] **4. 各 contract.md に ADR 0094 への参照を足す**（x-send・deadline-queue・mobile-approval・shorts-send・metrics）。deadline-queue と shorts-send には「基準日は自動で当日にする」「YouTube は60分前にアップロードし同じ実行で公開」、metrics には「累積値は15分の許容差」も足す
- [ ] **5. オーナー: 153 → 154 を SQL Editor で適用**。事前・事後の読み取りの確認は Claude（plan の system-architect の手順）。APPLIED.md を更新

## PR-2 素材 v1 の取り込み

- [ ] **6. `validateBundle` に v1（x_thread・claims[].source・race_id・screen_key、動画32 MiB）を足す**。v0 の検査は変えない。再現テストは `verify-sns-bundle-import.js`
- [ ] **7. `scripts/sns/push-bundle.js`**（Node、本体の `.env.local`、Storage へ直接・登録の RPC）。`package.json` に `sns:push-bundle`
- [ ] **8. hq 向けの手順書** `docs/operation/sns-pdca-loop-runbook.md`: Codex の出力フォルダ → push-bundle → 結果の見方。Codex に鍵を渡さないことを明記。Codex 向けの v1 の形式の説明も同じ文書に置く

## PR-3 検査（禁止表現・数値の照合・リンク先の表示）

- [ ] **9. 数値の照合** `api/_lib/snsClaimCheck.js`: endpoint の許可リスト、公開 API の読み直し、値の照合。preflight の `readCurrent` からも呼ぶ
- [ ] **10. ヘッドレス** `api/_lib/snsHeadless.js`（playwright-core＋@sparticuz/chromium、ADR 0091）と `scripts/lib/snsScreenMarkers.js`（実画面で印を決める）。関数のサイズを測り、250 MB を超えるなら chromium-min に切り替える
- [ ] **11. 個別承認の画面と同じ条件の検査** を部品にして、mobile-approval と自動の両方から使う

## PR-4 自動承認・事前通知・止める

- [ ] **12. cron `sns-auto-plan`**（5分ごと、JST 8:00〜21:00）: item 作成（締切は races から）。item を作るのは `race_conditions.race_stage` が優勝戦・準優勝戦のレースだけ（L3 ではその日の該当レースをすべて出す、2026-10-13 オーナー決定。L2 は日次上限で1日1レース）→ 検査 → notifying → Slack → notified → approve（スレッドは親から順に）。JST・太平洋時間の日付が変わるたびに基準日を当日にする（2026-10-13 決定）。`registry.js` に稼働時間つきで登録、`vercel.json` に追加
- [ ] **13. 止めるリンク** `api/sns-stop/[token].js`（GET は確認の画面、POST で止める、no-store・no-referrer・noindex）
- [ ] **14. 管理 API** `api/admin/sns-hub/auto-send.js`（一覧・止める・モード・誤投稿の記録、L3 の条件の計算）
- [ ] **15. 画面** `AutoSendPanel`（screens #1〜#4・#10）、`MobileApprovalPanel`・`DeadlineQueueList` の拡張（#5・#6）。375px・ライト／ダークを Playwright で確認。受け入れ E2E（`e2e/acceptance/sns-pdca-loop.spec.js`）を通す

## PR-5 送信

- [ ] **16. X の OAuth（PKCE）** `api/admin/sns-hub/x-oauth/start.js`・`callback.js`、`api/_lib/snsTokenStore.js`（AES-256-GCM、locked_by の条件付き保存、ADR 0093）
- [ ] **17. X adapter** `api/_lib/xApiAdapter.js`（media upload v2・POST /2/tweets・返信）
- [ ] **18. YouTube adapter** `api/_lib/youtubeQueueAdapter.js`（resumable・private、processing・makePublic・lookup、サムネイルの Content-Type）
- [ ] **19. cron `sns-send`**（2分ごと、JST 8:00〜21:00、maxDuration 300）: sweep → 対象の選び方（子は親が posted のもの）→ 既存の run* 関数。dry_run は claim の前で止める
- [ ] **20. 費用**: `reserve_sns_x_read` の呼び出し、期間の終わりの3日前の Slack

## PR-6 取り込み

- [ ] **21. cron `sns-metrics`**（5分ごと）: YouTube の `videos.list` 累積値・X の `GET /2/users/{id}/tweets` を観測の表へ。許容差を超えたら欠測。3回続けて失敗したら Slack
  - [ ] 本番実測: 期待件数（算出根拠: posted の投稿数×2窓、X はスレッドの子を含む）に対し、充足率99%以上であることを実測クエリで確認する
  - [ ] タイミング実測: 土日を含む直近5日で、`posted_at`＋48h／168h から15分以内に取れた割合を実測する（欠落率2%以内）
  - [ ] 継続監視: 上記が日次で自動計測され、閾値超過で Slack 通知されることを確認する
- [ ] **22. cron `sns-daily`**（JST 10:00）: YouTube Analytics の動画ごとの暦日の値と、GA4 の UTM・YouTube 経由の日次を `sns_channel_daily` へ。GA4 の流入元のリストは `scripts/lib/snsGa4.js` に出して分析スクリプトと共用
  - [ ] 本番実測: 期待件数（算出根拠: 日数×（動画数×指標数＋UTM の投稿数×指標数＋チャネル全体の指標数））に対し、充足率99%以上
  - [ ] タイミング実測: 直近5日（土日を含む）で、D−3 の値（確定済み）が入っている割合（欠落率2%以内）。YouTube Analytics の確定の遅れを含めるため D−1 では測らない
  - [ ] 継続監視: 未実行・0件を Slack に通知
- [ ] **23. UTM**: X の親の投稿の URL を承認時に `buildObservationUtm`（campaign=race-full）で作り、`sns_post_tracking` に保存

## PR-7 改善案

- [ ] **24. cron `sns-insights`**（月曜 JST 5:00）: 1週間たった proposed を riskRules で照合して active／retired
- [ ] **25. `scripts/sns/push-insights.js`・`scripts/sns/weekly-export.js`**（`.range()` で読む。統計検証の「守り」の判定を出力に入れる）。`InsightCard` に自動採用までの日数（screens #8・#9）
- [ ] **25b. `weekly-export.js --knowledge`**（2026-10-13 オーナー方針）: チャネルごとに、採用した1点とその結果（48h・7d の中央値と本数、採用前4週との比較）を `docs/knowledge/x.md`・`youtube.md` に1行ずつ書き出す（plan §6 B5）。insight の id で冪等、7d がそろった案だけ。再現テスト: 同じ入力で2回実行して行が増えない／7d がそろわない案は書かない／本数・欠測を省かない。hq が週1で走らせ docs だけの PR にする手順を `docs/operation/sns-pdca-loop-runbook.md`（tasks 8）に書く

## 運用の段取り（実装の後）

- [ ] **26. オーナー: 鍵を Vercel に登録**（`YOUTUBE_ANALYTICS_*`、`GOOGLE_SERVICE_ACCOUNT_KEY`、`SNS_TOKEN_ENC_KEY`、`X_OAUTH_CLIENT_ID`・`X_OAUTH_CLIENT_SECRET`）と、X の Developer Console のコールバック URL・spending limit（月額上限は $10、2026-10-12 決定）。手順は Claude がオーケストレーターに渡す
- [ ] **27. オーナー: 本番 SQL で送信の設定**（L2・L3 の日次上限と月の上限額は 153-runbook.md「L2・L3 の送信の設定」。L3 の月の上限額は $10 では足りない（見込み 月 $77、予約で $111、案 $120）。`renew_sns_x_send_period`、`attempt_ceiling_microusd`、`daily_limit`、`schedule_minutes=60`・`timing_approved=true`、`max_source_age_seconds=14400`、YouTube のクォータの上限・verified）。管理画面から「X と連携する」
- [ ] **28. L1 試運転**（1〜2日、dry_run=true）: 保留の理由を全件確認。`sns_auto_send_control.dry_run=false` はオーナー
- [ ] **29. L2**（7日）: paused=false。機械の検査とオーナーの判断の一致を記録
- [ ] **29b. 受け入れ E2E**（`e2e/acceptance/sns-pdca-loop.spec.js`）を、直した spec・screens で書き直させる（acceptance-test-writer）
- [ ] **30. オーナー: `.claude/CLAUDE.md` の変更**（[rule-change-proposal.md](rule-change-proposal.md)、自動モード以外のセッション）
- [ ] **31. L3**: 条件（止める操作の本番の試験を除く）を満たしたらオーナーが「自動にする」。初日の最初の1件で、止めるリンクと「自動を切る」を本番で試して `stop_tested_at` を記録する（L2 は個別承認なので、止める操作は L3 に入るまで試せない）
- [ ] **32. 統計検証のやり直し**: 再開から4週後に X の48h の指標のばらつきで必要件数を出し直す（`scripts/analysis/sns-pdca-baseline/`）。ソナー利用の基準値も4週分で出し直す
