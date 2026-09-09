# 企画型SNS投稿パイプライン タスク分解

依存順に並べる。各タスクは目安として1コミット〜1PRで完結する粒度。

**2026-09-08追記（方針変更）**: パイロット企画のバックテスト（`scripts/analysis/campaign-backtest-*.js`、
463レース・3週間分の実データ検証）の結果、当初想定していた「AI用コピペプロンプトを人間がAIに貼り付けて
回答を得る」運用は、実際のAI都度判断の回収率が決定的な計算式モデルより明確に劣ることが判明した
（27.2% vs 94.3%〜130.5%）。そのためタスク3・4（`buildRows()`のexport・`campaignPromptBuilder.js`）は
実施せず、代わりに`scripts/lib/campaignVolatilityModel.js`（出走表×展開予測・1号艇除外の決定的モデル）で
買い目生成を自動化する方針に変更した。詳細はPR #594参照。

- [x] **1. マイグレーション適用**: `docs/db-migration/054_sns_campaigns_schema.sql`をSupabase Dashboardで適用済み（2026-09-08）。既存の型ベースパイプラインへの影響なしを確認

- [x] **2. `scripts/lib/snsCampaigns.js`新設**: `getActiveCampaigns()`・`getCampaign()`・`createCampaign()`・`findQualifyingRaces()`・`createCampaignEntryWithTopic()`・`getCampaignEntries()`・`backfillEntryResult()`を実装（PR #594）

- [x] ~~3. `useAiCopyText.js`の`buildRows()`をexportする~~: 実施せず（方針変更）。ただしUI機能としての「イン崩れ狙い」プロンプト種別は別途PR #594で追加済み（企画の買い目生成には使わない、ユーザー向け機能として独立）

- [x] ~~4. `scripts/lib/campaignPromptBuilder.js`新設~~: 実施せず（方針変更）。代わりに`scripts/lib/campaignVolatilityModel.js`を実装（PR #594）

- [x] **5. `scripts/maintenance/create-campaign.js`新設**: 実装・実行済み（PR #594）。パイロット企画は引数無しCLIとして実装（JSON引数化はせず、決め打ちの値を直接記述。将来2つ目の企画を作る際にパラメータ化を検討）

- [x] **6. `docs/operation/sns-campaign-entry-detection.md`新設**（フェーズA運用手順書）: 本ファイルで作成（実装は`campaignVolatilityModel.js`ベースに変更済み）

- [x] **7. `docs/operation/sns-campaign-result-backfill.md`新設**（フェーズB運用手順書）: 本ファイルで作成

- [x] **8. チャネル別パイプライン文書へのcampaign_id分岐追記**: `sns-pipeline-x.md`の「2. ネタ本文・根拠insightの確認」に追記済み。tiktok/youtube/blogの同節は元々「x.mdの2.と同じ」参照のため自動的に反映される。noteは本文をブログから変換する構成のため、ブログ側で反映済みである旨を明記した

- [x] **8.5. Phase Bで結果発表・最終まとめ投稿のネタも作成する**（tasks.md新設、実装中に判明した設計漏れ）: 当初のPhase B実装は`sns_campaign_entries`のDB更新のみで、運用フロー③（結果発表）④（企画終了まとめ）用の`sns_topics`を作っていなかった。`scripts/lib/snsCampaigns.js`に`createResultAnnouncementTopic()`を追加し、`campaign-backfill-results.js`が結果確定時に③のネタを、企画期間経過・全エントリ確定時に④のネタを作成し企画を`completed`にするよう実装した

- [x] **9. `finalize-blog-draft.js`に企画ガードを追加**: `campaign_id`を持つ下書きは機械チェックによる自動マージの対象外とし、常に`pending_review`のまま人間承認に回るようにした（PR #594）

- [x] **10. パイロット企画の作成**: 実行済み（2026-09-08、企画ID `00263d28-3856-4bf9-b375-bb71f3d0889e`、`status='active'`）。`selection_criteria`: volatilityPercentile≥0.99、`purchase_amount_yen`: 900、対象チャネル: x/blog、TikTok対象外

