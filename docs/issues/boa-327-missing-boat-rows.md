# 欠場艇等の行の補完（BOA-327 の前提）

## 事象

2025-12〜2026-09-20 の `race_start_timings` に、欠場艇（K0/K1）の行がほとんど無い。事故率（BOA-327）では、選手責任の欠場 K1 は事故点10点で、出走回数の分母にも入る。そのため、行が抜けていると事故率が低く出る。

原因（コードで確認、2026-10-03）:

- 結果ページの取得: マイグレーション077 の前（〜2026-09-20）は、ST のある艇の行だけを書いていた（`raceResultRows.buildTimingRows` の extended=false）。077 の後（9/21〜）は、欠場艇も「欠」の行を書いている。今後の分は欠けない。
- K の補完（項目4、`--item=st`）: 進入コースの無い艇（欠場）を飛ばしていた。対象も、行が1つも無いレースだけだった。
- K の日次同期（kfile_sync）: 既存の行の成績コードを UPDATE するだけで、行は作らない。

## 補完の内容

`backfill-kb-gaps.js --item=missing_boats` で、K の成績にあって `race_start_timings` に行の無い艇の行を挿入する。races にあるレースだけが対象で、既存の行には触れない（insert、重複は無視）。

行の形は、9/21 以降の結果ページの取得が書く行と同じにする。

| 艇 | start_timing | is_flying / is_late_start | entry_course | finish_mark / finish_rank | official_finish_code |
|---|---|---|---|---|---|
| 欠場（K0/K1） | NULL | false / false | NULL | 欠 / NULL | K0・K1 |
| 走った艇（進入あり） | K の ST（F は絶対値） | K のとおり | K の進入 | 成績コードから（01〜06 は着、F は F） | K のとおり |
| 出遅れ（L0/L1） | NULL | false / true | NULL | L / NULL | L0・L1 |

- `created_at` は NULL（バックフィルの行は、取得時刻を偽らない）。`updated_at` は書き込みの時刻。
- 読み手の監査は済んでいる。欠場艇の行を出走・ST として数えていた読み手は、#1195 で直した（この補完の前にマージする）。

## 期待件数（dry-run、2026-10-03 の朝）

| 月 | 書く行 |
|---|---:|
| 2025-12 | 58 |
| 2026-01 | 77 |
| 2026-02 | 54 |
| 2026-03 | 49 |
| 2026-04 | 39 |
| 2026-05 | 31 |
| 2026-06 | 48 |
| 2026-07 | 46 |
| 2026-08 | 47 |
| 2026-09 | 24 |
| 計 | 473 |

内訳:

- 欠場 K0: 329
- 欠場 K1: 105
- 進入のある艇（実際に走った艇）: 31。行が丸ごと無いレース2つ（2026-07-19 びわこ12R、2026-09-16 下関7R）を含む
- 出遅れ L0: 6、L1: 2

全行が出走表（race_entries）にあり、中止確定でなく結果のあるレース。9月が少ないのは、9/21 以降は結果ページの取得で欠場艇の行が入っているため。

## 本番の実行（ユーザー。開催時間帯でもよい。トリガーは無い）

### 1. 控え（実行の前の行のキー）を取る

戻すときに、実行の前からあった行と足した行を区別するために使う。

```sql
CREATE TABLE backup_boa327_rst_keys AS
SELECT race_id, boat_number FROM race_start_timings
WHERE race_id >= '2025-12' AND race_id < '2026-10';
ALTER TABLE backup_boa327_rst_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_boa327_rst_keys FROM anon, authenticated;
SELECT count(*) FROM backup_boa327_rst_keys;
```

期待: 279,746（BOA-582 の補完の後の行数。実行時点の行数）

### 2. 補完（月ごと、または全期間を1回）

まず dry-run で件数を確かめる。上の表と一致すること。

```bash
node --env-file=.env.local scripts/maintenance/backfill-kb-gaps.js --item=missing_boats --from=2025-12-01 --to=2026-09-30
```

続けて書き込む。473行なので、1回でよい（1文200行以下、文の間に1秒）。

```bash
node --env-file=.env.local scripts/maintenance/backfill-kb-gaps.js --item=missing_boats --from=2025-12-01 --to=2026-09-30 --apply
```

### 3. 事後の確認（読み取り）

```sql
SELECT left(race_id, 7) AS ym,
  count(*) FILTER (WHERE official_finish_code IN ('K0','K1')) AS absent,
  count(*) FILTER (WHERE official_finish_code = 'K1') AS k1
FROM race_start_timings WHERE race_id >= '2025-12' AND race_id < '2026-10'
GROUP BY 1 ORDER BY 1;

SELECT count(*) FROM race_start_timings t
WHERE t.race_id >= '2025-12' AND t.race_id < '2026-10'
  AND NOT EXISTS (SELECT 1 FROM backup_boa327_rst_keys b WHERE b.race_id = t.race_id AND b.boat_number = t.boat_number);
```

期待:

- 欠場の行が各月にある（全期間で K0 は 329 以上、K1 は 105 以上。9/21 以降の結果ページ由来の行を含む）
- 足した行の数が 473

## 元に戻す

足した行（控えに無く、created_at が NULL の行）だけを消す。

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM race_start_timings t
  WHERE t.race_id >= '2025-12' AND t.race_id < '2026-10'
    AND t.created_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM backup_boa327_rst_keys b
                    WHERE b.race_id = t.race_id AND b.boat_number = t.boat_number);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 473 THEN
    RAISE EXCEPTION '削除が % 行（期待 473）。取り消します', n;
  END IF;
END $$;
COMMIT;
```

`created_at IS NULL` で絞るので、控えの後に日々の取得が足した行（created_at がある）は消さない。範囲は 2026-09 以前に限る。

## 控えを消す

補完の後、翌日の data_health と選手の集計（23:00）に異常が無ければ、`DROP TABLE backup_boa327_rst_keys;` を実行する。
