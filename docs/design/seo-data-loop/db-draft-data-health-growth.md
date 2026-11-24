> 未審査の案。適用の根拠にしない。

# growth_gsc_daily の鮮度を data_health（夜の鮮度）に載せる案

設計: SEO・GEO・AIO のデータの輪（2026-11-24）§6 の直し 3。`growth-gsc-daily.yml` が `scripts/lib/dataHealth/workflowCoverage.js` の `WORKFLOW_EXCLUSIONS`（watched_elsewhere）に載っていて、画面の表の側から見る鮮度の監視（data_health の夜の鮮度）の対象外になっている。0行が成功のまま通った件（#3353 で取り込み側は直した）と、job-watch の見張りの穴（Issue が閉じられる件）が重なると、取れていない日が誰にも見えない。

## なぜ PR にしないか（作り手が変えられない物に当たる）

この変更は `scripts/lib/dataHealth/**`（data_health の関数の正本）と、DB の関数 `data_health_nightly_freshness` の差し替え（マイグレーション。AGENTS.md 安全の3）と、既存の `verify-data-health-job.js` の期待値の更新（AGENTS.md 安全の4）の3つを同時に要する。lib だけを変えると、既存の verify が落ちる（下の「試験への影響」）。そこで、作り手は案とそのまま使える差分・手順を出し、取り込みは窓口（マイグレーション・verify の期待値の更新を含む1本の PR）が行う。

## 変える中身（差分の案）

`scripts/lib/dataHealth/freshnessSql.js`・`checks.js`・`workflowCoverage.js` の3つ。

```diff
--- a/scripts/lib/dataHealth/freshnessSql.js
+++ b/scripts/lib/dataHealth/freshnessSql.js
@@ NIGHTLY_FRESHNESS_ITEMS（st_course_baseline・nige_second_by_course の後、accuracy の前）
+  // Search Console の日別（growth-gsc-daily。毎日 JST 10 時台に直近7日を取り直す）。GSC は PT の日付で2〜3日遅れる。
+  // 06:35 JST の評価（p_to = 前日 D-1）の時点で、前回（D-1 の 10 時台）が取れていれば max(date) は D-3。
+  // max(date)+2 >= p_to - 1（= max(date) >= D-4）で、1日ぶんの余裕を見る。止まった日は2日続けて遅れた時点で鳴る
+  {
+    key: "growth_gsc_daily",
+    table: "growth_gsc_daily",
+    kind: "date_prev",
+    observed: "(select max(date) + 2 from growth_gsc_daily)",
+  },
--- a/scripts/lib/dataHealth/checks.js
+++ b/scripts/lib/dataHealth/checks.js
@@ NIGHTLY_FRESHNESS_CHECKS（top_start の後、accuracy の前）
+  nightly(
+    "growth_gsc",
+    "Search Console の日別（query × page）",
+    "growth-gsc-daily.yml",
+    ["growth_gsc_daily"],
+  ),
--- a/scripts/lib/dataHealth/workflowCoverage.js
+++ b/scripts/lib/dataHealth/workflowCoverage.js
@@ WORKFLOW_EXCLUSIONS
-  "growth-gsc-daily.yml": {
-    kind: "watched_elsewhere",
-    reason: "Search Console の日別の取り込み（BOA-1706）。…失敗は job-watch が見る",
-  },
```

- `kind: "date_prev"` と `observed` の `+ 2` で、新しい kind を足さずに「max(date) >= p_to - 3」を表した。余裕の日数（目安・根拠なし）は、実データで `max(date)` が平常時にどの日になるかを見て決める（未検証。この案を書いた作り手は本番を読めない）。窓口が `SELECT max(date) FROM growth_gsc_daily;` を数日見てから、`+ 2` を `+ 1`（余裕なし）か `+ 3` に直す。
- 通知の重さ: `nightly()` は `severity: "alert"`（Slack）。止まったら鳴ってよい表なので alert のままにした。`info` から始める場合は `nightly()` を使わず、`morning.poirot` のように `severity: "info"` と `note` を書く。
- 権限: `data_health_nightly_freshness` は既存の関数（service_role だけが EXECUTE）で、`growth_gsc_daily` を読む。表の権限は service_role に SELECT があるので追加は要らない（`docs/db-migration/204_growth_gsc_daily.sql`）。

