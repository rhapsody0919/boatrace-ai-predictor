# 🎨 BoatAI デザインシステム

このドキュメントは、BoatAIプロジェクトで使用するデザイントークンの使用方法とガイドラインをまとめたものです。

## 📖 目次

1. [概要](#概要)
2. [デザイントークンの使い方](#デザイントークンの使い方)
3. [色 (Colors)](#色-colors)
4. [タイポグラフィ (Typography)](#タイポグラフィ-typography)
5. [スペーシング (Spacing)](#スペーシング-spacing)
6. [ボーダー・シャドウ](#ボーダーシャドウ)
7. [新しいトークンの追加ルール](#新しいトークンの追加ルール)

---

## 概要

デザイントークンは、プロジェクト全体で一貫したデザインを保つための**共通の変数**です。

### メリット
- ✅ デザインの一貫性が保たれる
- ✅ 色やサイズの変更が一箇所で済む
- ✅ メンテナンスが容易になる
- ✅ デザインの意図が明確になる

### ファイル
- **定義**: `src/styles/design-tokens.css`
- **ドキュメント**: `docs/design-system.md` (このファイル)

---

## デザイントークンの使い方

### 基本的な使用方法

```css
/* ❌ 悪い例: ハードコードされた値 */
.button {
  background-color: #0ea5e9;
  padding: 16px;
  border-radius: 12px;
}

/* ✅ 良い例: デザイントークンを使用 */
.button {
  background-color: var(--color-primary-500);
  padding: var(--spacing-4);
  border-radius: var(--radius-lg);
}
```

### CSS変数のインポート

`src/styles/design-tokens.css` を各CSSファイルまたはメインのCSSファイルでインポートします:

```css
/* App.css や index.css など */
@import './styles/design-tokens.css';
```

または、HTMLの`<head>`内で:

```html
<link rel="stylesheet" href="/src/styles/design-tokens.css">
```

---

## 色 (Colors)

### プライマリーカラー - ブランドの主要色

プライマリーカラーは、BoatAIのブランドカラー（青系）です。

```css
--color-primary-400: #38bdf8  /* より明るい青 */
--color-primary-500: #0ea5e9  /* メイン (最も使用) */
--color-primary-600: #0284c7  /* ダーク */
--color-primary-700: #0369a1  /* さらにダーク */
```

**使用例:**
```css
/* ボタンの背景 */
.primary-button {
  background: var(--color-primary-500);
}

/* ホバー時 */
.primary-button:hover {
  background: var(--color-primary-600);
}

/* リンクやアイコン */
.link {
  color: var(--color-primary-500);
}
```

### セマンティックカラー - 意味を持つ色

状態や意味を表す色です。

```css
/* Success - 成功、的中 */
--color-success: #10b981
--color-success-light: #4caf50
--color-success-dark: #059669

/* Warning - 警告、注意 */
--color-warning: #f59e0b
--color-warning-light: #ff9800
--color-warning-dark: #f57c00

/* Error - エラー、失敗 */
--color-error: #ef4444
--color-error-light: #f87171
--color-error-dark: #dc2626

/* Info - 情報 */
--color-info: #2196f3
--color-info-light: #60a5fa
```

**使用例:**
```css
/* 的中表示 */
.hit-message {
  background: var(--color-success);
  color: white;
}

/* 外れ表示 */
.miss-message {
  background: var(--color-error);
  color: white;
}

/* 警告メッセージ */
.warning-banner {
  background: rgba(245, 158, 11, 0.1);
  border-left: 4px solid var(--color-warning);
}
```

### グレースケール - 背景、テキスト、ボーダー

```css
--color-gray-50: #f8fafc   /* 最も明るい背景 */
--color-gray-100: #f1f5f9  /* 薄い背景 */
--color-gray-200: #e2e8f0  /* ボーダー、区切り線 */
--color-gray-500: #64748b  /* 補助テキスト */
--color-gray-600: #475569  /* セカンダリテキスト */
--color-gray-800: #1e293b  /* メインテキスト (最も使用) */
--color-gray-900: #0f172a  /* 最も暗いテキスト */
```

**使用例:**
```css
/* ページ背景 */
body {
  background: var(--color-gray-50);
  color: var(--color-gray-800);
}

/* カードの背景 */
.card {
  background: var(--color-white);
  border: 1px solid var(--color-gray-200);
}

/* 補助テキスト */
.caption {
  color: var(--color-gray-500);
}
```

### 透明度付き色

```css
/* プライマリーカラーの透明度バリエーション */
--color-primary-alpha-10: rgba(14, 165, 233, 0.1)  /* 10% */
--color-primary-alpha-20: rgba(14, 165, 233, 0.2)  /* 20% */
--color-primary-alpha-30: rgba(14, 165, 233, 0.3)  /* 30% */
--color-primary-alpha-40: rgba(14, 165, 233, 0.4)  /* 40% */
--color-primary-alpha-50: rgba(14, 165, 233, 0.5)  /* 50% */

/* ブラックの透明度バリエーション */
--color-black-alpha-10: rgba(0, 0, 0, 0.1)
--color-black-alpha-15: rgba(0, 0, 0, 0.15)
--color-black-alpha-20: rgba(0, 0, 0, 0.2)
```

**使用例:**
```css
/* 薄い背景 */
.overlay {
  background: var(--color-primary-alpha-10);
}

/* ホバー効果 */
.button:hover {
  background: var(--color-primary-alpha-20);
}
```

### グラデーション

```css
--gradient-primary: linear-gradient(135deg, var(--color-primary-500) 0%, var(--color-primary-600) 100%)
--gradient-success: linear-gradient(135deg, var(--color-success) 0%, var(--color-success-dark) 100%)
--gradient-warning: linear-gradient(135deg, var(--color-warning) 0%, var(--color-warning-dark) 100%)
```

**使用例:**
```css
.hero-section {
  background: var(--gradient-primary);
}
```

---

## タイポグラフィ (Typography)

### フォントサイズ

16px = 1rem を基準とした相対サイズです。

```css
--font-size-2xs: 0.65rem   /* 10.4px - 極小ラベル */
--font-size-xs: 0.75rem    /* 12px - キャプション */
--font-size-sm: 0.85rem    /* 13.6px - 小さいテキスト */
--font-size-base: 0.9rem   /* 14.4px - 標準テキスト (最頻) */
--font-size-md: 0.95rem    /* 15.2px - やや大きめ */
--font-size-lg: 1rem       /* 16px - 大きめテキスト */
--font-size-xl: 1.1rem     /* 17.6px - 小見出し */
--font-size-2xl: 1.2rem    /* 19.2px - 見出し */
--font-size-3xl: 1.3rem    /* 20.8px - 中見出し */
--font-size-4xl: 1.5rem    /* 24px - 大見出し */
--font-size-5xl: 1.75rem   /* 28px - 大きな見出し */
--font-size-6xl: 2rem      /* 32px - 特大見出し */
--font-size-7xl: 2.5rem    /* 40px - ヒーロー */
--font-size-8xl: 3rem      /* 48px - 超大見出し */
```

**使用ガイドライン:**

| サイズ | 用途 | 例 |
|--------|------|-----|
| `2xs` ~ `sm` | キャプション、補足テキスト | ラベル、注釈 |
| `base` ~ `lg` | 本文テキスト | 段落、説明文 |
| `xl` ~ `3xl` | 小〜中見出し | サブセクション |
| `4xl` ~ `6xl` | 大見出し | ページタイトル |
| `7xl` ~ `8xl` | ヒーロー、特大表示 | トップページ |

**使用例:**
```css
/* ページタイトル */
h1 {
  font-size: var(--font-size-6xl);
  font-weight: var(--font-weight-bold);
}

/* セクション見出し */
h2 {
  font-size: var(--font-size-4xl);
}

/* 本文 */
p {
  font-size: var(--font-size-base);
  line-height: var(--line-height-relaxed);
}

/* キャプション */
.caption {
  font-size: var(--font-size-sm);
  color: var(--color-gray-500);
}
```

### フォントウェイト

```css
--font-weight-normal: 400     /* 標準 */
--font-weight-medium: 500     /* やや太字 */
--font-weight-semibold: 600   /* 太字 */
--font-weight-bold: 700       /* より太字 */
--font-weight-extrabold: 800  /* 極太 */
```

### 行間

```css
--line-height-tight: 1.25      /* タイトル、見出し用 */
--line-height-snug: 1.375      /* 見出し用 */
--line-height-normal: 1.5      /* 標準 */
--line-height-relaxed: 1.625   /* 本文用 */
--line-height-loose: 1.8       /* 読みやすい本文用 */
```

---

## スペーシング (Spacing)

0.25rem (4px) 刻みのスケールです。

```css
--spacing-0: 0
--spacing-1: 0.25rem    /* 4px */
--spacing-2: 0.5rem     /* 8px */
--spacing-3: 0.75rem    /* 12px */
--spacing-4: 1rem       /* 16px - 最も使用 */
--spacing-5: 1.25rem    /* 20px */
--spacing-6: 1.5rem     /* 24px */
--spacing-8: 2rem       /* 32px */
--spacing-10: 2.5rem    /* 40px */
--spacing-12: 3rem      /* 48px */
--spacing-16: 4rem      /* 64px */
```

**使用ガイドライン:**

| スペーシング | 用途 |
|--------------|------|
| `1` ~ `2` | アイコンとテキストの間隔、ボーダー内余白 |
| `3` ~ `4` | ボタンやカードの内側余白 |
| `6` ~ `8` | セクション間の余白、カード間の間隔 |
| `12` ~ `16` | 大きなセクション間の余白 |

**使用例:**
```css
/* ボタンのパディング */
.button {
  padding: var(--spacing-3) var(--spacing-6);
}

/* カードのパディング */
.card {
  padding: var(--spacing-6);
  margin-bottom: var(--spacing-4);
}

/* セクション間の余白 */
section {
  margin-bottom: var(--spacing-12);
}

/* Flexbox/Gridのgap */
.flex-container {
  display: flex;
  gap: var(--spacing-4);
}
```

---

## ボーダー・シャドウ

### ボーダー半径

```css
--radius-sm: 6px
--radius-md: 8px      /* 標準 */
--radius-lg: 12px     /* 最も使用 */
--radius-xl: 16px
--radius-2xl: 20px
--radius-full: 9999px /* 完全な円形 */
--radius-circle: 50%  /* 完全な円形(%) */
```

**使用例:**
```css
/* カード */
.card {
  border-radius: var(--radius-lg);
}

/* ボタン */
.button {
  border-radius: var(--radius-md);
}

/* 丸いアイコン */
.avatar {
  border-radius: var(--radius-circle);
}
```

### ボックスシャドウ

```css
--shadow-base: 0 2px 8px var(--color-black-alpha-10)      /* 最も使用 */
--shadow-md: 0 4px 12px var(--color-black-alpha-10)
--shadow-lg: 0 4px 20px var(--color-black-alpha-15)
--shadow-xl: 0 8px 24px var(--color-black-alpha-15)

/* プライマリーカラーのシャドウ */
--shadow-primary-md: 0 4px 12px var(--color-primary-alpha-30)
--shadow-primary-lg: 0 4px 15px var(--color-primary-alpha-40)
```

**使用例:**
```css
/* カード */
.card {
  box-shadow: var(--shadow-base);
}

/* ホバー時に強調 */
.card:hover {
  box-shadow: var(--shadow-lg);
}

/* プライマリーボタン */
.primary-button {
  box-shadow: var(--shadow-primary-md);
}
```

---

## 新しいトークンの追加ルール

### ❌ 追加してはいけない場合

- 既存のトークンで表現できる場合
- 1箇所でしか使わない特殊な値
- プロジェクト全体で統一する必要がない値

### ✅ 追加すべき場合

- 複数の場所で同じ値を使う場合
- デザインの一貫性を保つために必要な値
- 将来的に変更する可能性がある値

### 追加手順

1. **`src/styles/design-tokens.css` に追加**
   ```css
   /* 適切なカテゴリに追加 */
   --color-my-new-color: #abc123;
   ```

2. **このドキュメントを更新**
   - 使用例を追加
   - どのような場面で使うべきかを記載

3. **既存コードで使用**
   - 新しいトークンを実際に使用
   - 少なくとも2箇所以上で使われることを確認

### 命名規則

```
--{category}-{name}-{variant}: value;
```

例:
```css
--color-primary-500: #0ea5e9;
--font-size-2xl: 1.2rem;
--spacing-4: 1rem;
--shadow-primary-lg: 0 4px 15px rgba(14, 165, 233, 0.4);
```

---

## よくある質問

### Q: 既存のハードコードされた色を全て置き換える必要がありますか？

A: いいえ。段階的に移行してください。新しいコードでは必ずデザイントークンを使用し、既存コードは修正のタイミングで置き換えていきます。

### Q: インラインスタイルでもデザイントークンは使えますか？

A: はい、React/JSXのインラインスタイルでも使用できます:

```jsx
<div style={{
  color: 'var(--color-primary-500)',
  padding: 'var(--spacing-4)',
  borderRadius: 'var(--radius-lg)'
}}>
  コンテンツ
</div>
```

### Q: カスタムの色が必要な場合は？

A: まず既存のトークンで表現できないか検討してください。本当に必要な場合のみ、新しいトークンを追加します。

---

## 参考リンク

- [CSS カスタムプロパティ (MDN)](https://developer.mozilla.org/ja/docs/Web/CSS/--*)
- [Tailwind CSS - Design Tokens](https://tailwindcss.com/docs/customizing-colors)
- [デザイントークンファイル](../src/styles/design-tokens.css)
