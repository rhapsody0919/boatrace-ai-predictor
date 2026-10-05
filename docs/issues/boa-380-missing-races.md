# BOA-380 races に無いレース（2025-12-03 大村・2025-12-22 蒲郡/常滑/津）の補い方

## 何が欠けているか

races の最初の日から 2026-09-30 までの K/B ファイルのアーカイブ（3,954会場日）と races を突き合わせた（2026-10-05、読み取りのみ）。行われたのに races に無いレースは、次の24レース。

| 日付 | 会場 | races にあるレース | 無いレース | 節 |
|---|---|---|---|---|
| 2025-12-03 | 大村（24） | なし | 1〜12R（12） | 初日（ミッドナイト、12/03〜06） |
| 2025-12-22 | 蒲郡（7） | 2〜6・10・11R | 1・7・8・9・12R（5） | 初日 |
| 2025-12-22 | 常滑（8） | 1・5・7〜12R | 2・3・4・6R（4） | 2日目 |
| 2025-12-22 | 津（9） | 2〜9・12R | 1・10・11R（3） | 初日 |

- 24レースの race_id は、races・race_entries・race_results・race_start_timings・race_conditions・exhibition_data・predictions のどれにも行が無い（孤立した子の行も無い）
- 同じ会場日の既存のレースは、B ファイルの選手と一致する（日付のズレは無い。大村の 12/04〜06 も一致）
- 2025-12-03 大村 12R は、K で5艇が F（返還）

対象外にしたもの（オーケストレーター判断、2026-10-05）:

- 2025-12-02: races には津（9）しか無く、K の他の9会場が無い。races の開始日の境界として扱い、補わない
- 尼崎 2026-05-17・18、津 2026-07-30〜08-01: 節の打ち切りで番組が無い日（data-catalog E11 の (B)）。races を作らない

## 手順（公式への取得があるので JST 0〜6時に実行する。本番の書き込みはユーザー）

### 0. 事前確認（読み取り）

```sql
with ids as (select unnest(array[
'2025-12-22-07-01','2025-12-22-07-07','2025-12-22-07-08','2025-12-22-07-09','2025-12-22-07-12',
'2025-12-22-08-02','2025-12-22-08-03','2025-12-22-08-04','2025-12-22-08-06',
'2025-12-22-09-01','2025-12-22-09-10','2025-12-22-09-11']
|| array(select '2025-12-03-24-' || lpad(g::text,2,'0') from generate_series(1,12) g)) id)
select 'races' t, count(*) from races where race_id in (select id from ids)
union all select 'race_entries', count(*) from race_entries where race_id in (select id from ids)
union all select 'race_results', count(*) from race_results where race_id in (select id from ids)
union all select 'race_payouts', count(*) from race_payouts where race_id in (select id from ids)
union all select 'race_start_timings', count(*) from race_start_timings where race_id in (select id from ids)
union all select 'race_conditions', count(*) from race_conditions where race_id in (select id from ids)
union all select 'exhibition_data', count(*) from exhibition_data where race_id in (select id from ids)
union all select 'predictions', count(*) from predictions where race_id in (select id from ids);
```

期待: すべて 0。0 でなければ、ここで止める。

### 1. races・race_entries を作る（出走表の取り直し）

```bash
node --env-file=.env.local scripts/maintenance/backfill-missing-venue-day.js --date=2025-12-03 --venues=24
node --env-file=.env.local scripts/maintenance/backfill-missing-venue-day.js --date=2025-12-22 --venues=7,8,9 --partial
```

確認のみ（dry-run）。期待:

- 12/03: `会場24: 12レース（1R〜12R）・出走表 72艇`、`[DRY-RUN] 書く会場 24・races 12・race_entries 72`
- 12/22: `会場7: 5レース（1R 7R 8R 9R 12R）`・`会場8: 4レース（2R 3R 4R 6R）`・`会場9: 3レース（1R 10R 11R）`。それぞれ「既存 7/8/9レースは書かない」と出る。`races 12・race_entries 72`
- 出走表が12レースそろわないとき（公式に過去の出走表が残っていない等）は、例外で止まり何も書かない。そのときは連絡する

