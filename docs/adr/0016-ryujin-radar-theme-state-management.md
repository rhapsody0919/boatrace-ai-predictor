# ADR 0016: 龍神レーダー ライト/ダークテーマの状態管理・永続化方式

## ステータス
採用

## 背景
龍神レーダーのブランドビジュアル刷新（[docs/design/ryujin-radar-rebrand/spec.md](../design/ryujin-radar-rebrand/spec.md)）で、ユーザーが選択できるライト/ダークテーマ切替を新規実装する。状態管理・永続化の方式を決める必要がある。

## 決定
既存の`src/i18n.js`（i18next + `LanguageDetector`、localStorage永続化）と同じ思想で、軽量な自前実装を採用する。

- `src/config/theme.js`に`THEME_STORAGE_KEY`定数を定義する（`config/languages.js`の`LANGUAGE_STORAGE_KEY`と同じ置き場所）
- テーマ状態は`document.documentElement.dataset.theme`（`"light"` | `"dark"`）に同期し、`design-tokens.css`側は`[data-theme="dark"]`セレクタで意味トークンを上書きする
- 未選択時（localStorage未設定）は`data-theme`属性を設定せず、CSSの`@media (prefers-color-scheme: dark)`にフォールバックさせる。言語判定と異なりテーマはページの文言を変えないため、SEO/クローラー影響のリスクがなくOS設定追従で問題ない
- `useTheme()`フックは`useSyncExternalStore`（React 19で利用可能）でlocalStorage変更を購読する。実際に現在値の表示・切替UIが必要なThemeToggleコンポーネントのみが使用し、他のコンポーネントはCSS変数の自動反映に任せる

## 却下した選択肢
- **React Context + Provider方式**: 状態を読む必要があるのはThemeToggle程度に限定されるため、アプリ全体をProviderでラップするコストに見合わない。KISS/YAGNIの観点で見送り
- **i18nextのような状態管理ライブラリの導入**: テーマはboolean/enum 1つの単純な状態であり、i18nextクラスのリソース管理機構は過剰

## 影響
新規npm依存の追加なし。localStorageキーの命名規則を`config/`に集約する既存パターンを踏襲するため保守性が保たれる。テーマの初期表示はCSSのみで決まる設計にする場合、JSロード前のFOUC（読み込み直後に一瞬デフォルトテーマで表示されてから切り替わる現象）を避けるため、`data-theme`をlocalStorage値から同期する小さいインラインスクリプトを`index.html`の`<head>`に置く必要がある（実装時の注意点）。
