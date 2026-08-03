# SEO判断軸: SPAアーキテクチャによるクローラー制約

BOA-161（ブログ記事のOGP/Twitterカード未反映バグ）の調査で判明した事実。SEO・集客施策を検討する際の判断軸として記録する。

## 事実

- boatAIは `vercel.json` で `/((?!api/).*) → /index.html` のみを行う純粋なクライアントサイドSPA（React + Vite）。SSR・プリレンダリングの仕組みは無い。
- ページ固有の `<title>` / `<meta>` / `<link rel="canonical">` タグは、Reactコンポーネントがマウントされた後にJavaScriptで書き換えられる。
- Googlebot、および一部のX(Twitter)クローラーはJSレンダリングに対応しているため、`title` / `meta description` / 構造化データ（JSON-LD）等はReactでの実装で正しく取得できる。
- Facebookなど**JavaScriptを実行しないクローラー**は、初期HTML（`index.html` に静的に書かれたタグ）しか見ない。ReactコンポーネントがJSで書き換えたページ固有のOGP/Twitterカードタグは反映されない。

## 今後の判断軸

SEO・集客施策を検討・実装する際は、その施策が「JS実行後にしか反映されない変更かどうか」を必ず確認する。

| 施策 | JS実行後でも良いか | 対応方針 |
|------|---------------------|----------|
| 検索順位・インデックス精度（title/description/構造化データ/内部リンク等） | 可（Googlebotはレンダリングする） | Reactコンポーネントでの実装で概ね機能する |
| SNSシェア時のリンクプレビュー（OGP/Twitterカード） | 不可（Facebook等は非JS実行） | Vercel Edge Functionでのボット判定＋静的HTML返却、またはページのSSG化が必要 |

「Reactでmetaタグを出力したから直った」と判断する前に、上記の区別を必ず確認すること。DevTools/Playwrightでの確認はJS実行後の状態を見ているため、非JS実行クローラーの見え方とは異なる点に注意する。

## 関連

- BOA-161: ブログ記事のOGP/Twitterカードが記事ごとに上書きされない
