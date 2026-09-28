---
paths:
  - "src/**"
---

# 新機能・新ページ追加時の多言語化の3区分（必須）
新しいページ・機能を実装する際は、必ず以下の3区分のどれに該当するかを決めてから着手する（2026-08-09合意、i18n監査で「未翻訳ページを全言語URLで配信しlang=enを宣言する」構造欠陥が発覚したため）。

1. **翻訳対象（translated）**: ユーザー獲得に直結する主要導線（ホーム・分析ツール・ガイド・会場ガイド等）。UI文言は直書き禁止で`t()`経由、**4言語のi18nキーを同じPRで追加**し、`src/config/languages.js`の`TRANSLATED_PATHS`に登録する。用語は`docs/reference/i18n-glossary.md`準拠（新用語はglossaryに追記してから翻訳）
2. **ja専用（ja-only）**: 規約・管理画面・成績ページ等、翻訳コストに見合わないもの。`TRANSLATED_PATHS`に登録しない（=言語プレフィックスURLはja版へ自動リダイレクトされ、`lang=ja`で配信されてブラウザのGoogle翻訳に委ねられる。hreflang非出力・言語スイッチャー無効化も自動で連動）。ブログは原則この区分だが、featured記事のうち英語対応済みのものは`src/config/languages.js`の`PARTIALLY_TRANSLATED_PATHS`で記事単位に例外扱いする（`.claude/rules/content-ops.md`フローA-3「新機能リリース時のブログ記事ルール」参照）
3. **特定言語専用**: `/venues`系のような言語別コンテンツ。`LANGUAGE_ONLY_PATHS`に登録

共通ルール:
- 選手名等の固有名詞を表示する要素には`translate="no"`を付ける（ブラウザ自動翻訳で名前が壊れるのを防ぐ）
- 会場名は`venues.*`i18nキーを使う。日本語のVENUE_NAMES定数を新規に作らない
- 時刻表示は非ja言語で「JST」を付記する（`t("home.jstNote")`）
