# BOA-695 race_conditions の race_title・is_final_day を race_series から埋める手順

`race_conditions` の行は K/B 補完で埋まったが、`race_title`（節名）と `is_final_day`（節の最終日か）は 2025-12・2026-01 が全行 NULL、2026-02 も一部 NULL のまま残っている。K ファイルの `is_final_day` は常に false のため使えない。原材料の `race_series`（節の名前・開始日・終了日）から、**NULL の列だけ**を埋める。

本番の実行はユーザーが行う（`--apply` の CLI と、バックアップ・戻し方の SQL）。Claude は dry-run と読み取りの確認までしか行わない。

## 埋める規則と根拠

- `race_title` = その会場・その日を含む `race_series` の `title`
- `is_final_day` = `race_date = race_series.end_date`
- 既に値がある列は触らない（CLI は既存値をそのまま渡し直す。バルク upsert で行ごとに列の集合を変えると、欠けた列が NULL になるため）
- 会場×日が `race_series` のどの節にも入らない行（unmatched）、2節以上に入る行（ambiguous）は書かない
- **照合**: 2025-12 以降で両方の値が既に入っている3,142会場日では、この規則での導出が `race_title`・`is_final_day` とも全件一致した（2026-10-04 の本番の読み取り）
- **順延の疑い**: 埋める行の節で、終了日の翌日に同じ会場のレースがあり、かつその日から始まる節が無いもの（終了日が実際の最終日とずれている疑い）は0件（同）

実装: `scripts/maintenance/backfill-race-series-meta.js final-title`（`series-day` は `series_day` が NULL の行だけを対象にするため、`series_day` が埋まっている今回の行を拾えない）。候補の作り方は `verify-race-series-final-title.js`（CI）で固定している。

## 月別の期待件数（2026-10-04 の dry-run）

| 月 | NULL を含む行 | 書き込み候補 | race_title を埋める | is_final_day を埋める（うち true） | unmatched / ambiguous |
|---|---|---|---|---|---|
| 2025-12 | 4,508 | 4,508 | 4,508 | 4,508（816） | 0 / 0 |
| 2026-01 | 5,166 | 5,166 | 5,166 | 5,166（936） | 0 / 0 |
| 2026-02 | 300 | 300 | 300 | 300（60） | 0 / 0 |
| 2026-03 | 0 | 0 | 0 | 0 | 0 / 0 |
| 2026-04 | 0 | 0 | 0 | 0 | 0 / 0 |
| 2026-05 | 9 | 9 | 9 | 9（2） | 0 / 0 |
| 2026-06 | 43 | 43 | 19 | 43（3） | 0 / 0 |
| 2026-07 | 43 | 43 | 43 | 43（13） | 0 / 0 |
| 2026-08 | 27 | 27 | 27 | 27（7） | 0 / 0 |
| 2026-09 | 39 | 39 | 39 | 39（4） | 0 / 0 |
| 計 | 10,135 | 10,135 | 10,111 | 10,135（1,841） | 0 / 0 |

2026-06 は、`race_title` が入っていて `is_final_day` だけが NULL の行が24行ある（その24行は `series_day` も NULL）。`series_day` はこの手順では埋めない（下の「対象外」）。

件数は実行の時点で、出走表の再取得等により少し変わることがある。**各回の dry-run の件数を正とし、この表と大きく違えば `--apply` せずに連絡する**。2026-10 以降は開催中の節を含むため対象にしない。

## 手順

### 0. 事前確認（読み取りのみ）

```sql
SELECT left(race_id, 7) AS ym,
       count(*) FILTER (WHERE race_title IS NULL)   AS title_null,
       count(*) FILTER (WHERE is_final_day IS NULL) AS final_null
  FROM race_conditions
 WHERE race_id >= '2025-12' AND race_id < '2026-10'
   AND (race_title IS NULL OR is_final_day IS NULL)
 GROUP BY 1 ORDER BY 1;
```

→ 上の表の「race_title を埋める」「is_final_day を埋める」と同じ数（2025-12: 4508 / 4508、2026-01: 5166 / 5166、2026-02: 300 / 300、2026-05: 9 / 9、2026-06: 19 / 43、2026-07: 43 / 43、2026-08: 27 / 27、2026-09: 39 / 39）。

### 1. 戻すためのバックアップを取る（SQL Editor）

書き込む前の値（NULL を含む行の race_id・race_title・is_final_day）を別の表に残す。戻すときにこの表だけを使う。

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS public.boa695_race_conditions_backup AS
  SELECT race_id, race_title, is_final_day, now() AS backed_up_at
    FROM race_conditions
   WHERE race_id >= '2025-12' AND race_id < '2026-10'
     AND (race_title IS NULL OR is_final_day IS NULL);
-- public に置く表は既定で anon から読めるため、RLS を有効にして閉じる（ポリシーなし＝service_role 以外は読めない）
ALTER TABLE public.boa695_race_conditions_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boa695_race_conditions_backup FROM anon, authenticated;
COMMIT;

