# BOA-580 自社データ初日（2025-12-03）の出走表が前日の番組になっている

## 事象

2025-12-03 の9会場（01・02・05・07・12・13・14・17・21、108レース・648行）は、3種類のデータが混ざっていた（2026-10-02、本番の読み取りと K/B アーカイブの突き合わせ）。

| データ | どの日の値か | 根拠 |
|---|---|---|
| race_entries の選手の列（名前・級別・年齢・勝率・モーター番号・ボート番号・各2連率・3連率 等） | 前日 12-02 の番組 | 名前が B 12-02 と 647/648 一致、B 12-03 とは 8/648 |
| races.start_time | 前日 12-02 の締切 | B 12-02 と 102/108、B 12-03 とは 68/108 |
| race_entries.racer_id | 12-03（正しい） | B 12-03 と 648/648 |
| race_results（106レース） | 12-03（正しい） | K 12-03 と1着・決まり手とも 106/106（2026-09-24 の作り直し） |

12-02〜12-30 の他の日は、名前の不一致が0件（B の名前の4文字の切り詰めを考慮）。チケットの「racer_id が別人」は、racer_id ではなく他の列が前日のものだった。

## 原因（推定）

自社データの初日は、race_id の日付が 12-02、race_date が 12-03 だった。BOA-325 は race_date を正しいとみなして race_id を 12-03 に付け替えたが、中身（出走表・締切）は 12-02 の番組だった。BOA-413 は津だけを誤りとして戻した。BOA-413 の再検証は racer_id で照合していたが、racer_id はすでに 12-03 の K で補完されていたため、ずれが見えなかった。

## 是正（オーケストレーター判断: 案Aの出走表・締切部分）

公式の番組表（B 2025-12-03）で次を直す。

- race_entries（648行）
  - 次の列を直す: player_name（racer_profiles の名前。B の名前は4文字で切り詰められているため。racer_profiles に無い 5408 だけ B の名前）、grade、age、branch、weight_kg、hometown（racer_profiles）、win_rate、global_2rate、local_win_rate、local_2rate、motor_number、motor_2rate、boat_number_id、boat_2rate
  - モーター・ボートの2連率は、出走表のページと同じ小数1桁にする（2025-12-04 の実測で `toFixed(1)` が 864/864 一致）
  - NULL にする列: global_3rate、local_3rate、motor_3rate、boat_3rate、f_count、l_count。B に無い列で、今の値は前日の別の選手のもの
- races（108行）
  - 次の列を直す: start_time（B の締切）と、出走表から導く列（first_boat_grade・first_boat_win_rate・first_boat_motor_2rate・win_rate_avg・win_rate_stddev・motor_2rate_stddev。generate-predictions.js と同じ式）
- 触らないもの
  - racer_id（正しい）
  - ai_score_*
  - predictions 106件: 消さない。判定もそのまま（前日の番組で作られ、12-03 の結果で判定された予想。1日分として記録だけ残す）
- 範囲外
  - 12-03 の大村（24）は DB に無い
  - 12-02 の9会場（本来の日付）は、長期データ（kb_archive）側にある

差分（dry-run、2026-10-02）: race_entries 648行・races 108行。列ごとの件数は次のとおり。

| 列 | 件数 |
|---|---|
| player_name | 640 |
| grade | 349 |
| age | 616 |
| branch | 534 |
| weight_kg | 630 |
| hometown | 532 |
| win_rate | 640 |
| local_win_rate | 640 |
| local_2rate | 27 |
| motor_number | 640 |
| motor_2rate | 632 |
| boat_number_id | 640 |
| boat_2rate | 635 |
| global_3rate | 648 |
| local_3rate | 559 |
| motor_3rate | 648 |
| boat_3rate | 624 |
| f_count | 114 |
| l_count | 114 |
| races.start_time | 40 |
| races.first_boat_grade | 42 |
| races.first_boat_win_rate | 105 |
| races.first_boat_motor_2rate | 106 |
| races.win_rate_avg・win_rate_stddev・motor_2rate_stddev | 各108 |

global_2rate は0件（K/B の補完で、すでに 12-03 の値）。

## 本番の実行（ユーザー。開催時間帯でもよい。両表ともトリガーは無い）

SQL は `scripts/maintenance/fix-opening-day-entries-from-b.js --write-sql` が生成する（手で編集しない）。PGlite で次を確認済み。

- 書き込みは 648行・108行を更新する
- 1行欠けると件数の保護で全体が取り消される
- 取り消しの SQL で元の値に戻る

### 1. 事前の確認（読み取り）

```sql
SELECT count(*) AS entries,
       count(*) FILTER (WHERE player_name = '山戸　　信二') AS old_name_0101_1
FROM race_entries WHERE race_id LIKE '2025-12-03-%';
```

期待: `648 / 1`（01-01 の1号艇が、前日の番組の山戸信二）

### 2. 書き込み

`docs/issues/boa-580-opening-day-entries.sql` を、Supabase の SQL エディタで丸ごと実行する（BEGIN〜COMMIT の1ブロック。件数が 648・108 でなければ RAISE で全体を取り消す）。

### 3. 事後の確認（読み取り）

```sql
SELECT player_name, racer_id, motor_number, global_3rate
FROM race_entries WHERE race_id = '2025-12-03-01-01' AND boat_number = 1;
SELECT start_time FROM races WHERE race_id = '2025-12-03-01-01';
SELECT count(*) FILTER (WHERE global_3rate IS NULL) AS g3_null, count(*) AS n
FROM race_entries WHERE race_id LIKE '2025-12-03-%';
```

期待:

- `多羅尾　達之 / 3859 / 65 / NULL`
- `15:21:00`
- `648 / 648`

## 元に戻す

`docs/issues/boa-580-opening-day-entries-rollback.sql` を実行する。生成時点の値に戻る。updated_at は戻らず、実行時刻になる。
