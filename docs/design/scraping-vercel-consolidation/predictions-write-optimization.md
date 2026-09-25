# predictions再生成の書き込み量削減 — 調査・設計提案（WS8(c)、BOA-405）

**本ドキュメントは調査・設計提案のみ。コード実装・DDL適用は一切行っていない（BOA-405のスコープ）。**
DDL案は本番未適用のドラフトであり、適用にはユーザー承認と別チケット・別PRが必要。

## 0. 参照した一次情報

- `docs/design/scraping-vercel-consolidation/orchestration.md`（WS8全体、WS8(c)への入力）
- `scripts/daily/generate-predictions.js`（`mainRefresh`、1471〜1710行。DELETE+INSERT/UPSERTの実装）
- `scripts/lib/unchangedRows.js`（`upsertChangedRows`・`filterUnchangedRows`・`diffRows`）
- `scripts/lib/predictionRefresh.js`、`scripts/daily/scrape-scheduled.js`（`mainRefresh`の呼び出し元、writeModeの使い分け）
- `docs/db-migration/001_schema.sql`（`predictions`・`race_results`・`bet_recommendations`のテーブル定義、`update_prediction_results()`関数、`trg_update_predictions`）
- `docs/db-migration/078_race_results_status_refund.sql`（`race_results`への列追加とトリガー連鎖への配慮）
- 本番DB（`mcp__supabase__execute_sql`、読み取りのみ）: `pg_get_functiondef`・`pg_get_triggerdef`・`pg_stat_user_tables`・`pg_indexes`・`information_schema.columns`・実データのサンプル行
- `src/services/supabaseDataService.js`（`feature_contributions`の読み取り箇所）

## 1. 現状整理（実測）

### 1.1 書き込み方式は既に2種類が併存している

`mainRefresh`には`writeMode`引数があり、"replace"（DELETE→INSERT、既定）と"upsert"（`ON CONFLICT (race_id, model_id) DO UPDATE`）が既に実装済み。

| 呼び出し元 | writeMode | 状態 |
|---|---|---|
| Vercel（`api/cron/exhibition.js`・`race-info.js` → `predictionRefresh.js`の`refreshAfterExhibition`/`refreshAfterChange`） | 常に`"upsert"` | 稼働中 |
| GitHub Actions（`scrape-scheduled.js`） | `SKIP_ODDS_REFRESH_ON_GHA=true`なら`"upsert"`、既定は`"replace"` | **既定は今も"replace"（DELETE+INSERT）** |
| `racesInit/predictCodeCheck.js`（`forceTouchRaces`経路） | `"upsert"` | 稼働中 |

つまりBOA-405が指摘するDELETE+INSERTは、案1移行の過渡期でGitHub Actions側にまだ残っている経路。ただし**"upsert"モードも「変更が無い行を書かない」わけではない**。`ON CONFLICT DO UPDATE`はSupabase/PostgRESTの`.upsert()`経由で全列をSETするため、値が1件も変わっていない行もPostgres内部では通常のUPDATEとして処理され、WAL・dead tuple・TOASTの書き直しコストは"replace"のINSERTとほぼ同等に発生する（DELETEの分だけ無くなる）。**BOA-405が求める「差分更新」は、"upsert"モードの上にさらに「変更検知」を重ねる話**であり、"replace"→"upsert"の移行だけでは解決しない。

副次的な発見（コード内コメントで確認済み）: "replace"は対象レースの`is_shadow=false`の全モデルをDELETEするため、`mainRefresh`が書かない`model_id='unified'`行（朝の日次バッチ`generate-unified-predictions.js`が書く）も巻き込まれて消え、翌日のGitHub Actions（`morning-init.js`の`ensureUnifiedPredictions`）が日全体のunified予測を再生成する誘因になっている。"upsert"はunifiedに触れないため、この誘因が発生しない。差分更新への移行は、この巻き込み削除も併せて解消する。

### 1.2 `predictions`テーブルの実測（本番、2026-09-24時点）

```
relname      | n_tup_ins | n_tup_upd | n_tup_del | n_live_tup | table_size | toast_size | total_size
predictions  | 1,419,936 | 2,637,802 | 1,281,872 | 138,060    | 122 MB     | 159 MB     | 353 MB
```

（`n_tup_*`はDB起動来またはstats resetからの累積値。BOA-405本文の「3日で+55,380更新」は別途の期間差分測定によるもので、本調査の累積値とは基準期間が異なる。両者は同じ傾向＝「値が変わらなくても全行書き直し」を示す一次情報として整合する）

