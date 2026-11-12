---
name: analyze-venue
description: 指定した会場のボートレース予測データを分析し、回収率100%超えのルールを探索
---

# 会場別予測分析

会場コード **$ARGUMENTS** の分析を実行してください。

## 実行手順

1. **基本統計の確認**
   - レース数、1号艇勝率、荒れ度
   - 単勝/複勝/3連複/3連単の回収率

2. **条件探索**
   - 回収率100%を超える条件を探索
   - 例：「1号艇A1級 + モーター2連率40%以上」

3. **結果保存**
   - `data/analysis/venue-{コード}/` に結果を保存

## スクリプト

```bash
node scripts/analysis/collect-venue-stats.js --venue=$ARGUMENTS
```

## 会場コード一覧
1:桐生, 2:戸田, 3:江戸川, 4:平和島, 5:多摩川, 6:浜名湖,
7:蒲郡, 8:常滑, 9:津, 10:三国, 11:びわこ, 12:住之江,
13:尼崎, 14:鳴門, 15:丸亀, 16:児島, 17:宮島, 18:徳山,
19:下関, 20:若松, 21:芦屋, 22:福岡, 23:唐津, 24:大村

## 会場ルールの分析の決まり（旧 rules の analysis.md から、ZB03③ 2026-11）

- 目標: 各会場で回収率100%超えのルール・条件を統計的に見つける。流れは 仮説 → データ分析 → ルール発見 → 検証 → 本番適用 → 結果確認
- 採用の基準: 回収率100%以上（必須）・サンプル数10以上（推奨20以上）・的中率は参考
- 実装先は `src/services/ruleMatchService.js`（betType は win・place・trio・exacta）。実装済みの会場とルールの正本は `src/config/venueRules.js`
- ルール ID の頭: 江戸川 E03・平和島 HW04・浜名湖 H06・蒲郡 G07・津 TS09・三国 M10・びわこ B11・鳴門 N14・丸亀 R15・児島 K16・宮島 MY17・徳山 TY18・芦屋 AS21・福岡 F22・大村 OM24
- 分析を終えたら `data/analysis/venue-{コード}/` に `README.md`（会場特性・概要）・`rules.json`（ルール定義）・`RULE_SPECIFICATION.md`（実装仕様）。型は `.claude/templates/analysis-docs.md`