SELECT count(*) FROM public.boa695_race_conditions_backup;
-- → 10135（0. の行数の合計。2026-06 は title_null ではなく final_null の 43 で数える）
```

### 2. 月ごとに dry-run → --apply（ターミナル）

月ごとに、まず dry-run で件数を見て、表と合えば `--apply` する。1か月ずつ進め、途中でエラーが出たらそこで止めて連絡する。

```bash
node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js final-title --from=2025-12-01 --to=2025-12-31
```

```bash
node --env-file=.env.local scripts/maintenance/backfill-race-series-meta.js final-title --from=2025-12-01 --to=2025-12-31 --apply
```

残りの月は `--from` / `--to` を次のとおり変えて、同じく dry-run → `--apply` を繰り返す（3月・4月は対象0件なので飛ばしてよい）。

| 月 | --from | --to |
|---|---|---|
| 2026-01 | 2026-01-01 | 2026-01-31 |
| 2026-02 | 2026-02-01 | 2026-02-28 |
| 2026-05 | 2026-05-01 | 2026-05-31 |
| 2026-06 | 2026-06-01 | 2026-06-30 |
| 2026-07 | 2026-07-01 | 2026-07-31 |
| 2026-08 | 2026-08-01 | 2026-08-31 |
| 2026-09 | 2026-09-01 | 2026-09-30 |

`--apply` の最後の行が `書き込み完了 N件` で、N が dry-run の「書き込み候補」と同じであること。

### 3. 事後確認（読み取りのみ）

```sql
-- (a) 残った NULL。0 行になる（2026-03・04 も含め、2025-12〜2026-09 で NULL が無い）
SELECT left(race_id, 7) AS ym,
       count(*) FILTER (WHERE race_title IS NULL)   AS title_null,
       count(*) FILTER (WHERE is_final_day IS NULL) AS final_null
  FROM race_conditions
 WHERE race_id >= '2025-12' AND race_id < '2026-10'
   AND (race_title IS NULL OR is_final_day IS NULL)
 GROUP BY 1 ORDER BY 1;

-- (b) 既に値があった列が変わっていない（バックアップで値があった列と現在の値の不一致）。→ 0
SELECT count(*)
  FROM public.boa695_race_conditions_backup b
  JOIN race_conditions c USING (race_id)
 WHERE (b.race_title IS NOT NULL AND c.race_title IS DISTINCT FROM b.race_title)
    OR (b.is_final_day IS NOT NULL AND c.is_final_day IS DISTINCT FROM b.is_final_day);

-- (c) 埋めた値が race_series からの導出と一致する。→ mismatch = 0、checked = 10135
SELECT count(*) AS checked,
       count(*) FILTER (
         WHERE c.race_title IS DISTINCT FROM s.title
            OR c.is_final_day IS DISTINCT FROM (r.race_date = s.end_date)
       ) AS mismatch
  FROM public.boa695_race_conditions_backup b
  JOIN race_conditions c USING (race_id)
  JOIN races r USING (race_id)
  JOIN race_series s
    ON s.venue_code = r.venue_code AND r.race_date BETWEEN s.start_date AND s.end_date;

-- (d) 最終日の数。→ 1841（表の「うち true」の合計）
SELECT count(*)
  FROM public.boa695_race_conditions_backup b
  JOIN race_conditions c USING (race_id)
 WHERE b.is_final_day IS NULL AND c.is_final_day = true;
```

(c) は、`race_title` が既にあった2026-06の24行も含めて照合する（既存値も race_series と一致していることの確認を兼ねる）。

確認が済んだら、data-catalog（`docs/design/scraping-vercel-consolidation/data-catalog.md` の N16 等）の充足率を更新する。バックアップの表は、画面の確認が済んでから消す（下の「後片付け」）。

## 戻し方

バックアップの値に戻す（バックアップで NULL だった列は NULL に戻る。値があった列は同じ値なので変わらない）。

```sql
BEGIN;
UPDATE race_conditions c
   SET race_title = b.race_title,
       is_final_day = b.is_final_day
  FROM public.boa695_race_conditions_backup b
 WHERE c.race_id = b.race_id;
-- → UPDATE 10135（バックアップの行数）
COMMIT;
```

途中の月で止めた場合も同じ SQL でよい（まだ書いていない月の行は、もともと同じ値なので変わらない）。

## 後片付け

```sql
DROP TABLE IF EXISTS public.boa695_race_conditions_backup;
```

## 対象外

- `series_day` が NULL の行（2026-05: 12、2026-06: 24、2026-10: 4。2026-10-04 時点）は、この手順では埋めない。`series-day` サブコマンド（`--from` / `--to` を月に合わせて dry-run → `--apply`）の対象で、BOA-695 の範囲外
- 2026-10 以降の行（開催中の節を含む。取り込みの通常の経路で埋まる）
