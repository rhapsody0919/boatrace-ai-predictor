# プロジェクトルール

このプロジェクトで遵守すべきルールを記載します。

## Linear統合ルール（タスク管理）

### 運用方針

Claude Codeは **パターンA（自動管理）** で動作します：
- 実装タスクを受けた際に、自動的にLinearタスクを作成・更新する
- ユーザーが明示的にLinearタスク管理を指示しなくても、自動的に実行する

### 必須動作フロー

#### 🎯 実装タスクを受けた場合（バグ修正、機能追加など）

**1. タスク作成**
```bash
npm run linear:create "タスクのタイトル" "詳細な説明"
```
- タスクIDをメモする（例: BOAT-123）
- タイトルは簡潔に（例: "LINEシェアバグ修正"、"予測精度向上機能の追加"）
- 説明には実装内容や目的を記載

**2. タスクを「進行中」に更新**
```bash
npm run linear:update BOAT-123 "進行中" "実装を開始しました"
```

**3. 実装を進める**
- コードを書く、テストする
- 重要なマイルストーンに到達したらコメント追加:
```bash
npm run linear:comment BOAT-123 "進捗: UI部分の実装が完了"
```

**4. 実装完了後、タスクを「完了」に更新**
```bash
npm run linear:update BOAT-123 "完了" "実装完了。動作確認済み"
```

**5. コミット＆プッシュ**
- コミットメッセージにタスクIDを含める:
```bash
git commit -m "fix: LINEシェアバグ修正

Fixes BOAT-123

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### 例外ケース

以下の場合はLinearタスクを作成しない:
- 単純な質問への回答（コード変更なし）
- ドキュメントの軽微な修正（typo修正など）
- 既存のLinearタスクIDを指定された場合（そのタスクを更新する）

### コミットメッセージのキーワード

- `Fixes BOAT-123` - タスクを完了状態にする
- `Refs BOAT-123` - タスクに関連付けるが完了しない
- `Related to BOAT-123` - 関連付けのみ

## 用語規則

### ❌ 禁止用語

以下の用語は **絶対に使用禁止** です：

- **「競艇」**: 使用しないでください
  - ✅ 正しい表記: **「ボートレース」**
  - 理由: ブランド統一のため、公式名称である「ボートレース」を使用する

### 適用範囲

この用語規則は以下の全てに適用されます：

- ソースコード（変数名、コメント、文字列リテラル）
- UI/UX テキスト
- ブログ記事・コンテンツ
- ドキュメント
- エラーメッセージ
- ログメッセージ
- コミットメッセージ
- ハッシュタグ・SNSシェアメッセージ

## コード修正時の注意

既存のコードやコンテンツを修正・追加する際は、必ず上記の用語規則に従ってください。

**例:**

```javascript
// ❌ 悪い例
const kyoteiData = fetchData();
hashtags: ['競艇', 'ボートレース']

// ✅ 良い例
const boatraceData = fetchData();
hashtags: ['ボートレース', 'AI予想']
```

## Git操作ルール

### コミット時の動作

Claude Codeがコミットを行う際は、以下のルールに従うこと：

**❌ 禁止事項:**
- コミット前に1、2、3のステップで確認を求めること
- ユーザーに対して過度に確認ステップを踏むこと

**✅ 推奨動作:**
- ユーザーがコミットを依頼した場合は、直接実行する
- 必要な情報（変更内容の確認、コミットメッセージの作成）を自動的に収集し、一度に実行する
- コミットメッセージには必ずタスクIDを含める（例：`Fixes BOAT-123`）
- コミットメッセージのフォーマット：
  ```
  <type>: <簡潔な説明>

  Fixes BOAT-XXX

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
  ```

### 例外ケース

以下の場合のみ、ユーザーに確認を求めてもよい：
- 非常に大きな変更で、コミットの分割が必要な場合
- セキュリティに関わる変更がある場合
- `.env`や認証情報ファイルなど、機密情報が含まれる可能性がある場合

## デザイン統一ルール

### 全体方針

**すべてのページで統一されたデザインを維持すること。**

### カラースキーム（厳守）

プロジェクト全体で以下のカラースキームを使用すること：

**主要カラー（青系）:**
- プライマリ：`#0ea5e9`（明るい青）
- セカンダリ：`#0284c7`（濃い青）
- グラデーション：`linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)`

**背景色:**
- ページ背景：`#ffffff`（白）または`#f8fafc`（薄いグレー）
- カード背景：`#ffffff`（白）

**テキストカラー:**
- プライマリテキスト：`#1e293b`（濃いグレー）
- セカンダリテキスト：`#64748b`（グレー）
- ヘッダーテキスト：`#ffffff`（白）

