# ADR と本番 DB の運用

設計の決定（ADR）と番号、本番 DB への書き込みの手順、Supabase の読み方。書き方は [README.md](README.md)。

## ADR と番号
- 決定の正本は docs/adr/。新しい設計は既存の ADR と矛盾しないかを先に確かめ、変えるなら ADR を足すか追記する（docs/adr/、AGENTS.md）
- ADR の番号は並行セッションで重複しやすい。足したら npm run verify:adr-numbers（次の番号も出る）（2026-09-12 に8組15件を振り直し、memory technical_adr_number_collisions）
- マイグレーションの番号は並行するレーンで重なりうる。着手時にオーケストレーターに番号を取ってもらい、PR 作成前に origin/master の最新番号と比べる（2026-10-11、オーケストレーター依頼）
- 新しいマイグレーションの番号は origin/master の最大番号より大きくないと verify-migration-numbers が CI で落とす。予約した番号でも、master が先に進んでいたら使えない（2026-10-13、BOA-822 の 149〜151 を 155〜157 に付け替え）
- マイグレーションと ADR の番号は予約しない。PR を作るときに origin/master の最大＋1 を使い、CI で落ちたらその時の最大＋1 に付け直す（2026-10-19 hq の決定で予約を廃止。予約した 164・162 が、後の番号の先のマージで使えなくなったため）
- マイグレーションの番号を付け替えるときは、SQL のファイル名・docs/db-migration/APPLIED.md・docs/design の番号の表記・verify-*.js が読むファイル名を全部 grep して直す（2026-10-10、memory sns_hub_intake_paused_2026_10_09）
- plan.md に新しいテーブル・リレーションを書いたら node scripts/maintenance/generate-er-diagram.js {slug} で DDL から erDiagram を作り、npm run verify:er-diagram で照合する（2026-09-15、memory er_diagram_generation_2026_09_15、PR #665）
- docs/reference/database-design.md の関係図は自動更新されず、「テーブル一覧と使用状況」等は古い（race_odds を「未使用」と書く等）（2026-09-15、memory er_diagram_generation_2026_09_15。更新されたかは要確認）

