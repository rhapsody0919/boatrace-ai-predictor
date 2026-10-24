# 定時実行・キャッシュ・Vercel・CI と E2E の落とし穴

バッチ・Cron・API のキャッシュ・Vercel の運用と、CI・E2E で踏みやすい落とし穴。本番 DB の書き込みは [db-operations.md](db-operations.md)。検証の置き場所の決まりは AGENTS.md「検証・テスト」。主に system-architect と実装者が読む。書き方は [README.md](README.md)。

## 定時実行・バッチ
- 定時のジョブは、定時の実行の成功を見てから完了とする。手動で作った分の時刻が偶然条件を満たし、定時では一度も成功しないまま完了扱いになった例がある（2026-09-25、memory morning_data_digest_2026_09_25、BOA-402）
- GitHub Actions の定時実行は実測で2.5〜4.5時間遅れることが多い。時刻が大事な取得・集計は Vercel Cron に置く（2026-09-25、memory morning_data_digest_2026_09_25、ADR-0066）
- scrape_job_state の mode が off でも、kind が monitor のジョブ（scrape-monitor・scrape-cleanup）は5分ごとに動く。last_report は10分ごとに上書きされるので過去の判断の証拠に使えない（2026-09-28、memory project_data_foundation_orchestration_2026_09_19、PR #874）
- Routine を起動する Vercel の環境変数（*_FIRE_URL・*_FIRE_TOKEN）が未設定でも、fireRoutine は {fired:false, reason:"not_configured"} を返して黙って飛ばす。送られていないのにエラーにならない（2026-09-24、memory claude_account_migration_runbook、api/_lib/snsHubHelpers.js）

## API のキャッシュ
- 日次バッチの表（accuracy_cache・race_history_cache・outcome_distribution）の API は s-maxage=86400・stale-while-revalidate=3600、本日の races は s-maxage=300・stale-while-revalidate=60。短くすると Supabase の egress が増える。変える前に scripts/verification/verify-cache-config.js を通す。正本は docs/reference/cache-strategy.md（2026-05-28 に短くして戻した、memory cache_strategy_critical）

## Vercel
- 新しいデプロイが失敗すると前回成功した版を配り続ける。1日に多数マージするとビルド回数の上限（retry in 24 hours）に当たり、その間のマージは本番に出ない（2026-09-12 は10時間以上・6PR が未反映）。急がない複数マージは日を分ける（2026-09-12、memory ai_crawler_snapshot_2026_09_01。今のプランの上限は要確認）
- vercel env rm <名前> preview は Production と共有している変数ごと消す（本番から13個消えた例）。Preview だけ外すときは共有かを先に確かめる（2026-10-06、memory project_ai_multi_venture_ops_2026_10_05）
- Supabase は Pro で日次のバックアップは7日分。Storage（ML モデルのバケット等）はバックアップの対象外（2026-10-06、memory project_ai_multi_venture_ops_2026_10_05、要確認）