- **TOAST（`feature_contributions`が主因）が159MBで、テーブル本体122MBを上回る**。predictionsの実ディスク使用量の過半（159 / (122+159) ≈ 57%）をこのJSONB列が占める
- 実データサンプル（本日分、3件）: `feature_contributions`の圧縮後サイズは`pg_column_size()`で2,363〜2,472バイト、非圧縮JSON文字列で7,931〜8,177バイト（TOAST圧縮率は概ね30%程度）
- **重複の発見**: 同一レースの`standard`・`safeBet`・`upsetFocus`3モデルの`feature_contributions`は**バイト単位で完全に同一**（`turnPrediction`・`racerStats`はモデルに依存しない値のため）。`unified`モデルのみ別内容（`generate-unified-predictions.js`が別途書く、`volatilityPercentile`等を含む）。これは3案のどれとも独立に今すぐ効果のある無駄（1.4節）

### 1.3 `feature_contributions`の読み取り側

`src/services/supabaseDataService.js`を確認した結果、フロントエンドが`turnPrediction`・`racerStats`を読むのは**常に`model_id='standard'`の行のみ**（696〜736行、1366〜1458行、4939〜4967行）。`safeBet`・`upsetFocus`行の`feature_contributions`を読むコードは無い。`unified`行は別枠で読まれる（1529〜1538行、`volatilityPercentile`用）。

→ **`safeBet`・`upsetFocus`への`feature_contributions`書き込みは、現状のフロントエンド仕様上100%無駄**（読まれない値を毎回書いている）。

RPC側（`get_predictions_by_date`等、`docs/db-migration/051`・`066`・`070`）は`feature_contributions->'turnPrediction'`のようにキーだけを抽出しているが、PostgreSQLのTOASTはキー抽出のためであっても値全体をまずデトースト（伸長）する必要があるため、列のサイズを削れば読み取り側（WS8(d)で指摘されている`get_predictions_by_date`平均686ms×4.8万回、1回30〜43MBスキャン）にも効く。

### 1.4 `trg_update_predictions`トリガーの実体（本番で確認、001_schema.sqlから不変）

```sql
CREATE TRIGGER trg_update_predictions AFTER INSERT OR UPDATE ON public.race_results
FOR EACH ROW EXECUTE FUNCTION update_prediction_results()
```

`update_prediction_results()`関数（`pg_get_functiondef`で本番から取得、001_schema.sqlと完全一致）が参照する`race_results`の列は次の8列のみ:

- `rank1`, `rank2`, `rank3`
- `payout_win`, `payout_place_1`, `payout_place_2`, `payout_trifecta`, `payout_trio`

この8列以外の値がどう変わっても、関数は`predictions`の該当レース全行と`bet_recommendations`の該当レース全行を無条件にUPDATEする（`WHERE p.race_id = NEW.race_id`に列条件が無い）。

`race_results`の現在の全列（本番、`information_schema.columns`で確認）と、予測に無関係な列を棚卸しした:

| 分類 | 列 |
|---|---|
| **トリガーに必要（関数が参照）** | `rank1`, `rank2`, `rank3`, `payout_win`, `payout_place_1`, `payout_place_2`, `payout_trifecta`, `payout_trio` |
| **無関係（現状は無駄にトリガーを起動）** | `rank4`〜`rank6`, `course_1`〜`course_6`, `actual_course_1`〜`actual_course_6`, `race_time_1`〜`race_time_6`, `payout_exacta`, `payout_quinella`, `payout_wide_1`〜`3`, `popularity_trifecta`/`trio`/`exacta`/`quinella`/`wide_1`〜`3`, `winning_technique`, `is_cancelled`, `is_no_race`, `race_status`, `refund_boats`, `remark`, `result_at`, `created_at` |

無関係列だけを更新している既存の書き込み経路を特定した（BOA-349の起点はこのパターン）:

- `scripts/daily/scrape-results.js`の`syncActualCourseFromKFile()`（415〜417行）: `actual_course_1`〜`6`のみ更新。WS8(b)（`filterUnchangedRows`）で「値が同じなら書かない」対策済みだが、**値が実際に変わった行は今も全行トリガーを起動する**（BOA-349はこの経路の「常に変更ありと誤判定される」バグで、修正済みなのは誤判定の方。トリガー自体の起動条件はまだ絞られていない）
- `scripts/maintenance/backfill-rank456-from-kfile.js`・`scrape-results.js`565〜566行: `rank4`〜`6`のみ更新
- `scripts/maintenance/backfill-start-timings.js`: `winning_technique`のみ更新
- `scripts/lib/raceResultFix.js`の`buildFixPlan()`: 変更のあった列だけを差分更新する設計だが、対象列に`race_status`・`refund_boats`・`remark`（078列）や`course_*`等が含まれるため、rank/payout以外だけが変わるケースがあり得る

（`scripts/analysis/`配下・`scripts/maintenance/`配下の一部スクリプトは一回限りのバックフィル・分析用であり、全数の網羅的な棚卸しはしていない。DDL適用前に`grep -rn "race_results\").update\|from(\"race_results\").upsert" scripts/ api/`で最終確認することを推奨）

`bet_recommendations`は`mainRefresh`からは書かれず、`generate-moriarty-recommendations.js`等の別バッチが書く。トリガーの`bet_recommendations`側UPDATEは`actual_hit`・`actual_payout`の2列のみで、`predictions`側の計算結果を読むため、トリガーの発火条件を絞ってもこの部分のロジックは変える必要がない（発火条件だけ絞れば良い）。

## 2. 案1: DELETE+INSERT/UPSERTを差分更新へ

### 2.1 技術的な成立可否

`predictions`には`race_id, model_id`の**非部分ユニーク制約**`predictions_race_id_model_id_key`が存在する（`idx_predictions_unique`は`WHERE is_shadow=false`の部分インデックスだが、実際に`.upsert()`のonConflict先として使われているのはこちらの非部分制約）。`mainRefresh`が書くのは`standard`・`safeBet`・`upsetFocus`の3モデル固定で、レースごとに常に3行（増減なし）。`is_shadow=true`の行を書くコードは現状無い（未使用機能とみられる）。

→ **キーは`(race_id, model_id)`、対象レースにつき常に3行という前提は安定しており、`upsertChangedRows`（`scripts/lib/unchangedRows.js`）のパターンをそのまま適用できる**。行の増減シナリオ（新規レースが増える／既存レースが消える）は、`mainRefresh`の対象`race_id`集合自体が発走前ウィンドウの検出結果であり、この差分更新の変更範囲では発生しない（レース自体の追加・削除は`races`テーブル側の話で、`predictions`側は既存のCASCADE削除に任せる。ここは変更しない）。

### 2.2 比較列・除外列の設計

`predictionsData`の各行は次の列を持つ（`upsertPredictions`関数、1719〜1732行）:

```
race_id, model_id, top_pick, top_2nd, top_3rd, confidence, is_shadow,
feature_contributions, scores, is_hit_win, is_hit_place, is_hit_trifecta,
is_hit_trio, is_hit_turn, payout_win, payout_place, payout_trifecta,
payout_trio, predicted_at
```

- **比較すべき列**: `top_pick`, `top_2nd`, `top_3rd`, `confidence`, `feature_contributions`
  - 予測結果（`top_pick`等）が変わった場合は通常の`diffRows`の「値が違う」判定でカバーされ、特別扱いは不要
  - `feature_contributions`はJSONBのため`unchangedRows.js`の`normalizeValue`（`canonicalize`でキー順を正準化してJSON文字列化）で比較可能。ただし現状は`turnPrediction`・`racerStats`という2つの入れ子オブジェクトを持つため、内部の一部だけ変化しても丸ごと「変更あり」判定になる（列単位の差分更新であり、JSONB内部のキー単位の差分ではない。実害は無いが、粒度の限界として明記する）
- **常にリセットされ、比較から除外すべき列**: `scores`, `is_hit_win`, `is_hit_place`, `is_hit_trifecta`, `is_hit_trio`, `is_hit_turn`, `payout_win`, `payout_place`, `payout_trifecta`, `payout_trio`
  - 現行の"upsert"実装（`upsertPredictions`）はこれらを毎回nullにリセットしている。`mainRefresh`の対象は発走前レースのみのため、通常はリセット前後とも既にnullで実質「変更なし」になり、差分検知は正しく機能する（null→nullは`normalizeValue`で一致）。結果確定後にこれらの列へ値を入れるのは`trg_update_predictions`の役目であり、差分更新の対象外
