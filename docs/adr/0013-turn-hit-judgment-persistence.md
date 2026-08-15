# ADR 0013: 展開予測的中判定の永続化方式

## ステータス
提案中

## 背景
unifiedモデルの展開予測的中判定（`turnPrediction.patterns`のいずれかの`winnerCourse`が実際の1着コースと一致するか）は、`predictions.is_hit_win`/`is_hit_place`のようにDBカラムとして保存されておらず、`predictions.feature_contributions.turnPrediction`（JSONB）と`race_results`を都度突き合わせて計算する方式になっている。

この判定ロジックは既に以下2箇所に個別実装されている:
- `src/components/race/RaceCard.jsx`の`isTurnHit`（クライアント側、レース一覧カードの的中バッジ用、BOA-173で実装済み）
- `scripts/daily/calculate-unified-model-accuracy.js`の集計ループ（Node側、全体の展開予測的中率をaccuracy_cacheに保存、BOA-179関連で実装済み）

`unified-model-legacy-pages`（BOA-174/175/178）では、この判定を以下2箇所でも新たに必要とする:
- `src/components/HitRaces.jsx`の`extractHitRaces()`（クライアント側、的中レース一覧の抽出）
- `scripts/daily/update-race-history-cache.js`（Node側、日別の展開予測的中率をrace_history_cacheに保存）

対応方式を決めずに実装すると、同一ロジックが4箇所目・5箇所目として重複することになる。

## 決定
**案C: `predictions.is_hit_turn`カラムを新設し、結果反映バッチ（`scripts/daily/scrape-results.js`）で`is_hit_place`と同時に一度だけ計算・保存する。**

- `scripts/lib/hitCalculator.js`に`isTurnHit(predictions, results)`相当の判定関数を追加し、`is_hit_place`計算と同じ場所（`scrape-results.js`の結果反映処理）で呼び出して`is_hit_turn`を保存する
- マイグレーション: `predictions`テーブルに`is_hit_turn BOOLEAN`カラムを追加（`docs/db-migration/`に追加、Supabase MCPアクセストークン失効中のため手動適用が必要）
- 保存後は、`HitRaces.jsx`・`update-race-history-cache.js`・`calculate-unified-model-accuracy.js`は全て`is_hit_turn`カラムを参照するだけになり、`feature_contributions`のJSONB走査は結果反映バッチの1箇所のみになる
- **例外**: `RaceCard.jsx`（本日開催中・結果未確定のレースも表示する一覧カード）は、結果確定前は`is_hit_turn`が存在しないため、既存の都度計算ロジック（`isTurnHit`）をそのまま残す。結果確定後の表示は`is_hit_turn`に切り替えても良いが、必須ではない（表示件数が少なく計算コストが軽微なため、今回のspecでは変更しない）

## 却下した選択肢

**案A: 共有関数を`scripts/lib/`に切り出し、フロント・バックエンド双方が都度計算し続ける**
- 却下理由: `src/services/adlerModel.js`が`../../scripts/lib/harville.js`をimportする前例がありビルド上は可能だが、5箇所全てで`feature_contributions`のJSONB走査・突き合わせを毎回行うことになり、`update-race-history-cache.js`（90日分・数千件規模）のような集計バッチでは不要な計算コストが積み重なる。既存の`is_hit_win`/`is_hit_place`等が全てDB保存済みカラムを参照するだけの設計になっているのに対し、展開予測だけ都度計算方式を継続するのは一貫性を欠く

**案B: 各実装を重複させたまま放置する**
- 却下理由: DRY原則違反。判定ロジックに将来変更（例: パターン数の閾値変更）が入った場合、5箇所全てへの同時修正が必要になり修正漏れのリスクが高い

## 影響

- マイグレーション（`predictions.is_hit_turn`追加）が必要。Supabase MCPが読み取り専用のため、過去のマイグレーション同様ユーザーによる手動適用が必要
- `scrape-results.js`の結果反映処理に軽微な計算コストが追加されるが、レース単位の処理のため影響は小さい
- 既存の`RaceCard.jsx`・`calculate-unified-model-accuracy.js`は、`is_hit_turn`カラムが使えるようになった時点で都度計算ロジックを`is_hit_turn`参照に置き換えることが望ましいが、本spec（BOA-174/175/178）の必須スコープではない。別途リファクタリングチケット化を検討する
- 過去分（2026-08-11のunified運用開始〜マイグレーション適用日まで）の`is_hit_turn`はNULLになる。バックフィル用の一括更新スクリプト（`scripts/maintenance/`）を`/step3`のタスクに含める
