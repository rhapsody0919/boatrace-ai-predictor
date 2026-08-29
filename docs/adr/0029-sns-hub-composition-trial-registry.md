# ADR 0029: SNSハブPhase 2 — 新規コンポジション試作の管理方法

## ステータス
採用

## 背景
Phase 2では生成Routineが新規のRemotionコンポジション（Reactコンポーネント）を自律的に試作できるようにする（spec.md要件6）。試作したコンポジションを「型ごとのデザインバリアント」としてどう管理するかを決める必要があった。Phase 1で既に`sns_template_variants`テーブル（format・variant_name・composition_name・active・notesを持つレジストリ）が存在する。

## 決定
**既存の`sns_template_variants`テーブルを拡張する**（新規テーブルは作らない）。`created_by VARCHAR(10) NOT NULL DEFAULT 'human'`（`'human'`\|`'routine'`）を追加し、Routineが試作したコンポジションもこのテーブルに新規行としてINSERTする（`active=true`にすれば即座に生成時の選択肢に入る）。採用・不採用の判断は、そのバリアントを使って生成された下書きが通常の承認フロー（approve/revise/redo）を通るかどうかで行う。バリアント専用の承認UIは作らない（spec.mdスコープ外）。

## 却下した選択肢
- **試作専用の新規テーブル（例: `sns_template_variant_trials`）を新設する**: 試作中/実験段階のバリアントを本番のレジストリと分離する案。却下理由: (1) `sns_template_variants`は既に`active`フラグを持っており、試作段階かどうかは`active`で表現できる（試作直後は`active=false`にして人間が目視確認後に`active=true`にする運用も可能）、(2) 別テーブルにすると「どの型にどんなバリアントがあるか」を見る際に2テーブルを常に結合する必要が生じ、既存の`sns_drafts.template_variant_id`参照ロジックも複雑化する、(3) YAGNI: 現時点で試作と本採用を区別する具体的な要件（表示上の違い等）が無い
- **コンポジションのメタデータをGitのコミット履歴のみで管理し、DBには何も登録しない**: JSXファイルの存在自体を試作記録とする案。却下理由: 生成Routineが`sns_drafts.template_variant_id`で特定のバリアントを参照する既存の設計と整合しない。DBに登録されていないコンポジションは下書き生成時に選択できない

## 影響
- 既存の`sns_template_variants`を参照する箇所（Routineのバリアント選定ロジック、管理画面での表示があれば）に`created_by`列を追加しても後方互換性は保たれる（デフォルト値`'human'`のため既存行に影響なし）
- 将来、Routine作成バリアントと人間作成バリアントで扱いを変えたくなった場合（例: 一定期間`active`だが一度も使われなければ自動的に`active=false`にする等）、この`created_by`列を起点にロジックを追加できる
