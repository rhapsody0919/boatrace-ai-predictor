# CSSクラス名衝突と対処方針（BOA-207）

## 問題の背景

boatAIはVite標準のグローバルCSSバンドル構成で、CSS Modules等のスコープ機構を使っていない。`src/**/*.css`はビルド時にすべて1つのスタイルシートに結合されるため、異なるページ・コンポーネントのCSSファイルで同名クラスを定義すると、片方の値がもう片方に意図せず適用される。

例: `src/pages/Foo.css`の`.page-header h1`と`src/pages/Bar.css`の`.page-header h1`が異なる`font-size`を持つ場合、バンドル順で後に読み込まれた方が両方のページに適用されてしまう。ファイル単体を見ても正しく見えるため発見しづらく、実際に「修正したのに画面に反映されない」という形で複数回発覚した（`.venue-name`、`.race-card`、`.page-header h1`、`.step-content`等）。

## 検出

```bash
npm run verify:css-collisions
```

`scripts/maintenance/verify-css-class-collisions.js`が`src/**/*.css`全体を解析し、別々のCSSファイルが同じクラス名を**スコープせずに**（同じ詳細度で）定義しているものを検出する。PRごとに`Quality Gates`（`npm run verify:ci`）が自動実行する。

- スコープされていない＝そのクラスがセレクタの先頭の複合セレクタの最初のクラスにある（`.venue-grid {}`、`.venue-grid .card {}`）。`.guide-page .venue-grid {}`の`venue-grid`は対象外。`html`・`body`・`:root`・`[data-theme="dark"]`のようにページを絞らない先頭は読み飛ばす
- `@media`・`@supports`等の中も対象、`@keyframes`の中・コメント・文字列・`:not()`等の括弧の中は対象外。同じファイル内の重複は順序が明確なので対象外
- 既存の衝突は`scripts/maintenance/css-class-collisions-allowlist.json`に載せてあり、新しい衝突だけで失敗する。衝突を解消したらエントリを消す（消し忘れも失敗する）
- 内訳（食い違うプロパティ）は`node scripts/maintenance/verify-css-class-collisions.js --report`で見る

見逃すもの: 片方だけがスコープされている場合（`.x {}`と`.page .x {}`）は詳細度で勝敗が決まるので対象外だが、スコープされていない側の他のプロパティは漏れる。要素セレクタだけのルール（`h2 {}`等）も対象外。

## 対処方針: 祖先クラスでスコープする

`!important`やCSS記述順の調整では根本解決にならない（`!important`はさらに強力な衝突を生み、記述順依存はバンドル順が変わると再発する）。恒久対処は、そのページ・コンポーネント固有の祖先クラスでセレクタをスコープし、詳細度で確実に勝たせること。

```css
/* NG: 他ページの同名クラスと衝突しうる */
.page-header h1 {
  font-size: 1.5rem;
}

/* OK: そのページのルート要素クラスでスコープ */
.race-detail-page .page-header h1 {
  font-size: 1.5rem;
}
```

メディアクエリ内のオーバーライドも同様にスコープすること。ベースルールだけスコープしてメディアクエリ内の上書きを裸のセレクタのまま残すと、そこだけ衝突が再発する。

## 運用

新しいクラスはページ・部品に固有の名前にする（例: `/guide`の会場グリッドは`.guide-venue-grid`。BOA-539）。衝突はPRのCIで検出されるので、手元での事前実行は必須ではない。
