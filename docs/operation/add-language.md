# 言語追加手順書

新しい表示言語を追加する手順。i18n 基盤（BOA-124〜130）により、基本手順は「言語定義の追記 + 翻訳 JSON の作成」の2ステップで完了する。

## 前提となる設計

- **URL が言語の唯一の情報源**: デフォルト言語（ja）はプレフィックスなし、それ以外は `/{code}/*`（例: `/en/guide`）
- 言語定義の唯一の情報源は `src/config/languages.js` の `SUPPORTED_LANGUAGES`
- 以下は SUPPORTED_LANGUAGES から自動生成されるため、言語追加時の個別対応は不要:
  - ルーティング（`src/AppRouter.jsx`）
  - hreflang 代替リンク（`src/components/HreflangTags.jsx`）
  - 言語スイッチャーのボタン（`src/components/LanguageSwitcher.jsx`）
  - 内部リンクの言語プレフィックス（`src/hooks/useLocalizedPath.js`）
  - sitemap の言語別 URL（`scripts/generate-sitemap.js`）
  - GA4 の app_language 送信（`src/utils/analytics.js`）

## 手順

### 1. 言語定義の追加

`src/config/languages.js` の `SUPPORTED_LANGUAGES` に追記する。

```js
export const SUPPORTED_LANGUAGES = [
  { code: "ja", label: "日本語", ogLocale: "ja_JP", hreflang: "ja" },
  { code: "en", label: "English", ogLocale: "en_US", hreflang: "en" },
  // 例: 繁体字中国語を追加する場合
  { code: "zh-TW", label: "繁體中文", ogLocale: "zh_TW", hreflang: "zh-Hant" },
];
```

| フィールド | 内容 |
|-----------|------|
| `code` | URL プレフィックス・localStorage・GA4 に使う言語コード（BCP 47） |
| `label` | 言語名の自己表記（UI 表示用） |
| `ogLocale` | OGP の `og:locale` 値（`ll_CC` 形式） |
| `hreflang` | hreflang 属性値。地域でなく文字体系で指定する言語に注意（繁体字: `zh-Hant`、簡体字: `zh-Hans`） |

### 2. 翻訳ファイルの作成

`src/locales/{code}/common.json` を作成する。`src/locales/en/common.json` をベースに全キーを翻訳する。

- 未翻訳キーは日本語にフォールバックするため、部分的な翻訳でも動作はする（公開品質としては全キー翻訳が前提）
- 専門用語はローマ字 + 現地語説明の併記（例: Nige (逃げ) の各言語版）。対訳表は `docs/reference/i18n-glossary.md` を参照・更新する
- 賭事関連の法的ディスクレーマー（投票は日本国内在住・20歳以上のみ）は必ず翻訳に含める

ファイルを置くだけで `src/i18n.js` の `import.meta.glob` が自動で読み込む。

注意:
- `src/locales/` 配下の JSON は SUPPORTED_LANGUAGES 未登録でも全ファイルがバンドルに含まれる。公開前の翻訳を main ブランチに置かない
- 翻訳 JSON は全言語分がメインバンドルに eager 読込される。4言語時点で計約48KB（gzip後 約13KB）であり許容と判断（2026-07）。**5言語目を追加する際は言語別の遅延ロード化を実施する**
- 定義だけ追加して JSON を置き忘れた場合、開発サーバーは起動時にエラーで停止する（本番ビルドでは白画面回避のため ja フォールバックで動作し console.error を出す）

### 3. 手動判断が必要な箇所

自動対応されない、言語ごとに判断が必要な箇所:

| 箇所 | 内容 |
|------|------|
| `scripts/generate-sitemap.js` の `LOCALIZED_PAGES` | sitemap に載せる言語別ページの範囲。デフォルトは `/` と `/guide` のみ |
| `src/AppRouter.jsx` の `GUIDE_BY_LANG` | 言語別入門ガイドの登録マップ。新言語のガイドページを作ったらここに追加する（未登録の言語は日本語のコンテンツハブが表示される） |
| 入門ガイドページの作り方 | **言語別に独立したコンポーネントとして作る**（テンプレート共通化はしない）。読者の前提知識が言語圏ごとに異なるため、構成自体を変えることを推奨（例: KoGuide は韓国경정との比較が主役、EnglishGuide は競技のゼロからの説明）。スタイルは EnglishGuide.css を共用（2026-07 方針決定） |
| 言語専用コンテンツ（`/venues` 等） | 対応言語は `src/config/languages.js` の `LANGUAGE_ONLY_PATHS` で一元管理（ルーティング・hreflang が参照）。sitemap の `LANGUAGE_ONLY_PAGES`（スラッグ・priority）は別途更新 |
| `scripts/analysis/i18n-demand-report.js` | GA4 集計が en/ja の2言語前提。新言語のパス（`/{code}/*`）を集計対象に追加する |
| `src/components/LanguageSwitcher.jsx` の UI | ボタン並列表示。4言語（JA/EN/中文/한국어）までは 375px で表示崩れなしを検証済み。**5言語以上でドロップダウン化する** |

### 4. 検証

```bash
npm run dev
```

- [ ] 言語スイッチャーに新言語ボタンが表示され、切替で URL が `/{code}/` に変わる
- [ ] `/{code}/guide` 等の直アクセスで新言語表示になる
- [ ] ページソースに全言語分の hreflang `<link rel="alternate">` が出力される
- [ ] JA / EN の既存動作に影響がない（切替・リダイレクト・hreflang）

```bash
node scripts/generate-sitemap.js
```

- [ ] `public/sitemap.xml` に `/{code}/` と `/{code}/guide` が含まれる

```bash
npm run build
```

- [ ] ビルドエラーなし

### 5. 公開後

- GA4 の `app_language` ユーザープロパティは言語コードをそのまま送信するため設定変更不要
- 月次の需要レポート（`docs/operation/i18n-demand-report.md`）で新言語の PV 推移を確認する
