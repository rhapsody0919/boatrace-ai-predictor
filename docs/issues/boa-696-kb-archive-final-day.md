# BOA-696 長期データ（kb_archive_venue_days）の最終日フラグの補完

## 事象

`kb_archive_venue_days`（2019-04-01〜2025-12-02、31,023会場日）の `is_final_day` が全件 false だった（2026-10-02、本番の読み取り）。

原因は K/B ファイルの書き方。最終日も「第N日」と書き、「最終日」とは書かない。例として、大村 2025-12-06 は節の最終日（race_series の終了日）だが「第 4日」と書かれている。2019-04〜2026-09 の全ファイルで、日の見出しが「最終日」のものは0件だった（「最終」の文字は節名の「最終戦」等だけ）。`kbFileParser.js` は見出しが「最終日」のときだけ true にするので常に false になり、`kbArchiveRows.js` がそれを書いていた。

影響: BOA-271（アナロジー・ファインダー）の特徴量 `is_final_day_num`（`scripts/ml/analogy/features.py`）が、長期36万レースのすべてで「最終日でない」になっていた。本体（2025-12〜）の `race_conditions.is_final_day` には true がある。

## 判定の規則: race_series の終了日

`is_final_day = (race_date が、その会場の race_series の end_date)`。race_series に当たらない12日（2019-04-01〜05）だけは、成績のある優勝戦がその日にあるかで判定する。

候補だった「優勝戦のある日」と比べた（本番の読み取り）。

- 両方が一致: 5,443日
- 食い違い: 136日。中身はすべて、終了日の規則が正しかった。
  - 35日: 優勝戦が中止されて翌日に行われた（同じ「第N日」が2日続く。例: 2019-06-27 蒲郡は 12R 優勝戦が成績なし、翌 06-28 に成績あり）。成績のある優勝戦に限ると、終了日以外の日は0日（race_series 外の3日を除く）
  - 98日: 節のどの日にも「優勝戦」の名前のレースが無い。会場独自の名前（決勝戦・王将位決定戦 等）と推定する。98日すべては見ていないが、データ整備レーンが #1165 の範囲（2025-12〜）で、同じ型の5件がすべて実際の最終日だったことを確認している
  - 35日: 優勝戦が番組にあったが、中止で成績が無い（節は終了日で終わった）
- 本体の `race_conditions.is_final_day`（2,987会場日）も、全件がこの終了日の規則に従っている（データ整備レーンの確認）。同じ規則にすると、長期と本体で特徴量の意味がそろう

## 再発の防止（コード）

- `kbArchiveRows.js`: `is_final_day` を行に入れない（BOA-651 の race_grade と同じ）。列は `NOT NULL DEFAULT false` なので、挿入では false、長期データの読み込みの再実行（`kb-backfill.js load`）では補完した値を保つ。`verify-kb-file-parser.js` で固定した。
- `kbFileParser.js`: `is_final_day` は K/B からは決まらないことを、コメントで明記した。

## 本番の実行（ユーザー。開催時間帯でもよい。トリガーは無い）

### 1. 事前の確認（読み取り）

```sql
SELECT count(*) AS days, count(*) FILTER (WHERE is_final_day) AS final_true FROM kb_archive_venue_days;
```

期待: `31023 / 0`

### 2. 書き込み（1ブロック。件数が 5,579 でなければ取り消す）

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  UPDATE kb_archive_venue_days v SET is_final_day = true
  WHERE NOT v.is_final_day
    AND (
      EXISTS (SELECT 1 FROM race_series s
              WHERE s.venue_code = v.venue_code AND s.end_date = v.race_date)
      OR (
        -- race_series に当たらない12日（2019-04-01〜05）だけ、成績のある優勝戦で判定する
        NOT EXISTS (SELECT 1 FROM race_series s
                    WHERE s.venue_code = v.venue_code AND v.race_date BETWEEN s.start_date AND s.end_date)
        AND EXISTS (SELECT 1 FROM kb_archive_races k
                    WHERE k.venue_day_id = v.venue_day_id AND k.stage_kind = 'final' AND k.has_result)
      )
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5579 THEN
    RAISE EXCEPTION '更新件数が % 件（期待 5,579）。取り消します', n;
  END IF;
END $$;
COMMIT;
```

### 3. 事後の確認（読み取り）

```sql
SELECT count(*) FILTER (WHERE is_final_day) AS final_true FROM kb_archive_venue_days;
SELECT venue_day_id, is_final_day FROM kb_archive_venue_days
WHERE venue_day_id IN ('2019-06-27-07', '2019-06-28-07') ORDER BY 1;
```

期待:

- `5579`
- `2019-06-27-07 / false`・`2019-06-28-07 / true`（蒲郡。優勝戦が中止で翌日に行われた節。終了日 06-28 が最終日）

## 元に戻す

```sql
UPDATE kb_archive_venue_days SET is_final_day = false WHERE is_final_day;
```

元はすべて false だったので、全件を false に戻せば元どおりになる。

## BOA-271 側への影響

特徴量の再計算・再学習の要否は、オーケストレーターから BOA-271 のレーンに伝える（FR-1 の寄与度・FR-2 の分析・本番の週次学習）。
