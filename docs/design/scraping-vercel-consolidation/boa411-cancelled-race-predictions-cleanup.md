# BOA-411: 開催されなかったレースへのpredictions誤生成の調査・対応

BOA-406の調査（PR #816）で発覚した「中止・打ち切りレース269件にpredictionsが生成済み」という事象について、(1) 生成ロジックの再発防止、(2) 既存の残骸行の扱いを調査・対応した記録。

## 現状確認（読み取り専用）

### 1. BOA-406の269件・779行は今も残存している

`races.cancellation_status='confirmed'`（2026-09-24是正済み）かつ`race_results`が存在しない269レースに対し、`predictions`が計779行（`standard`269 + `safeBet`255 + `upsetFocus`255）残存していることを確認した（2026-09-25実測）。

### 2. 同じ不具合はBOA-254導入（2026-09-06）後も現在進行形で再発していた

調査を269件・779行の枠に限定せず、`races.cancellation_status IS NOT NULL AND race_resultsが存在しない`という一般条件で全期間を再集計したところ、**330レース・1023行**が該当した。内訳:

| 対象日 | レース数 |
|---|---|
| 2025-12-03〜2026-03-31（BOA-406の対象） | 269レース・779行 |
| 2026-09-09 | 12レース |
| 2026-09-12 | 2レース |
| 2026-09-21 | 35レース |
| 2026-09-22 | 12レース |

2026-09-09・09-12・09-21・09-22はいずれもBOA-254（`races.cancellation_status`検出機構、2026-09-06導入）より後の日付であり、**この不具合は「BOA-254導入前の過去データに限った問題」ではなく、導入後も継続して発生していた**。全330レースで`is_hit_win`/`is_hit_place`/`is_hit_trifecta`/`is_hit_trio`/`payout_*`は全件NULLであることも確認済み。

### 3. 根本原因: 予測生成（発走前）と中止確定（発走後）の時間差

- `generate-predictions.js`の`mainRefresh`は、発走60/30/15/10/5分前の時間窓でレースを検出し（`scripts/lib/raceSchedule.js`の`getRaceSchedule`/`getRacesInWindow`）、`race_entries`さえ存在すれば予測を生成する。`fetchRaceDataFromSupabase`は`races.cancellation_status`を一切見ていなかった
- 一方、中止・順延の確定（`confirmCancellationsForRaceIds`）は「発走90分超・結果未取得」を待つか、公式の早期告知に依存する早期確定ジョブ（`scripts/lib/raceStatusJob.js`、2026-09-21のpostponed-day-early-detection導入）が必要
- 結果として、当日の告知前・かつ予測生成の時間窓（発走前）は`cancellation_status`がまだNULLのままであり、`generate-predictions.js`はそのレースを「通常のレース」として予測を生成してしまう。生成後にレースが中止・順延と確定しても、既に書き込まれたpredictionsは残り続け、`race_results`が永遠に来ないため`is_hit_win`等も永遠に未確定のまま残存する
- 2026-09-21は`raceStatusJob`の設計ドキュメント（`docs/design/scraping-vercel-consolidation/postponed-day-early-detection.md`）が「戸田・江戸川・津で7R以降の確定が発走1.5時間後まで遅れた」と記録している、まさに本不具合の実例。同ジョブは確定の**速さ**を改善するが、確定より前に予測生成が先行してしまう構造自体は解消しない

## 対応: 生成ロジックの修正（再発防止）

`scripts/daily/generate-predictions.js`の`fetchRaceDataFromSupabase`で、`races`テーブルから`cancellation_status`も取得し、非NULL（`tentative`または`confirmed`）のレースは`race_entries`が存在していても予測生成の対象から除外するようにした。

```js
const race = racesByRace.get(raceId) || {};
if (race.cancellation_status) {
  console.log(`  ⏭️  ${raceId} — 中止・順延検知済み（cancellation_status=${race.cancellation_status}）のため予測生成をスキップ`);
  continue;
}
```

`fetchRaceDataFromSupabase`は`mainRefresh`の自動検出（発走前ウィンドウ）・`specificRaceIds`指定の両方の経路から呼ばれる唯一の関所のため、ここ1箇所の修正で両経路をカバーする。

**この修正で防げる範囲**: 一度`cancellation_status`が設定された後の再生成（同日の別ウィンドウでの再実行、手動再計算、バックフィル等）。`raceStatusJob`（10分間隔の公式告知ポーリング）と組み合わさることで、当日の告知が発走60分前より十分早ければ、初回の生成自体も防げる。

**この修正で防げない範囲**: 告知が無い/遅い、または発走90分超の結果未取得を待つしかないケースで、かつ当該レース自身の予測生成ウィンドウ（発走60分前〜）が既に通過してしまっている場合。この構造的なタイムラグ自体（確定より先に生成が走りうる）は、ポーリング間隔の短縮や告知検知の対象拡大等の追加対策が必要であり、本チケットのスコープを超えるため別途検討課題として記録する（本ドキュメント末尾「今後の検討課題」参照）。

