# データ取得基盤の一本化とデータ整備 オーケストレーション（体制の正本）

対応: [ADR-0066](../../adr/0066-scraping-execution-consolidation-to-vercel.md) / [完了の定義](../../../.claude/rules/data-acquisition.md) / Linear [BOA-353](https://linear.app/boat-ai/issue/BOA-353)（索引のみ。状態の正本は本ファイル）

## 目的と完了条件

全データ取得を、Vercel Functions + Vercel Cronの1基盤に集約し、全データセットが「完了の定義」のA（過去分を含む件数）・B（可変データの取得タイミング）・C（継続監視）を満たした状態にする。完了の判定は、コードのマージではなく、本番DBの実測で行う。

## 体制

- **親（オーケストレーター）**: 計画、依存関係の管理、ゲート判定、マージ承認の窓口。実装は子が担当する。状態の正本は本ファイル（git管理）とし、節目ごとに親が更新する。Linearは索引として使う
- **子**: バックグラウンドAgent（worktree隔離）または別セッション。1つの子には、1つのワークストリームまたは1つのデータセットを割り当てる
- **並列度**: 同時に動かす子は最大2〜3。マージは1件ずつ明示的な承認が必要なため、承認待ちが律速になる。承認依頼はまとめて提示し、順序を添える
- **子への共通ルール**: worktree隔離。完了報告に、完了の定義の実測証拠（クエリと結果）を添付する。devサーバーの停止は自ポートのみ（`pkill -f`禁止）。`preview_start`は使わずBashで自ポート起動しtabIdを明示する。他人のブランチにpushしない。マイグレーション番号は、着手時とPR作成前に`origin/master`の最大番号を確認する（重複はCIで機械検査する。WS6）
- **並行する他セッションとの境界**: 取得系に触れる作業には`.claude/rules/data-acquisition.md`が自動で適用される。追加の通知機構は設けない（worktreeとPRで足りる）

## ベースライン（2026-09-19の実測）

| 項目 | 実測 |
|---|---|
| オッズの窓内取得率（±3分、9/17・9/18の360レース） | 60分前84.7% / 30分前86.7% / 15分前88.1% / 10分前87.8% / 5分前89.4% / 0分前87.2%（欠落率2%基準に未達。「存在判定」ではほぼ100%だった） |
| 取得時刻列 | `race_odds.captured_at`のみ。`exhibition_data`・`race_entries`・`race_start_timings`・`predictions`に無い（`race_conditions`・`race_results`は`created_at`のみ）。展示のタイミングは現状、計測不能 |
| 空テーブル | `racer_series_points` 0件、`racer_profiles.ability_index` 0/1,627件、`race_special_notes` 0件（正常か不明） |
| 履歴 | `races`は2025-12-03〜。結果の充足率は2025-12が93%、2026-03が91%（他月は98〜99.7%） |
| 期別成績との突合 | 自社の出走回数が公式の40〜55%（原因未解明。期間定義の不一致が仮説） |
| 実行基盤 | GitHub Actions・cron-job.org・Vercel Cron未使用の3系統。`morning-init.js`（`races`初期化）がGitHub Actions上の`execSync`・`git log`・`races.json`に依存 |
| Supabase計算リソース | アドオン未選択。警告文のベースラインIOは5MB/s（Nanoの約43Mbpsに相当。Microは87Mbps、Smallは174Mbps）。DBは約629MB（Nanoの推奨500MB超）、メモリは0.5GB。リージョンはap-southeast-2（シドニー）。Nano相当は推定で、ダッシュボードで確認が必要 |
| 書き込みの回転量（2026-01-06のstats reset以降の累積） | predictions: 生存13.5万行に対し挿入140万・更新241万・削除127万。race_entries: 更新168万/26.7万行（6.3倍）。races: 更新44.5万/4.4万行（10倍）。prediction_odds: 更新25.1万/2.3万行（11倍）。racer_aggregated_stats: 更新58.6万/1,639行。race_results.actual_courseのUPDATEが167,072回（WAL 1.3GB、BOA-349） |
| predictionsのWAL | INSERT 1回あたり約190KB（feature_contributions等のTOAST）、DELETE 1回あたり約96KB。累積WAL 25.6GBの約43% |
| 現在の定常IO | 2026-09-19 10:35 JST、120秒計測。WAL 0.125MB/s、ディスク読み出し0.01MB/s（キャッシュ命中率ほぼ100%）。枯渇の原因は定常負荷ではなくバースト（夜間バッチ・バックフィル・大きなスキャン・CI/e2e）と推定（未検証） |

## ワークストリーム

| ID | 内容 | 担当 | 依存 | 完了条件 | 状態 |
|---|---|---|---|---|---|
| WS0 | ADR-0066・完了の定義・本ファイルのマージ | 親 | なし | PRマージ | 進行中 |
| WS1 | データ健全性の実測レポート（`scripts/analysis/`にDBから機械生成。存在充足率（期間×会場）、窓内取得率、月別結果充足率、空テーブル、`scrape-*`の最終成功からの経過時間。取得時刻が無いものは「計測不能」と明示） | Agent | なし | 全データセットのベースラインが再現可能に出力される | 未着手 |
| WS2 | 取得時刻列（`scraped_at`）の追加（`exhibition_data`・`race_entries`・`race_start_timings`ほか）。並走開始の前に実施する | Agent | WS1 | マイグレーション適用、以降の行で取得時刻が入る | 未着手 |
| WS3 | 既存spec（`scraping-full-coverage`・`scraping-serverless-migration`）の統合改訂とADR-0066の補正。`morning-init`・`races`初期化、展示→予測リフレッシュの連動、`scrape-scheduled`の分割、`scrape-results`の所要時間実測、リージョン（hnd1）、並走方式を決める | 親＋ユーザー（設計判断） | WS1 | 統合specの承認（G1） | 未着手 |
| WS4a | 共通Cronラッパ（認証、排他（リース）、冪等、0件エラー、catch-up、リージョン、監視フック）。各データセットの移行より先に、1つの子で作る | Agent | WS3 | ラッパが1データセットで動く | 未着手 |
| WS4b | データセット別の移行（展示・特記事項→純正Cron、`morning-init`、結果、オッズ、レース情報、低頻度ジョブ）。1データセット=1子 | Agent（2〜3並列） | WS4a | 各データセットが完了の定義A/B/Cを満たす（G2） | 未着手 |
| WS5 | 空データ・欠損の解消とバックフィル: `ability_index`初回実行、`racer_series_points`の0件原因、`race_special_notes`の判別、結果欠損（2025-12・2026-03）の原因と補填、`today_weight`のNULL、`series_day`の過去分、期別成績40〜55%の原因調査 | Agent | WS1 | 完了の定義Aを満たす | 未着手 |
| WS6 | マイグレーション台帳と番号衝突のCI検査（実スキーマとの突合、適用状況の記録） | Agent | なし | CIで重複を検知、台帳が実スキーマと一致 | 未着手 |
| WS8 | Supabase Disk IO対策: (a)計算リソース増強の判断（ユーザー判断。Small（約15ドル/月、ベースライン4倍、メモリ2GB）を推奨） (b)変更の無い行を書かない（条件付きupsert。race_entries・races・race_conditions・race_results・prediction_odds・bet_recommendations・exhibition_data。BOA-349を含む） (c)predictionsの再生成方式の見直し（DELETE+INSERTを差分更新へ、feature_contributionsの分離・圧縮） (d)重い読み取りRPCの見直しとキャッシュ（get_predictions_by_dateは平均686ms×4.8万回、predictionsの大きなスキャンは1回あたり30〜43MBを読む） (e)CI/e2e・エージェントの本番DBへの負荷の見積りと抑制 | 親＋ユーザー(a)、Agent(b〜e) | なし（WS1と並行） | ダッシュボードのDisk IO消費が予算内に収まり、e2eのタイムアウトが解消する | 未着手 |
| WS7 | 最終検証と旧基盤（cron-job.org・取得系GitHub Actions）の廃止（G3）。`continue-on-error`の見直しを含む | 親＋Agent | WS4b・WS5 | 全データセットが完了の定義を満たし、旧基盤が停止 | 未着手 |

推奨する着手順: WS1とWS8(a)(b)を最優先で並行 → WS2・WS6・WS5の一部を並列 → WS3 → WS4a → WS4b。

## ゲート

- **G1**: WS1のベースラインが確定し、WS3の統合specが承認されている
- **G2**: 各データセットが完了の定義のA・B・Cを満たしている（実測の証拠つき）
- **G3**: `morning-init`を含む全取得処理がVercelへ移行済みで、旧基盤を止めても本番データが欠けないことを実測で確認している

## 未確認事項（着手前に確認する）

- Supabaseのリージョンはap-southeast-2（シドニー）と確認済み。Vercel Functionsのリージョン（syd1かhnd1）は、DBへの往復とboatrace.jpの取得の遅延を実測して決める
- boatrace.jpのレート制限・IPブロックの閾値
- Vercel Active CPUの課金見込み
- 期別成績との突合で自社の出走回数が公式の40〜55%になる原因
- 結果欠損（2025-12・2026-03）の内訳（バックフィル未了か、中止レースか）
- 展示取得のGitHub Actionsスキップ（2026-09-16〜）以降、展示更新が予測リフレッシュの起動条件に入らなくなった影響（`predictions.predicted_at`は買い目オッズ更新でも更新されるため、この指標では判別不能）
- Disk IO枯渇の主因（バーストの発生源）。ダッシュボードのDisk IO消費の時間帯と、夜間バッチ・バックフィル・CI実行の時刻の突合は未実施
- Supabaseの顧客向けメトリクスAPIは、2026-09-19の試行で504（上流タイムアウト）となり、取得できなかった。Disk IOの自動監視の手段は未確定
