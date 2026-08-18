# レース荒れ度ムード演出アニメーション - システム設計

ADR: [0015-race-mood-effect-visual-concept.md](../../adr/0015-race-mood-effect-visual-concept.md)（波紋エフェクトの採用理由）

## データ設計

新規のSupabaseテーブル・カラム追加は無し。既存の`prediction.volatilityPercentile`・`prediction.volatilityPercentileIsFallback`（`VolatilityDisplay`が既に受け取っているものと同一）をそのまま再利用する。新規クエリ・APIコールも発生しない。

### レベル判定ロジックの共通化

`VolatilityDisplay.jsx`は現在、レベル判定を各所にインラインの三項演算子で重複して持っている（247行目・18-19行目の`PercentileBar`内等）。今回`RaceMoodEffect`でも同じ基準（`percentile >= 0.7` → high, `<= 0.3` → low, それ以外 → standard）が必要になるため、共通ヘルパーとして切り出す。

`src/utils/volatilityLevel.js`（新規）:
```js
export function getVolatilityLevel(percentile) {
  if (percentile === null || percentile === undefined) return null;
  if (percentile >= 0.7) return "high";
  if (percentile <= 0.3) return "low";
  return "standard";
}
```

`VolatilityDisplay.jsx`側もこのヘルパーに置き換える（247行目のインライン三項演算子を置換）。BOA-194のレビューで見つかった「同じロジックの並行複製がドリフトする」問題（`useAiCopyText.js`と`raceIndicators.jsx`の乖離）を、今回は事前に共通化することで回避する。

## コンポーネント構成・データフロー

```
PredictionPanel.jsx
└─ AiAnalysisSection（展開予測パネル/イン崩れバッジ）
    └─ {prediction.volatilityPercentile != null && (...)}  ← 既存の条件分岐を再利用
        └─ VolatilityDisplay
            └─ アイコン（🌪️/⚖️/🎯）の背後に RaceMoodEffect を重ねる
```

### 配置案: VolatilityDisplayのアイコン背後に統合する

`RaceMoodEffect`を独立した新規ブロック（カード）として追加するのではなく、`VolatilityDisplay`のヘッダーアイコン（🌪️/⚖️/🎯、`VolatilityDisplay.jsx`279行目）の背後に波紋を重ねる。

理由:
- BOA-194の`AiCopyBanner`で確立した「装飾要素は既存の目立たせたい要素の背後に重ねる」パターンをそのまま踏襲できる
- レース詳細ページは既に要素数が多い（公式リンク・AI用にコピー・データ出走表・展開予測・イン崩れバッジ・出現パターン・シェアボタン・会場ガイドリンク）。新規の空ブロックを追加するより、既存のイン崩れバッジ自体を「開いた瞬間に波紋が広がって現れる」演出にした方が、情報と演出が一体化しユーザーの目に自然に入る
- FR2（具体的な予測内容を表現しない）を満たしたまま、視覚的な主張度を上げられる

`VolatilityDisplay`はロジック・表示テキストのみを引き続き担当し、`RaceMoodEffect`は純粋な装飾（`aria-hidden="true"`、`pointerEvents: "none"`）としてその上に重なる。責務は分離したまま合成する。

### 新規ファイル

| ファイル | 役割 |
|---------|------|
| `src/components/race/RaceMoodEffect.jsx` | 波紋アニメーション本体。`level`（high/standard/low）を受け取り、レベルに応じたリング数・周期でループ再生する |
| `src/utils/volatilityLevel.js` | レベル判定ロジックの共通ヘルパー |

### 既存ファイルの変更

| ファイル | 変更内容 |
|---------|---------|
| `VolatilityDisplay.jsx` | アイコン`<span>`を`position: relative`のラッパーで囲み、背後に`RaceMoodEffect`を配置。レベル判定を`getVolatilityLevel()`に置換 |

## アニメーション仕様

リング数・周期はArtifactプロトタイプで検証済みの数値をそのまま採用する（`framer-motion`で実装、CSSプロトタイプの`@keyframes ripple`相当）。

| レベル | リング数 | 1周期の長さ | リング間の時間差 | 最大scale |
|--------|---------|------------|-----------------|----------|
| high（警戒） | 5 | 1.15秒 | 0.28秒 | 3.2 |
| standard（標準） | 3 | 1.9秒 | 0.63秒 | 2.6 |
| low（堅い） | 2 | 2.8秒 | 1.4秒 | 2.0 |

各リングは `scale: 1 → 最大scale, opacity: 0.55 → 0` で拡大・フェードアウトする（`AiCopyBanner`のping効果と同じ`animate`/`transition`の書き方を流用、`ease: "easeOut"`, `repeat: Infinity`）。

**最大scaleの補足**: Artifactプロトタイプは108pxの専用ステージ内でscale:9としていたが、これは「12pxのリング→108pxのステージいっぱいに広がる」という、ステージという大きな入れ物を基準にした比率だった。実装時は`VolatilityDisplay`の1.2remアイコン（約19px）の背後にステージ無しで直接重ねるため、同じscale:9をそのまま適用すると300px超まで広がりテキストと重なる実機バグが発生した（実装時に発覚・修正）。アイコンサイズを基準に、周辺に収まる2〜3.2倍へ調整済み。

色はレベルごとに`--color-warning-light`（high）/`--color-info`（standard）/`--color-success-light`（low）を使用（`VolatilityDisplay`の既存配色と一致、新規ハードコード無し）。

## 非機能要件への対応

- `useReducedMotion()`（`framer-motion`）で`prefers-reduced-motion`環境では波紋を非表示にする（BOA-194で確立したパターン）
- 波紋は`pointerEvents: "none"` + `aria-hidden="true"`とし、アイコン自体のクリック可能性・スクリーンリーダーでの読み上げに影響しない
- `isFallback`（データ収集中）または`percentile`が`null`/`undefined`の場合は`RaceMoodEffect`をレンダリングしない（`VolatilityDisplay`の既存ガードと同じ条件を`getVolatilityLevel()`が`null`を返すことで自然に表現する）

## 実装ノート

- 新規パッケージ依存は無し（`framer-motion`は既存）
- モバイルパフォーマンス: リング要素は最大5個（highレベル時）× DOM要素のみで、Canvas/WebGL等は不要な軽量実装
