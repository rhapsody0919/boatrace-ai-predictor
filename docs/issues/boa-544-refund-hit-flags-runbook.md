# BOA-544 不成立・返還を的中判定から外す: 本番適用の手順

不成立のレースと、返還艇を含む勝式の予想を、的中判定と成績の集計から外す。コード（PR）とは別に、本番では次の2つが要る。

- DBトリガーの置き換え（マイグレーション117）
- 既存の予想の書き直し（バックフィル）

どちらも本番への書き込みなので、ユーザーが実行する。

## 何が変わるか

| | 変更前 | 変更後 |
|---|---|---|
| 不成立（`race_status='no_race'`）のレースの予想 | 的中・外れが付く（例: 2026-08-07-24-01 の standard は4券種すべて的中） | 全券種と展開予測が NULL（判定対象外） |
| 本命（top_pick）が返還艇の予想 | 単勝・複勝が「外れ」 | 単勝・複勝・3連系が NULL |
| 上位3艇に返還艇がある予想 | 3連系が「外れ」 | 3連系が NULL（単勝・複勝は通常どおり） |
| 成績の集計（`models`・`accuracy_cache`） | 母数は is_hit_win がある全予想（返還も「投資100円・戻り0円」） | 母数は券種ごとの「判定した予想」の数 |

成績の変化（dry-run、2026-10-02 の夕方の本番データ。race_status の補完（K から、2025-12〜）の後）:

| モデル | 書き直す行 | 単勝 的中率 | 単勝 回収率 | 3連単 的中率 | 3連単 回収率 |
|---|---:|---|---|---|---|
| standard | 1,172 | 26.97%→27.11%（+0.146pt） | 77.57%→77.99%（+0.420pt） | 3.69%→3.74%（+0.053pt） | 80.84%→82.02%（+1.172pt） |
| safeBet | 1,110 | 49.38%→49.72%（+0.336pt） | 88.30%→88.91%（+0.608pt） | 6.74%→6.84%（+0.096pt） | 78.91%→80.05%（+1.146pt） |
| upsetFocus | 1,132 | 19.14%→19.23%（+0.087pt） | 74.81%→75.17%（+0.367pt） | 2.06%→2.08%（+0.025pt） | 74.32%→75.38%（+1.060pt） |
| unified | 188 | 55.75%→56.21%（+0.457pt） | 92.13%→92.88%（+0.755pt） | （3連系は予想しない） | |

3連単は、DB の列名の逆転のため `is_hit_trio`・`payout_trio` の列（dry-run の出力では trio の行）。

2026-10-01 時点の dry-run（書き直す 263行）から大きく増えたのは、race_status の補完で、一部返還のレースが 117 から 1,254 に増えたため（race_status が入っていなかった 2025-12〜2026-09-20 のレースに、K から入った）。

複勝・3連複を含む全券種の値は、PRの本文と dry-run の出力にある。

## 実行順

開催時間帯（JST 8:00〜21:30頃）を避ける。トリガーの作り直しで `race_results` に一瞬ロックを取るため。

### 1. 適用前の確認（読み取りのみ）

```sql
select
 count(*) filter (where r.race_status='no_race' and (p.is_hit_win is not null or p.is_hit_place is not null
   or p.is_hit_trifecta is not null or p.is_hit_trio is not null or p.is_hit_turn is not null)) no_race_judged,
 count(*) filter (where r.race_status='partial_refund' and p.top_pick = any(coalesce(r.refund_boats,'{}'))
   and p.is_hit_win is not null) refunded_top_judged,
 count(*) filter (where r.race_status='partial_refund' and array[p.top_pick,p.top_2nd,p.top_3rd]::smallint[]
   && coalesce(r.refund_boats,'{}') and p.is_hit_trio is not null) refunded_top3_trio_judged
from predictions p join race_results r using (race_id)
where r.race_status in ('no_race','partial_refund');
```

期待値（2026-10-02 の夕方、race_status の補完の後）は `25 / 791 / 1937`。適用までに不成立・返還のレースが増えれば、数字も増える。対象は不成立 8レース・一部返還 1,214レース（予想のあるレース）の予想 3,771行。

### 2. マイグレーション117を適用する

Supabase Dashboard > SQL Editor で、`docs/db-migration/117_prediction_hits_exclude_no_race_refund.sql` の全文を実行する（BEGIN〜COMMIT を含む）。

確認（読み取りのみ）:

```sql
select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_update_predictions';
-- → UPDATE OF ... payout_trio, race_status, refund_boats を含む
select position('race_status' in pg_get_functiondef('public.update_prediction_results()'::regprocedure)) > 0;
-- → true
```

### 3. 既存の予想を書き直す

書き直しの前に、対象の予想の判定の列の控えを取る（戻すときに使う。手順「元に戻す」）。SQL Editor で実行する。

