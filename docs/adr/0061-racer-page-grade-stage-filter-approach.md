# ADR 0061: 選手ページのグレード別・レース種別フィルタの実現方式

## ステータス

採用

## 背景

[BOA-159](https://linear.app/boat-ai/issue/BOA-159)（`docs/design/racer-stats-drilldown/spec.md`）で、選手ページ（`/racer/:racerId`）の会場×枠番フィルタに、グレード（`races.race_grade`）・レース種別（`race_conditions.race_stage`、「優勝戦」「準優勝戦」の完全一致のみ）を第3・第4軸として追加する。

既存の会場×枠番フィルタ（`RacerPerformanceStats.jsx`）は、`getRacerRaceHistory(racerId)` で対象選手の過去2年分の出走履歴を1回だけ取得し、`aggregateRacerVenueBoatStats`（純粋関数、I/O無し）でフィルタ変更ごとにフロント側で再集計する設計になっている。この既存設計をどう拡張するかが論点。

## 決定

**既存の `getRacerRaceHistory` を拡張し、フロント側集計のまま4軸に対応する。**

1. `getRacerRaceHistory` の `races` テーブルSELECTに `race_grade` を追加する（既存の `race_id, venue_code` → `race_id, venue_code, race_grade`）
2. `race_conditions` テーブルを新規に `fetchAllByIn("race_conditions", "race_id, race_stage", "race_id", raceIds)` で取得し、既存の `venueByRaceId`/`resultByRaceId` と同じ `Map` パターンで `race_id` をキーにJOINする
3. 返却オブジェクトに `raceGrade`・`raceStage` を追加する
4. `aggregateRacerVenueBoatStats(history, venueCode, boatNumber)` の引数に `raceGrade`・`raceStage` を追加し、フィルタ条件に含める（関数自体はネットワークI/O無しの純粋関数のまま維持）
5. `RacerPerformanceStats.jsx` に `vcGrade`・`vcStage` の state を追加し、既存の `vcVenue`/`vcBoat` と同じUIパターン（select、`vcActive` 判定、ラベル生成）を拡張する

新規マイグレーション・新規RPC・新規テーブルは不要。既存カラム（`races.race_grade`、`race_conditions.race_stage`）をそのまま使う。

## 却下した選択肢

- **新規RPC関数でサーバー側集計する**: [ADR-0052](0052-racer-grade-win-rate-cache-strategy.md)は「全選手（約1,627人）一括」という別ドメインの問題であり、RPC化・キャッシュテーブルが正当化される規模だった。一方、本機能は**単一選手**の履歴に対する追加フィルタであり、既存の `getRacerBoatReturnRate`（コメントに「対象が1選手のみのためRPC化は不要」と明記）と同じ軽量なクエリ規模。新規RPCマイグレーションを追加するコストに対して得られる利点（クエリ実行時間の短縮等）が小さく、既存のフロント集計パターンとの一貫性も失われるため却下
- **`racer_aggregated_stats`（事前集計テーブル）にグレード別・レース種別別の列を追加し、バッチスクリプトで集計**: この事前集計テーブルは会場別・コース別のような「組み合わせ数が少なく恒常的に使う」集計に向いている。本機能は会場×枠番×グレード×レース種別の4軸を任意に組み合わせられる必要があり、組み合わせ数が爆発する（24会場×6枠番×5グレード×3レース種別＝2,160通り以上）ため事前計算に適さない。既存の会場×枠番フィルタと同じ「履歴を1回取得しフロントで動的に再集計する」設計の方が、組み合わせ数に依存せずスケールするため却下
- **`race_conditions.race_stage` の312種類の値をカテゴリに正規化してから保存し直す（マイグレーション + バックフィル）**: 「予選特賞は予選か特賞か」等の恣意的な優先順位ロジックが必要になり、正規化ルール自体の妥当性を保証できない。競合（日和）もこの軸を持たないことを確認済み（`docs/proposal/competitor-kyoteibiyori/data-coverage-comparison-2026-09-14.md:26`）。spec.md で「優勝戦」「準優勝戦」の完全一致のみに絞る方針が確定済みのため、正規化自体が不要と判断し却下

## 影響

- `getRacerRaceHistory` のクエリが1つ増える（`race_conditions` の `fetchAllByIn`）。対象 `race_id` は既に `races`/`race_results`/`exhibition_data` で3回フェッチしているのと同じ規模（選手1人・過去2年分、通常数百件程度）のため、既存のI/O最小化設計を大きく損なわない
- グレード・レース種別で絞り込んだ場合、2025-12〜2026-01のレースは `race_grade`/`race_stage` が両方 `NULL` のため対象から自動的に除外される（`spec.md` の制約・前提に記載済み）。追加のUI注記は行わない
- サンプル数閾値（5走未満非表示）は本機能には適用しない。既存の閾値ルール自体の見直しは [BOA-335](https://linear.app/boat-ai/issue/BOA-335) で別途検討する
