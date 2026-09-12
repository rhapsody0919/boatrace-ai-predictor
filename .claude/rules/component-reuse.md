---
paths:
  - "src/**"
---

# フロントエンド開発ルール（コンポーネント再利用・デザイン統一）

## 原則
- **同じUIパターンが2箇所以上で使われる場合、必ず共通コンポーネントに切り出す**
- App.jsx にインラインでUIを書く前に、既存の `src/components/race/` コンポーネントを確認する
- 新しいUIパターンを作る場合、他のページでも使う可能性があるならコンポーネント化する

## チェックリスト（UI変更時）
- [ ] 同じUIが App.jsx と RaceDetail.jsx の両方にないか？
- [ ] インラインスタイルで書いた部分は既存コンポーネントで代替できないか？
- [ ] 新規コンポーネントは `src/components/race/index.js` の barrel export に追加したか？

## 既存の共通コンポーネント一覧（race/）
| コンポーネント | 用途 |
|--------------|------|
| **PredictionPanel** | **AI予想セクション全体（App.jsx/RaceDetail.jsx共通）** |
| PredictionLoadingOverlay | AI分析中のローディング演出 |
| ModelSwitcher | モデル切替タブ（本命/スタンダード/穴） |
| ModelDescription | 予想モデル説明セクション |
| PredictionTable | AIデータ予想テーブル + 注目ポイント + データの見方 |
| FirstMarkAnimation | 1マーク展開予測アニメーション |
| AttackDefenseTable | 超展開データテーブル |
| RaceResult | レース結果表示 |
| VenueSelector | 会場選択 |
| RaceCard | レースカード |
| VolatilityDisplay | 荒れ度表示 |

## App.jsx について
- App.jsx は巨大になりやすいため、UIブロックはできる限りコンポーネントに切り出す
- App.jsx 内にインラインで100行以上のUI定義がある場合は、コンポーネント化を検討する

## デザイン統一
- 新しいページ・コンポーネントは既存ページ（`HowToUse.jsx`, `Blog.jsx` 等）のパターンを踏襲する
- すべてのページで `Header` コンポーネントを必ず含める
- 色・サイズは `src/styles/design-tokens.css` のCSS変数を使用し、ハードコードしない
- 独自のデザインシステムやテーマカラーを作成しない
- 詳細は `docs/reference/design-system.md` を参照

### 文字色・背景色は「意味トークン」を使う（ダークモード対応、必須）
2026-08-25、選手ページ実装で「ダークモードで見出しが暗背景に暗文字で不可視になる」バグが発生した（racer-news-featureブランチで修正済み）。`design-tokens.css`には2層のトークンがあり、混同すると再発する。

- **Layer 1（生パレット値、`--color-gray-900`等）**: `[data-theme="dark"]`で反転しない固定値。**要素が自前の背景色（カード等）を持ち、その背景と組み合わせて常に読める配色にしている場合のみ**使ってよい（例: 常に明るいカード背景 `--color-gray-50` + 常に暗いテキスト `--color-gray-700` のペア）
- **Layer 2（意味トークン、`--text-primary`/`--text-secondary`/`--surface-page`/`--surface-card`）**: `[data-theme="dark"]`で自動的に反転する。**ページ背景に直接乗るテキスト（見出しh1/h2、パンくず、空状態メッセージ、本文等、要素自身に背景色を持たないもの）は必ずこちらを使う**
- 判断基準: 「その要素は自分専用の固定背景を持っているか？」→ Yes なら生パレット値でも安全、No（ページ背景がそのまま透けている）なら意味トークン必須
- 新しいページ・コンポーネントを作ったら、Playwrightで**ライトモードだけでなくダークモードも**目視確認する（`document.documentElement.setAttribute('data-theme', 'dark')`で切り替え可能）。`scripts/maintenance/check-token-contrast.js`はトークン定義自体の妥当性は検証できるが、コンポーネント側の誤用（Layer 1を意味トークンの代わりに使ってしまうミス）までは検知しないため、実機確認を省略しない

## CSS
- `!important` は基本使わない
- メディアクエリで同じ要素に対する重複したスタイルを避ける

## React
- イベントハンドラはシンプルに保つ
- 状態管理が複雑になったらカスタムフックに切り出す
- デバッグ用コード（console.log）は問題解決後に必ず削除
