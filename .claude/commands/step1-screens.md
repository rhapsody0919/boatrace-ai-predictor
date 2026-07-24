---
description: SDD Step 1（UI機能）— docs/design/{機能slug}/screens.md に画面・コンポーネントを洗い出す
argument-hint: "<機能slug（kebab-case）>"
---

引数 `$ARGUMENTS` は機能slug（kebab-case）。以降 `{slug}` と表記する。

`docs/design/{slug}/spec.md` をもとに `docs/design/{slug}/screens.md` に、影響する画面・コンポーネントをすべて洗い出して一覧化する。各項目に1〜2行の役割記述（何の画面/コンポーネントか・主要素）を付ける。

洗い出す際は必ず `.claude/rules/component-reuse.md` を確認し、以下を明記する。
- 新規コンポーネントか、既存コンポーネント（`src/components/race/` 等）の拡張で足りるか
- 同じUIパターンが `App.jsx` と `RaceDetail.jsx` の両方に必要になる場合、共通コンポーネント化の方針
- デザイントークン（`src/styles/design-tokens.css`）で表現できる部分と、新規CSSが必要な部分

※データ・分析機能（画面変更なし）ではこのコマンドは使わない。`/step1-spec` の種別判定で「データ・分析機能」となった場合は `/step2` に進む。
