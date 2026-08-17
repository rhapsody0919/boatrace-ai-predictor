# race-ai-copy システム設計

`docs/design/race-ai-copy/spec.md`・`docs/design/race-ai-copy/screens.md` を実現するための設計。

## データ設計

新規のSupabaseテーブル・カラム・マイグレーションは**不要**。

理由: コピー対象データ（データ出走表11指標×6艇）は`RaceDetail.jsx`/`App.jsx`が既に保持している`prediction`オブジェクト（`prediction.racerStats`等）と、`DataRaceTable.jsx`が参照している`raceIndicators.jsx`の`buildIndicatorRows()`の出力から導出できる。クライアント側でのテキスト整形のみで完結する。

## コンポーネント構成・データフロー

```
PredictionPanel.jsx（既存拡張）
├─ AiCopyBanner（新規）
│   └─ 予想パネル上部に配置。パルス/バウンスアニメーション付きのAiCopyButton + キャッチコピーバッジ
│       クリックで DataRaceTable セクションへスムーズスクロール → コピー実行
│
├─ DataRaceTable.jsx（既存、変更なし）
│   └─ AiCopyButton（新規、variant="inline"）
│       データ出走表の直後に配置。クリックで直接コピー実行（スクロールなし）
│
└─ [AiCopyButtonクリック時の共通処理]
    1. AiCopyPromptSelector で選択中のプロンプト種別（win/trifecta/trio、デフォルトwin）を取得
    2. useAiCopyText({ raceId, prediction, race }) を呼び出し、
       返された buildText(promptType) にプロンプト種別を渡してMarkdown表＋プロンプト文言の
       完成テキストを取得する（フック内部で useRaceAnalysisData(raceId) を呼び出し、
       DataRaceTable と同じ withCache 経由でデータ取得。in-flightデデュープにより
       DataRaceTable と同時にマウントされても追加のネットワークリクエストは発生しない）
    3. navigator.clipboard.writeText(text) でクリップボードに書き込み
    4. 成功時: Toast表示（「コピーしました」等、`t()`経由）
       失敗時（Permission denied等）: Toastでエラー表示（クリップボード権限不可の場合など）
```

**実装済みの実際のシグネチャ**（`src/hooks/useAiCopyText.js`）: `useAiCopyText({ raceId, prediction, race })` → `{ buildText(promptType), isReady }`。表示言語は`useTranslation()`が返す現在の`i18n`インスタンス経由で自動的に反映されるため、明示的な`language`引数は不要だった。

### 新規ファイル
| ファイル | 役割 |
|---|---|
| `src/components/race/AiCopyButton.jsx` | コピー実行ボタン本体。`variant`（`banner`\|`inline`）で予想パネル上部バナー用／データ出走表直後用の2つの見た目を出し分け |
| `src/components/race/AiCopyPromptSelector.jsx` | 単勝/3連単/3連複を選択するセグメントコントロールUI。選択状態は`AiCopyBanner`が保持し、`AiCopyButton`にpropsで渡す |
| `src/hooks/useAiCopyText.js` | `prediction`・`selectedRace`・`promptType`・現在の表示言語から、Markdown表＋プロンプト文言の完成テキストを組み立てる純粋関数寄りのフック。UIから分離してユニット的に検証しやすくする |
| `src/components/Toast.jsx` | 汎用トースト通知（[ADR 0014](/docs/adr/0014-race-ai-copy-toast-implementation.md)参照） |
| `src/utils/aiCopyPrompts.js` | 3パターンのプロンプト文言テンプレート（i18nキー参照、`t("aiCopy.promptWin")`等) |

### 既存ファイルの変更
| ファイル | 変更内容 |
|---|---|
| `src/components/race/PredictionPanel.jsx` | 上部に`AiCopyBanner`を追加。`DataRaceTable`直後に`AiCopyButton variant="inline"`を追加 |
| `src/locales/{ja,en,zh-TW,ko}/common.json` | `aiCopy.*`名前空間で新規キー追加（ボタンラベル・バッジ文言・トースト文言・3パターンのプロンプト文言・Markdown表の見出しは既存`dataTable.*`キーを再利用） |

## Markdown出力フォーマット（確定案）

```markdown
## ボートレース出走表データ（{会場名} 第{R}レース）

| 項目 | 1号艇 | 2号艇 | 3号艇 | 4号艇 | 5号艇 | 6号艇 |
|---|---|---|---|---|---|---|
| 選手名 | ... | ... | ... | ... | ... | ... |
| 級別 | A1 | ... |
| 全国勝率 | 6.52 | ... |
| 当地勝率 | 6.80 | ... |
| モーター2連率 | 38.5% | ... |
| 調子（勝率Δ） | ↑0.12 | ... |
| 平均ST | 0.15 | ... |
| ST安定度 | ±0.02 | ... |
| 展示ST | 0.14 | ... |
| 展示タイム | 6.78秒 | ... |
| コース別勝率 | 55% (11/20) | ... |
| 決まり手（最多） | 逃げ（8勝） | ... |
| 単勝回収率 | 92% | ... |

{選択中のプロンプト文言}
```

見出し行の項目名は`raceIndicators.jsx`が既に使っている`dataTable.row*`系i18nキーをそのまま再利用し、画面表示とコピー結果の表記を完全一致させる（新規翻訳作業は不要）。

## プロンプト文言（3パターン、日本語原文案）

実装時に`docs/reference/i18n-glossary.md`準拠でen/zh-TW/koへ翻訳する。以下は日本語原文の確定案（要ユーザー最終確認）:

- **単勝**: 「上記はボートレースの出走表データです。このデータをもとに、1着になる可能性が最も高い艇番を、根拠とともに教えてください。」
- **3連単**: 「上記はボートレースの出走表データです。このデータをもとに、3連単（1着・2着・3着を着順通りに当てる）で狙うべき組み合わせを3つ、根拠とともに提案してください。」
- **3連複**: 「上記はボートレースの出走表データです。このデータをもとに、3連複（1〜3着に入る3艇を着順不問で当てる）で狙うべき組み合わせを3つ、根拠とともに提案してください。」

## 技術判断（ADR）
- [ADR 0014: トースト通知の実装方式](/docs/adr/0014-race-ai-copy-toast-implementation.md) — 自作コンポーネント（`framer-motion`活用）を採用、外部ライブラリは導入しない

## その他の実装メモ（ADR化しない軽微な判断）
- **クリップボードAPI**: `navigator.clipboard.writeText()`を使用。本番はHTTPS配信のため権限制約はなく、フォールバック（`document.execCommand('copy')`等の非推奨API）は実装しない。書き込み失敗時（ブラウザの権限拒否等、稀なケース）はエラーTOASTを表示する
- **アニメーション**: `AiCopyBanner`のパルス/バウンスは既存依存の`framer-motion`（`motion.button` + `animate` + `transition: { repeat: Infinity }`）で実装。`prefers-reduced-motion: reduce`環境では静的表示にフォールバックする
- **表示条件**: 結果未確定レースのみ表示するロジックは、既存の`TurnPatternList`が採用している「`prediction.result`が無い場合のみ表示」の条件分岐パターンを流用する

## 既存サービス層との連携
- 新規のSupabaseアクセス・`src/services/`層への変更は不要（既にロード済みのpropsから完結）
- `scripts/lib/`との連携も不要（フロントエンドのみで完結する機能のため）
