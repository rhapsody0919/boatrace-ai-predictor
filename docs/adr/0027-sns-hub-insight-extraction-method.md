# ADR 0027: SNSハブPhase 2 — insight抽出の実現方法

## ステータス
採用

## 背景
Phase 2は外部調査（競合・隣接ジャンル観測）から得た知見を`sns_strategy_insights`へ構造化して登録する必要がある（spec.md要件2）。外部調査自体は既存スキル`/x-growth-report`・`/tiktok-growth-report`が担うことは確定済みだが、これらのスキルの出力（`data/analysis/x-growth/report-*.json`＋末尾の「統合分析・次の施策」という自然文の提案）をそのまま構造化データとして使えるかは未確定だった。

## 決定
**既存スキルを拡張する**（新規スキルは作らない）。`/x-growth-report`・`/tiktok-growth-report`の最終ステップに「insightとして`sns_strategy_insights`へ登録する」ステップを追加する。両スキルは既にステップ0で「前回提案した施策の実施・効果検証」を行っており、最終ステップで「小施策（即実行）」の提案を文章として出力する構成になっている。この提案文をそのままinsightの候補として構造化する（`insight_text`=提案文、`evidence`=根拠になった数値・観測、`source`='external-research'、`research_method`='x-growth-report-skill'または'tiktok-growth-report-skill'）。

## 却下した選択肢
- **insight抽出専用の新規スキルを新設する**: `/x-growth-report`・`/tiktok-growth-report`とは別に「insight化」だけを行うスキルを作る案。却下理由: (1) 実行し忘れるステップが1つ増える（既存スキル実行後に別スキルを追加実行する必要があり、継続性リスクが増す）、(2) 既存スキルの「次の施策」提案は既にほぼinsight相当の粒度で書かれており、変換処理を別スキル化するほどの複雑さが無い、(3) 既存スキルのステップ0（前回提案の検証）と新規insightの整合性を保つには、どのみち既存スキルの内部で完結させた方が自然
- **Routine内で自動的にレポートJSONを解析してinsight化する**: レポートJSONをRoutineが読み込みLLM解析でinsight抽出する案。却下理由: このステップも「対話セッション側の仕事」であるべきで（外部調査自体が対話セッション限定という制約と一貫性を持たせる）、無人Routineに解析ロジックを持たせる必然性が無い。むしろ既存スキル実行時（人間が同席している対話セッション）にその場でinsight化した方が、文脈のロスが少ない

## 影響
- `/x-growth-report`・`/tiktok-growth-report`のドキュメント（`.claude/commands/`）に新規ステップを追記する必要がある
- 既存の静的ファイル保存（`data/analysis/x-growth/report-*.json`）は維持し、insight化は追加の出力として扱う（既存の運用・過去データ参照を壊さない）
- 過去に蓄積済みのレポートからも遡ってinsight化できる（新しいスキル実行を待たずに初期データを投入可能）
