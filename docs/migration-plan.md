# 🚀 デザイントークン移行計画

このドキュメントは、既存のハードコードされた値をデザイントークンに段階的に移行するための計画です。

## 📋 移行の優先順位

### フェーズ1: 基盤の構築 ✅ 完了

- [x] `src/styles/design-tokens.css` の作成
- [x] `docs/design-system.md` の作成
- [x] 現状分析とトークン設計

### フェーズ2: デザイントークンのインポート（次のステップ）

**目的:** プロジェクト全体でデザイントークンを使えるようにする

**タスク:**
1. `src/index.css` または `src/App.css` の先頭でインポート
   ```css
   @import './styles/design-tokens.css';
   ```

2. ビルドして動作確認
   ```bash
   npm run dev
   ```

**確認方法:**
- ブラウザの開発者ツールで `:root` に変数が定義されているか確認
- `getComputedStyle(document.documentElement).getPropertyValue('--color-primary-500')` で値が取得できるか確認

---

### フェーズ3: 最も影響が大きいファイルから移行

#### 3-1. `src/App.css` の移行 (優先度: 🔥 最高)

**理由:** 最も多くのスタイルが定義されており、影響範囲が大きい

**移行対象:**
- プライマリーカラー: `#0ea5e9` → `var(--color-primary-500)`
- グレースケール: `#1e293b`, `#64748b`, `#e2e8f0` など
- フォントサイズ: `0.9rem`, `1.5rem` など
- スペーシング: `1rem`, `1.5rem`, `2rem` など

**一括置換コマンド例:**
```bash
# 色の置き換え
sed -i '' 's/#0ea5e9/var(--color-primary-500)/g' src/App.css
sed -i '' 's/#0284c7/var(--color-primary-600)/g' src/App.css
sed -i '' 's/#1e293b/var(--color-gray-800)/g' src/App.css
sed -i '' 's/#64748b/var(--color-gray-500)/g' src/App.css
sed -i '' 's/#e2e8f0/var(--color-gray-200)/g' src/App.css

# フォントサイズの置き換え
sed -i '' 's/font-size: 0\.9rem/font-size: var(--font-size-base)/g' src/App.css
sed -i '' 's/font-size: 1\.5rem/font-size: var(--font-size-4xl)/g' src/App.css
sed -i '' 's/font-size: 1\.1rem/font-size: var(--font-size-xl)/g' src/App.css

# border-radiusの置き換え
sed -i '' 's/border-radius: 12px/border-radius: var(--radius-lg)/g' src/App.css
sed -i '' 's/border-radius: 8px/border-radius: var(--radius-md)/g' src/App.css
```

**検証:**
```bash
# 置き換え前にバックアップ
cp src/App.css src/App.css.backup

# 置き換え実行
# (上記コマンド)

# ビルドして確認
npm run dev

# 問題があれば戻す
# mv src/App.css.backup src/App.css
```

**コミット:**
```bash
git add src/App.css
git commit -m "refactor: App.cssでデザイントークンを使用"
```

---

#### 3-2. ページ別CSSの移行 (優先度: 🔥 高)

**対象ファイル (使用頻度順):**

1. `src/pages/RaceDetail.css`
2. `src/pages/FAQ.css`
3. `src/pages/HowToUse.css`
4. `src/pages/Blog.css`
5. `src/pages/BlogPost.css`
6. `src/pages/About.css`
7. `src/components/AccuracyDashboard.css`
8. `src/components/DifyChat.css`
9. `src/components/HitRaces.css`

**移行方法 (各ファイル共通):**

```bash
# 1. バックアップ
cp src/pages/RaceDetail.css src/pages/RaceDetail.css.backup

# 2. 色の置き換え
sed -i '' 's/#0ea5e9/var(--color-primary-500)/g' src/pages/RaceDetail.css
sed -i '' 's/#0284c7/var(--color-primary-600)/g' src/pages/RaceDetail.css
sed -i '' 's/#1e293b/var(--color-gray-800)/g' src/pages/RaceDetail.css

# 3. ビルドして確認
npm run dev

# 4. コミット
git add src/pages/RaceDetail.css
git commit -m "refactor: RaceDetail.cssでデザイントークンを使用"
```