### 共通コンポーネント

**ヘッダー:**
- すべてのページで`Header`コンポーネントを使用すること
- ヘッダーのスタイルを変更しないこと
- ヘッダーのグラデーション背景を変更しないこと

**レイアウト:**
- 最大幅：`1920px`
- コンテナの padding：`1.5rem 2rem`（モバイルでは調整可）

### 禁止事項

**❌ ページごとに以下を変えることを禁止:**
- 背景色（全ページで白または薄いグレーを使用）
- 主要なテキスト色
- ヘッダーのデザイン
- ブランドカラー（青系以外の色をメインカラーとして使用）

**❌ 新しいページやコンポーネントを作成する際:**
- 独自の背景色やテーマカラーを設定しないこと
- 既存のページと異なるフォントサイズ体系を使用しないこと
- 既存のデザインパターンから大きく逸脱しないこと

### 例

**❌ 悪い例:**
```css
.my-page {
  background: #ff5722; /* 赤系の背景 */
  color: #fff;
}

.my-header {
  background: linear-gradient(to right, #ff0000, #00ff00); /* 独自のグラデーション */
}
```

**✅ 良い例:**
```css
.my-page {
  background: #ffffff; /* 統一された白背景 */
  color: #1e293b; /* 統一されたテキストカラー */
}

/* 既存のHeaderコンポーネントを使用 */
import Header from '../components/Header';
```

### 新機能追加時の注意

新しいページやコンポーネントを追加する際は：
1. 既存のページ（`HowToUse.jsx`、`Blog.jsx`など）のデザインパターンを参考にする
2. `Header`コンポーネントを必ず含める
3. 既存のCSSファイルで定義されているカラー変数やスタイルを再利用する
4. 独自のデザインシステムを作成しない

### CSS色指定の重要ルール

**背景とテキストのコントラスト問題を防ぐため、以下を厳守すること：**

#### 1. 背景色タイプごとのテキスト色定義

| 背景色タイプ | テキスト色 | 適用場所 |
|------------|----------|---------|
| 白背景 `#ffffff` または `#f8fafc` | `#1e293b !important`（濃いグレー） | ページ本体、カード |
| グラデーション背景（青系） | `#ffffff !important`（白） | CTA、ヘッダー、強調セクション |
| 薄いグレー背景 `#f1f5f9`, `#e2e8f0` | `#1e293b !important`（濃いグレー） | サブセクション、ボックス |
| 青背景 `#0ea5e9` 系 | `#ffffff !important`（白） | ボタン、バッジ、アクセント |
| 暗い背景 `#1e293b` 系 | `#f1f5f9 !important`（薄いグレー） | コードブロック、暗いテーマ |

**重要：すべてのテキスト色には`!important`を付けて、継承による予期しない色の適用を防ぐこと**

#### 2. 必須ルール

1. **すべてのテキスト要素に明示的に色を指定する**
   - h1, h2, h3, h4, h5, h6, p, span, a などすべてのテキスト要素に`color`プロパティを明示的に設定
   - 親要素からの継承に依存しない
   - 必ず`!important`を使用する

2. **背景色とテキスト色を同時に設定する**
   - 背景色を変更する場合は、必ずテキスト色も同時に設定
   - 例：暗い背景には白文字、白背景には暗い文字

3. **CSSの詳細度問題を避ける**
   - グラデーション背景などの特殊な背景を持つ要素の子要素には`!important`を使用
   - 例：`.faq-cta h2 { color: white !important; }`

4. **修正後は必ず視覚的に確認**
   - コミット前にブラウザで実際の表示を確認する
   - 特に、CTAセクション、ヘッダー、カードなど背景色が異なる箇所を重点的にチェック

#### 3. よくある問題パターンと解決方法

**パターンA: グラデーション背景のセクション**

❌ **悪い例:**
```css
.section {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
}
.section h2 { /* 色指定なし */ }
.section p { /* 色指定なし */ }
```

✅ **良い例:**
```css
.section {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  color: white; /* 親要素でデフォルトを設定 */
}
.section h1,
.section h2,
.section h3,
.section h4,
.section p,
.section span,
.section a {
  color: white !important; /* すべての子要素で明示 */
}
```

**パターンB: 白背景のセクション**

❌ **悪い例:**
```css
.section {
  background: #ffffff;
}
/* テキスト色が指定されていない */
```

✅ **良い例:**
```css
.section {
  background: #ffffff;
  color: #1e293b; /* 濃いグレー */
}
.section h1,
.section h2,
.section h3,
.section h4 {
  color: #1e293b !important;
}
.section p {
  color: #64748b !important; /* グレー */
}
```

