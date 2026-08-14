# unifiedモデル 月次パラメータ見直し運用（FR8）

`scripts/maintenance/review-unified-model-params.js` を月次（目安: 毎月1日前後）で実行し、直近30日分の実績を確認する。自動でパラメータを書き換えることはしない。判断材料の提示のみで、係数調整は都度人手で行う。

## 実行方法

```bash
# 直近30日（デフォルト）
node scripts/maintenance/review-unified-model-params.js

# 期間を指定
node scripts/maintenance/review-unified-model-params.js --days=60
node scripts/maintenance/review-unified-model-params.js --from=2026-07-01 --to=2026-08-01
```

内部で以下4つの既存検証スクリプト（Task7〜8bで実装済み）を順に呼び出し、結果を1レポートにまとめる。

| 指標 | 呼び出すスクリプト | 対応FR |
|---|---|---|
| 複勝的中率（コース別勝率） | `scripts/analysis/backtest-course-rate-only.js` | FR1 |
| 展開予測の的中率 | `scripts/analysis/verify-turn-prediction-accuracy-v6.js` | FR2 |
| イン崩れ指数パーセンタイルの予測力 | `scripts/analysis/verify-volatility-predictive-power.js` | FR3 |
| 3連単参考情報の回収率（EV閾値別） | `scripts/analysis/backtest-unified-model.js` | FR4 |

## 注意点

- **実行時間**: 各スクリプトはレース単位で複数回Supabaseへ問い合わせるため、対象レース数が多いと数十分かかる場合がある（2026-08-13時点、5日分で40分以上）。月次実行では余裕を持って開始する
- **サンプル数**: unifiedモデルは2026-08-11リリースのため、当面はサンプル数が少ない。統計的に意味のある判断（数百〜千レース規模）ができるのは運用開始から数週間後を目安にする
- **係数の変更先**: 見直しの結果、係数調整が必要と判断した場合の変更先は以下
  - 展開予測: `scripts/lib/turnPrediction.js`
  - イン崩れ指数: `scripts/lib/volatilityFactors.js`
  - 3連単スコアリング・EV閾値: `scripts/lib/unifiedModel.js`、`scripts/daily/generate-unified-trifecta-reference.js`
- 変更後は必ず対応する検証スクリプトを再実行し、実際に指標が改善したことを確認してからコミットする（`.claude/rules/analysis.md`のデータ精度検証ルールに準ずる）