## 本番 DB への書き込み
- Claude 側から本番に書けない。Supabase MCP は --read-only 固定、service key のスクリプトは auto mode が拒否する。迂回しない（2026-09-25、memory technical_supabase_write_blocked_both_routes）
- 書き込み（マイグレーション本体等）はオーナーが Supabase Dashboard の SQL Editor で実行する。チャットに1ブロック=1回の実行で渡し、確認の SELECT は Claude が読み取り MCP で行う（2026-09-30 ユーザー指示、memory feedback_prod_sql_user_runs_writes_only）
- SQL Editor は最後の文の結果しか出さない。BEGIN〜ROLLBACK 型の確認は渡さない（2026-09-30、同 memory）
- 「適用済み」はそのマイグレーションだけが持つ差分で確かめる。他の版も入れるキーを見ても区別できない（063/068 の取り違え、memory migration_applied_check_needs_discriminating_observation）
- CREATE OR REPLACE FUNCTION は古い定義を土台にすると、後のマイグレーションが足したキーを黙って消す。適用後に scripts/maintenance/verify-rpc-output-keys.js を実行する（BOA-363・BOA-431、ADR-0074 で PR 時の検査あり、.claude/CLAUDE.md）
- PostgREST のバルク upsert はキーの集合が違う行を混ぜると、その列を持たない行に NULL を書く。scripts/lib/unchangedRows.js の diffRows で列をそろえる（2026-09-27 に1,729行が NULL、PR #870、memory technical_postgrest_bulk_upsert_nulls_missing_keys）
- 外部キー・制約の確認は pg_constraint で行う。information_schema の多段 JOIN は黙って0行を返す（races を参照する FK は18本、memory technical_pg_constraint_not_information_schema_for_fks）
- PK のリネーム等は全種類の制約（FK・UNIQUE・CHECK 等）を洗い、1件で先に試す（ユーザー指摘、memory feedback_pk_migration_verify_all_constraints_and_single_row_test）
- 既存の RPC の本文だけを差し替えるマイグレーションも、114番以降は関数ごとに GRANT/REVOKE か `-- function-exempt` を書かないと verify:migration-rls で CI が落ちる（2026-10-13、BOA-822 の 157、scripts/maintenance/verify-migration-rls.js:340）
- RPC の本文の md5（`AS $$`〜`$$;` の間）は、ファイルから計算した値と本番の md5(prosrc) が一致する。109 の2関数 5d0ff6d8…・a5c39f55…、110 は 8f6cf80c…（2026-10-13 本番で確認、157 の適用前の確認用）
- 日ごとの集計表を「直近N日の upsert」で直すと、件数が0になったセルが残る（CHECK n>0 で0の行を書けず、upsert は行を消さない）。computed_at を全行の payload に入れて upsert し、窓の中の古い computed_at の行を後で消す（更新では DEFAULT が効かない）（2026-10-13、system-architect、BOA-822 の 155）
- races-init の後始末が unified を作り直すのは「unified の行が無いレース」があるときだけ。朝の生成で値を null にして続行すると、一時的な失敗でもその日は戻らない（2026-10-13、scripts/lib/racesInit/job.js:139-150）
- races を参照する外部キー18本のうち sns_campaign_entries だけ ON DELETE NO ACTION（他17本は CASCADE）。行があると races の削除が失敗し、他の表は黙って消える。「FK 違反で安全に止まる」前提を置かない（2026-09-28、memory technical_pg_constraint_not_information_schema_for_fks・feedback_pk_migration_verify_all_constraints_and_single_row_test）
- races には UNIQUE(race_date, venue_code, race_number) があり、race_id・日付の修正でぶつかる（BOA-325 で本番の120件が全部失敗。dry-run は INSERT/UPDATE を実行しないので制約違反を検出しない）。race_number を一時退避して直す（2026-09-15、memory race_entries_racer_id_null_bug_2026_09_15、PR #664・#666）
- 除外するものを DB から読んで集合にするとき、エラーを見ずに (data || []) にすると、読み取りの失敗で除外が空になりガードが外れる（BOA-512 で開催した32レースを中止に一括更新）。失敗は例外にする（ADR-0069、verify-query-errors.js）。一括 UPDATE の跡は updated_at がミリ秒まで同じ行で見分けられる（2026-09-20、memory technical_supabase_read_error_swallowed_flips_guard、PR #743）
- verify-migration-rls.js は REVOKE/GRANT の1文につき先頭の関数名しか読まない。複数の関数を並べた文は1関数1文に分ける（2026-10-08、memory feedback_codex_patch_intake_checklist）
- race_entries が別の日の出走表で上書きされる汚染は、race_results が正常に入るので欠損を探す検知では見つからない。日次の data_health_entries_duplicates（マイグレーション100）で検知する（2026-09-25、memory project_data_foundation_orchestration_2026_09_19、BOA-423）
- 適用待ちキーを WARN にする RPC 検査は、終了コード0でも当該マイグレーションの成功証拠にならない。台帳・途中の WARN・対象日と同一 raceId の保存値/応答を併せて確認する（2026-10-13、2026-10-13-plan-review-20261013-22.md）

