# BOA-544 不成立・返還を的中判定から外す: 本番適用の手順

不成立のレースと、返還艇を含む勝式の予想を、的中判定と成績の集計から外す。コード（PR）とは別に、本番では次の2つが要る。

- DBトリガーの置き換え（マイグレーション112）
- 既存の予想の書き直し（バックフィル）

どちらも本番への書き込みなので、ユーザーが実行する。

## 何が変わるか

| | 変更前 | 変更後 |
|---|---|---|
| 不成立（`race_status='no_race'`）のレースの予想 | 的中・外れが付く（例: 2026-08-07-24-01 の standard は4券種すべて的中） | 全券種と展開予測が NULL（判定対象外） |
| 本命（top_pick）が返還艇の予想 | 単勝・複勝が「外れ」 | 単勝・複勝・3連系が NULL |
| 上位3艇に返還艇がある予想 | 3連系が「外れ」 | 3連系が NULL（単勝・複勝は通常どおり） |
| 成績の集計（`models`・`accuracy_cache`） | 母数は is_hit_win がある全予想（返還も「投資100円・戻り0円」） | 母数は券種ごとの「判定した予想」の数 |

成績の変化（dry-run、2026-10-01 時点の本番データ）:

| モデル | 書き直す行 | 単勝 的中率 | 単勝 回収率 | 3連単 的中率 | 3連単 回収率 |
|---|---:|---|---|---|---|
| standard | 74 | 27.03%→27.05%（+0.016pt） | 77.41%→77.45%（+0.046pt） | 3.69%→3.70%（+0.005pt） | 80.79%→80.89%（+0.102pt） |
| safeBet | 72 | 49.36%→49.40%（+0.038pt） | 88.22%→88.29%（+0.076pt） | 6.74%→6.75%（+0.007pt） | 79.09%→79.19%（+0.107pt） |
| upsetFocus | 74 | 19.16%→19.17%（+0.005pt） | 74.69%→74.74%（+0.045pt） | 2.06%→2.06%（-0.002pt） | 72.79%→72.89%（+0.093pt） |
| unified | 43 | 55.77%→55.91%（+0.132pt） | 91.74%→91.96%（+0.217pt） | （3連系は予想しない） | |

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

期待値（2026-10-01 時点）は `25 / 83 / 162`。適用までに不成立・返還のレースが増えれば、数字も増える。

### 2. マイグレーション112を適用する

Supabase Dashboard > SQL Editor で、`docs/db-migration/112_prediction_hits_exclude_no_race_refund.sql` の全文を実行する（BEGIN〜COMMIT を含む）。

確認（読み取りのみ）:

```sql
select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_update_predictions';
-- → UPDATE OF ... payout_trio, race_status, refund_boats を含む
select position('race_status' in pg_get_functiondef('public.update_prediction_results()'::regprocedure)) > 0;
-- → true
```

### 3. 既存の予想を書き直す

ユーザーの手元のターミナルで実行する。

```bash
node --env-file=.env.local scripts/maintenance/backfill-refund-hit-flags.js
```

上は dry-run。期待値は「不成立 8レース・一部返還 117レース、予想 311行のうち、書き直す 263行」（適用時点で増えていれば、その分だけ多い）。

```bash
node --env-file=.env.local scripts/maintenance/backfill-refund-hit-flags.js --apply
```

`[APPLY] 263行を書き直した` が出れば完了。途中で失敗しても、再実行すれば残りだけを書く。

### 4. 適用後の確認（読み取りのみ）

手順1と同じ SQL を実行する。期待値は `0 / 0 / 0`。

### 5. 成績の集計

成績の集計は、毎晩の `calculate-accuracy.yml`（JST 23:30）が新しい規則で `models`・`accuracy_cache` を作り直す。すぐに反映したい場合は、GitHub Actions の calculate-accuracy を手動で実行する。

## 元に戻す

- トリガー: 112 の冒頭の「元に戻す」の SQL を実行する。関数と発火条件が 097 の状態に戻る。
- 書き直した予想: 元の値には自動では戻らない。必要なら、旧規則での再判定（`race_status` を見ない判定）を別途行う。書き直すのは不成立・返還のレースの予想だけ（約260行）で、通常のレースには触れない。

## 対象外（このPRでは直さない）

- **scripts/analysis/ 配下**: `is_no_race` を読む分析スクリプトは対象外。BOA-536（analysis の約25本が払戻の列を逆に読む件）と同じく別に扱う。
- **unified の3連系**: 既存の 6,503行に、NULL ではなく false が入っている。旧 `fixMissingHitFlags` が top_3rd を見ていなかったため。今後の補完は NULL を書く。既存行は、本件の書き直しの対象（不成立・返還のレース）に入らない分は残る。unified は `models` の集計（standard・safeBet・upsetFocus）に入らないので、成績の画面には出ない。
- **一部の勝式だけが不成立のレース**: たとえば複勝だけが不成立のレース。判定には払戻の明細（`race_payouts`）が要る。今回の規則は返還艇だけを見る。
