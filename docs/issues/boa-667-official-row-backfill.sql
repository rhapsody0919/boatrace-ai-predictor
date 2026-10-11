-- BOA-667: race_start_timings.official_row（公式の着順表の行の順）の過去分を、DB の着・着欄から導いて埋める（手順 A）。
-- 手順書: docs/issues/boa-667-official-row-backfill.md（実行順・事前事後の確認・戻し方はそちら）。
--
-- 導出の規則: 完走した艇（finish_rank あり）を着の昇順、同着は艇番の昇順。その後に、完走しなかった艇を艇番の昇順。
--   完走しなかった艇の記号が1種類以下のレースだけを対象にする（記号の種類の間の順は公式で確定できていないため、
--   2種類以上のレースと、着欄が NULL の艇がいるレースは対象外。手順 B の結果ページの取り直しで埋める）。
--   既に official_row がある艇が1艇でもいるレースは対象外（取得時に書かれた値・取り直しで書かれた値を上書きしない）。
-- 根拠: 2026-10-04 時点で本番に official_row がある368レースのうち、規則の対象になる363レース・2,178行で、
--   規則の値と本番の値が全件一致（PGlite で値を消してから、この SQL で埋め直して照合。同着19・同じ記号の非完走2艇以上39を含む）。
-- 合計の期待: 45,129レース・270,774行の UPDATE（11回）。1回あたり約2.5〜3万行。Disk IO のため、回の間を数分あける。
-- updated_at は書き込みの時刻になる（取得の時刻ではない。戻し方の判定に使う）。

-- ===== 2025-12（2025-12-01 〜 2026-01-01 の前日）: 期待 4,237レース・25,422行 =====
-- dry-run（読み取りのみ）→ 期待: races=4237, rows=25422
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2025-12-01' AND race_id < '2026-01-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 25422
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2025-12-01' AND race_id < '2026-01-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-01（2026-01-01 〜 2026-02-01 の前日）: 期待 4,914レース・29,484行 =====
-- dry-run（読み取りのみ）→ 期待: races=4914, rows=29484
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-01-01' AND race_id < '2026-02-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 29484
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-01-01' AND race_id < '2026-02-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-02（2026-02-01 〜 2026-03-01 の前日）: 期待 3,973レース・23,838行 =====
-- dry-run（読み取りのみ）→ 期待: races=3973, rows=23838
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-02-01' AND race_id < '2026-03-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 23838
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-02-01' AND race_id < '2026-03-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-03（2026-03-01 〜 2026-04-01 の前日）: 期待 4,442レース・26,652行 =====
-- dry-run（読み取りのみ）→ 期待: races=4442, rows=26652
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-03-01' AND race_id < '2026-04-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 26652
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-03-01' AND race_id < '2026-04-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-04（2026-04-01 〜 2026-05-01 の前日）: 期待 4,170レース・25,020行 =====
-- dry-run（読み取りのみ）→ 期待: races=4170, rows=25020
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-04-01' AND race_id < '2026-05-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 25020
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-04-01' AND race_id < '2026-05-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-05（2026-05-01 〜 2026-06-01 の前日）: 期待 4,613レース・27,678行 =====
-- dry-run（読み取りのみ）→ 期待: races=4613, rows=27678
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-05-01' AND race_id < '2026-06-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 27678
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-05-01' AND race_id < '2026-06-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-06（2026-06-01 〜 2026-07-01 の前日）: 期待 4,455レース・26,730行 =====
-- dry-run（読み取りのみ）→ 期待: races=4455, rows=26730
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-06-01' AND race_id < '2026-07-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 26730
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-06-01' AND race_id < '2026-07-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-07（2026-07-01 〜 2026-08-01 の前日）: 期待 4,754レース・28,524行 =====
-- dry-run（読み取りのみ）→ 期待: races=4754, rows=28524
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-07-01' AND race_id < '2026-08-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 28524
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-07-01' AND race_id < '2026-08-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-08（2026-08-01 〜 2026-09-01 の前日）: 期待 4,735レース・28,410行 =====
-- dry-run（読み取りのみ）→ 期待: races=4735, rows=28410
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-08-01' AND race_id < '2026-09-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 28410
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-08-01' AND race_id < '2026-09-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-09（2026-09-01 〜 2026-10-01 の前日）: 期待 4,503レース・27,018行 =====
-- dry-run（読み取りのみ）→ 期待: races=4503, rows=27018
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-09-01' AND race_id < '2026-10-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 27018
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-09-01' AND race_id < '2026-10-01'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;

-- ===== 2026-10（2026-10-01 〜 2026-10-03 の前日）: 期待 333レース・1,998行 =====
-- dry-run（読み取りのみ）→ 期待: races=333, rows=1998
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-10-01' AND race_id < '2026-10-03'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
SELECT count(DISTINCT race_id) AS races, count(*) AS rows FROM ranked;

-- 本体（dry-run の件数が期待と合ったら実行）→ 期待: UPDATE 1998
BEGIN;
WITH eligible AS (
  SELECT race_id
  FROM race_start_timings
  WHERE race_id >= '2026-10-01' AND race_id < '2026-10-03'
  GROUP BY race_id
  HAVING count(*) FILTER (WHERE official_row IS NOT NULL) = 0
     AND count(*) FILTER (WHERE finish_rank IS NULL AND finish_mark IS NULL) = 0
     AND count(DISTINCT finish_mark) FILTER (WHERE finish_rank IS NULL) <= 1
     AND count(*) FILTER (WHERE finish_mark IS NOT NULL) > 0
), ranked AS (
  SELECT t.race_id, t.boat_number,
         row_number() OVER (PARTITION BY t.race_id ORDER BY t.finish_rank ASC NULLS LAST, t.boat_number ASC) AS rn
  FROM race_start_timings t
  JOIN eligible e ON e.race_id = t.race_id
)
UPDATE race_start_timings t
SET official_row = r.rn, updated_at = now()
FROM ranked r
WHERE t.race_id = r.race_id AND t.boat_number = r.boat_number AND t.official_row IS NULL;
COMMIT;