件数が合えば、同じコマンドに `--apply` を付けて実行する。期待: `[APPLY] races 12/12・中止の確定 0・予想 0件（0のはず）` が2回。書いた後に、各会場日が12レースそろったことを確かめ、合わなければ例外になる。最後に、次の手順のコマンド（`--race-ids=...`）が出る。

### 2. 結果を取り直す（結果ページ）

```bash
node --env-file=.env.local scripts/maintenance/backfill-results-by-race-id.js --race-ids=2025-12-03-24-01,2025-12-03-24-02,2025-12-03-24-03,2025-12-03-24-04,2025-12-03-24-05,2025-12-03-24-06,2025-12-03-24-07,2025-12-03-24-08,2025-12-03-24-09,2025-12-03-24-10,2025-12-03-24-11,2025-12-03-24-12,2025-12-22-07-01,2025-12-22-07-07,2025-12-22-07-08,2025-12-22-07-09,2025-12-22-07-12,2025-12-22-08-02,2025-12-22-08-03,2025-12-22-08-04,2025-12-22-08-06,2025-12-22-09-01,2025-12-22-09-10,2025-12-22-09-11
```

確認のみ。期待: `対象24レース`、`結果取得対象24件`。同じコマンドに `--apply` を付けて実行する。期待: 最後に `完了`。「結果を取得できなかったレース」が出たら連絡する。

### 3. 4〜6着（K ファイル）

```bash
node --env-file=.env.local scripts/maintenance/backfill-rank456-from-kfile.js --from=2025-12-03 --to=2025-12-03 --dry-run
node --env-file=.env.local scripts/maintenance/backfill-rank456-from-kfile.js --from=2025-12-22 --to=2025-12-22 --dry-run
```

対象は「1着はあるが4着が無いレース」なので、手順2で入れたレースだけになるはず（12/03 は最大12、12/22 は最大12。返還のレースは減る）。件数を確かめてから `--dry-run` を外して実行する。

### 4. K/B ファイルからの欠けの補い（アーカイブのみ。公式への取得なし）

日付ごとに、次の順で項目を dry-run し、書く行が 0 でない項目だけ `--apply` を付けて実行する。対象はその日の全会場の欠けなので、今回のレース以外の行が出たら、件数を控えて連絡する。

```bash
for item in st missing_boats finish_code exhibition conditions race_status rate2; do
  node --env-file=.env.local scripts/maintenance/backfill-kb-gaps.js --item=$item --from=2025-12-03 --to=2025-12-03
  node --env-file=.env.local scripts/maintenance/backfill-kb-gaps.js --item=$item --from=2025-12-22 --to=2025-12-22
done
```

### 5. 事後確認（読み取り）

0 の SQL をもう一度流す。期待: races 24・race_entries 144・race_results 24・race_start_timings 144 前後（欠場・返還の艇で増減）・predictions 0。さらに:

```sql
select race_date, venue_code, count(*) from races
where (race_date, venue_code) in (('2025-12-03',24),('2025-12-22',7),('2025-12-22',8),('2025-12-22',9))
group by 1,2 order by 1,2;
```

期待: 4会場日とも 12。

## 戻し方

24レースの races を消す。races を参照する子のテーブル（race_entries・race_results・race_payouts・race_start_timings・race_conditions・exhibition_data・predictions 等）は、外部キーが ON DELETE CASCADE なので一緒に消える（2026-10-05 に pg_constraint で確認。CASCADE でないのは sns_campaign_entries だけで、過去のレースは参照しない）。races の件数が 24 でなければ、何も消さずに止まる。

```sql
begin;
do $$
declare n int;
begin
  delete from races where race_id in (
    select unnest(array[
    '2025-12-22-07-01','2025-12-22-07-07','2025-12-22-07-08','2025-12-22-07-09','2025-12-22-07-12',
    '2025-12-22-08-02','2025-12-22-08-03','2025-12-22-08-04','2025-12-22-08-06',
    '2025-12-22-09-01','2025-12-22-09-10','2025-12-22-09-11']
    || array(select '2025-12-03-24-' || lpad(g::text,2,'0') from generate_series(1,12) g)));
  get diagnostics n = row_count;
  if n <> 24 then raise exception 'races の削除が % 件（24のはず）。取り消します', n; end if;
end $$;
commit;
```

手順4で、今回のレース以外の行も書いた場合は、その分は戻らない（既存の値は上書きしない設計なので、NULL だった列が埋まるだけ）。
