# race-ai-copy タスク分解

`docs/design/race-ai-copy/spec.md`・`screens.md`・`plan.md`に基づくタスク一覧。依存順に並べており、上から順に実装する。

## タスク一覧

- [x] **1. i18nキー追加（4言語）**
  `src/locales/{ja,en,zh-TW,ko}/common.json`に`aiCopy`名前空間を追加。ボタンラベル・バッジ/吹き出し文言・トースト文言（成功/失敗）・3パターンのプロンプト文言（単勝/3連単/3連複）・見出し用テキスト（「ボートレース出走表データ（{venue} 第{race}レース）」等）を定義する。ja原文は`plan.md`記載の案をベースに、en/zh-TW/koは`docs/reference/i18n-glossary.md`準拠で翻訳する。

- [x] **2. Toast汎用コンポーネント実装**
  `src/components/Toast.jsx`を新規作成。`framer-motion`の`AnimatePresence`でフェードイン/アウトする成功/エラー通知（ADR 0014準拠）。propsで表示テキスト・種別（success/error）・表示時間を受け取る設計にし、他機能でも再利用可能にする。

- [x] **3. aiCopyPrompts.js（プロンプトテンプレート定義）**
  `src/utils/aiCopyPrompts.js`を新規作成。3パターン（win/trifecta/trio）のプロンプト種別定義と、`t()`経由での文言取得ロジックをまとめる。

- [x] **4. useAiCopyText フック実装**
  `src/hooks/useAiCopyText.js`を新規作成。`prediction`・`selectedRace`・`promptType`（`aiCopyPrompts.js`の種別）・現在の表示言語を受け取り、Markdown表＋プロンプト文言の完成テキスト文字列を返す。`raceIndicators.jsx`の`buildIndicatorRows()`が持つ既存i18nキー（`dataTable.row*`）を見出しとして再利用する。

- [x] **5. AiCopyPromptSelector コンポーネント実装**
  `src/components/race/AiCopyPromptSelector.jsx`を新規作成。単勝/3連単/3連複をセグメントコントロールで選択するUI。選択状態はコールバックで親に伝える。

- [x] **6. AiCopyButton コンポーネント実装**
  `src/components/race/AiCopyButton.jsx`を新規作成。`variant`（`banner`\|`inline`）で見た目を出し分け。クリックで`useAiCopyText`の出力を`navigator.clipboard.writeText()`に渡し、成功/失敗を`Toast`で表示する。

- [x] **7. AiCopyBanner コンポーネント実装**
  `src/components/race/AiCopyBanner.jsx`を新規作成。`AiCopyPromptSelector`＋`AiCopyButton(variant="banner")`＋キャッチコピーバッジを内包。`framer-motion`でパルス/バウンスアニメーション（`prefers-reduced-motion`配慮込み）。クリック時にデータ出走表セクションへスムーズスクロール。

- [x] **8. PredictionPanel.jsx への統合**
  既存の`PredictionPanel.jsx`に`AiCopyBanner`（上部）と`AiCopyButton(variant="inline")`（`DataRaceTable`直後）を追加。結果未確定レースのみ表示する条件分岐を、`TurnPatternList`と同様のパターンで実装する。App.jsx・RaceDetail.jsxへの個別変更は不要（共通コンポーネント経由で両画面に自動反映されることを確認する）。

- [x] **9. E2Eスモークテスト追加**
  `e2e/smoke.spec.js`に、(a) 結果未確定レースでAiCopyBanner/AiCopyButtonが表示される (b) 結果確定済みレースでは表示されない (c) コピー実行後にトーストが表示される、の3点を確認するテストケースを追加する。

- [x] **10. 動作確認・PR作成**
  ローカルで`npm run dev`起動、Playwrightでja/en/zh-TW/koそれぞれのレース詳細ページ・ホーム画面埋め込みパネルの両方で見た目・コピー内容・多言語出力を確認。モバイル幅（375px等）でのレイアウト崩れ・アニメーションの動作も確認。`npm run build`・`npm run test:e2e`実行後、`/create-pr`でPR作成。