- [x] **11. フェーズAの初回実行・動作確認**: 実施済み（2026-09-08）。試験実行で「結果確定済みレースを誤って登録しかける」不具合を発見・修正（`getRaceIdsWithResults()`必須チェック追加）。**本物の初回エントリはまだ無い**（次回のcron/朝実行で作成される想定）

- [x] **12. フェーズBの初回実行・動作確認**: 実施済み（2026-09-09、タスク19の修正後の動作確認として実行）。1件目（びわこ2R）の結果は実際の着順2-1-6、買い目（3-2-4/3-4-2/2-3-4）不的中、通算収支-900円。結果書き戻し・結果発表ネタ作成とも正しく動作した

- [ ] **13. チャネル別下書き生成の初回確認**: タスク8の分岐が実際に機能し、2件目以降のエントリで前回の結果を踏まえた本文が生成されることを確認する（1件目のみでは検証できないため、最低2エントリ分の実行後に確認する）

- [x] **14. X向け投稿カードの実装**（2026-09-09新設）: 「各チャネルの動画・投稿仕様」のうちXを実装。ユーザーとモックアップで合意した仕様（テキスト+静止画像2枚、内部スコアは見せず分析ツールの実データのみ提示）に基づき`sns-video-studio/remotion/src/CampaignEntryCard.jsx`（買い目・収支カード）・`CampaignDataExcerptCard.jsx`（データ出走表・展開予測抜粋カード）・`scripts/lib/contentChannels/renderCampaignCard.js`（レンダリングラッパー）を実装。`sns-pipeline-x.md`に「3'. 企画由来ネタの画像生成」を追加し、`docs/reference/brand-kit.md`に採用実例を追記した。実際のバックテストデータでの静止画レンダリングを確認済み

- [x] **15. ブログ向け「日記型記事・逐次更新」の実装**（2026-09-09）: `sns-pipeline-blog.md`に「3'. 企画由来ネタの本文執筆（日記型記事の追記）」を追加。ファイル名は`sns_campaigns.tone_spec.blogSlug`で企画作成時に決め打ち（既存パイロット企画にも追記済み: `campaign-ai-900yen-inkuzure-week`）。1日目は新規記事、2日目以降は既存ファイルへの追記PRにする設計。事前発表ネタ（②）はブログでは日記化せず結果確定後にまとめて書く方針も明記

- [x] **16. target_channelsが実際の配信対象フィルタに使われていなかった不具合を修正**（2026-09-09、実装中に発見）: Phase A/Bの`createCampaignEntryWithTopic`/`createResultAnnouncementTopic`が`targetAccountIds`を指定せず、`sns_campaigns.target_channels`（x/blogのみ）に関わらず全チャネル（tiktok/youtube/note含む）に配信対象を作ってしまっていた。`getTargetAccountIdsForChannels()`を追加し、必ず`campaign.target_channels`で絞り込むよう修正した

- [x] **17. Xカードv4〜v5デザイン改善・ダウンロード不具合修正**（2026-09-09、PR #601/#602）: 実際に生成した1件目の投稿を見た指摘（ゴールド不足・余白・ダウンロード不可・発走時刻欠落・CTA見切れ）を受け、`CampaignEntryCard.jsx`/`CampaignDataExcerptCard.jsx`を全面改訂。キャンバスも16:9横型（1200x675）→4:5縦型（1080x1350、スマホ閲覧が主のため）に変更。sns-hub側の画像ダウンロード不具合（`source_data.dataCardPath`未署名、`PostingActionLinks`が画像ダウンロード未対応）も修正

- [x] **18. Phase A/B・1日のまとめの自動化**（2026-09-09）: `.github/workflows/campaign-pipeline.yml`を新設し、`campaign-detect-and-generate.js`（Phase A）・`campaign-backfill-results.js`（Phase B）をJST 6:00-23:59の間30分おきに自動実行するようにした。新規`scripts/daily/campaign-daily-summary.js`＋`createDailySummaryTopic()`（`snsCampaigns.js`）で「1日のまとめ」投稿（ナイター終了後21:30 JST）を追加。下書き（X画像・ブログ記事）の生成自体は既存のsns-topic-gate基盤（チャネル別生成Routineの自律ポーリング）がそのまま担うため追加実装不要と判明（実際にパイロット企画1件目の下書きも`x-pipeline-*`識別子で既に自動生成されていたことを確認）。実装の過程で2件の見落としを発見・修正した: ①PR #599（`findQualifyingRaces`のUTC/JST境界バグ修正・`autoApproveTopics`実装）が作成済みのままマージされずmasterに未反映だったため本タスクの前提としてマージ、②`campaign-detect-and-generate.js`の日付引数省略時のデフォルト値が`toISOString()`（UTC基準）のままで、JST 0-9時台の自動実行で前日日付になる同種のバグが呼び出し元に残っていたため`getTodayDateJST()`に修正

