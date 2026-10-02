# 「ほかの艇はどうだったか」を条件の中で数える（案b）の試算（2026-10-03、探索的・事前登録なし）

ユーザー要望（オーケストレーター経由）: 「若松×G1×優勝戦で6号艇が1着になるには何が必要か。本来は1〜5号艇の不出来（スタートで遅れる・転覆する等）が要るはず。他の艇の不出来も考慮して見せられないか」。

**探索的な集計で、事前登録をしていない。** 本番 DB の読み取り（Supabase MCP の execute_sql）で数えた。

## 1. 件数（n）が足りるか
長期分（`kb_archive_*`、has_result、2019-04〜2025-12）。優勝戦は `stage LIKE '%優勝%' AND stage NOT LIKE '%準%'`、グレードは `kb_archive_venue_days.race_grade`。

| 条件 | レース数 | 1号艇1着 | 6号艇1着 | 6号艇3着以内 | 3号艇3着以内 |
|---|---|---|---|---|---|
| 若松×G1×優勝戦 | 9 | 8 | **0** | 2 | 5 |
| 若松×SG×優勝戦 | 3 | 2 | 0 | 0 | 1 |
| 全国×G1×優勝戦 | 235 | 166 | 2 | 56 | 113 |
| 全国×SG×優勝戦 | 67 | 44 | 2 | 14 | 35 |
| 全国×G2×優勝戦 | 59 | 40 | 1 | 17 | 28 |
| 全国×G3×優勝戦 | 397 | 279 | 9 | 89 | 210 |
| 全国×一般×優勝戦 | 4,814 | 3,339 | 84 | 984 | 2,589 |

- 若松×G1×優勝戦で6号艇の1着は7年で0件。「この条件で6号艇が1着になるには」は、数えても答えられない。条件を広げる（会場を外す → グレードを外す）しかない
- 全国×優勝戦（5,572R）でも6号艇の1着は 98件。艇番×着順の組ごとに、30件以上になる条件まで広げる形になる

## 2. 「ほかの艇はどうだったか」（全国×優勝戦 5,572R）
各指標の割合を、「その艇がその着順になったレース」と「全レース」で比べた。ST の順位は F・出遅れの艇を除いて6艇の中で付けた。「F・出遅れ・失格」は `finish_raw` が F・L・S（失格。転覆・落水・エンスト等を含む）で始まるもの。前付けは、その艇の進入コースが艇番より内（`course < 艇番`）。

| 艇・着順 | 件数 | 1号艇が4着以下か F・出遅れ・失格 | 1号艇の ST が4位以下 | この艇の ST が1位 | 内の艇に F・出遅れ・失格 | 前付け |
|---|---|---|---|---|---|---|
| 全レース（比べる元） | 5,572 | 12.3% | 25.6% | 艇ごと | 艇ごと | 艇ごと |
| 6号艇・1着 | 98 | **52.0%** | **46.9%** | 31.6%（全体 10.2%） | 13.3%（6.3%） | 28.6%（11.0%） |
| 5号艇・1着 | 197 | 45.2% | 40.6% | 28.4%（13.2%） | 12.2%（5.5%） | 9.6%（6.6%） |
| 4号艇・1着 | 404 | 42.6% | 47.5% | 47.5%（18.3%） | 6.9%（4.4%） | 5.0%（4.6%） |
| 3号艇・1着 | 450 | 41.8% | 43.1% | 34.9%（18.6%） | 9.8%（3.2%） | 2.0%（2.6%） |
| 2号艇・1着 | 555 | 33.0% | 35.7% | 29.9%（15.5%） | 6.7%（2.0%） | 1.3%（0.3%） |
| 6号艇・3着以内 | 1,160 | 25.7% | 29.7% | 15.9%（10.2%） | 10.5%（6.3%） | 16.6%（11.0%） |
| 3号艇・3着以内 | 2,975 | 14.3% | 25.5% | 22.7%（18.6%） | 3.9%（3.2%） | 2.0%（2.6%） |
| 1号艇・1着 | 3,868 | — | — | 50.0%（42.5%） | — | — |