**注意点:**
- 1ファイルごとにコミットする
- 必ずビルドして動作確認する
- 見た目が変わっていないことを確認する

---

#### 3-3. JSXのインラインスタイルの移行 (優先度: 🟡 中)

**対象ファイル:**
- `src/App.jsx`
- `src/components/*.jsx`
- `src/pages/*.jsx`

**移行例:**

```jsx
// ❌ Before
<div style={{ color: '#0ea5e9', padding: '16px' }}>

// ✅ After
<div style={{
  color: 'var(--color-primary-500)',
  padding: 'var(--spacing-4)'
}}>
```

**検索コマンド:**
```bash
# インラインスタイルで #0ea5e9 を使っている箇所を検索
grep -rn "#0ea5e9" src --include="*.jsx" --include="*.tsx"

# rgba を使っている箇所を検索
grep -rn "rgba(" src --include="*.jsx" --include="*.tsx"
```

**手動での置き換えが必要:**
- インラインスタイルは構造が複雑なため、sedによる一括置換は危険
- 1つずつ手動で確認しながら置き換える

---

### フェーズ4: 一括置換スクリプトの作成

より安全に一括置換するためのシェルスクリプトを作成します。

**`scripts/migrate-tokens.sh`:**

```bash
#!/bin/bash

# デザイントークン移行スクリプト
# 使用方法: ./scripts/migrate-tokens.sh src/App.css

FILE=$1

if [ -z "$FILE" ]; then
  echo "使用方法: ./scripts/migrate-tokens.sh <file-path>"
  exit 1
fi

# バックアップ
cp "$FILE" "$FILE.backup"
echo "✅ バックアップ作成: $FILE.backup"

# 色の置き換え
sed -i '' 's/#0ea5e9/var(--color-primary-500)/g' "$FILE"
sed -i '' 's/#0284c7/var(--color-primary-600)/g' "$FILE"
sed -i '' 's/#1e293b/var(--color-gray-800)/g' "$FILE"
sed -i '' 's/#1E293B/var(--color-gray-800)/g' "$FILE"
sed -i '' 's/#64748b/var(--color-gray-500)/g' "$FILE"
sed -i '' 's/#64748B/var(--color-gray-500)/g' "$FILE"
sed -i '' 's/#e2e8f0/var(--color-gray-200)/g' "$FILE"
sed -i '' 's/#E2E8F0/var(--color-gray-200)/g' "$FILE"
sed -i '' 's/#f8fafc/var(--color-gray-50)/g' "$FILE"
sed -i '' 's/#F8FAFC/var(--color-gray-50)/g' "$FILE"
sed -i '' 's/#f1f5f9/var(--color-gray-100)/g' "$FILE"
sed -i '' 's/#F1F5F9/var(--color-gray-100)/g' "$FILE"
sed -i '' 's/#10b981/var(--color-success)/g' "$FILE"
sed -i '' 's/#10B981/var(--color-success)/g' "$FILE"
sed -i '' 's/#4caf50/var(--color-success-light)/g' "$FILE"
sed -i '' 's/#f59e0b/var(--color-warning)/g' "$FILE"
sed -i '' 's/#F59E0B/var(--color-warning)/g' "$FILE"
sed -i '' 's/#ff9800/var(--color-warning-light)/g' "$FILE"
sed -i '' 's/#ef4444/var(--color-error)/g' "$FILE"
sed -i '' 's/#EF4444/var(--color-error)/g' "$FILE"

echo "✅ 色の置き換え完了"

# border-radiusの置き換え
sed -i '' 's/border-radius: 12px/border-radius: var(--radius-lg)/g' "$FILE"
sed -i '' 's/border-radius: 8px/border-radius: var(--radius-md)/g' "$FILE"
sed -i '' 's/border-radius: 16px/border-radius: var(--radius-xl)/g' "$FILE"
sed -i '' 's/border-radius: 6px/border-radius: var(--radius-sm)/g' "$FILE"

echo "✅ border-radiusの置き換え完了"

echo ""
echo "📊 変更内容を確認:"
diff "$FILE.backup" "$FILE" || true

echo ""
echo "問題なければバックアップを削除:"
echo "  rm $FILE.backup"
echo ""
echo "問題があれば元に戻す:"
echo "  mv $FILE.backup $FILE"
```