- [x] **19. 天才エンジニアレビューを受けた堅牢性・拡張性の修正**（2026-09-09）: タスク18の自動化コードを依存関係・堅牢性・拡張性・観測性の観点でレビューし、指摘5点すべてに対応した。
  - **企画・エントリ単位のエラー分離**: `campaign-detect-and-generate.js`・`campaign-backfill-results.js`の企画ループが無防備で、1企画（または1エントリ）の例外が他の企画・エントリの処理まで巻き込んで止める構造だった。企画単位（両ファイル）・エントリ単位（backfill側）でtry/catchを追加し、失敗時は`process.exitCode = 1`でCI側の失敗検知につなげるよう分離した
  - **ワークフローの多重実行対策**: `campaign-pipeline.yml`に`concurrency`グループを追加（`scrape-scheduled.yml`に倣う）。また「1日のまとめ」のcronが通常サイクルの`*/30`と同時刻（21:30）にマッチし2つのワークフロー実行が同時に走っていたため、21:45にずらして重複を解消した
  - **複合条件（selection_criteria）への対応**: `findQualifyingRaces()`が単一メトリクスの比較にしか対応しておらず、将来「イン崩れ99%以上 かつ SG戦のみ」等の複合条件を持つ企画を作れなかった。配列（AND結合）も受け付けるよう拡張（既存の単一条件企画は後方互換で挙動不変）
  - **下書き生成Routineの停止を検知する仕組み**: 下書き生成は本リポジトリ外の生成Routineに全面依存しており、その稼働を直接監視する手段が無かった。`scripts/maintenance/content-ops-checks/check-campaign-draft-lag.js`を新設し、承認済みネタなのに3時間以上下書きが作られていないものを症状ベースで検知、`session-start-check.js`の13番目のチェック項目として追加した
  - **失敗時のSlack通知**: `campaign-pipeline.yml`に`content-ops-nightly-check.yml`と同じ`SLACK_WEBHOOK_URL`経路での失敗通知ステップを追加した
  - **既知の残課題**（今回は対応見送り）: `campaign-backfill-results.js`で1エントリの結果書き戻し（`backfillEntryResult`）自体は成功したが後続の結果発表ネタ作成（`createResultAnnouncementTopic`）が失敗した場合、そのエントリは次回実行時に`actual_result`が既に埋まっているため「結果未確定」の再試行対象から外れ、結果発表ネタだけが永久に作られなくなる。発生頻度は低い（一時的なDBエラー等）上、Slack通知で人間が気づいて手動でネタを作成できるため、書き戻しとネタ作成の順序入れ替え等の抜本対応は見送った

- [x] **20. 選定閾値をUI表示値に合わせて0.985に調整**（2026-09-09、稼働中に発見・対応）: ホーム画面（`TodaysVolatilityHighlights.jsx`）が`Math.round(値×100)`で四捨五入して「99%」と表示する一方、`selection_criteria.value`は生の値0.99だったため、実値98.8%（表示は「99%」）のレースが対象外になる食い違いをユーザーが発見。「UI表示で99%に見えるレースは対象に含めるべき」との判断で閾値を0.985（四捨五入で99%になる下限）に変更した（DBを直接更新、`scripts/maintenance/create-campaign.js`も追随）。透明性企画の趣旨上、条件緩和の経緯を`spec.md`に明記し、キャプション文言も「99%以上」→「99%（表示値）以上」に統一した（`sns-pipeline-x.md`）。変更直後にPhase Aを再実行し、当日の桐生2R（実値98.8%）を実際に新規エントリとして捕捉できることを確認済み
