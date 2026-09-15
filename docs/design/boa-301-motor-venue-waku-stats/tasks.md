# モーター単体の会場内比較・枠番別成績 tasks

対応: [spec.md](./spec.md) / [screens.md](./screens.md) / [plan.md](./plan.md)

## 着手順序の推奨

FR-1（データ取得済み・低コスト）→ FR-2/3（新規集計、コース抽象化込み）→ FR-4（最もサンプルが薄い）の順で、依存の少ないものから積み上げる。既存の`MotorConditionChart`への統合は最後にまとめて行う（コンポーネント個別の動作確認を先に済ませてから統合した方が問題の切り分けがしやすい）。

前提: BOA-257（進入コース精度）・BOA-329（モーター交換対応）はそれぞれ別Agentで対応中。本tasks.mdのFR-2〜4は、両方が未解消の状態でも進められるよう「暫定値（艇番=コース、180日ウィンドウ）」で実装し、解消後に差し替え可能な設計にする（plan.md参照）。

## FR-1: 会場内モーターランキング

- [ ] `getVenueMotorRanking(venueCode, metric)`を`supabaseDataService.js`に実装する（`venue_motor_stats`の最新スクレイピング日の行を同一`venue_code`内で指標順にソートし、対象モーターの順位・総数を返す）
- [ ] 既存`MotorStatBadgeRow`の`badges`配列に順位バッジ（例:「会場内3位／24機中」）を追加できることを確認し、`MotorConditionChart`に配線する
- [ ] データ精度検証: 手動集計（SQL直接実行等）とUI表示値が一致することを確認する（`.claude/rules/analysis.md`準拠）

## FR-2/FR-3: 枠番別成績・展示タイム推移

- [ ] `getMotorWakuStats(venueCode, motorNumber, { courseColumn = 'boat_number' })`を実装する（`race_entries`×`race_results`で1着率/2連率/3連率をコース別に集計、直近180日ウィンドウ、n数を必ず返す）
- [ ] 同関数（または対になる関数）で展示タイムの推移データも返すようにする（`exhibition_data`を同じ絞り込みで結合）
- [ ] 新規コンポーネント`MotorWakuStatsGrid`を実装する（`embedded=true`時は指定艇番の行を強調表示＋タップで全6コース展開、`embedded=false`時は常に全6コース表示）。艇番の色（`BOAT_COLORS`）は使わず中立色にする（screens.md参照）
- [ ] データ精度検証: 特定モーター1件を選び、手動集計とUI表示値が一致することを確認する

## FR-4: 選手×モーター×枠成績

- [ ] `getMotorRacerWakuStats(venueCode, motorNumber, { courseColumn })`を実装する（FR-2のJOINに`racer_id`を追加してグルーピング、n数を必ず返す）
- [ ] 新規コンポーネント`MotorRacerWakuDrillDown`を実装する（既存`DrillDownHeader`を流用、選手別・枠番別の成績リスト）。`MotorWakuStatsGrid`の特定コース行タップで開く導線にする
- [ ] サンプル数が小さい行（n<6目安、基本情報タブ・BOA-306と同じ閾値）の視覚的区別を適用する
- [ ] データ精度検証: 実データでn数・成績値の妥当性を確認する

## 統合・仕上げ

- [ ] `MotorConditionChart.jsx`にFR-1〜4を統合し、レース詳細ページの「モータ情報」タブ（`embedded=true`）と分析ツール「モーター調子」タブ（`embedded=false`）の両方で表示範囲が意図通り切り替わることを確認する
- [ ] ライト/ダークモード両方でPlaywright目視確認する
- [ ] `npm run build`・`npm run test:e2e`を実行し、既存のモーター調子タブ・レース詳細ページの回帰が無いことを確認する
- [ ] BOA-257・BOA-329それぞれの対応状況を確認し、まだ暫定値のままなら、その旨をPR本文・完了報告に明記する

## 横断確認

- [ ] `.claude/rules/component-reuse.md`に沿って、`MotorStatBadgeRow`・`MotorRecordStatCards`・`DrillDownHeader`を実際に変更なしで流用できたか、実装時に想定と乖離が無いか確認する
- [ ] `/code-review`セルフレビュー、レビュー指摘の修正・記録