- ユーザーの見立てどおり、外の艇の1着には「1号艇の不出来」が強く出る。6号艇の1着では、1号艇が4着以下か F・出遅れ・失格だったのが 52.0%（全体の約4.2倍）。1号艇の ST が4位以下も 46.9%（約1.8倍）
- 3着以内になると差は小さくなる（6号艇の3着以内で 25.7%、約2.1倍。3号艇の3着以内では 14.3% でほぼ全体どおり）
- これは結果を条件にした数え方で、原因ではない（「6号艇が勝ったレースでは1号艇が沈んでいた」は言えるが、「1号艇が沈めば6号艇が勝つ」とは言えない）。画面にもそう書く

## 3. データの制約
- 長期分は、失格を S0〜S2 の3区分でしか持たない（転覆か落水かは分からない）。本体（2025-12〜）は `race_start_timings.finish_mark` に 転・落・エ・妨・不・失・沈 がある（期間が短く、件数は数百）
- 長期分の進入不明（course=0）は「前付け」に数えてしまう。実装では NULL として除く
- 事故の中身（接触・妨害の相手など）は BOA-279 のとおり取れていない
- 母集団 `analogy_pool_outcomes`（マイグレーション 120）は、1〜3着の艇番・進入・コース別 ST・決まり手しか持たない。この表を出すには、艇ごとの着順（4〜6着を含む）と、艇ごとの F・出遅れ・失格の印を足す必要がある。今の母集団は1〜3着に返還艇が入るレースを除いているので、「1号艇が F」のレースの扱いも決め直す（1号艇の F で返還、6号艇が1着、のレースは今は母集団に入る）

## 出典（SQL）
件数（1節）と、2節の表は次の2本（読み取り、2026-10-03 実行）。

```sql
-- 2節。艇番 k × 着順 t（1着・3着以内）
WITH r AS (SELECT race_id FROM kb_archive_races WHERE has_result AND stage LIKE '%優勝%' AND stage NOT LIKE '%準%'),
s AS (SELECT b.race_id, b.boat_number, b.finish_rank, b.finish_raw, b.course,
  rank() OVER (PARTITION BY b.race_id ORDER BY CASE WHEN NOT coalesce(b.is_flying,false) AND NOT coalesce(b.is_late_start,false) THEN b.start_timing END NULLS LAST) st_rank
  FROM kb_archive_boats b JOIN r USING (race_id)),
a AS (SELECT race_id, array_agg(finish_rank ORDER BY boat_number) fr, array_agg(coalesce(finish_raw ~ '^(F|L|S)',false) ORDER BY boat_number) bad,
  array_agg(st_rank ORDER BY boat_number) sr, array_agg(course ORDER BY boat_number) co FROM s GROUP BY race_id HAVING count(*)=6),
g AS (SELECT k, t, coalesce(fr[k] <= t, false) hit, (coalesce(fr[1],9)>=4 OR bad[1]) b1_down, (sr[1]>=4) b1_slow, (sr[k]=1) own_st1,
  (k>1 AND (bad[1] OR (k>2 AND bad[2]) OR (k>3 AND bad[3]) OR (k>4 AND bad[4]) OR (k>5 AND bad[5]))) inner_bad, (co[k] < k) maeduke
  FROM a, generate_series(1,6) k, unnest(ARRAY[1,3]) t)
SELECT k, t, count(*) FILTER (WHERE hit) n_hit, count(*) n_all,
 avg(b1_down::int) FILTER (WHERE hit), avg(b1_down::int), avg(b1_slow::int) FILTER (WHERE hit), avg(b1_slow::int),
 avg(own_st1::int) FILTER (WHERE hit), avg(own_st1::int), avg(inner_bad::int) FILTER (WHERE hit), avg(inner_bad::int),
 avg(maeduke::int) FILTER (WHERE hit), avg(maeduke::int)
FROM g GROUP BY k,t ORDER BY t,k;
```