**検証**: `scripts/maintenance/verify-prediction-refresh.js`に検証ケース(i)を追加し、インメモリの偽クライアントで「cancellation_statusが`tentative`/`confirmed`のレースは予測を生成せず、通常レースのみ生成する」「除外時にログへ出力する」ことを確認した（`node scripts/maintenance/verify-prediction-refresh.js`で全項目パス）。

**スコープ外として確認済みの別経路**: `generate-predictions.js`のレガシー経路（`data/races.json`を読む`main()`/`generateAndWriteFromRacesData`）は、`.github/workflows/`・`scripts/lib/scrapeJobs/`のいずれからも呼ばれておらず、本番では未使用と確認した（本番は`preRaceHandlers.js`経由の`mainRefresh`のみ）。`generate-unified-predictions.js`（`model_id='unified'`を生成する別スクリプト）も同様に`cancellation_status`を見ずに`race_entries`の有無だけで判定しており、理論上は同種の構造的リスクを持つが、今回の1023行に含まれる`unified`行61件は生成タイミングの違いにより本チケットの主要因ではない可能性があり、深追いはBOA-411のスコープ外として別チケット化を推奨する。

## 対応: 既存残骸行（330レース・1023行）の扱い

### 安全性の確認

- 対象1023行は全件`is_hit_win`等の的中判定列・`payout_*`列がNULL（結果が来ないため今後も変化しない）
- `scripts/daily/calculate-accuracy.js`の集計（`models`テーブル更新・`accuracy_cache`生成の両方）は、predictions取得時に`.not("is_hit_win", "is", null)`でフィルタしており、対象行は**現在の的中率・回収率集計に一切混入していない**（削除しても表示中の数値は変化しない）
- `predictions.race_id`は`races`へのFK（`ON DELETE CASCADE`）だが、本対応は`predictions`のみを削除し`races`は削除しない（`cancellation_status`の是正結果を保持するため）

### フロントエンドへの表示リスク（別調査）

`races.cancellation_status`自体は`get_predictions_by_date`系RPC・`RaceCard`・`PredictionPanel`に伝播しており、「中止」バッジ・バナーの表示は機能している。ただし調査の過程で、本チケットのスコープ外の別UI不具合を2件発見したため、それぞれ別セッション向けに切り出した（本チケットでは対応しない）:

1. `PredictionPanel.jsx`が中止バナーを表示しつつ、その下の予想タブ・「AI用にコピー」ボタン（`useAiCopyText.js`）を非表示にしない
2. ホーム画面の`TodaysVolatilityHighlights.jsx`が`cancellation_status`を見ずに中止確定レースを注目レースとして表示しうる

いずれも「predictionsが存在すること」自体が引き起こす症状であるため、今回の1023行削除は、この2つの不具合の露出機会を（既存分だけ）減らす副次効果もある。

### 推奨対応: 削除

329レース・1023行は、削除してもよい（是正済みの`cancellation_status`は変更しない）。理由:
- 今後も`race_results`が来ないため、いつまでも「未確定」のゴミ行として残り続ける
- 集計への影響が無いことを確認済み
- 保持する積極的な理由がない（YAGNI）

### 実行コマンド案（要ユーザー承認、本PRでは未実行）

```bash
# 1. 現状確認（読み取り専用）
node --env-file=.env.local scripts/maintenance/delete-cancelled-race-predictions.js plan

# 2. DRY-RUN（書き込みなし）
node --env-file=.env.local scripts/maintenance/delete-cancelled-race-predictions.js delete

# 3. 本番実行（要承認）
node --env-file=.env.local scripts/maintenance/delete-cancelled-race-predictions.js delete --apply
```

`plan`実行結果（2026-09-25時点）: 330レース・1023行（cancellation_status='confirmed'のみ、'tentative'は0件）。対象日は2025-12-03〜2026-09-22の26日。

## 今後の検討課題（本チケットのスコープ外、記録のみ）

- 予測生成（発走前）と中止確定（発走後 or 告知ポーリング）の構造的なタイムラグそのものの解消（例: `raceStatusJob`のポーリング間隔短縮、または生成直前に軽量な状態チェックを挟む等）
- `generate-unified-predictions.js`も同様に`cancellation_status`を見ていない件
- `PredictionPanel.jsx`・`TodaysVolatilityHighlights.jsx`のcancellation_status未考慮（spawn_task済み）

## 参照

- Linear: BOA-411、関連: BOA-406（PR #816、未マージ）
- `scripts/daily/generate-predictions.js`（`fetchRaceDataFromSupabase`）
- `scripts/maintenance/verify-prediction-refresh.js`（検証ケース(i)）
- `scripts/maintenance/delete-cancelled-race-predictions.js`（新規、本番書き込みは未実行）
- `scripts/lib/raceStatusJob.js`、`docs/design/scraping-vercel-consolidation/postponed-day-early-detection.md`
- `scripts/daily/scrape-results.js`の`confirmCancellationsForRaceIds`
