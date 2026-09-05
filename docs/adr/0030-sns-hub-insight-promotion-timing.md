# ADR 0030: SNSハブPhase 2 — insight昇格・注入処理の実行タイミング

## ステータス
一部改訂（昇格処理の実行主体を変更、2026-09-05追記参照）

## 背景
insightの`proposed`→`active`昇格（週次デフォルト採用、spec.md要件4）と、生成Routineへの`active`なinsightの注入（要件5）は、いずれも「週次」で行う設計が決まっている。この処理をどのRoutine・スケジュールで実行するかが未確定だった。

## 決定
**既存の週次バッチ生成Routine（`sns-hub-content-generation`、月曜起動時に「週次バッチ生成」フローに入る）に処理を統合する**。月曜の実行時、コンテンツ生成に着手する前に新しいステップとして「(a) `created_at`から1週間以上経過し`status=proposed`のままのinsightをrisk-rules.jsonと照合し、問題なければ`active`に昇格する（`activated_at`記録）、抵触すれば`decision_note`に理由を記録して`retired`にする、(b) 生成対象のplatform/format/languageに一致する`active`なinsightを取得し、以降の生成プロンプトへ追加コンテキストとして渡す」を追加する。

## 却下した選択肢
- **insight昇格・注入専用の新規Routineを、独立した週次cronで新設する**: 却下理由: (1) 新規Routineを増やすとRoutine管理（`sns-hub-v3`環境の割り当て、Claude利用枠の消費、失敗時の監視対象）が増える。既存のPhase 1構築時点で「新規の月額固定費追加を極力避ける」「Claude Code Routineは既存の購読に含まれる」という非機能要件方針があり、Routine数自体を無闇に増やすことは同じ精神に反する、(2) 独立スケジュールにすると、昇格処理と生成処理の実行順序を`cron`のタイミング調整で保証する必要が生じる（昇格処理が生成処理より後に走ってしまうと、その週のinsightが反映されない事故が起きうる）。同一Routine内の逐次ステップにすれば順序は自明に保証される
- **insightの昇格は管理画面側のAPI（Vercel Edge Function）で、日時ベースの定期実行（Vercel Cron）を使って行う**: 却下理由: 昇格処理にはrisk-rules.jsonとの照合（テキストの意味判断を伴う可能性がある軽い処理）が必要で、これは既存の設計方針上Routine側（Claude Code環境）が担う領域。Vercel Edge Function側はSupabaseへの読み書き専用に徹する既存のADR 0021の役割分担とも整合する

## 影響
- `sns-hub-content-generation`Routineのプロンプト（`.claude/CLAUDE.md`等ではなくRoutine自体のjob_config）に新規ステップを追記する必要がある（`RemoteTrigger update`で全体を送り直す）
- 日次実行（当日ネタ生成、月曜以外）ではinsightの昇格処理は行わない。生成時の`active`なinsight読み込みのみ行う（要件5は毎日実施、要件4の昇格判定は週次のみという非対称な設計になる。spec.mdの非機能要件「反映サイクルは週次のみ」と整合）
- 将来、昇格処理が重くなった場合（insight数の増加、より複雑な照合ロジック）は、本ADRを見直し独立Routine化を検討する余地を残す

## 2026-09-05追記: 昇格処理が孤立し、手動承認に切り替え

本ADRが処理の統合先とした`sns-hub-content-generation`Routine自体が、その後のsns-topic-gateへの経路統合作業（タスク#74「generate.js/SNS_HUB_ROUTINE・手動生成パネルの全廃止」、2026-09-04）で完全に廃止された。結果、`scripts/maintenance/promote-strategy-insights.js`（本ADRを受けて実装済みだったスクリプト）はどのRoutine・cronからも呼び出されない孤立コードになり、insightが`proposed`のまま昇格されない状態が続いていた（2026-09-05、実データで`sns_strategy_insights`のtiktok分2件が作成から4日間未昇格のまま放置されていたことを確認）。

**是正**: 週次自動昇格の復元は行わず、`sns-hub`管理画面「戦略メモ」タブの`InsightCard`に手動の「採用」ボタンを追加し、人間が個別にactive化する運用に切り替えた（`api/admin/sns-hub/insights/[id]/approve.js`）。risk-rules照合は参考の警告表示として同エンドポイント内で行うが、承認自体はブロックしない（risk-rules.json自体の既存方針を踏襲）。`getProposedInsightsForPromotion()`/`activateInsight()`/`retireInsight()`（`scripts/lib/snsStrategyInsights.js`）と`promote-strategy-insights.js`本体は削除した。

この変更により、上記「却下した選択肢」の1点目・2点目で比較したトレードオフの前提（Routine側で行うか・独立cronにするか）自体が変わり、「そもそも自動処理にしない」という第3の選択肢を採用したことになる。理由: 本プロジェクトのSNS投稿系はドラフト承認・ネタ承認を含め一貫して人間の個別承認を必須とする設計になっており、insight昇格だけを唯一の自動判定にする一貫性の無さより、既存の承認UIパターン（却下ボタンと対になる採用ボタン）に揃える方が実装・運用コストの両面で合理的と判断した。
