# 龍神レーダー ブランドビジュアル刷新 システム設計

spec.md / screens.md を踏まえたシステム設計。技術判断の詳細な比較は各ADRを参照。

## データ設計

なし。Supabaseのテーブル・カラム変更は発生しない（spec.md記載の通り、視覚のみの変更でデータ源に変更はない）。

## トークン層構成

`design-tokens.css`を3層に再構成する。

```
Layer 1: ベースパレット（生の16進数値。モード非依存）
  --ryujin-gold-400/500/600/700, --ryujin-silver-400/500/600,
  --ryujin-navy-100〜900, --ryujin-ivory-100〜900
  ※既存の --color-primary-* 等170箇所以上の参照は当面残し、
    新トークン追加という形で共存させる（一括置換は別タスク）

Layer 2: 意味トークン（コンポーネントが実際に参照する）
  --surface-page, --surface-card, --text-primary, --text-secondary,
  --border-hairline, --brand-accent-primary（金）, --brand-accent-secondary（銀）
  既存の状態色（--color-success/warning/error/info）・グレード色
  （--color-grade-sg/g1/g2/g3）・銅色（--color-bronze）は色相を変えず、
  Layer 2の値としてそのまま残す

Layer 3: テーマ層（:root のデフォルト値 と [data-theme="dark"] の上書き）
  :root                    → ライト（生成り）の値をデフォルトとして定義
  [data-theme="dark"]      → ダーク（深紺）の値で上書き
  data-theme未設定時は @media (prefers-color-scheme: dark) でも
  ダーク値にフォールバックする（ADR 0016参照）
```

コンポーネント側は常にLayer 2の意味トークンのみを参照する。Layer 1・Layer 3の存在を意識する必要はない。

## コンポーネント構成・データフロー

### テーマ切替
[ADR 0016](../../adr/0016-ryujin-radar-theme-state-management.md)の通り、Context Providerは使わず軽量な自前実装にする。

```
src/config/theme.js          THEME_STORAGE_KEY 等の定数
src/utils/theme.js           getTheme() / setTheme() / subscribe()
                              localStorage読み書き + document.documentElement
                              の data-theme 属性同期を担当（vanilla JS）
src/hooks/useTheme.js         useSyncExternalStore でtheme.jsを購読するフック。
                              ThemeToggleコンポーネントのみが使用
src/components/ThemeToggle.jsx  切替UI本体。Header.jsx内に設置
index.html                    FOUC防止のインラインスクリプトで
                              初期表示前にdata-theme属性を同期
```

### Footer共通化
screens.mdで確認した通り、`<footer>`が5ファイルに重複しているため以下に切り出す。

```
src/components/Footer.jsx    新規。既存5ファイル（App.jsx, Holmes.jsx,
                              ContentHub.jsx, WinningTechniqueAnalysis.jsx,
                              ResponsibleGambling.jsx）から重複コードを移設
```

### 予想・着順・データ密集コンポーネント
screens.md 3・4節の対象コンポーネントは新規モジュール追加なし。`design-tokens.css`のLayer 2トークン参照への置き換えと、対象コンポーネントのCSS（ピルバッジ→罫線、二層設計の適用）を直接編集する。

### ロゴ/faviconアセットパイプライン
`docs/design/ryujin-radar-rebrand/source-assets/`に生成済みの`dragon-mark-full-v1.jpg`（ダーク背景）・`dragon-mark-transparent.png`（透過）を元に、`sips`/ImageMagickでのリサイズ・トリミングにより以下を`public/`直下へ書き出す（ベクター化はしない方針。理由: プロジェクトにSVGトレースツールが無く、手描きSVGの精度検証で実用に耐えないことが確認済み）。

| 出力先 | サイズ | 元素材 |
|--------|--------|--------|
| `public/favicon-16.png` / `favicon-32.png` | 16 / 32px | `dragon-mark-transparent.png`をトリミング後縮小 |
| `public/apple-touch-icon.png` | 180px | 同上 |
| `public/icon-192.png` / `icon-512.png` | 192 / 512px | 同上（このサイズ帯は龍のシルエットが十分判読できることを検証済み） |
| `public/logo.png`（ダーク版） | 元解像度のまま | `dragon-mark-full-v1.jpg` |
| `public/logo-light.png`（ライト版、新規） | 元解像度のまま | `dragon-mark-transparent.png` |

### 明朝体ロゴタイプ
[ADR 0018](../../adr/0018-ryujin-radar-serif-font-delivery.md)の通り自己ホストする。

```
public/fonts/noto-serif-jp-logotype-subset.woff2   ビルド時にpyftsubsetで生成
src/index.css                                       @font-face定義、
                                                     ロゴタイプ要素にのみ適用
```

### コントラスト検証
[ADR 0017](../../adr/0017-ryujin-radar-contrast-verification.md)の通り2段階。

```
scripts/maintenance/check-token-contrast.js   新規。design-tokens.cssの
                                               意味トークンペアを検証
e2e/smoke.spec.js                             @axe-core/playwrightによる
                                               ライト/ダーク両テーマのスキャンを追加
```

## 既存サービス層との連携

データ取得・予測ロジック（`src/services/`）への変更はない。本刷新は表示層（コンポーネントCSS・トークン・アセット）に閉じる。

## 実装フェーズ（spec.mdのロールアウト方針に対応）

1. **基盤**: トークン3層構造、ロゴ/favicon資産、明朝体サブセット、コントラスト検証スクリプトの追加
2. **ブランドチロム**: Header・Footer（新規共通化）・IntroBanner・LoadingScreenの意匠更新
3. **テーマ切替機能**: theme.js / useTheme / ThemeToggleの実装
4. **データ密集画面**: 二層設計の適用、モバイル最小フォントサイズ是正、E2Eスモークテストへのaxe-core追加

各フェーズは既存のGitHub Flow（feature branch→Vercel Preview→レビュー→master）で個別PRとする。