- **`predicted_at`の扱い（要検討事項）**: 現状は毎回`now()`を書き込んでいる。`unchangedRows.js`の`UPDATED_AT_COLUMN`パターン（変更があった行だけ更新時刻を進める）を適用するのが自然だが、`predicted_at`は分析・バックテスト系スクリプト（`scripts/analysis/`配下）で「その予測がいつ計算されたか」の判定に広く使われている（20ファイル超でgrep該当）。差分更新で「値が変わらなければ`predicted_at`も更新しない」設計に変えると、これらの消費側の前提（「`predicted_at`は直近のリフレッシュ時刻」）が崩れる可能性がある。**実装時にはこれらの消費箇所を個別に確認し、影響がある場合は`predicted_at`を比較対象から除外しつつ毎回更新する（＝この列だけは差分検知の対象にしない）という妥協案も選択肢に残す**（DRY_RUN測定で書き込み削減効果への影響は小さい。1行あたり数バイトの固定長列のため）

### 2.3 推奨設計（概要、実装はしない）

1. `writeMode`に`"diff"`（仮称）を追加し、`upsertChangedRows(client, "predictions", predictionsData, { onConflict: "race_id,model_id", keyColumns: ["race_id", "model_id"], ignoreColumns: [...結果系8列, "predicted_at"（要検証）], chunkColumn: "race_id", label: "predictions" })`を呼ぶ
2. 既存の`"replace"`・`"upsert"`は当面残し、GitHub Actions側も含めて全経路を段階的に`"diff"`へ寄せる（"upsert"から"diff"への切り替えはロジック互換）
3. `filterUnchangedRows`の`chunkColumn`は現状`race_id`前提（1レースあたり複数行のテーブル向けに設計されている）なので、predictionsの`chunkSize`は「1レースにつき3行」を踏まえて調整する（既存の`race_entries`・`exhibition_data`と同様の考え方でそのまま流用可能）

### 2.4 不適合点・リスク

- JSONB列の比較は列全体の一致判定であり、`feature_contributions`内の一部フィールドだけが変わるケース（後述2.5・3節参照）では差分更新の恩恵が薄れる。3節の対策と併用することで初めて効果が最大化する
- `predicted_at`の意味変更は消費側への影響調査が必要（本調査では全消費箇所の精査までは行っていない。実装フェーズで要確認）
- "diff"モードも既存行の取得（`fetchExistingRows`）という追加の読み取りコストを払う。ただし対象は1レースにつき最大3行×対象レース数で小さく、書き込み削減効果に対して読み取りコストは無視できる規模（`race_entries`等の既存適用実績と同等）

## 3. `feature_contributions`列の対策案（3案比較）

前提として、**3モデル重複の解消（対策0）はどの案とも独立に、今すぐ実施できる**:

### 対策0（前提・quick win）: `feature_contributions`は`model_id='standard'`にのみ書き、`safeBet`・`upsetFocus`は`NULL`にする

- 根拠: 1.3節の通り、フロントエンドは`standard`行しか読まない
- 効果: このJSONB列の書き込みバイト数を**即座に約2/3削減**（3モデル→1モデル）。以下の(a)〜(c)のどれを採用してもこの削減は乗算的に効く
- 不適合点: 将来`safeBet`・`upsetFocus`個別の根拠表示機能が追加された場合は書き戻しが必要になる（現状そのような画面要件は無いことをsrc/を確認して裏付け済み）。もし「モデルごとに根拠が違う体裁を将来見せたい」という製品判断があるなら、この対策は保留すべき（要ユーザー確認）

### (a) 別テーブルへの分離

`predictions`から`feature_contributions`を切り出し、`prediction_feature_contributions(race_id, model_id, turn_prediction jsonb, racer_stats jsonb, updated_at)`のような別テーブルに持つ。

| 観点 | 内容 |
|---|---|
| 書き込み量 | predictions本体のUPDATE/INSERTがJSONB分のTOAST書き込みを持たなくなり、rank/topPick等の軽量な列だけの書き込みになる。差分更新（2節）と組み合わせれば、`top_pick`等が変わらない限りpredictions側は書き込み自体が発生しない | 
| 読み取り側の影響 | `get_predictions_by_date`等のRPC（`docs/db-migration/051`・`066`・`070`）は`predictions p`に`JOIN`を1本追加する必要がある。`src/services/supabaseDataService.js`の直接SELECT箇所（1108行台・1287行台・4957行台）も`.select("feature_contributions")`から`.select("prediction_feature_contributions(...)")`相当に変更が要る | 
| 不適合点 | RPC・フロントエンド双方の変更が必要でこの3案の中で最も影響範囲が広い。JOIN追加によりRPCの実行計画が変わり、WS8(d)で問題視されている読み取りコスト（`get_predictions_by_date`平均686ms）に良い方にも悪い方にも影響しうる（軽いテーブルだけ読めば済むケースは速くなるが、常にJOINが必要なら追加コストになる）。マイグレーション（新テーブル作成・既存データの移行）が要る |

