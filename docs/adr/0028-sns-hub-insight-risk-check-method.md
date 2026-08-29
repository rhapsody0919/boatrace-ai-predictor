# ADR 0028: SNSハブPhase 2 — insightのrisk-rulesガードレール実装方式

## ステータス
採用

## 背景
insightが`proposed`から`active`に昇格する前に、`risk-rules.json`の禁止パターンに抵触しないか照合する必要がある（spec.md要件3）。既存の動画・キャプション生成時のリスクチェック（Routineプロンプト内の手順9）はLLMが`risk-rules.json`を読んで自分でテキストと照合する、LLM推論ベースの方式になっている。insightの照合もこれを踏襲するか、決定的なコード実装にするか検討した。

## 決定
**決定的なキーワードマッチのスクリプト（`scripts/lib/riskRules.js`等）を新設する**。`risk-rules.json`の`patterns`配列はすべて単純な文字列パターンであり（例:「競艇」「儲か」「万舟券」）、`insight_text`に対して`patterns.some(p => text.includes(p))`という単純な部分一致で機械的に判定できる。`platforms`が`"all"`または対象platform配列に含まれる場合のみ適用する既存ロジックもそのまま流用できる。

## 却下した選択肢
- **既存の動画生成と同じLLM推論ベースの照合**: Routine（またはinsight昇格処理を行うスクリプト）がLLMとして`risk-rules.json`を読み判定する案。却下理由: (1) `risk-rules.json`のパターンは単純な文字列一致で十分に検出できる内容であり、LLM推論を挟む必要が無い、(2) insightの昇格判定は`sns_strategy_insights`の`status`を書き換える重要な操作であり、LLMの解釈揺れよりも決定的なロジックの方が監査性・再現性が高い、(3) コストの観点でも、週次で発生する数件のinsight照合のためだけにLLM呼び出しを追加する必要は無い

## 影響
- `scripts/lib/riskRules.js`（新設）を、insight昇格処理と将来的な動画生成側の決定的チェックの両方から呼び出せる共通ユーティリティとして設計する（既存の動画生成側のLLM推論チェックを置き換える判断は本ADRのスコープ外、Phase 2では新規の照合先にのみ適用する）
- `risk-rules.json`のパターンが将来「単純な文字列一致では検出できない表現」（言い換え等）を含むようになった場合、この決定的チェックでは検出漏れが起きる可能性がある。現状のパターン定義が単純な単語ベースである前提が崩れた場合は、本ADRを再検討する