## DB の関数の差し替え（マイグレーションの案。番号は適用の時に `origin/master` の最大＋1）

関数の DDL は手で書き写さず、lib から生成する（`scripts/lib/dataHealth/functions.js` が正本）。上の差分を当てた状態で次を回し、出力を新しいマイグレーションに貼る。

```
node scripts/maintenance/render-data-health-functions.js data_health_nightly_freshness
```

- 出力は `CREATE OR REPLACE FUNCTION data_health_nightly_freshness(p_to date)` の本体・`REVOKE ALL … FROM PUBLIC, anon, authenticated`・`GRANT EXECUTE … TO service_role`・`COMMENT` を含む（66行。新しい項目は `'growth_gsc_daily', jsonb_build_object('applicable', true, 'ok', coalesce((select max(date) + 2 from growth_gsc_daily) >= p_to::date - 1, false), 'observed', (select max(date) + 2 from growth_gsc_daily))` の1行）。
- 読み取りの関数の差し替えだけで、表・データは変えない（ロックなし・冪等）。
- 適用の順序: 170 の注記のとおり、db-apply は master の SQL を当てるので、コード（lib の差分）が先に master に入る。適用までの 06:35 JST の実行では、関数が新しい項目を返さないため、`growth_gsc_daily` の項目は「項目が無い」になる（通知の出し方は `verify-data-health-job.js` の「鮮度の実行」の節で確認する。適用の直後の最初の実行で消える見込み。未検証）。
- 適用後の確認（読み取りのみ）: `SELECT data_health_nightly_freshness(current_date - 1);` が 20項目と `_since` を返し、`growth_gsc_daily` の `ok` が true、`has_function_privilege('anon', 'data_health_nightly_freshness(date)', 'EXECUTE')` が false。
- 戻し: 170 の `data_health_nightly_freshness` の DDL（`node scripts/maintenance/render-data-health-functions.js --migration 170_data_health_freshness.sql` の出力）を `CREATE OR REPLACE` で当て直す。lib の差分は revert する。

## 試験への影響（既存の verify の期待値を更新する必要がある。作り手は変えられない）

この差分を当てて `verify-data-health-*` を回すと、次の3件が落ちる（`verify-data-health-workflow-coverage.js`・`verify-data-health-report.js` は緑のまま）。

- `verify-data-health-job.js`「マイグレーション170: data_health_nightly_freshness のDDLが、functions.js から生成したものと一字一句一致する」: 関数の正本が 170 から新しいマイグレーションに移るので、検査の対象を新しいマイグレーションに向ける（170 の関数は新しいマイグレーションの CREATE OR REPLACE で上書きされた古い版になる）。
- 同「鮮度の関数（夜）: 全ての項目（NIGHTLY_FRESHNESS_ITEMS）と _since を返す」と「鮮度の実行（夜）: … 11本が全て未達なら共通原因の要約を先頭に、11件を通知する」: 項目と check の数が増える（19項目 → 20項目、check は1件増）。PGlite の最小のスキーマに `growth_gsc_daily` の表を足す必要がある（`table` の宣言から作る仕組みなら自動）。

期待値の更新は「項目が増えた分を数える」だけで、条件は緩めない。

## 範囲外・未決

- `page_daily`（growth_gsc_page_daily）・`growth_url_inspection` の鮮度は、表の適用と日次の取得の組み込みの後の別の案。
- GSC の取得を Vercel Cron へ移す件（ADR-0066。オーナー決定済み）の後は、`workflowCoverage.js` の検査（prod-jobs を使う workflow）の対象でなくなるので、この項目は Vercel の cron の見張り（`scrape-monitor` の `daily_overdue` 等）へ寄せ直す。