**パターンC: テーブル**

❌ **悪い例:**
```css
table {
  background: #ffffff;
}
thead {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
}
/* th, td の色が指定されていない */
```

✅ **良い例:**
```css
table {
  background: #ffffff;
}
thead {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
}
th {
  color: #ffffff !important;
}
td {
  background: #ffffff;
  color: #1e293b !important;
}
```

#### 4. 実装チェックリスト

新しいページやコンポーネントを追加する際は、以下を確認：

- [ ] すべてのh1〜h6要素に`color: XXX !important;`を設定
- [ ] すべてのp要素に`color: XXX !important;`を設定
- [ ] グラデーション背景を持つ要素の子要素すべてに明示的な色を設定
- [ ] テーブルのth, tdに明示的な色を設定
- [ ] ボタン、バッジ、ラベルなどの特殊要素にも明示的な色を設定
- [ ] ブラウザで実際の表示を確認し、すべてのテキストが読める

#### 5. 「全ページ」修正時の必須プロセス

**❌ 過去の失敗例（2回繰り返した致命的なミス）：**

**第1回目の失敗：**
ユーザーが「全ページの文字色・背景色を統一」と依頼したにも関わらず、一部のページ（HowToUse、FAQ、Blog、RaceDetail）の確認を怠り、古い色が残ってしまった。

**第2回目の失敗（さらに深刻）：**
ユーザーが再度「/how-to-use、/blog、/faq、/aboutが統一的に修正されていない。一部見づらいところがある」と指摘したにも関わらず、また同じミスを繰り返した。具体的には：
1. 白色のテキストに`!important`が不足していた（グラデーション背景のボタンやバッジなど）
2. RaceDetail.cssに古い色（#00C7C7）が1箇所残っていた
3. 全ページを系統的に確認せず、一部のページしか見ていなかった

**問題点：**
1. ユーザーが「全ページ」と明示したにも関わらず、一部のページしか確認しなかった
2. タスクの完了基準が曖昧だった（「全CSSファイルを確認」と言いながら、実際には全て確認しなかった）
3. 系統的なアプローチを取らなかった（全CSSファイルをリストアップして1つずつチェックするプロセスを守らなかった）
4. 検証を怠った（修正後に全ページを再確認しなかった）
5. **コントラスト問題を見落とした**：グラデーション背景の要素で`color: white`に`!important`がついていなかったため、他のCSSルールで上書きされる可能性があった

**✅ 正しいプロセス：**

1. **対象ファイルを明示的にリストアップ**
   ```bash
   # 必ず実行：全CSSファイルをリストアップ
   find src -name "*.css" -type f
   ```