```sql
CREATE TABLE backup_boa544_pred_hits AS
SELECT p.prediction_id, p.is_hit_win, p.is_hit_place, p.is_hit_trifecta, p.is_hit_trio, p.is_hit_turn,
       p.payout_win, p.payout_place, p.payout_trifecta, p.payout_trio
FROM predictions p JOIN race_results r USING (race_id)
WHERE r.race_status IN ('no_race', 'partial_refund');
ALTER TABLE backup_boa544_pred_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_boa544_pred_hits FROM anon, authenticated;
SELECT count(*) FROM backup_boa544_pred_hits;
```

期待: 3,771（2026-10-02 の夕方。手順1の対象の予想の数。増えていれば、その分だけ多い）。書き直す 3,602行は、すべてこの中に入る。

続けて、ユーザーの手元のターミナルで実行する。

```bash
node --env-file=.env.local scripts/maintenance/backfill-refund-hit-flags.js
```

上は dry-run。期待値（2026-10-02 の夕方）は「不成立 8レース・一部返還 1254レース、予想 3771行のうち、書き直す 3602行」（適用時点で増えていれば、その分だけ多い）。変わる列ごとの行数は is_hit_trifecta 2,055・is_hit_trio 2,029・payout_win 1,878・payout_trio 1,602・payout_trifecta 1,298・payout_place 1,210・is_hit_win 816・is_hit_place 816・is_hit_turn 7。

```bash
node --env-file=.env.local scripts/maintenance/backfill-refund-hit-flags.js --apply
```

`[APPLY] 3602行を書き直した`（dry-run と同じ数）が出れば完了。途中で失敗しても、再実行すれば残りだけを書く。

### 4. 適用後の確認（読み取りのみ）

手順1と同じ SQL を実行する。期待値は `0 / 0 / 0`。

### 5. 成績の集計

成績の集計は、毎晩の `calculate-accuracy.yml`（JST 23:30）が新しい規則で `models`・`accuracy_cache` を作り直す。すぐに反映したい場合は、GitHub Actions の calculate-accuracy を手動で実行する。

## 元に戻す

- トリガー: 117 の冒頭の「元に戻す」の SQL を実行する。関数と発火条件が 097 の状態に戻る。
- 書き直した予想: 手順3の控え（`backup_boa544_pred_hits`）から戻す。書き直すのは不成立・返還のレースの予想だけ（約3,600行）で、通常のレースには触れない。

```sql
BEGIN;
UPDATE predictions p
SET is_hit_win = b.is_hit_win, is_hit_place = b.is_hit_place, is_hit_trifecta = b.is_hit_trifecta,
    is_hit_trio = b.is_hit_trio, is_hit_turn = b.is_hit_turn, payout_win = b.payout_win,
    payout_place = b.payout_place, payout_trifecta = b.payout_trifecta, payout_trio = b.payout_trio
FROM backup_boa544_pred_hits b
WHERE p.prediction_id = b.prediction_id
  AND (p.is_hit_win, p.is_hit_place, p.is_hit_trifecta, p.is_hit_trio, p.is_hit_turn,
       p.payout_win, p.payout_place, p.payout_trifecta, p.payout_trio)
      IS DISTINCT FROM (b.is_hit_win, b.is_hit_place, b.is_hit_trifecta, b.is_hit_trio, b.is_hit_turn,
       b.payout_win, b.payout_place, b.payout_trifecta, b.payout_trio);
COMMIT;
```

  戻すのは書き直した行（約3,600行）だけ。戻した後、手順1の SQL が書き直し前の値（`25 / 791 / 1937`）に戻ることを確かめ、成績の集計（手順5）を回し直す。トリガー（117）も戻す場合は、上の「トリガー」の手順を別に行う（予想の控えから戻すことと、トリガーを戻すことは独立している）。
- 控えを消す: 翌日の成績の集計（`models`・`accuracy_cache`）が新しい規則で出たことを確かめたら、`DROP TABLE backup_boa544_pred_hits;` を実行する。

## 対象外（このPRでは直さない）

- **scripts/analysis/ 配下**: `is_no_race` を読む分析スクリプトは対象外。BOA-536（analysis の約25本が払戻の列を逆に読む件）と同じく別に扱う。
- **unified の3連系**: 既存の 6,503行に、NULL ではなく false が入っている。旧 `fixMissingHitFlags` が top_3rd を見ていなかったため。今後の補完は NULL を書く。既存行は、本件の書き直しの対象（不成立・返還のレース）に入らない分は残る。unified は `models` の集計（standard・safeBet・upsetFocus）に入らないので、成績の画面には出ない。
- **一部の勝式だけが不成立のレース**: たとえば複勝だけが不成立のレース。判定には払戻の明細（`race_payouts`）が要る。今回の規則は返還艇だけを見る。