## CI・検証
- Vite の npm run build は api/ を束ねないので、ビルドが通っても api の import が解決する根拠にならない。存在しないパスの import は verify-relative-imports.js だけが検出した（2026-10-08、memory feedback_codex_patch_intake_checklist、PR #1316）
- scripts/tests/ 等に置いたテストは CI から呼ばれない。scripts/maintenance/verify-*.js に置き verify-registry.json に登録する（2026-10-08、memory feedback_codex_patch_intake_checklist）
- 画面で setError(e.message) と書くと BOA-668 の検査で落ちる（errorMessageOf を使う）（2026-10-08、memory feedback_codex_patch_intake_checklist）
- master には整形していないファイルがあるので、既存ファイル全体に prettier --write をかけると差分が膨らむ。新しいファイルと自分の書いた範囲だけにする（2026-10-03、memory feedback_reset_soft_onto_moved_master、PR #1208）
- verify-*.js で「実タイマーで観測した間隔が N ms 以上」を assert すると CI の負荷で落ちる。仮想の時計（verify-boatcast-job.js の createVirtualClock）で判定する。変異のファイルを ?t=Date.now() で読み分けると ESM キャッシュで前の変異が返るので、通し番号のファイル名にする（2026-10-02、memory technical_ci_flake_real_timer_gap_assertions、BOA-648）
- 後続の修正 PR の点検は、先行指摘の ID と対象差分を明記し、静的に解消・継続・実行未判定を分ける。修正 PR の存在だけで修正成功や承認の運用適用を認定しない（2026-10-13、2026-10-13-plan-1623.md・2026-10-13-plan-1829.md）
- 点検の依頼を選ぶときは、PR 番号だけでなく変更対象の機能名と既存の点検成果物も照合し、同じ点検を再度積まない（2026-10-13、2026-10-13-plan-2033.md）
- 後続 PR で部品が接続されても、実行環境での受入（Chromium 起動・未ログイン表示等）や別の関門は別に追う。以前の「未接続」を現状へ転記せず、接続の commit と残る関門を記録する（2026-10-13、2026-10-13-plan-2137.md・2026-10-13-plan-2234.md）
- 同じ依頼の再点検でも、知見の索引・話題数・写しの一致は再確認する。古い一致申告を現在の資料の証拠にしない（2026-10-13、2026-10-13-plan-review-20261013-15.md）
- パッチ点検の合格は、フォルダ名・自由文ではなく patch hash・base・tree に結び付け、同名の改訂版は再点検する（提案、未導入）（2026-10-16、2026-10-16-codex-direct-pr-design.md）
- 新しい verify の登録（verify-registry.json）が要る変更は、台帳変更を禁じる経路だけでは完結しない（2026-10-16、2026-10-16-codex-direct-pr-design.md）
- パッチの未登録指摘は、取り込み後の台帳→集約ランナー→通常 workflow まで追う。3-way 取り込みで blob が元パッチと違っても、親差分と先行変更の保持を確認してから判定する（2026-10-14、2026-10-14-plan-review-20261014-08.md）
- 並行パッチの統合後に片方のテストが見つからないときは、親 SHA にも無かったかで未取り込みと統合時の削除を区別する（2026-10-15、2026-10-15-plan-review-20261015-12.md）
- PR ゲートの E2E（e2e-smoke-test）は HAR 再生・3台分割。直接 PR の前段の機械 E2E は CI の代替にならない（2026-10-17、2026-10-17-codex-direct-pr-design-v2.md）
- テスト名・assert・mock の合格を実際の範囲より広く読まない。通知失敗の検査名は reject 通知の実行を保証せず、MP4 シグネチャだけを書く ffmpeg の注入 mock は実動画の寸法・尺・音を保証しない（2026-10-13、2026-10-13-plan-review-20261013-09.md・2026-10-13-plan-review-20261013-15.md）
- 録画ポインタの tests/skipped は録画時点の件数で、新規 PR の収集・成功を証明しない。ローカル public/data への fetch も録画対象 API とは別（2026-10-15、2026-10-15-plan-review-20261015-01.md）
- 版 hash の順序非依存は ID の一意性まで確認する。値変化の検証は、同一入力集合で値だけを変えて行う（claims 集合を減らす assert は値変化の検証ではない）（2026-10-13、2026-10-13-plan-review-20261013-32.md）
- generate-ai-snapshots.js は Chromium が起動できなくても例外を捕捉して build を続ける。npm run build の exit 0 とブラウザ生成の成功は別。Vite の成功と後続のブラウザ・スナップショットの成功も分ける（2026-10-13、2026-10-13-boa-873.md・2026-10-13-boa-875.md）
- build で使う Chromium 起動ヘルパーを API で共用しても、build の実績や mock CI は API の Node 版・bin 収録・関数サイズ/メモリを証明しない。lock の engine 条件と実配備を別に確認する（2026-10-13、2026-10-13-plan-review-20261013-33.md）
- runtime 属性の存在検査と、Node 上で handler(Request) を直接呼ぶ検査の通過は、Vercel で同じ呼出し規約になる証拠にならない（2026-10-13、2026-10-13-plan-review-20261013-11.md）
- レイアウト E2E は固定幅の実行配線と境界直前の測定を分ける（1024px の切替に対し 375/768/1024/1440/1920 では 1023px 直前を測らない）。spec 内の viewport 上書きで実幅が変わるので、CI の実行枠数と独立した画面幅の数も分ける（2026-10-15、2026-10-15-plan-review-20261015-05.md・2026-10-16-review-20261016-01.md）
- テスト置換では、期待値の更新と、旧ループから境界幅が消えていないかを別に確認する（2026-10-16、2026-10-16-review-20261016-05.md）
- レイアウト再現用 DOM の置換と測定に別々の await を挟むと、間の再描画で条件が変わる。同期の1回の evaluate で置換・測定する（2026-10-13、2026-10-13-plan-review-20261013-19.md）
- 棒のレイアウト検査は外枠 track と内側 fill を区別する。内側 fill の width transition だけを根拠に外枠測定へ待機を足さない。時計の Date 固定はタイマー・アニメーションの停止ではない（2026-10-13、2026-10-13-plan-review-20261013-19.md）
- 全領域共通のセレクターで検査すると、比較表や着順に全艇があるだけで条件付き領域の欠落を見逃す。固定 UI の検査は各領域の存在と検査到達を明示する（2026-10-14、2026-10-14-plan-review-20261014-07.md）
- 保存期限を持つ UI の受入は、録画時計・保存時刻・レース締切を一緒に固定する。30日超の Entry を注入して表示を期待すると、仕様どおりの期限削除でテストが落ちる（2026-10-13、2026-10-13-plan-review-20261013-16.md）
- URL を切り替えて複数要素を撮影する変更は、一覧入口の inspect 成功と各撮影先の最終 URL・対象 ID の一致を分ける。要求行のラベルを図へ挿入しても、誤遷移先の内容は検出できない（2026-10-16、2026-10-16-review-20261016-07.md）
- 取得間隔は各 headless コンテキスト内だけでは、並行コンテキストの合算を保証しない。公開撮影はコンテキストの起動も順次にし、初回で必要な応答・領域画像を保存する（2026-10-13、2026-10-13-venue-20261013-05-edogawa.md）
- 日本語の欠字検査で別文字列の黒画素総数を比べると、文字数が違えば同じ欠字箱の反復でも差が出る。同じ文字数・同じ配置の対照と字形の比較を分け、実画像の受入とは区別する（2026-10-16、2026-10-16-review-20261016-04.md）
- 共通の生成器のコードを復帰・変更する前に、同じ出力先を使う実行中プロセスとログを確認する（2026-10-16、2026-10-16-generator-structure-conflict.md）
- 実行開始時だけでなく、場面開始前と符号化前にも負荷を確認する（2026-10-16、2026-10-16-generator-structure-progress.md）
- 水質 verify の成功をブログ本文の照合結果に読み替えない。verify-venue-water-profiles.js は表示定数・3言語の会場ガイド等を検査し、場別ブログ本文と JSON メタは読まない（2026-10-13、2026-10-13-plan-review-20261013-17.md）
- 会場の警告抽出を直しても、監視が保存済みの last_report.alerts を読むなら、新しい報告が保存されるまで旧警告が残る。health からの再計算と保存 alerts の更新を分ける（2026-10-13、2026-10-13-plan-review-20261013-20.md）
- 会場モーター成績の health は取得を止めた会場のキーを保持する。通知側は現在の取得対象一覧で絞って判定し、固定の除外一覧との一致を仮定しない（2026-10-13、2026-10-13-boa-876.md）

