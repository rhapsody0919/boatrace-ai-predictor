# 三国 2026-09-12 1R・2R: 結果を取り逃したまま中止確定になっていた（BOA-512・BOA-526）

## 何が起きていたか

2026-09-12 の三国（会場10）1R・2R は、`races.cancellation_status = 'confirmed'`（中止確定）で、`race_results` に行が無い。しかし**実際には開催されていた**。

| レース | 公式の成績ファイル（Kファイル）の着順 | 公式の結果ページ（2026-09-29 に取得） |
|---|---|---|
| 2026-09-12-10-01（1R） | 2-1-3-5-6-4 | 2-1-3-5-6-4・決まり手「差し」 |
| 2026-09-12-10-02（2R） | 1-2-6-5-4-3 | 1-2-6-5-4-3・決まり手「逃げ」 |

同じ日（BOA-512）の結果の読み取りの失敗で、結果を取り逃し、発走90分後に中止確定になった。BOA-512 のデータ修正SQLは「結果があるもの」だけが対象だったため、この2本は残った（BOA-512 では誤って「正しい中止」と判断していた。訂正コメントあり）。

## 本番で実行すること（ユーザー）

リポジトリの直下で、通常の端末から実行する。書き込むのはこの2レースの結果一式（結果の取得処理 `scrapeAndSaveResults` が通常書くもの: 結果・艇別の結果・的中判定など）と、`races.cancellation_status` の解除（NULL に戻す）だけ。

### 1. 事前確認（読み取り。Supabase Dashboard の SQL Editor）

```sql
select r.race_id, r.cancellation_status, rr.rank1, rr.rank2, rr.rank3
from races r left join race_results rr on rr.race_id = r.race_id
where r.race_id in ('2026-09-12-10-01', '2026-09-12-10-02')
order by r.race_id;
```

期待値: 2行とも `cancellation_status = confirmed`、`rank1〜3` は NULL（結果の行が無い）

### 2. dry-run（読み取りのみ）

```bash
node --env-file=.env.local scripts/maintenance/backfill-results-by-race-id.js --race-ids=2026-09-12-10-01,2026-09-12-10-02
```

期待値（2026-09-29 に実行して確認済み）:

```
対象2レース（dry-run）
  2026-09-12-10-01 cancellation_status=confirmed 結果=なし
  2026-09-12-10-02 cancellation_status=confirmed 結果=なし

dry-run: 結果取得対象2件。書き込むには --apply を付けて再実行
```

### 3. 本番実行

```bash
node --env-file=.env.local scripts/maintenance/backfill-results-by-race-id.js --race-ids=2026-09-12-10-01,2026-09-12-10-02 --apply
```

期待値: 公式の結果ページから2レースを取得して書き込み、最後に `中止・順延の状態を解除: 2件` と `完了` が出る。`結果を取得できなかったレース` の行は出ない。

### 4. 事後確認（読み取り）

```sql
select r.race_id, r.cancellation_status, r.cancellation_check_streak,
       rr.rank1, rr.rank2, rr.rank3, rr.rank4, rr.rank5, rr.rank6, rr.winning_technique
from races r left join race_results rr on rr.race_id = r.race_id
where r.race_id in ('2026-09-12-10-01', '2026-09-12-10-02')
order by r.race_id;
```

期待値:

| race_id | cancellation_status | rank1〜6 | winning_technique |
|---|---|---|---|
| 2026-09-12-10-01 | NULL | 2, 1, 3, 5, 6, 4 | 差し |
| 2026-09-12-10-02 | NULL | 1, 2, 6, 5, 4, 3 | 逃げ |

あわせて、日次監視の「確定中止なのに結果がある」が0件のままであることを確かめる（解除されていなければ、ここに2件出る）:

```sql
select count(*) from races r join race_results rr on rr.race_id = r.race_id
where r.cancellation_status = 'confirmed';
```

期待値: **0**

## 再発の防止

BOA-526: 23:50 の補完（結果の catch-up）が、中止確定のレースも取り直すようにする。取り直して結果が取れれば、BOA-524 の解除が中止確定を外す。
