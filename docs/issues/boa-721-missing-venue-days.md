# BOA-721 races が丸1日無い会場日

## 事象と原因（2026-10-03、本番の読み取りと公式ページの確認）

race_series の期間内で races の無い会場日を、2025-12〜2026-10-02 で全件探すと、7会場日あった。原因は2種類。

| 型 | 会場日 | 公式のページ | 原因 |
|---|---|---|---|
| (A) | 2026-06-03 江戸川（03）・蒲郡（07） | 出走表・発走時刻あり（節の初日、全日中止） | 当時の朝の初期化（GitHub Actions）が 00:13 JST に動いた。開催場一覧が当日分に切り替わる前だったので、新節の初日の会場を取りこぼした。同じ時刻に、節の途中の津・三国は作られている。9/12 の #625 で、hd= の指定と9時前の再確認を入れて直した不具合と同じ |
| (B) | 尼崎（13）5/17・5/18、津（09）7/30・7/31・8/1 | 開催場一覧には「中止」で載る。出走表・直前情報は「データがありません」、発走時刻も無い | 前日の中止の後の節の打ち切り（番組が無い日） |

- 再発: (A) は今の races-init（hd= の指定と再確認）では起きない。9/21 の戸田・江戸川の全日中止も、初期化で races が作られている。
- (B) は、今の races-init でも「毎回失敗する会場」になる。その会場が済まないので、その日の後始末（unified の生成・Deploy Hook）が走らない。9/21 に live になってから、この型の日はまだ無い（読み取りで確認）。
- 直し: races-init で、一覧で日全体の中止 かつ 1R の出走表が「データがありません」の会場は、失敗にせず「済み（番組なし）」にする。races は作らない。片方だけなら、従来どおり失敗にする。

## (A) の補完（ユーザー）

公式の出走表から、通常の朝の初期化と同じ経路で races・race_entries・race_conditions を作り、中止の確定（cancellation_status='confirmed'）を立てる。同じ日の津（全日中止）と同じ形。予想は作らない（過去の日付は全レースが発走済みで、書き込み側が予想を書かない。書いた後に0件を確かめる）。

### 1. dry-run（DB は読むだけ。公式の出走表を取得する）

```bash
node --env-file=.env.local scripts/maintenance/backfill-missing-venue-day.js --date=2026-06-03 --venues=3,7 --cancelled
```

期待: 会場3・7 とも 12レース・出走表 72艇。`[DRY-RUN] 書く会場 3,7・races 24・race_entries 144`

### 2. 書き込み

```bash
node --env-file=.env.local scripts/maintenance/backfill-missing-venue-day.js --date=2026-06-03 --venues=3,7 --cancelled --apply
```

期待: `[APPLY] races 24/24・中止の確定 24・予想 0件（0のはず）`

### 3. 確認（読み取り）

```sql
SELECT venue_code, count(*) AS races, count(*) FILTER (WHERE cancellation_status = 'confirmed') AS confirmed,
  (SELECT count(*) FROM race_entries e WHERE e.race_id LIKE '2026-06-03-0' || r.venue_code || '-%') AS entries
FROM races r WHERE race_date = '2026-06-03' AND venue_code IN (3, 7) GROUP BY venue_code ORDER BY 1;
```

期待: 会場3・7 とも `12 / 12 / 72`

## 元に戻す

races を消すと、race_entries・race_conditions 等は外部キーの CASCADE で消える（sns_campaign_entries だけは CASCADE でないが、過去の日付なので行は無い）。

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM races WHERE race_date = '2026-06-03' AND venue_code IN (3, 7);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 24 THEN
    RAISE EXCEPTION '削除が % 行（期待 24）。取り消します', n;
  END IF;
END $$;
COMMIT;
```

## (B) の扱い

races を作らない（オーケストレーター判断、2026-10-03）。番組が無く、公式の出走表も存在しないため。事実は data-catalog の E11 に記録した。
