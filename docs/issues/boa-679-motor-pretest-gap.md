# BOA-679 前検タイム（motor_pretest_stats）の欠けの補い方

## 何が欠けていたか

日次ジョブ `motor_pretest`（`scripts/lib/motorPretestJob.js`）が live になったのは 2026-09-23 の朝で、それより前は 9/23 に実行したバックフィル（`--scope=first-days`）で節の初日だけを入れていた。そのとき 9/18〜9/22 の初日のうち 7 会場日が入らなかった。

| 日付 | 会場 | 行数（解析結果） |
|---|---|---|
| 2026-09-18 | 住之江（12） | 48 |
| 2026-09-21 | 宮島（9）・徳山（18） | 47・45 |
| 2026-09-22 | 常滑（8）・びわこ（11）・若松（20）・福岡（22） | 45・45・52・45 |

合計 327 行。

9/18 住之江は、2026-10-05 の取得ではページを取れた。公式側にページは残っていたので、9/23 の実行で一時的に取得に失敗したものとみられる（9/23 の取得記録が残っていないため断定はできない）。

日次ジョブが live になった 9/23 以降は、races の開催会場日すべてに行がある（9/23〜10/4 の 154 会場日で欠け 0）。

## 補った手順（2026-10-05）

アーカイブは `/Users/terukina/boatrace-archive-backup/motor-pretest-archive`。

1. plan・download・parse・load（検証のみ）を夜間の窓（JST 00-06）に実行した。対象は 13 ページ・604 行で、全行に前検タイムがある
   - すでに本番にある 6 会場日・277 行（02-0918・03-0918・17-0918・06-0919・01-0920・10-0920）は、解析結果と行数が一致した。load は変わった行だけを書くので、ここはほぼ書かない
   - 本番に無い 7 会場日・327 行が新規になる
2. 書き込みはユーザーが実行する

```bash
node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js load --from=2026-09-18 --to=2026-09-22 --archive-dir=/Users/terukina/boatrace-archive-backup/motor-pretest-archive --apply
```

すでにある 6 会場日で数十行以上の更新が出たら、想定外の差分なので止める。

### 確認（読み取りのみ）

```sql
select venue_code, race_date, count(*) n, count(*) filter (where pretest_time is not null) with_time
from motor_pretest_stats
where (venue_code, race_date) in ((1,'2026-09-20'),(2,'2026-09-18'),(3,'2026-09-18'),(6,'2026-09-19'),(8,'2026-09-22'),(9,'2026-09-21'),(10,'2026-09-20'),(11,'2026-09-22'),(12,'2026-09-18'),(17,'2026-09-18'),(18,'2026-09-21'),(20,'2026-09-22'),(22,'2026-09-22'))
group by 1,2 order by 2,1;
```

期待: 13 行が返り、n は 01-0920=48、02-0918=46、03-0918=47、06-0919=45、08-0922=45、09-0921=47、10-0920=45、11-0922=45、12-0918=48、17-0918=46、18-0921=45、20-0922=52、22-0922=45（合計 604）。with_time も n と同じ。

### 取り消し

新規の 7 会場日だけを消す。消えた件数が 327 でなければ、何も消さずに止まる。

```sql
begin;
do $$
declare n int;
begin
  delete from motor_pretest_stats
  where (venue_code, race_date) in ((12,'2026-09-18'),(9,'2026-09-21'),(18,'2026-09-21'),(8,'2026-09-22'),(11,'2026-09-22'),(20,'2026-09-22'),(22,'2026-09-22'));
  get diagnostics n = row_count;
  if n <> 327 then raise exception '削除件数が % 件（327のはず）。取り消します', n; end if;
end $$;
commit;
```

## 日次の取得が止まった日の補い方

日次ジョブは当日の 05:30・06:00・06:30 に起動し、一時的な失敗の会場は同じ日のうちに取り直す。3 回とも失敗した会場や、ジョブが止まった日は、翌日以降に自動では取り直さない（BOA-764）。そのときは scrape-monitor が指定時刻（05:20）の 3 時間後に日次の遅延として通知するので、次の手順で補う。

1. 欠けている会場日を確かめる（読み取りのみ）

   ```sql
   with vd as (select distinct venue_code, race_date from races where race_date between 'YYYY-MM-DD' and 'YYYY-MM-DD'),
   mp as (select distinct venue_code, race_date from motor_pretest_stats where race_date between 'YYYY-MM-DD' and 'YYYY-MM-DD')
   select vd.* from vd left join mp using (venue_code, race_date) where mp.venue_code is null order by 2, 1;
   ```

2. 同じ CLI を、夜間の窓（JST 00-06）に実行する。download は窓の外では動かない。取得済みのアーカイブは取り直さない

   ```bash
   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js plan --from=YYYY-MM-DD --to=YYYY-MM-DD --scope=all-days --archive-dir=/Users/terukina/boatrace-archive-backup/motor-pretest-archive
   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js download --from=YYYY-MM-DD --to=YYYY-MM-DD --scope=all-days --archive-dir=/Users/terukina/boatrace-archive-backup/motor-pretest-archive
   node scripts/maintenance/motor-pretest-backfill.js parse --from=YYYY-MM-DD --to=YYYY-MM-DD --scope=all-days --archive-dir=/Users/terukina/boatrace-archive-backup/motor-pretest-archive
   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js load --from=YYYY-MM-DD --to=YYYY-MM-DD --scope=all-days --archive-dir=/Users/terukina/boatrace-archive-backup/motor-pretest-archive
   ```

   - 日次ジョブは毎日の全会場の行を書くので、日次の欠けを補うときは `--scope=all-days` を付ける。既定の `first-days` は節の初日（前日に同じ会場の開催が無い日）だけを対象にするため、節の途中の日が欠けても拾わない
   - `--from`・`--to` は欠けている日だけに絞る。all-days は first-days の約 5 倍のリクエストになる
   - load は検証のみ。件数を確かめてから、ユーザーが `--apply` を付けて書き込む

3. 1 の SQL をもう一度流し、欠けが 0 行になったことを確かめる

後から取ったページの前検タイムは節の間は変わらない。モーター/ボートの 2 連対率が「その日の朝時点」の値になるかは確かめていない（BOA-764 で確認する）。
