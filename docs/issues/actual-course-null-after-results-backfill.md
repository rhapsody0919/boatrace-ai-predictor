# 実進入コースが全て NULL の過去レース（BOA-523）

## 何が起きていたか

`race_results.actual_course_1〜6`（Kファイル由来の実進入コース。BOA-257）が6列とも NULL の過去レースが **1,499件**（58日）あった（2026-09-29 の本番の読み取り）。

| 月 | 件数 |
|---|---:|
| 2025-12 | 12 |
| 2026-04 | 62 |
| 2026-05 | 282 |
| 2026-06 | 386 |
| 2026-07 | 336 |
| 2026-08 | 133 |
| 2026-09 | 288 |

ほぼ全てが「会場×日」の丸ごとで、同じ日の他の会場は埋まっている。

## 原因

**結果の行が、日次のKファイル同期より後に作られた。**

- 1,499件の結果の行は、全て 2026-09-21（1,476件）と 2026-09-28（23件）に作られていた（`race_results.created_at`）。過去日の結果のバックフィルで入った行
- 日次のKファイル同期（`syncKFileForDate`、07:00 JST）は、直近 `KFILE_SYNC_LOOKBACK_DAYS`（4）日しか遡らず、`race_results` に既にある行だけを更新する（`writeMissing: false`）。同期の時点で結果の行が無かったレースは、後から行が入っても、進入が書かれない
- Kファイルのパーサーの問題ではない。欠けた会場（例: 2026-09-11 の 02・06・12）もKファイルから正しく読める
- 4〜6着（`rank4〜6`）は、結果ページの解析（BOA-362）でも入るため、同じレースでも埋まっている

`src/services/supabaseDataService.js` の `courseOfBoat` などは、6列とも NULL のとき艇番をコースとして使う。そのため、該当のレースは枠番別成績の「コース」が実進入とずれていた。

## 本番で実行すること（ユーザー）

本番DBへの書き込みのため、ユーザーの端末で実行する。書き込むのは **6列とも NULL の行の `actual_course_1〜6` だけ**（NULL → 値）。既に入っている値は書き換えない。

### 1. 事前確認（読み取り。Supabase Dashboard の SQL Editor）

```sql
select count(*) from races r join race_results rr on rr.race_id = r.race_id
where r.race_date < current_date and r.cancellation_status is null
  and rr.actual_course_1 is null and rr.actual_course_2 is null and rr.actual_course_3 is null
  and rr.actual_course_4 is null and rr.actual_course_5 is null and rr.actual_course_6 is null;
```

期待値: **1499**（2026-09-29 時点。以後の日次の同期で当日分は埋まるため、実行日によって増えない）

### 2. dry-run（読み取りのみ。リポジトリの直下で）

```bash
node --env-file=.env.local scripts/maintenance/backfill-actual-course.js --from=2025-12-01 --to=2026-09-27 --dry-run
```

期待値: 最後に `処理日数: 58`・`エラー: 0日`・`更新レース数合計: 1499件`。`未取得だがKファイルに無かった件数` の行は出ない。1日1回Kファイルをダウンロードするため、10分前後かかる（2026-09-29 に3分割して実行して確認済み: 12件＋502件＋985件）

### 3. 本番実行

```bash
node --env-file=.env.local scripts/maintenance/backfill-actual-course.js --from=2025-12-01 --to=2026-09-27
```

期待値: `処理日数: 58`・`エラー: 0日`・`更新レース数合計: 1499件`。`該当行なし` は0件。

途中で止まっても、そのまま同じコマンドを再実行してよい（書き終えた日は「既に同期済み」でスキップする）。`エラー` の日があれば、その日だけ `--from`・`--to` に指定して再実行する。

### 4. 事後確認（読み取り）

1 の SQL を再実行する。期待値: **0**

あわせて、埋まった値に、進入が枠番どおりでないレースが含まれることを確かめる（実データが入った）。対象は、結果の行が後から作られた（2026-09-21・28）レース:

```sql
select count(*) as total,
       count(*) filter (where rr.actual_course_1 is not null) as filled,
       count(*) filter (where rr.actual_course_1 is not null
                          and (rr.actual_course_1 <> 1 or rr.actual_course_2 <> 2 or rr.actual_course_3 <> 3)) as course_changed
from races r join race_results rr on rr.race_id = r.race_id
where r.race_date < '2026-09-12' and r.cancellation_status is null
  and rr.created_at::date in ('2026-09-21', '2026-09-28');
```

期待値: `total` は 1499。実行前は `filled`・`course_changed` とも0（2026-09-29 に確認）。実行後は `filled` が1499（1号艇が欠場したレースがあれば、その分だけ少ない）、`course_changed` が0より大きい。

## 再発の防止（未実装。判断が要る）

過去日の結果をバックフィルすると、また同じことが起きる。案:

1. **運用で防ぐ**: 過去日の結果をバックフィルしたら、その期間で `backfill-actual-course.js` を実行する（このスクリプトの冒頭のコメントに記載済み）
2. **監視で気づく**: 日次監視 data_health の `coverage.actual_course` は直近7日しか見ないため、バックフィルした古い日の欠けに気づかない。全期間の週次の集計を足す
3. **同期で直す**: 日次のKファイル同期が遡る日数を広げる。ただし、Kファイルに載らないレースがある日は、毎日ダウンロードし直すことになる