### (b) 圧縮（アプリ側でgzip等）

書き込み前に`feature_contributions`をアプリ側でgzip圧縮し、`bytea`または圧縮済みJSON文字列として保存する。

| 観点 | 内容 |
|---|---|
| 書き込み量 | PostgreSQLのTOASTは既に列単位でpglz圧縮している（1.2節の実測で非圧縮8KB→TOAST後2.4KB、圧縮率約70%）。アプリ側gzipはpglzより高圧縮率だが、**その差分は「既に圧縮された列をさらに圧縮する」効果でしかなく、TOAST機構自体の書き込みオーバーヘッド（TOAST行のINSERT/UPDATE自体のWAL）は減らない**。行の増減が無い限りTOAST行のUPDATE回数は変わらないため、この案単体では「値が変わっていなくても毎回書き直す」というBOA-405の主課題は解決しない |
| 読み取り側の影響 | RPCが`feature_contributions->'turnPrediction'`のようにJSONBの演算子でキー抽出しているため、`bytea`化するとRPC側でSQLによるキー抽出ができなくなり、**アプリ側で毎回展開する処理が必要**になる（RPCを跨いだ設計変更が必要） |
| 不適合点 | 主課題（差分の無い書き直し）に効かない上、読み取り側のRPCが使えなくなる副作用が大きい。**3案の中で最も不適合**。バイト数の削減のみが目的なら対策0（3倍重複の解消）の方が同じ方向で遥かに低リスクに大きな効果を得られる |

### (c) 最新1件のみ保持し履歴を持たない

現状も`predictions`は「レースごとに最新の予測1件」しか持っていない（DELETE→INSERT/UPSERTのどちらも履歴を残さない設計。過去の予測変遷は保存されていない）。

| 観点 | 内容 |
|---|---|
| 現状との差分 | **既に(c)の状態である**。これは新しい対策ではなく現状追認。誤解を避けるため明記する |
| 検討する余地があるとすれば | 「発走直前の1回だけ`feature_contributions`を書き、それ以前のリフレッシュ（60/30/15分前等）では`feature_contributions`を`NULL`のまま据え置く」という運用は可能（`turnPrediction`・`racerStats`は発走直前ほど精度が上がる性質のため、後続のリフレッシュで上書きされる前提の値。早い段階のリフレッシュでこの重いJSONBを書く意味は薄い） |
| 不適合点 | 発走前の早い段階でユーザーがレース詳細ページを開いた場合に`turnPrediction`/`racerStats`が空になる時間帯が生じる（現状は都度更新されるため常に何らかの値がある）。UXとのトレードオフになるため、製品判断としてユーザー確認が必要 |

### 3.1 比較のまとめと推奨

| 案 | 書き込み量削減 | 読み取り側の影響 | 実装コスト | 推奨度 |
|---|---|---|---|---|
| 対策0（3重複解消） | 大（即time -2/3） | 無し（standard行はそのまま） | 極小（`generate-predictions.js`の`predictionsData.push`を1箇所修正するだけ） | **最優先で採用** |
| (a) 別テーブル分離 | 中〜大（2節の差分更新と組み合わせて最大化） | 中（RPC・フロントエンド双方に変更） | 中〜大 | 対策0の効果を測った上で、なお不足する場合の次善手として検討 |
| (b) 圧縮 | 小（主課題に効かない） | 大（RPCのJSONB演算子が使えなくなる） | 中 | **非推奨** |
| (c) 最新1件のみ | 現状追認／早期リフレッシュでの省略は可能 | UX上のトレードオフ | 小 | 製品判断が必要なため今回は提案に留める |

**推奨: 対策0を即時採用（別チケットで実装）。効果を実測した上で、なお`feature_contributions`のTOASTが書き込み量の主因として残るなら(a)別テーブル分離を検討する。(b)は不採用。(c)はUX判断待ちで保留。**