2. **チェックリストを作成**
   - [ ] src/App.css
   - [ ] src/pages/HowToUse.css
   - [ ] src/pages/FAQ.css
   - [ ] src/pages/Blog.css
   - [ ] src/pages/BlogPost.css
   - [ ] src/pages/About.css
   - [ ] src/pages/RaceHistory.css
   - [ ] src/pages/RaceDetail.css
   - [ ] src/components/*.css（全コンポーネント）

3. **各ファイルを個別に確認・修正**
   - リストの各ファイルを1つずつ確認
   - 完了したらチェックリストにマーク
   - **すべて完了するまで次に進まない**

4. **修正後の検証（必須）**
   ```bash
   # 古い色が残っていないか全ファイルで検証
   grep -r "#0A4F8D\|#0D6EBC\|#00A3A3\|#00C7C7" src/ --include="*.css" --include="*.js" --include="*.jsx" --include="*.tsx" --include="*.ts"

   # 白色のテキストで!importantが不足していないか確認
   grep -r "color:\s*\(white\|#fff\|#ffffff\)(?!\s*!important)" src/ --include="*.css"
   ```

5. **コントラスト問題の確認**
   - グラデーション背景やカラー背景の要素で、テキスト色に`!important`がついているか確認
   - 特に以下の要素は要注意：
     - ボタン（.btn-primary, .nav-button.next, .nav-button.finishなど）
     - バッジ（.category-badge, .score-badgeなど）
     - カード（.featured-card, .stat-cardなど）
   - `color: white`は必ず`color: white !important;`にする

6. **コミット前の最終確認**
   - 変更したファイルをすべてリストアップ
   - 漏れがないか再確認
   - ブラウザで各ページを実際に確認
   - TodoWriteツールで全タスクが完了していることを確認

**⚠️ 絶対に守ること：**
- 「全ページ」「全ファイル」と言われたら、必ずこのプロセスに従うこと
- 一部だけ対応して完了とみなさないこと
- **TodoWriteツールで各ページを個別にタスク化し、1つずつ完了させること**
- 検証なしでコミットしないこと

---

## 🌟 天才的な反省点：デザイン統一修正の完全ガイド

### 📊 今回の失敗の全体像（5回の修正依頼が必要だった）

**ユーザーの依頼：** 「全ページのデザイン・背景色・文字色を統一してほしい」

**実際の修正回数：** 5回のコミット、複数の修正依頼が必要だった

**問題の根本原因：**
1. ✗ CSSファイルのみ確認し、JSXファイルのインラインスタイルを見落とした
2. ✗ `color: white`に`!important`を付けず、他のルールで上書きされた
3. ✗ 同じクラス名`.faq-cta`が異なるファイルで異なるスタイルで定義され、衝突した
4. ✗ 「全ページ」と言われたのに、CSSファイルだけ確認してJSXファイルを忘れた
5. ✗ 系統的なアプローチを取らず、見つかった問題だけを修正していた

---

### 🎯 今後同じミスを絶対にしないための完全チェックリスト

#### ステップ1: 完全なファイルリストの作成（絶対に省略しない）

```bash
# 必ず実行：全CSSファイルをリストアップ
find src -name "*.css" -type f > css_files.txt

# 必ず実行：全JSX/TSXファイルをリストアップ
find src -name "*.jsx" -o -name "*.tsx" > jsx_files.txt

# 必ず実行：全コンポーネントをリストアップ
ls -R src/components/ src/pages/
```

**TodoWriteに必ず追加：**
- [ ] 全CSSファイルのリストを作成した
- [ ] 全JSX/TSXファイルのリストを作成した
- [ ] 各ファイルを個別にタスク化した

#### ステップ2: デザイン統一の4つの検索（すべて実行必須）

```bash
# 1. 古い色の検索（CSS + JSX両方！）
grep -r "#3b82f6\|#667eea\|#764ba2\|#2563eb\|#1d4ed8\|#0A4F8D\|#0D6EBC\|#00A3A3\|#00C7C7" src/ --include="*.css" --include="*.js" --include="*.jsx" --include="*.tsx" --include="*.ts"

# 2. インラインスタイルの検索（見落としがち！）
grep -r "style=\{\{" src/ --include="*.jsx" --include="*.tsx"

# 3. !importantが不足している白色テキストの検索
grep -r "color:\s*\(white\|#fff\|#ffffff\)(?!\s*!important)" src/ --include="*.css"

# 4. クラス名の重複検索（衝突の原因！）
# 同じクラス名が複数のCSSファイルで定義されていないか確認
for class in $(grep -rh "^\.[a-zA-Z-]*\s*{" src/ --include="*.css" | sed 's/\s*{.*//' | sort | uniq -d); do
  echo "重複クラス: $class"
  grep -rn "^$class\s*{" src/ --include="*.css"
done
```

#### ステップ3: 修正時の必須ルール

**1. グラデーション背景やカラー背景のテキスト色は必ず`!important`**
```css
/* ❌ 間違い */
.cta-section {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  color: white;  /* ← !importantがない！ */
}

/* ✅ 正しい */
.cta-section {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%) !important;
  color: white !important;
}

.cta-section h2 {
  color: white !important;  /* 子要素も必ず */
}

.cta-section p {
  color: white !important;  /* 子要素も必ず */
}
```

**2. クラス名は必ずコンポーネント固有にする**
```css
/* ❌ 間違い：汎用的すぎて衝突する */
.faq-cta { ... }  /* HowToUse.cssとFAQ.cssで衝突！ */

/* ✅ 正しい：ページ名を含める */
.howto-faq-link-section { ... }  /* HowToUse専用 */
.faq-page-cta { ... }  /* FAQページ専用 */
```

**3. インラインスタイルは必ず統一色を使う**
```jsx
/* ❌ 間違い */
<h1 style={{ borderBottom: '3px solid #3b82f6' }}>  /* 古い色！ */

/* ✅ 正しい */
<h1 style={{ borderBottom: '3px solid #0ea5e9' }}>  /* 統一色 */
```

#### ステップ4: 修正後の完全検証（すべて実行必須）

```bash
# 1. 古い色が残っていないか再確認
grep -r "#3b82f6\|#667eea\|#764ba2\|#2563eb\|#1d4ed8" src/ --include="*.css" --include="*.jsx" --include="*.tsx"
# → 結果: "No matches found" であること！

# 2. !importantが不足していないか確認
grep -r "color:\s*white(?!\s*!important)" src/ --include="*.css"
grep -r "color:\s*#fff(?!\s*!important)" src/ --include="*.css"
# → グラデーション背景の要素ではすべて!importantがついていること！

