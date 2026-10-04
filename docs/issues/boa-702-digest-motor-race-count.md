# BOA-702 後半: 本日のデータ一覧に会場公式のモーター出走数を持たせる（マイグレーション131）の適用手順

「本日のデータ一覧」（/today）のカードは、一度も使われていない新モーターの2連率を「モーター2連率 0.0%」と出しており、「2着以内0回」と読まれる。データ出走表（PR #1241）と同じ判定（`src/utils/motorUsage.js`）で「モーター2連率 —（新モーター・実績なし）」に切り替えるため、/today が読む `morning_digest_rows` に会場公式の出走数 `motor_race_count` を足す（ADR-0070 で /today は `morning_digest_days`・`morning_digest_rows` の2表だけを読む）。

本番の実行はユーザーが行う（Supabase Dashboard > SQL Editor）。

| 手順 | 内容 | 必須 |
|---|---|---|
| 1 | 列を足す（マイグレーション131） | 必須 |
| 2 | 適用の確認 | 必須 |
| 3 | 既存の行に出走数を埋める | 任意（過去日を `?date=` で開いたときの表示を直す） |

**コードのマージとの順序は問わない**。生成スクリプト（`scripts/daily/generate-morning-digest.js`）は列が無ければこの列だけを除いて書き、画面は NULL を「分からない」として従来どおり「0.0%」を出す。適用後の最初の生成（`generate-morning-digest.yml`）から新しい行に値が入る。

## 1. 列を足す

`docs/db-migration/131_morning_digest_rows_motor_race_count.sql` の全文を実行する（BEGIN〜COMMIT を含む）。NULL 可・既定値なしの列の追加はメタデータの変更だけで一瞬（表は約600行）。

```sql
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE morning_digest_rows
  ADD COLUMN IF NOT EXISTS motor_race_count integer;

COMMENT ON COLUMN morning_digest_rows.motor_race_count IS
  '会場公式のモーター出走数（venue_motor_stats.race_count、digest_date 以前で最新）。0 かつ motor_2rate=0 なら未使用の新モーター（BOA-702）。NULL＝分からない';

COMMIT;
```

## 2. 適用の確認（読み取りのみ）

```sql
SELECT data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'morning_digest_rows' AND column_name = 'motor_race_count';
-- → integer / YES

SELECT has_column_privilege('anon', 'public.morning_digest_rows', 'motor_race_count', 'SELECT');
-- → true（098 の表単位の GRANT SELECT がそのまま効く）
```

適用後、APPLIED.md の 131 の行を「適用済み」に直す（根拠に上の結果を書く）。

## 3. 既存の行に出走数を埋める（任意）

列の追加前に生成した行は NULL のまま（画面は従来どおり「0.0%」）。過去日の表示も直す場合だけ実行する。生成スクリプトと同じ条件（同じ会場・同じモーター番号の、digest_date 以前で最新のスナップショット）で埋める。値が NULL の行だけを対象にし、生成スクリプトが書いた値は上書きしない。

### 3-1. 事前確認（読み取りのみ。件数を控える）

```sql
WITH src AS (
  SELECT m.digest_date, m.section, m.rank, m.motor_2rate,
         (SELECT v.race_count
            FROM venue_motor_stats v
           WHERE v.venue_code = m.venue_code
             AND v.motor_number = re.motor_number
             AND v.scraped_date <= m.digest_date
           ORDER BY v.scraped_date DESC
           LIMIT 1) AS rc
    FROM morning_digest_rows m
    JOIN race_entries re ON re.race_id = m.race_id AND re.boat_number = m.boat_number
   WHERE m.motor_2rate IS NOT NULL
     AND m.motor_race_count IS NULL
)
SELECT count(*)                                         AS target_rows,
       count(rc)                                        AS will_fill,
       count(*) FILTER (WHERE motor_2rate = 0 AND rc = 0) AS unused_motor_rows
  FROM src;
```

2026-10-04 の本番の読み取り（2026-09-22〜10-04、全608行）: `target_rows=486` / `will_fill=309` / `unused_motor_rows=8`。生成が進むと増えるため、実行時点のこの SELECT の値を正とする。`will_fill` が `target_rows` より少ないのは、会場公式の出走数が無い会場（桐生・浜名湖・常滑・三国・びわこ・住之江・尼崎は列が無く、戸田・平和島はページが無い）の行があるため。

### 3-2. 埋める

```sql
BEGIN;
SET LOCAL lock_timeout = '10s';

WITH src AS (
  SELECT m.digest_date, m.section, m.rank,
         (SELECT v.race_count
            FROM venue_motor_stats v
           WHERE v.venue_code = m.venue_code
             AND v.motor_number = re.motor_number
             AND v.scraped_date <= m.digest_date
           ORDER BY v.scraped_date DESC
           LIMIT 1) AS rc
    FROM morning_digest_rows m
    JOIN race_entries re ON re.race_id = m.race_id AND re.boat_number = m.boat_number
   WHERE m.motor_2rate IS NOT NULL
     AND m.motor_race_count IS NULL
)
UPDATE morning_digest_rows m
   SET motor_race_count = src.rc
  FROM src
 WHERE m.digest_date = src.digest_date
   AND m.section = src.section
   AND m.rank = src.rank
   AND src.rc IS NOT NULL;
-- → UPDATE <3-1 の will_fill と同じ件数>。違えば ROLLBACK; して連絡する

COMMIT;
```

### 3-3. 事後確認（読み取りのみ）

```sql
SELECT count(*) FILTER (WHERE motor_race_count IS NOT NULL)                   AS filled,
       count(*) FILTER (WHERE motor_2rate = 0 AND motor_race_count = 0)        AS unused_motor_rows,
       count(*) FILTER (WHERE motor_2rate IS NULL AND motor_race_count IS NOT NULL) AS must_be_zero
  FROM morning_digest_rows;
-- → filled = 3-1 の will_fill（＋適用後に生成された行のぶん）、unused_motor_rows = 3-1 の unused_motor_rows（同）、must_be_zero = 0
```

画面の確認: 2026-10-04 の行では、注目レースとまくりの唐津8R 3号艇（モーター65、会場公式の出走数0）が「モーター2連率 —（新モーター・実績なし）」になる。`https://www.boat-ai.jp/today?date=2026-10-04` を開き、注目レースのカードと、まくりの該当カードを開いて（▼）フッターを見る。キャッシュ（当日30分・過去日7日）があるため、反映まで時間がかかることがある。

## 戻し方

列ごと消す（値も消える。他の列・表には影響しない）。生成スクリプトは列が無ければ除いて書くので、戻した後も生成は止まらない。

```sql
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE morning_digest_rows DROP COLUMN IF EXISTS motor_race_count;
COMMIT;
```

手順3だけを戻す場合（列は残し、埋めた値だけ消す）は、適用前の状態（生成スクリプトが書いた行以外は NULL）に厳密には戻せない。必要なら次で全行を NULL にし、当日分は生成の再実行（`node scripts/daily/generate-morning-digest.js`）で書き直す。

```sql
UPDATE morning_digest_rows SET motor_race_count = NULL WHERE motor_race_count IS NOT NULL;
```