## 4. トリガー限定のDDLドラフト（適用しない）

1.4節の棚卸しに基づき、`update_prediction_results()`が実際に参照する列だけで`UPDATE OF`を絞る。

```sql
-- ⚠️ ドラフトのみ。本番への適用はユーザー承認後に別チケット・別PRで行う。
-- 適用前の確認事項:
--   1. grep -rn "from(\"race_results\").update\|from('race_results').update" scripts/ api/ で
--      rank1〜3・payout_*以外の列だけを更新している経路が他に無いか最終確認する
--   2. race_results への一括UPDATE（マイグレーション適用時のバックフィル等）を、開催時間帯を避けて実行する
--      （078_race_results_status_refund.sqlと同じ配慮。ADD COLUMNはトリガーを発火しないが、
--       このDROP/CREATE TRIGGER自体はACCESS EXCLUSIVEロックを一瞬取る）

BEGIN;
SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS trg_update_predictions ON race_results;

CREATE TRIGGER trg_update_predictions
AFTER INSERT OR UPDATE OF
  rank1, rank2, rank3,
  payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio
ON race_results
FOR EACH ROW
EXECUTE FUNCTION update_prediction_results();

COMMIT;
```

- `AFTER INSERT OR UPDATE OF <列>`はPostgreSQLの標準構文で、列リストは`UPDATE`イベントにのみ適用される（`INSERT`は常に発火。新規結果は必ず`predictions`と突き合わせる必要があるため意図通り）
- 関数本体（`update_prediction_results()`）は変更しない。発火条件だけを絞るため、関数のロジックとの不整合は生じない
- `bet_recommendations`側の`actual_hit`/`actual_payout`更新は同じ関数内にあるため、この発火条件の絞り込みで自動的に恩恵を受ける（関数自体は変更不要）

### 4.1 このDDLで発火しなくなる既知の書き込み経路（1.4節より）

- `syncActualCourseFromKFile()`（`actual_course_1`〜`6`のみ更新）
- `backfill-rank456-from-kfile.js`・`scrape-results.js`の`rank4`〜`6`更新
- `backfill-start-timings.js`の`winning_technique`更新
- `raceResultFix.js`が`race_status`・`refund_boats`・`remark`・`course_*`のみを直す場合

いずれも`predictions`・`bet_recommendations`の計算に使われない列のみの変更であり、トリガーを発火させない方が正しい（現状は誤って発火している）。

### 4.2 懸念点・確認結果

- **他に予測へ影響しうる列が無いか**: 関数のSQL本文を直接確認済み（1.4節）。参照しているのは8列のみで、それ以外は一切参照していない。将来この関数を拡張する際は、DDLの`UPDATE OF`列リストも同時に更新する必要がある点をコメントで明記しておくべき（実装時の対応）
- **`race_results`への一回限りのバックフィルスクリプト**（`scripts/maintenance/backfill-*.js`群、`scripts/analysis/`配下）は網羅的な確認をしていない。多くは過去データの一括修正用でありrank/payout自体を書くものも多いため実害は無いと見られるが、DDL適用前の最終確認として4節冒頭のgrepを実施することを推奨する
- **moriartyの`bet_recommendations`更新**（`update-moriarty-outcomes.js`等）はこのトリガーに依存せず独自にrace_resultsを読んで判定しているため、発火条件を絞ってもmoriarty側のロジックへの影響は無い

## 5. 書き込み量削減の見積り

現時点の実測値（本番、2026-09-24、DB起動来またはstats reset以来の累積値）:

```
predictions:         n_tup_ins 1,419,936 / n_tup_upd 2,637,802 / n_tup_del 1,281,872 / TOAST 159MB
bet_recommendations: n_tup_ins 14,837    / n_tup_upd 258,031   / n_tup_del 313
race_results:        n_tup_ins 45,235    / n_tup_upd 315,436   / n_tup_del 0
```

参考値（`orchestration.md`、2026-09-19〜20の実測）: WS8(a)(b)適用後もpredictionsの更新は約26時間で+165,000件増加しており、`trg_update_predictions`の連鎖が主因と特定済み。また同ドキュメントの累積WAL実測では、predictionsのINSERT/DELETEだけで累積WAL 25.6GBの約43%を占める（INSERT 1回あたり約190KB、DELETE 1回あたり約96KB。1.2節の実測1行あたり2.4KB×3モデルとは粒度が異なる単位=バッチ処理あたりの値と見られる）。

