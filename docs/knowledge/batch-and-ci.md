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

## E2E
- dev サーバーと e2e は本番と別の経路を通る。EDGE_API_BASE="" で /api/predictions/{date} が index.html を返し、Supabase 直のフォールバックになる。本番は Edge API→RPC。両者の差（BOA-304 の weather、BOA-254 の cancellationStatus）は e2e で検知できない（2026-09-19、memory technical_e2e_depends_on_live_supabase_flakiness_2026_09_19。録画の導入後の扱いは要確認）
- e2e が無関係な多数のページで落ちたら、①worktree に .env.local が無い（build は無くても通る）②Supabase の障害（REST だけ止まることがある）③マシンの負荷、の順に疑う。再実行で落ちる顔ぶれが変われば揺らぎ、同じなら環境かコード（2026-09-24、memory technical_e2e_false_failures_supabase_incident_and_load）
- 「本日のレース」を前提にしたテストは、日付が変わってから朝の morning-init までの間に落ちる。まず当日の races があるか確かめる（2026-09-20、memory project_data_foundation_orchestration_2026_09_19）
- 新しい本番の鍵を Actions に置くときは、repo の secret ではなく master だけの Environment（prod-jobs）に置き、job-watch.json に載せる（載せないと verify-job-watch.js が落ちる）。key-canary にも読み取りを1回足す（こちらは verify では検査しない）（2026-10-20、system-architect、ADR-0097:48-49,128）
- master への自動コミットは1回ごとに本番デプロイが走る（vercel.json の除外は codex/** だけ。デプロイフックも叩くと2回）。日次のデータの置き場所にするなら費用として数える（2026-10-20、system-architect、ADR-0032 追記）
