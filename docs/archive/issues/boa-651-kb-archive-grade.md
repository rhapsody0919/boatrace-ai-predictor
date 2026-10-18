# BOA-651 長期データ（kb_archive_venue_days）のグレードの補完

## 事象

`kb_archive_venue_days`（2019-04-01〜2025-12-02、31,023会場日）の `race_grade` が全件 NULL。

原因は、`scripts/lib/kbArchiveRows.js` が `race_grade: null` を固定で書いていたこと。コメントには「race/index で後から補完する」とあったが、その補完は実装されていなかった。

この影響で、BOA-271 の Phase M では、長期 362,927レースのうち 10.6%（38,477レース）のグレードが「不明」になった。

## 調べたこと（2026-10-02、読み取りのみ）

| 方法 | 正解（races.race_grade、2025-12-03〜2026-09-30 の3,863会場日）との一致 | 長期で付く会場日 |
|---|---|---|
| K/B の節名だけ（SG・G1・G2・レディース等の名称の規則） | 96.7%。不一致はすべて「企業杯の G3 → 一般」で、同じ名前の一般戦があるため節名では区別できない | 全件。ただし約3%が誤り |
| **`race_series` の kind（下の対応付け）** | **100%** | 31,011（99.96%） |

- K/B にはグレードの項目が無い。分かるのは節名だけ。
- `race_series`（会場×開催期間、月間スケジュール由来）の `grade` は、lady・masters・venus・rookie だけ NULL になっている。正解との突き合わせで、次の対応付けに例外は1件も無かった。

| kind | グレード | 正解との一致 |
|---|---|---|
| sg・g1・g2・g3・ippan | `grade` のまま | すべて一致 |
| lady（オールレディース） | G3 | 96/96 |
| masters（マスターズリーグ） | G3 | 34/34 |
| venus（ヴィーナスシリーズ） | ippan | 104/104 |
| rookie（ルーキーシリーズ） | ippan | 91/91 |

- 長期の31,023会場日は、すべて `race_series` の1件以下に当たる（2件以上に当たる日は0）。当たらないのは12日（2019-04-01〜05。e‐SHINBUN杯・金陵カップ・チケットショップ富士おやま4周年記念）で、節名の規則ではいずれも一般になる。この12日（144レース）は ippan で埋める（オーケストレーターの判断。NULL のままだと「不明」が残るため）。
- 補完した後の内訳（見込み）: ippan 26,407（26,395＋12日）・G3 2,445・G1 1,477・G2 369・SG 325。

注意:

- 対応付けが正しいことの検証は、2025-12〜2026-09 の正解でしか取れていない。2019〜2024 は、制度（オールレディース・マスターズリーグは G3）からの推定。
- 同時開催の節は、上位のグレードに寄る（例: グランプリシリーズの日は SG）。races と同じ約束。
- 由来（race_series か、節名の推定か）を残す列は足さない。12日分のためだけにマイグレーションを足すのは過剰なので、ここに記録する。

## 再発の防止（コード）

`kbArchiveRows.js` は、`race_grade` の列を行に入れないようにした。`null` を送ると、長期データの読み込み（`kb-backfill.js load`）の再実行が、補完した値を NULL で上書きする。`load` は `upsertChangedRows` を使い、値の違う行を書くため。`verify-kb-file-parser.js` で固定した。

## 本番の実行（ユーザー。開催時間帯でもよい。トリガーは無い）

### 事前の確認（読み取り）

```sql
select count(*) total, count(race_grade) graded from kb_archive_venue_days;
```

期待: `31023 / 0`

### 書き込み（1ブロック。件数が31,023でなければ取り消す）

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  UPDATE kb_archive_venue_days v SET race_grade = g.grade
  FROM (
    SELECT v2.venue_day_id,
      coalesce(
        max(coalesce(s.grade, CASE s.kind
          WHEN 'lady' THEN 'G3' WHEN 'masters' THEN 'G3'
          WHEN 'venus' THEN 'ippan' WHEN 'rookie' THEN 'ippan' END)),
        'ippan'  -- race_series に当たらない12日（2019-04-01〜05）。節名の規則で一般
      ) AS grade
    FROM kb_archive_venue_days v2
    LEFT JOIN race_series s
      ON s.venue_code = v2.venue_code AND v2.race_date BETWEEN s.start_date AND s.end_date
    GROUP BY v2.venue_day_id
  ) g
  WHERE v.venue_day_id = g.venue_day_id AND v.race_grade IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 31023 THEN
    RAISE EXCEPTION '更新件数が % 件（期待 31,023）。取り消します', n;
  END IF;
END $$;
COMMIT;
```

### 事後の確認（読み取り）

```sql
select race_grade, count(*) from kb_archive_venue_days group by 1 order by 2 desc;
```

期待: `ippan 26407・G3 2445・G1 1477・G2 369・SG 325`（NULL は0）

## 元に戻す

```sql
update kb_archive_venue_days set race_grade = null;
```

元はすべて NULL だったので、全件を NULL に戻せば元どおりになる。
