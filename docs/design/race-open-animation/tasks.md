# race-open-animation タスク分解

`docs/design/race-open-animation/spec.md`・`screens.md`・`plan.md`に基づくタスク一覧。依存順に並べており、上から順に実装する。

## タスク一覧

- [x] **1. volatilityLevel.js共通ヘルパー作成 + VolatilityDisplay.jsxのロジック置換**
  `src/utils/volatilityLevel.js`を新規作成し、`getVolatilityLevel(percentile)`（high/standard/low/null判定）を実装する。`VolatilityDisplay.jsx`247行目のインラインの三項演算子をこのヘルパー呼び出しに置換する（表示内容・挙動は変えない、リファクタのみ）。

- [x] **2. RaceMoodEffect.jsxコンポーネント実装**
  `src/components/race/RaceMoodEffect.jsx`を新規作成。`level`（high/standard/low）をpropsで受け取り、`framer-motion`でレベル別のリング数・周期（plan.md記載の数値: high=5リング/1.15秒、standard=3リング/1.9秒、low=2リング/2.8秒）で波紋アニメーションをループ再生する。色は`--color-warning-light`/`--color-info`/`--color-success-light`の既存デザイントークンを使用。`aria-hidden="true"`・`pointerEvents: "none"`を付与し、`useReducedMotion()`で`prefers-reduced-motion`時は非表示にする。

- [x] **3. VolatilityDisplay.jsxへの統合**
  `VolatilityDisplay.jsx`のヘッダーアイコン（🌪️/⚖️/🎯、279行目）を`position: relative`のラッパーで囲み、背後に`RaceMoodEffect`を配置する（`getVolatilityLevel(percentile)`の結果を渡す）。`isFallback`時・`percentile`が`null`/`undefined`の場合（＝関数の早期return箇所）は`RaceMoodEffect`もレンダリングされないことを確認する。新しい表示条件分岐は追加しない。

- [x] **4. E2Eスモークテスト追加**
  `e2e/smoke.spec.js`に、(a) イン崩れバッジが表示されるレースで`RaceMoodEffect`のDOM要素（波紋のリング要素）が存在する (b) `prefers-reduced-motion`環境ではリング要素が非表示/animation無しになる、の2点を確認するテストケースを追加する。

- [ ] **5. 動作確認・PR作成**
  ローカルで`npm run dev`起動、Playwrightで警戒/標準/堅いの3レベルそれぞれの波紋の見た目・周期の違いを実機確認する。モバイル幅（375px）でのレイアウト崩れ・パフォーマンス（過度なDOM要素・repaint負荷が無いか）も確認する。`npm run build`・`npm run test:e2e`実行後、`/create-pr`でPR作成。
