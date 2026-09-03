# ADR 0037: チャネル別パイプラインの構成方式

## ステータス
採用

## 背景
`docs/design/sns-topic-gate/spec.md`要件10により、blog/note/x/tiktok/youtubeそれぞれに独立したパイプライン（Claude Code Routine）を持たせる設計にする。一方でRoutineは新規作成のたびに発火トークンの登録が人間の手動作業になる（Claude Codeからは自動化不可、2026-09-03に2回検証済み）という制約があり、構成方式によってこの手動セットアップ負荷が大きく変わる。

## 決定
**チャネルごとに完全に独立したRoutineを新設する方式を採用するが、5チャネル分を一度に作らず、優先度の高いチャネルから段階的に展開する。**

各Routineは自分の担当チャネル（`sns_target_accounts`の対応行）に紐づく`sns_topic_targets`のみをポーリングし、型（`sns_content_types`）に応じたcadence・トリガー方式で動く。チャネル固有の知見（TikTokガンブル規制等）は各Routine専用のプロンプトファイルにのみ書く（`.claude/rules/sns-content-generation.md`には書かない、ADR外だが`spec.md`要件9参照）。展開順序・段階分けの詳細は`/step3`のタスク分解で決める。

## 却下した選択肢

- **1つのRoutineが起動時に全チャネル分の未claimedターゲットを順番に処理する（単一ポーリングRoutine）**: 発火トークン登録が1回で済む利点はあるが、(1) 1回の実行が長時間化しタイムアウトしやすい、(2) 1チャネルの処理失敗（例: YouTube API障害）が他チャネルの処理をブロックしうる、(3) チャネルごとに異なる知見（TikTokガンブル規制等）が1つのプロンプトに混在し、本spec全体の動機である「伝播漏れの防止」にかえって逆行する（1ファイルが肥大化し、チャネル追加のたびに条件分岐が増える）
- **既存の2 Routine（`sns-hub-content-generation`・`content-multi-channel-pipeline`）を拡張し続ける**: 本specが解決しようとしている問題（修正・技術ルールがパイプライン間で伝播しない、TikTokガンブル規制がPipeline Bに未実装等）そのものがこの構成に起因しており、延命は根本解決にならない

## 影響
- チャネルを1つ追加する（例: Instagram）たびに、新規Routineの発火トークン登録という手動作業が発生する。これは本ADRで解消できないコストとして受け入れる（`spec.md`制約・前提に明記済み）
- 段階的展開の間、未展開のチャネルは引き続き既存の`content-multi-channel-pipeline`（Pipeline B）または`sns-hub-content-generation`（Pipeline A）が担当する暫定状態が生じる。どのチャネルがどちらの仕組みで動いているかを`sns-hub`の進捗マトリクスUIまたはドキュメントで明示し、混乱を避ける