## 画面からの読み取り
- 画面から Supabase を読むのは src/services/supabaseClient.js の1つの入口だけ。.throwOnError() が既定で、失敗を「データなし」に化けさせない（BOA-359、.claude/rules/frontend-data-fetch.md）
- Supabase の上限1000行はエラーにならず切り捨てる。1000行を超えうるクエリは .range() のヘルパを使う（BOA-301・BOA-372、.claude/rules/frontend-data-fetch.md）
- PostgREST は GROUP BY が使えないので、日ごとの小さな表を JS で合計すると、エラーにならないまま1000行で切れる。合計は RPC で行う（2026-10-12、BOA-822、docs/design/in-collapse-caution/architecture-y.md）
- 既存のキーの意味を変えて使い回すと verify-rpc-key-regression は通ってしまう（値の変化は検知しない）。意味が変わるなら新しいキーを足し、古いキーは NULL になるに任せる（2026-10-12、ADR-0074「限界」、同 architecture-y.md）
- 小数2桁の値（勝率など）の差で帯を切るときは 1/100 の整数で計算する。浮動小数では 6.10−5.60 が 0.4999… で帯が1つずれる（2026-10-12、同 architecture-y.md）
- 朝の unified の予想は、欠けたレースがあると日全体を作り直すことがある（scripts/lib/racesInit/job.js:25）。予想が読む入力の表は開催時間外に更新する（2026-10-12、同 architecture-y.md）
- 予想を作るときの「前日まで」はレースの日付で読む（race_date < 対象日）。「最新まで」で読むと過去の日を作り直したときに結果が混ざる（2026-10-12、BOA-628 と同じ系統、同 architecture-y.md）
- fetchAll の .range() で全件を読むときは .order("race_id") 等の一意の並びを付ける。並びが無いとページの境目で行が重なったり抜けたりする（2026-09-25、memory project_data_foundation_orchestration_2026_09_19、BOA-403）
- Supabase は Small。Nano のときは get_predictions_by_date が2.3〜12秒かかり、anon の statement_timeout（3秒）を超えて「開催なし」と誤って表示した。DB は ap-southeast-2 で、api/cron/* も syd1 に固定している（2026-09-19、memory project_data_foundation_orchestration_2026_09_19、PR #747）

- SNS の送信（承認・claim・runner・通知・容量）に関する知見は [sns-send-ops.md](sns-send-ops.md) へ移動（2026-10-18）
- 複数 bundle の下書きを limit だけでまとめて読むと、取得の打切りが素材の本数不備に化ける。対象日の抽出前の上限と下書き集合の完全性を別に確認し、超過を不合格素材として確定しない（2026-10-14、2026-10-14-plan-review-20261014-01.md）

## 点検での見落としを防ぐ知見
- 本番操作待ちの引継ぎと後続PRのマージは時点を分け、マージだけで表生成・公開への切替・データ削除の完了を推定しない。（2026-10-13、2026-10-13-plan-1517.md）
- 取得対象の削除だけで保存済みhealthが消えるとせず、履歴ファイルとlast_report.healthの両方に旧警告入力が残らないか確認する。（2026-10-13、2026-10-13-plan-review-motorstop-20261013-06.md）
- fetchRecordedという名前だけで録画限定とせず、モードとstrictを確認し、本番接続禁止のレーンでは録画漏れ・live/recordの実通信への遷移を遮断する。（2026-10-13、2026-10-13-task-70-check-codex-patches.md）
- 同じファイルの同じ文脈へ追加する並行パッチは単独適用成功だけで統合可能とせず、まとめた適用でも両方の検査が残るか確認する。（2026-10-13、2026-10-13-task-72-check-codex-patches.md）
- 新verifyの台帳登録を取り込み側へ委ねた場合、登録と品質ゲートでの実行確認が済むまで取り込み判定に残作業を明記する。（2026-10-13、2026-10-13-task-72-check-codex-patches.md）
- 鍵を読まず本番接続を避けるローカル検証ではstrict replay・API_PROXY_TARGET空文字に加えViteのenvDirを空ディレクトリにし、複合npmスクリプトの引数転送先も確認する。（2026-10-13、2026-10-13-boa-744-part2.md）
- verify実行前にimport先の秘密ファイル読込と実通信を確認し、本番接続禁止のレーンではmanualのDB検証をローカル純関数検査と区別して未実行と報告する。（2026-10-13、2026-10-13-boa-856.md）
- 表・関数を DROP する前の参照確認は、本番の pg_depend（deptype<>'i'）・prosrc の ILIKE・pg_views・pg_constraint の confrelid の4つで行う。plpgsql の本文は pg_depend に出ないので prosrc の検索が要る（2026-10-19、system-architect、163）
- DROP だけのマイグレーションでも APPLIED.md の行が無いと verify-migration-numbers（--base origin/master）が CI で落ちる。display-coverage.md は手で直さず、マージ後の再生成に任せる（ADR-0078）（2026-10-19、163）
- 本番に pg_cron は入っていない（cron.job が無い）。DB の DROP で cron の依存を気にしなくてよい（2026-10-19、system-architect の本番読み取り）
- DROP だけのマイグレーションの runbook では、「最後に書かれた時刻」の判定の基準を、呼び出し元を消した PR の本番デプロイ時刻にする（DROP の PR の時刻では、その間の想定外の書き込みを見逃す）。読むだけの RPC はこの判定では見えず、コードの grep だけが根拠になる（2026-10-19、system-architect、168。呼び出し元を消したのは #1645）
- pg_depend（deptype<>'i'）で外からの依存を数えるときは、対象の表自身の制約（pg_constraint）・既定値（pg_attrdef）・索引（pg_index の indexrelid）を除く。索引を除き忘れると、外の依存が無くても 0 にならない（2026-10-19、168-runbook の PGlite での再現）
- 消した表は元のマイグレーションをもう一度流せば作り直せるが、行は戻らない。後で読む経路が無く件数が小さければ APPLIED.md に要点を書き、そうでなければ適用前にオーナーが CSV で退避してリポジトリの外に置く。本番に退避用の表は作らない（2026-10-19、system-architect、168）
- 手元の既定の node は v16 で `node:test` 等が無く verify-*.js が落ちる。`~/.nvm/versions/node/v22.20.0/bin` を PATH に足して実行する。worktree の node_modules が古いと `twitter-text` 等が見つからないので `npm ci` する（2026-10-19）
- middleware から DB で数を足す設計は、anon で実行できる口・UA の偽装による水増し・パスの種類の増加・upsert で足し算できない（RPC が要る）が重なるので避ける（2026-10-20、system-architect、ADR-0089 決定6）
- db-apply は master の HEAD の SQL しか当てないので、コードのデプロイが必ず先になる。マイグレーションに「コードが先でも壊れない」と書くときは、その間に cron が動く前提で確かめる（2026-10-20、system-architect、170）
- 共通ラッパは、行の無いジョブの初回の起動で scrape_job_state に mode='off' の行を作る（cronWrapper.js の ensureRow）。後から入れる `INSERT … ON CONFLICT DO NOTHING` は空振りして off のまま残るので、条件つきの DO UPDATE（mode='off' かつ last_success_at・last_tick_at が NULL）にする（2026-10-20、system-architect、170）
- data_health の reconcileAlerts は「同じキーで欠損数が増えない未達」を7日間通知しない。日ごとの事故である鮮度の未達には everyDay を付けて毎日通知する（2026-10-20、system-architect・/code-review、170）
- db-apply の classifyMigration は関数の `$$`・REVOKE・GRANT・`INSERT … ON CONFLICT` のどれでも heavy と判定する。scrape_job_state の行をマイグレーションで入れると自動の経路には乗らない（2026-10-20、system-architect、170）

- 読取専用ロール・権限検査・読取CLIの知見は [db-readonly.md](db-readonly.md) を参照（2026-10-19、依頼77の分割案）。
- 列控えは削除列の包含だけでなく主キーとの対応と、削除時点まで控えが残ることを確認する。過去のCREATEの存在だけでは復元可能性を示せない。（2026-10-19、2026-10-19-review-20261019-13.md）
- db-apply は毎時17分の自動適用になる予定（ADR-0097、今は DB_APPLY_DRY_RUN）。本番の反映をまとめる（master の自動デプロイを止める）と SQL がコードより先に当たるので、本番のデプロイの SHA にそのマイグレーションが入っているかを確かめる関門が要る（2026-10-20、system-architect、db-apply.yml、BOA-908。反映をまとめる案は保留）
- `INSERT ... ON CONFLICT DO NOTHING`（対象を書かない形）は PK にも UNIQUE にも効くので、中身の違う既存行があっても黙って成功する。固定 uuid でマスタの行を入れるときは、COMMIT の前に DO ブロックで「入ったはずの行がそろっているか」を検査して落とす（2026-10-20、system-architect、171・PR #1695）
- sns_template_variants を外部キーで参照するのは sns_drafts.template_variant_id（035）と sns_post_tracking.template_variant_id（136、154 で NULL 可）の2つだけ。行を消す前の参照の数は、この2表を足して数える（2026-10-20、system-architect、PR #1695）
- db-apply の確認の節の見出しを拾う処理（scripts/lib/dbApplySql.js の extractConfirmationSections）は、最初の「:」/「：」で見出しを切る。見出しの括弧の中に「:」を書くと、job summary で SQL の1行目にはみ出す（2026-10-20、system-architect、171）
- workflow_dispatch に mode を足して schedule の経路を共有させると、Actions: write の PAT で承認なしの経路（db-apply の reconcile → apply-auto）を任意の時刻に起動できるようになる。「できることは増えない」と書く前に、承認の無い job まで届くかを確かめる（2026-10-20、PR #1722 の審査、db-apply.yml の reconcile の if）
- scrape_job_state.last_report は recordSuccess が丸ごと置き換え、recordFailure は触らない。off の間は起動の記録（last_tick_at）も更新されない。失敗が続く間も持ち越したい状態は last_report に置き、off から戻したかは last_tick_at の空きで見る（2026-10-20、scripts/lib/scrapeJobs/store.js・cronWrapper.js、scripts/lib/dbApplyDispatch.js）
- kind:"monitor" の job は mode を問わず通知の対象になる（scrapeJobs/monitor.js の active）。off にしても consecutive_failures が残る間は通知が止まらない。止めるときは失敗の回数も 0 に戻す（2026-10-20、PR #1722 の審査）
- AbortSignal.timeout のタイマーは unref なので、偽の fetch が返らない Promise だけを返すテストでは、打ち切りの前に Node のプロセスが終わる（unsettled top-level await）。偽物の側で ref のタイマーを持つ（2026-10-20、verify-analogy-dispatch.js (g)）
- hq の codex-pr.py の自動マージ（--merge）は ryujin-maker の名義の直接マージ（squash・--match-head-commit）で、GitHub の auto-merge を要さない。Allow auto-merge は OFF のままでよい（2026-10-24、~/hq/scripts/codex-pr.py:1035-1036、docs/design/codex-direct-pr/design.md:208、オーナー決定）
- Allow auto-merge を ON にすると、--auto を付けた PR が ruleset の承認1件と必須の3つの check だけで入り、codex-pr.py の M2〜M7（skipped の不合格・保護対象・新規ファイルだけ等）を飛ばす道が増える（2026-10-24、system-architect の審査、design.md §5.2）
- review.yml の gate（scripts/lib/reviewPr.js の mechanicalRejections）は .github/** の変更を一般には落とさない（落とすのは本文の無い差分・symlink・submodule・LFS・.gitattributes 等、reviewPr.js:56 付近）。保護パスの守りは codex-pr.py の G5・M3 だけ（2026-10-24、system-architect の審査、design.md:70・186）
- ruleset master-guard の承認1件は、書き込み権限のある身元の承認なら誰のものでも数える（審査の App に限らない）。審査の App だけを数える前提で守りを組まない（2026-10-24、system-architect の審査）
- ruleset の bypass の Integration 5220661 は App が非公開で、API では名前を確かめられない。オーナーが画面で ryujin-bot と確認した（2026-10-23、design.md §10.1 Q8）

## 検査と試験の土台
- DAL（src/services/supabaseDataService.js）は Node で import できない。supabaseClient.js:44-45 が import.meta.env を読み、拡張子なしの import（./supabaseClient・../utils/stConsideration 等）を Node の ESM が解決しない。中の純粋な計算を試験するには、手を加えずに別ファイルへ移して旧の export から呼ぶ（2026-10-24、system-architect の審査、docs/design/dev-efficiency/plan.md 3+2）
- PGlite を使う verify（scripts/maintenance/ に34本）は、それぞれ必要なマイグレーションだけを読む。全スキーマの共通の土台は無く、マイグレーションの積み上げでは DROP・RENAME を追えない。土台を作るなら claude_ro でカタログを読んだ本番のスナップショットを正本にする（2026-10-24、system-architect の審査、plan.md 5）
- ESLint の error は 345（system-architect の実測）。範囲で数が変わり、e2d194f35 の再測は eslint . 全体で 699、docs・sns-video-studio を除くと 352（no-unused-vars 316）。lint 全体を必須にせず、違反を 0 にした規則から verify:ci に足す（2026-10-24、ADR-0079 追記、plan.md 1a）
- E2E で録画に無いリクエストの素通しが0件なら、その E2E が通る経路の SQL（PostgREST のクエリ）を変えていない証拠になる。録画は URL で照合するので、クエリが変われば素通しに出る。E2E が通らない関数のクエリは証拠にならない（2026-10-24、system-architect の審査、e2e/fixtures.js:35・426、scripts/maintenance/report-e2e-passthrough.js）
- ADR-0072 の「ci が100本を超えたらランナーを見直す」の線を越えた（2026-10-24 の台帳で ci 239本・manual 12本）。当面は自作のランナーを続け、新しい純関数の試験だけ新しい verify ファイルにする。vitest・node:test への移行は3件の切り出しの後に見直す（2026-10-24、ADR-0072 追記）
- ESLint の flat config は languageOptions.globals を上から重ねて合わせるので、後のブロックの globals: {} では node・browser の名前を消せない。消すには "off" を並べるか、overrideConfigFile: true の別の設定で検査する（2026-10-24、system-architect の審査、eslint.config.js:19・45）
- post-merge-checks.yml:69 は verify-no-undef.js を引数なしで直接呼ぶ。このスクリプトの既定の規則を増やすと、マージ後の Slack の範囲も広がる。規則を広げるのは引数（台帳の args）で行う（2026-10-24、system-architect の審査、ADR-0079 追記）
- 共通ロジックの索引（generate-lib-index.js:39-55）の対象は scripts/lib・src/utils・src/services だけで、再 export の行は export に数えない。src/pure に移すときは TARGETS に足す（2026-10-24、system-architect の審査）
- tsc の範囲を include で絞っても、JSDoc の import('...') 型と /// <reference> を伝って根の外が入る。既定の lib は DOM を含み、@types/* も自動で入る。閉じるには types: [] と DOM なしの lib（2026-10-24、system-architect の審査）
