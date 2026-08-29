# ADR 0030: SNSハブPhase 2 — insight昇格・注入処理の実行タイミング

## ステータス
採用

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
