# trifecta / trio カラムの命名スワップ問題

## 概要

`predictions` と `race_results` テーブルの trifecta / trio 系カラムは、
**カラム名と実体が入れ替わっている**。

| カラム | 名前が示す意味 | 実際に格納されている値 |
|--------|----------------|------------------------|
| `predictions.is_hit_trifecta` | 3連単的中 | **3連複的中**（順不同一致） |
| `predictions.is_hit_trio` | 3連複的中 | **3連単的中**（順序一致） |
| `predictions.payout_trifecta` | 3連単払戻 | **3連複払戻** |
| `predictions.payout_trio` | 3連複払戻 | **3連単払戻** |
| `race_results.payout_trifecta` | 3連単払戻 | **3連複払戻** |
| `race_results.payout_trio` | 3連複払戻 | **3連単払戻** |

一方、`prediction_odds` テーブル（`trifecta_odds_*` / `trio_odds_*`）の命名は
**正しい**（3連単オッズ > 3連複オッズの関係が常に成立している）。

## 検証エビデンス（2026-06-20〜07-01, standardモデル 1,968レース）

- `is_hit_trio = true` は38件で、**全件が予想3艇と着順の完全一致**（順序込み）
  - 的中率 1.9% は3連単の妥当な水準
  - 例: `2026-06-20-17-01` pred `2-1-4` / result `2-1-4`、
    `payout_trio = 12,910円`（高額 = 3連単の払戻水準）、
    同レースの `race_results.payout_trifecta = 340円`（低額 = 3連複水準）
- `is_hit_trifecta = true` は328件で、うち290件は**順序不一致だが3艇の集合が一致**
  - 的中率 16.7% は3連複の妥当な水準
  - 例: `2026-06-20-02-01` pred `3-1-4` / result `1-4-3`（集合一致・順序不一致）

## 影響範囲

- `scripts/analysis/train-moriarty-calibration.js` — 対応表
  `BET_TYPE_TO_HIT_KEY` で正しい対応付けに補正済み
- `scripts/daily/update-moriarty-outcomes.js` — `judgeBet` 内で
  payout カラムの対応を補正済み
- 2026-11-03 の点検（本番の 11/02 の156レースと、書き手・読み手の全数の grep）で、上の「未対応・要確認」だった3つ（`compare-pcexpect.js`・`analyze-prediction-ensemble.js`・AccuracyHistory の表示）を含め、読み手はすべて逆の名前で読んで打ち消しており、利用者に誤った値は出ていない（例: `2026-11-02-06-08` は payout_trifecta=15,360（3連複）・payout_trio=820,900（3連単）で、結果タブは3連複 15,360円・3連単 820,900円）
- 逆の列は9本: race_results の payout_trifecta・payout_trio・popularity_trifecta・popularity_trio、predictions の is_hit_trifecta・is_hit_trio・payout_trifecta・payout_trio、model_performance_daily.payout_trifecta。書き手（scripts/lib/raceResultRows.js:15-23、scripts/daily/scrape-results.js、kbResultsBackfillRows.js、scripts/ml/backfill.py）は意図して逆に入れている
- hq の読み手は config/ds-extracts/slit-forms-boa980.sql:207 の1か所（`payout_trio AS payout_3tan`、正しく読む）
- 新しい読み手は `race_payouts`（bet_type 3tan・3fuku、正しい命名）から読む

## 恒久対応の選択肢

2026-11-03 の判断: 列名は直さない。書き手と約60の読み手を同時に切り替えないと、切り替えの間に画面と分析が逆になる。得るのは命名の整合だけで、利用者に誤りは出ていない。新しい読み手を race_payouts に寄せて、逆の列の読み手を減らしていく。

1. **DBカラム名を実体に合わせて入れ替える**（マイグレーション + 全参照箇所の一括修正）
2. 書き込み側（`calculate-accuracy.js` 等の非正規化処理）を修正して
   値を正しいカラムに入れ直し、過去分をバックフィル

どちらの場合も、修正済みの Moriarty スクリプト2ファイルの補正マッピングを
同時に外す必要がある。upstream に `feature/fix-trifecta-trio-naming`
ブランチが存在するため、対応状況を確認してから着手すること。