**使用方法:**
```bash
chmod +x scripts/migrate-tokens.sh
./scripts/migrate-tokens.sh src/App.css
```

---

### フェーズ5: 検証とテスト

#### 5-1. ビルドエラーのチェック

```bash
npm run build
```

#### 5-2. 見た目の確認チェックリスト

各ページで以下を確認:

- [ ] トップページ
  - [ ] ヘッダーの色
  - [ ] ボタンの色とホバー
  - [ ] カードの余白とシャドウ
  - [ ] フォントサイズ

- [ ] レース詳細ページ
  - [ ] プライマリーカラーの表示
  - [ ] グレースケールの濃淡
  - [ ] レース結果の表彰台

- [ ] FAQ/使い方/Aboutページ
  - [ ] 見出しのサイズ
  - [ ] セクション間の余白
  - [ ] CTAボタンの色

- [ ] ブログページ
  - [ ] カードのスタイル
  - [ ] カテゴリーバッジの色

#### 5-3. レスポンシブ確認

- [ ] デスクトップ (1920px)
- [ ] タブレット (768px)
- [ ] スマートフォン (375px)

---

## 📝 移行の進捗管理

### チェックリスト

**フェーズ2:**
- [ ] `src/index.css` または `src/App.css` でデザイントークンをインポート
- [ ] ビルドして動作確認

**フェーズ3-1:**
- [ ] `src/App.css` の移行
- [ ] コミット

**フェーズ3-2:**
- [ ] `src/pages/RaceDetail.css`
- [ ] `src/pages/FAQ.css`
- [ ] `src/pages/HowToUse.css`
- [ ] `src/pages/Blog.css`
- [ ] `src/pages/BlogPost.css`
- [ ] `src/pages/About.css`
- [ ] `src/components/AccuracyDashboard.css`
- [ ] `src/components/DifyChat.css`
- [ ] `src/components/HitRaces.css`

**フェーズ3-3:**
- [ ] JSXのインラインスタイル (手動)

**フェーズ5:**
- [ ] ビルドエラーチェック
- [ ] 全ページの見た目確認
- [ ] レスポンシブ確認

---

## ⚠️ 注意事項

### やってはいけないこと

- ❌ 全ファイルを一度に変更しない
- ❌ コミット前にビルド・確認をしない
- ❌ バックアップを取らずに置き換えない
- ❌ `!important` を削除しない（既存の優先順位を維持）

### やるべきこと

- ✅ 1ファイルごとにコミット
- ✅ 変更前後で見た目が同じか確認
- ✅ バックアップを取る
- ✅ 問題があれば即座に戻す

---

## 🎯 完了後の効果

移行完了後、以下のメリットが得られます:

1. **デザイン変更が容易**
   - 色を変えたい → `design-tokens.css` の1箇所を変更するだけ
   - フォントサイズの調整 → 全ページに一括適用

2. **一貫性の向上**
   - 新しいページを追加する際も、トークンを使うだけで統一感が出る

3. **メンテナンス性の向上**
   - どの色がどこで使われているか把握しやすい
   - 不要な色を削除しやすい

4. **将来の拡張が容易**
   - ダークモード対応
   - テーマ切り替え機能

---

## 📞 困ったときは

- デザイントークンの使い方: `docs/design-system.md` を参照
- 移行スクリプトの使い方: このファイルのフェーズ4を参照
- トラブルシューティング: バックアップから復元して再試行