# 3. インラインスタイルに古い色がないか確認
grep -r "style=\{\{.*#3b82f6\|#667eea\|#764ba2" src/

# 4. クラス名の衝突がないか確認
# 同じクラス名で異なるスタイルが定義されていないか
```

#### ステップ5: コミット前の最終チェック

**必ず以下をすべて確認：**
- [ ] CSSファイルの古い色をすべて削除した
- [ ] JSXファイルのインラインスタイルの古い色をすべて削除した
- [ ] グラデーション背景のテキストにすべて`!important`を追加した
- [ ] クラス名の衝突をすべて解決した
- [ ] 全ファイルで検証コマンドを実行し、"No matches found"を確認した
- [ ] TodoWriteツールですべてのタスクが完了していることを確認した

---

### 💡 究極のベストプラクティス：今後のデザイン変更

#### 1. CSS変数を使った一元管理（推奨）

```css
/* src/App.css（またはglobal.css）の:root */
:root {
  /* プライマリカラー */
  --color-primary: #0ea5e9;
  --color-primary-dark: #0284c7;

  /* テキストカラー */
  --color-text-primary: #1e293b;
  --color-text-secondary: #64748b;
  --color-text-on-primary: #ffffff;

  /* 背景カラー */
  --bg-gradient-primary: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  --bg-gradient-success: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

/* 使用例 */
.cta-section {
  background: var(--bg-gradient-primary) !important;
  color: var(--color-text-on-primary) !important;
}
```

**メリット：**
- 色を変更するときは:rootを1箇所変更するだけ
- 全ファイルで古い色を検索する必要がなくなる
- 統一性が自動的に保たれる

#### 2. コンポーネント固有のクラス名規則（BEM記法）

```css
/* ページ名__要素名--修飾子 */
.faq-page__cta { ... }
.faq-page__cta-title { ... }
.faq-page__cta-button--primary { ... }

.howto-page__faq-link { ... }
.howto-page__faq-link-title { ... }
```

#### 3. デザインシステムのドキュメント化

**`.claude/design-system.md`を作成：**
```markdown
# デザインシステム

## カラーパレット
- プライマリブルー: #0ea5e9
- セカンダリブルー: #0284c7
- テキスト: #1e293b
- サブテキスト: #64748b

## 使用禁止色（旧カラー）
❌ #3b82f6, #667eea, #764ba2, #2563eb

## CTAセクションの標準スタイル
- 背景: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)
- テキスト: white
- すべての色に!important必須

## クラス命名規則
- ページ固有: {page-name}__{element}
- コンポーネント: {component}__{element}
```

---

### 🚨 絶対に守るべき鉄則

1. **「全ページ」と言われたら：**
   - CSSファイル AND JSXファイル両方を必ず確認
   - インラインスタイルも必ず確認
   - 検索コマンドで全ファイルを対象にする

2. **グラデーション背景には：**
   - 背景色に`!important`
   - テキスト色に`!important`
   - すべての子要素（h1, h2, p, button等）にも`!important`

3. **クラス名は：**
   - 必ずページ名やコンポーネント名を含める
   - 汎用的な名前（.cta, .button, .sectionなど）は避ける

4. **修正後は：**
   - 必ず全検索コマンドを実行
   - "No matches found"を確認してからコミット
   - TodoWriteツールで全タスク完了を確認

5. **コミットメッセージには：**
   - 修正したファイル数と箇所数を明記
   - 検証結果を必ず記載（"古い色が残っていないことを確認済み"等）

---

### 📝 参考：今回の修正履歴（反面教師として）

**5回のコミットが必要だった理由：**

1. **1回目**: CSSの色統一（JSXを見落とし）
2. **2回目**: ページCSSの!important追加（コンポーネントを見落とし）
3. **3回目**: コンポーネントのインラインスタイル修正（CTAセクションを見落とし）
4. **4回目**: CTAセクションの!important追加（クラス名衝突を見落とし）
5. **5回目**: クラス名衝突の解決

**本来は1回で完了すべきだった。**

---

## ✅ まとめ：デザイン統一修正の完璧な手順

1. **準備**: 全CSSファイル + 全JSXファイルのリストを作成
2. **検索**: 4つの検索コマンドをすべて実行（古い色、インライン、!important、クラス重複）
3. **修正**: TodoWriteで各ファイルをタスク化し、1つずつ修正
4. **検証**: すべての検索コマンドで"No matches found"を確認
5. **コミット**: 検証結果を含めたコミットメッセージで記録

**この手順を守れば、1回で完璧に修正できる。**