各施策の効果を、独立要因ごとに整理する（**注: いずれも本番の実測を伴わない机上の見積りであり、実装後は`measure-unchanged-writes.js`と同様の手法でdry-run実測してから適用判断すべき**）:

| 施策 | 削減対象 | 見積りの根拠 | 概算インパクト |
|---|---|---|---|
| 2節: 差分更新（"diff" writeMode） | predictionsの`n_tup_upd`・`n_tup_ins`（値が変わらない行） | `top_pick`等の予測結果は、展示・オッズが変わらない限り同じレースへの複数回のリフレッシュ（60/30/15/10/5分前の最大5回）で変わらないことが多い。5回のリフレッシュ機会のうち実際に値が変わるのは主に展示反映後の1〜2回程度と推測されるため、**該当ケースで書き込みが発生する回数を最大5分の1〜2程度に圧縮できる可能性がある**（既存の`race_entries`等でのWS8(b)適用実績のオーダーに準ずる） | 中〜大（ただし対象は「値が変わらない場合」に限るため、レースごとのばらつきが大きい。実測必須） |
| 3節 対策0: 3モデル重複解消 | `feature_contributions`のTOASTバイト数 | 1.2節実測: 3行→1行で該当列のバイト数が約1/3に | 即時・確実（バイト数ベースで約66%減、TOAST 159MBのうち`safeBet`/`upsetFocus`相当分） |
| 3節 (a): 別テーブル分離 | predictions本体のUPDATE/INSERTからJSONB分の書き込みを除去 | 2節の差分更新と組み合わせた場合、`top_pick`等が変わらなければpredictions本体の書き込みそのものが発生しなくなる | 対策0・2節と組み合わせて初めて効果最大化。単独では書く場所が変わるだけで総量はほぼ不変 |
| 4節: トリガー限定 | predictions・bet_recommendationsの、rank/payout以外の`race_results`更新に起因する`n_tup_upd` | 1.4節で特定した無関係列更新の経路（`actual_course`同期・`rank4-6`backfill等）が、`race_results`の`n_tup_upd`(315,436)のうちどの程度を占めるかは列単位のWAL内訳が無いため正確な比率は算出できない。ただしorchestration.mdが「WS8(b)適用後も残る主因」と名指ししている経路であるため、**predictions側の残存する不要な`n_tup_upd`の相当部分（数十%オーダー）をこの1施策だけで削減できると見込む** | 中〜大（実測が必須。適用後に`pg_stat_user_tables`の`n_tup_upd`前後比較で検証する） |

## 6. 推奨ロードマップ

1. **即時（低リスク）**: 3節「対策0」（`feature_contributions`を`standard`行にのみ書く）を先行実装。1箇所の修正で確実な削減が見込め、他施策の前提にもなる
2. **次点**: 4節のDDL（`UPDATE OF`限定）をユーザー承認の上で適用。既存のBOA-349修正（WS8(b)）と役割が異なる（WS8(b)=「同じ値は書かない」、これ=「関係ない列の変更では発火しない」）ため、両方適用して初めて`trg_update_predictions`起因の残存分が解消する
3. **中期**: 2節の差分更新（"diff" writeMode）をGitHub Actions/Vercel両経路に導入し、"replace"を廃止する（"upsert"からの移行はロジック互換）
4. **要ユーザー判断のため保留**: 3節(a)別テーブル分離は、対策0適用後の実測でなお必要性が高い場合に着手。3節(c)（早期リフレッシュでの`feature_contributions`省略）はUXトレードオフのため製品判断を仰ぐ。3節(b)圧縮は不採用が妥当という結論
5. 各段階で`scripts/maintenance/measure-unchanged-writes.js`と同様のdry-run計測（本チケットでは実装しない）を挟み、見積り（5節）を実測で検証してから本番適用する運用を推奨する

## 未解決・別チケット行きの論点

- `predicted_at`列の意味変更（2.2節）は、消費している20以上のスクリプトの精査が必要で本調査では未実施
- `race_results`への一括UPDATE経路の完全な棚卸し（4.2節）は、一回限りのバックフィルスクリプト群まで含めた網羅確認はしていない
- 3節(c)（早期リフレッシュでの`feature_contributions`省略）はUXトレードオフを伴う製品判断が必要
