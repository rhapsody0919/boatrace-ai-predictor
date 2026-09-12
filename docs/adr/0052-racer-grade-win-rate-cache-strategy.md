# ADR 0052: 選手の最新級別・勝率を一括取得するキャッシュ方式

## ステータス
採用

## 背景
`docs/design/racer-search-and-list/spec.md`（FR2・FR3）で、選手一覧ページ`/racers`とヘッダー検索フィルタで級別（A1/A2/B1/B2）・勝率によるフィルタ・ソートに対応する必要がある。[ADR-0023](0023-racer-grade-freshness.md)の方針により、級別は`racer_profiles.grade_at_scrape`ではなく`race_entries`の選手ごとの最新行（`race_id`降順で1件、`src/services/racerService.js:28-35`が個別選手ページで既に採用しているパターン）から取得する必要がある。勝率（`race_entries.win_rate`）も同じ行から一緒に取得できる。

問題は、これを**全選手（約1,627人）分、一括で**取得する既存の仕組みがないこと。`race_entries`は約25.6万行（`pg_class.reltuples`実測）あり、選手ごとに1件ずつクエリを発行するのは非現実的（1,627回のクエリになる）。また`race_entries.racer_id`には単体インデックス（`docs/db-migration/050_race_entries_racer_id_index.sql`、2026-09-07追加）はあるが、`race_id`との複合インデックスは無い。

## 決定
**Postgres RPC関数（`DISTINCT ON`）+ 複合インデックス + 夜間バッチキャッシュ**を採用する。

1. 新規マイグレーション`docs/db-migration/054_racer_grade_cache_table.sql`で、`race_history_cache`と同じ形状（`key TEXT PRIMARY KEY` / `data JSONB` / `updated_at TIMESTAMPTZ`）の新規テーブル`racer_grade_cache`を作成する（レース領域とドメインが異なるため、`race_history_cache`に相乗りせず別テーブルにする）。RLSは`race_history_cache`と同じ`allow_anon_read`ポリシーを踏襲する。
2. 新規マイグレーション`docs/db-migration/055_get_latest_racer_grades_rpc.sql`で、複合インデックス`idx_race_entries_racer_id_race_id ON race_entries(racer_id, race_id DESC)`と、RPC関数`get_latest_racer_grades()`（`DISTINCT ON (racer_id) ... ORDER BY racer_id, race_id DESC`で選手ごとの最新1行を返す）を追加する。
3. 新規バッチスクリプト`scripts/daily/update-racer-grade-cache.js`（`update-race-history-cache.js`と同じ構成: RPC呼び出し→整形→`racer_grade_cache`へ`upsert`）を追加し、`.github/workflows/calculate-accuracy.yml`に1ステップとして追加する（既存ステップと同じ形式、新規ワークフローは作らない）。
4. `src/services/supabaseDataService.js`に`getRacerGradeCache()`を追加し、`racer_grade_cache`から`withCache`経由で取得。既存の`getAllRacersLite()`を拡張し、`racer_profiles`（支部・身長・体重・登録期・出身地・生年月日）とこのキャッシュ（級別・勝率）をクライアント側でマージして返す。

## 却下した選択肢
- **JS側での全件ページネーション集計**（`update-race-history-cache.js`と全く同じ方式: `race_entries`を1,000件ずつページングしながら取得し、JSの`Map`で選手ごとの最新行を判定して`upsert`）: 実装パターンとしては最も既存踏襲度が高いが、`race_entries`は日々増え続ける（1日あたり約1,700行、24会場×平均12R×6艇）ため、夜間バッチのたびに毎回テーブル全件（現在25.6万行、今後も増加）をスキャン・転送することになり、egress・実行時間ともにコストが増え続ける。過去の教訓（BOA-168/169、レース詳細のRPC化でegress約1/25に削減した実績）と同じ問題を新規に持ち込むことになるため却下
- **マテリアライズドビュー + `REFRESH MATERIALIZED VIEW`**: SQL側で完結しクエリも高速だが、このプロジェクトに前例が無く（`docs/db-migration/`を全文検索して0件）、`REFRESH`を誰がいつ叩くかという新しいトリガー機構（pg_cron等）も導入していないため、結局「夜間バッチスクリプトから`REFRESH`を呼ぶ」という形になり、通常のテーブル+RPC構成に対する利点が薄い。新しいDBオブジェクト種別を1機能のためだけに導入するコストに見合わないため却下
- **選手個別ページと同じ「1選手ずつクエリ」を1,627回実行**: 検討の余地なく却下。N+1問題そのもの

## 影響
- `DISTINCT ON`はこのプロジェクト初めての採用（既存RPC関数はすべて単純な集計・JOINのみ、`007_RPC_FUNCTIONS.sql`・`008_accuracy_rpc.sql`・`029_race_analysis_rpc.sql`等を参照）。標準的なPostgres機能であり技術的リスクは低いが、レビュー時に他の開発者が読み慣れていない可能性がある点は留意する
- 複合インデックス`(racer_id, race_id DESC)`の追加により、`idx_race_entries_racer_id`（単体、050番）と役割が一部重複するが、単体インデックスは他の既存クエリ（`racer_id`のみで絞り込む`getRacerFormTrend`等）でも使われ続けるため削除しない
- キャッシュは1日1回（`calculate-accuracy.yml`と同じ23:30 JST）しか更新されない。当日中に級別が変わることは実運用上ない（級別は期別入れ替えで年2回のみ）ため許容できるが、**勝率は日々変動する**値である点に注意。1日1回更新のラグは、既存の`race_history_cache`（`/races`ページの「本日」集計が1日1回更新される設計）と同じ許容範囲としてユーザーに説明済みの前提を踏襲する