## E2E
- dev サーバーと e2e は本番と別の経路を通る。EDGE_API_BASE="" で /api/predictions/{date} が index.html を返し、Supabase 直のフォールバックになる。本番は Edge API→RPC。両者の差（BOA-304 の weather、BOA-254 の cancellationStatus）は e2e で検知できない（2026-09-19、memory technical_e2e_depends_on_live_supabase_flakiness_2026_09_19。録画の導入後の扱いは要確認）
- e2e が無関係な多数のページで落ちたら、①worktree に .env.local が無い（build は無くても通る）②Supabase の障害（REST だけ止まることがある）③マシンの負荷、の順に疑う。再実行で落ちる顔ぶれが変われば揺らぎ、同じなら環境かコード（2026-09-24、memory technical_e2e_false_failures_supabase_incident_and_load）
- 「本日のレース」を前提にしたテストは、日付が変わってから朝の morning-init までの間に落ちる。まず当日の races があるか確かめる（2026-09-20、memory project_data_foundation_orchestration_2026_09_19）
- 撮影前の時計で即時送信の候補を確定せず、撮影・保存中に迎える候補締切と、合成した投稿全体の失効時刻を別に検証する。（2026-10-19、2026-10-19-review-20261019-03.md）
- 実行ごとに予定を動的にする変更では、初回insertだけでなく再生成した既存itemのveto_untilと再承認jobのscheduled_atも同じ時刻へ更新されるか確認する。（2026-10-19、2026-10-19-review-20261019-03.md）
- 番号順に先頭1件を処理する選定では、後続全件の外部事実取得を先行させると後続の取得失敗で先頭の結果も失われる。先頭の選定と必要事実の取得の順を点検する。（2026-10-19、2026-10-19-review-20261019-14.md）
- 新しい本番の鍵を Actions に置くときは、repo の secret ではなく master だけの Environment（prod-jobs）に置き、job-watch.json に載せる（載せないと verify-job-watch.js が落ちる）。key-canary にも読み取りを1回足す（こちらは verify では検査しない）（2026-10-20、system-architect、ADR-0097:48-49,128）
- master への自動コミットは、サイトの出力に関わるファイル（public/・src・api・ルートの data/* 等）を変えるなら1回ごとに本番デプロイが走る。docs/・data/analysis/ 等だけなら ignoreCommand でビルドしない（#1690、scripts/lib/vercelIgnoreBuild.js）。日次のデータの置き場所にするなら費用として数える（2026-10-20、system-architect、ADR-0032 の追記「選手ページ（BOA-848）」の「ビルド時間」。BOA-908 で更新）
- Vercel の本番ビルドの所要は 10/10 以前の約1.9分から、10/13 以降は6〜7分に延びた（選手約320件などのスナップショット）。選手を作らない Preview も1本の費用が約7倍になったので、Elastic のビルドマシンが大きい機種に上がったと見る。1本あたり本番 約$0.79・Preview 約$0.26（2026-10-20、system-architect、`vercel ls --prod` 600件・請求 API・racerSnapshotPlan.js:22、BOA-908）
- Vercel の ignoreCommand の除外に `*.md` を全体で書くと、public/blog/*.md だけのブログ修正（1週に6本）が本番に出ない。除外はディレクトリと名前で書く。build は scripts/maintenance/run-heavy.sh を通るので除外しない（2026-10-20、system-architect、package.json の build、BOA-908、scripts/lib/vercelIgnoreBuild.js）
- update-sitemap は master への push と Deploy Hook の両方で、同じ内容の本番ビルドを2回走らせていた（10/17 の 7e42db1 で2本）。Deploy Hook のビルドは GitHub の Deployments に載らない（2026-10-20、system-architect、update-sitemap.yml、BOA-908）
- ビルドマシンを下げたときは、ビルドの成否ではなくスナップショットを作れた件数で確かめる。generate-ai-snapshots.js は失敗を受け止めて exit 0 にしうる。並列4は固定値（2026-10-20、system-architect、generate-ai-snapshots.js:49,51、BOA-908）
- 2026-10-20 時点の審査の関門は、本文の無い差分を削除以外すべて落とす。画像を足す PR は、ADR-0097 の追記なしでは承認されない（2026-10-20、system-architect の content-publish の審査、scripts/lib/reviewPr.js:57-60・ADR-0097:34）
- ブログの古い道（finalize-blog-draft.js の自動マージ、merge-blog-pr.js の GITHUB_MERGE_TOKEN の PAT、ADR-0034）は書き込みの身元を増やす道で、ADR-0097:109 と矛盾し、切替の後は失敗する。#1701 で止める（対応中、2026-10-20、system-architect の content-publish の審査、BOA-908 ⑤）
- AI 審査の承認は P0 だけで決まり、P1 が残っていても APPROVE になる。段階0 A の「P0・P1 が0件」は、オーケストレーターがマージするときにしか効いていない（2026-10-20、system-architect の開発の社員化 v2 の審査、scripts/lib/reviewPr.js:254-270・.claude/skills/orchestrate/SKILL.md:69）
- review.yml の gate は、パス・PR の大きさ・テストの弱めを見ない。見るのは symlink・submodule・LFS・バイナリ・.gitattributes・299ファイル・20万字・月の上限だけ（2026-10-20、system-architect の開発の社員化 v2 の審査、scripts/lib/reviewPr.js:8-67・scripts/review/gate.js）
- 審査の月の上限（既定300）は作成の App の run の数で、push のたびに1回数える。全レーンと全社員で共有なので、1日7本の PR の流れでは上限に当たりうる（2026-10-20、system-architect の開発の社員化 v2 の審査、scripts/lib/reviewPr.js:277-284・ADR-0097:96）
- 例外の線を機械で効かせる置き場は、master から読まれる龍神の config に限る。pull_request_target は master の定義で動くので、PR がこのファイルを書き換えても、その PR の審査には効かない（2026-10-20、system-architect の開発の社員化 v2 の審査、.github/workflows/review.yml:12・54-56）
- codex/* には Preview が無い。それ以外の接頭辞の Preview は本番の管理者キーを持つ。画面の作業を社員に回すと、段階0 B（mock-diff-checker・ファン評価）を満たす手段が無い（2026-10-20、system-architect の開発の社員化 v2 の審査、vercel.json:5-6・AGENTS.md:25・SKILL.md:115）
- verify-registry.json の entries は script の名前の順に置き、新しい項目は名前の位置に挿す。順は `run-verify-registry.js` の突き合わせ（verify:ci）で落ち、`--sort` で並べ直せる。同じ隙間への追加は今後も衝突しうる（10/06〜10/20 の同じ日のコミットの組で6.3%、末尾に足す運用では100%。verify-sns-*・verify-bot-* の束に偏る）（2026-10-20、BOA-938、system-architect が master の台帳の履歴から数えた）
- 台帳の衝突を「両方残す」で直すと、別の項目の guards が付いた項目ができうる（checkRegistry は名前と tier・guards の対応を見ない）。master の台帳を丸ごと取り、自分の項目だけ足して `--sort`・`--check`、`git diff origin/master` が足した塊だけか確かめる（2026-10-20、BOA-938、system-architect が #1708 の merge-tree で再現）
- Linear の起票はすべて scripts/lib/linearIssueGate.js の assertCanCreateIssue を通す。未アーカイブ（issues を includeArchived なし・チームで絞らず数えた数、hq の count_unarchived と同じ）が閾値以上（2026-10-21 から230件。hq は200で警告・240で社員の起票を止める）、または数えられないときは起票せず Slack に件数と閾値を送る。新しい起票の経路は verify-linear-issue-gate.js が CI で検知する（2026-10-20、hq 台帳 PL48・docs/operation/linear-cli.md）
- 社員へ渡された仕事は、進めたものをhandled_tickets、道・承認待ちで進められないものを理由つきblockedへ記録する。両方に入れない票は再配布・相談の対象になり、別件の失敗時に失敗数へ含まれうる（2026-10-20、head-marketing、hq platform/run_employee.py の done_tickets・block_tickets）
- 社員間の週使用量・1周あたりtokenを比べる前に、task-runs各行のtokens_cachedの有無と使用量の定義を確認する。現行の予算比較量はtokens_in−tokens_cached＋tokens_outで、cacheを含む旧行と混ぜない。欠落したcache量を0と決めず、合算値と各周の値を突き合わせる（2026-10-20、ops-efficiency、hq platform/run_employee.py の予算比較量の定義）
- 起票・PR・受け手の同時上限などで制作後に拒否が続く場合、制作・審査の前に実行可能性を判定できるかを先に点検する。後段の拒否回数だけでなく、拒否までに使った制作・審査のtokenも改善対象にする（2026-10-20、ops-efficiency、ledger/task-runs.jsonl の上限拒否点検）
- 社員の難易度はtoken予算の消化率だけで下げない。同種の仕事で使用量と審査P0を比べ、節約量が小さい場合や品質が悪化する場合は見送る。変更先のmax_turnsを超える実績がないかも確認する（2026-10-21、ops-efficiency、ledger/task-runs.jsonl・company/models.json の難易度別点検）
- 材料待ちのLLM定時処理は、入力ファイルの存在・鮮度だけでなく、その仕事で使える値の行があることを起動条件にする。空の表が更新されただけで起動すると、材料なしの周でもtokenを消費する（2026-10-21、ops-efficiency、ledger/task-runs.jsonl・company/roster/x.json）
- モデル廃止や既定変更の影響は、製品名だけでなく認証方式と実効モデルを照合する。設定がnull・明示指定なしでもCLI既定や継承が効くため、起動引数と別プロセスへの受け渡しまで追い、設定を確認できない経路は非該当と断定せず未確認に残す（2026-10-20、tech-trends、hq platform/run_employee.py・platform/spool.py、変更履歴との照合）
- Codex用cloneに.env*があれば停止する規則は、例外の明記が無い限り追跡済みの.env.exampleにも当たる。配布前にテンプレートを含むファイル名を確認し、cloneの条件とテンプレートの扱いを明示する。内容を読んで安全と推測する例外は作らない（2026-10-21、BOA-779、指定SHAのAGENTS.md「作業場所と認証」、Codex報告2026-10-21-boa-779.md）
- ファイル走査中の削除競合は、隔離した木でstat・readdir・readの直前に同期的な削除を注入すると、実時間の並行実行に頼らず再現できる。共通部品だけでなく実際のverifyもその木で動かし、通常ファイルの違反検出が残ることを確認する（2026-10-21、BOA-969、Codex報告2026-10-21-boa-969.md、検証用パッチのscripts/maintenance/verify-source-file-walk.js）
- 時間帯を制限する取得処理は、リクエスト間隔の待機後・fetch直前に取得窓を判定する。待機で窓をまたぐ状況を注入し、次の取得が止まることに加え、取得済み計画の全配列が保持されることも検証する（2026-10-23、BOA-779、Codex報告2026-10-23-boa-779.md、scripts/maintenance/verify-disqualified-finish-marks.js）
