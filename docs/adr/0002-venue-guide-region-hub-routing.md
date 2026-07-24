# ADR 0002: 地域別ハブページのルーティング方式

## ステータス
採用

## 背景
spec.mdの要件6で、会場を地域（関東・関西・九州等）でグルーピングしたハブページを追加する。24会場化に伴い一覧ページが縦に長くなるため、地域単位での回遊・SEOの長尾クエリ（例: "Tokyo boat race venues"）獲得を狙う。既存の会場ガイド関連ルートはすべてパスセグメント方式（`/en/venues`, `/en/venues/:slug`）で、hreflang・sitemap・canonicalもこの前提で組まれている。

## 決定
新規動的ルート `/en/venues/region/:regionSlug` を追加する。カードのレンダリング（`evg-card`）は一覧ページと共通化し、地域データでフィルタしたリストを渡すラッパーとして実装する。

## 却下した選択肢
- **クエリパラメータ方式（`/en/venues?region=kanto`）**: 実装は最も簡単だが、既存アーキテクチャがパスベースのcanonical・sitemap・hreflang管理を前提にしており一貫性を欠く。また検索エンジンがクエリパラメータ違いを別ページとして安定的に評価する保証が低く、SEO目的の新規ページとしては不向き
- **地域ごとに個別の静的ルート（`/en/venues/kanto`, `/en/venues/kansai`, `/en/venues/kyushu` を個別に`<Route>`定義）**: 動的パラメータ方式より単純だが、既存の`/en/venues/:slug`という動的パラメータの前例と一貫性がなく、地域を増減する際にルート定義自体の変更が必要になりDRYでない

## 影響
- `getAvailableLanguages`/`LANGUAGE_ONLY_PATHS`のパターンに`/venues/region`を追加登録する必要がある
- sitemap生成スクリプトに地域ハブページのURLを追加する
- カード共通化のため、`VenueGuideList`から`VenueCard`相当のレンダリング部分を抽出する必要がある（component-reuse.md準拠）

## 重要な既知の落とし穴（設計レビューで発見、2026-07-24）
`getAvailableLanguages`の現行実装は次の通り、**最初にマッチしたエントリを返す**ため、`/venues`が`/venues/region`より前に登録されていると、プレフィックス一致（`basePath.startsWith(`${p}/`)`）により`/venues/region/kanto`が誤って`/venues`エントリ（`["en", "zh-TW"]`）にマッチしてしまう。

```js
const entry = Object.entries(LANGUAGE_ONLY_PATHS).find(
  ([p]) => basePath === p || basePath.startsWith(`${p}/`),
);
```

地域ハブページはzh-TW未対応（スコープ外）のため、この誤マッチはルーティングガード・hreflangの両方で「zh-TWでも地域ハブが提供されている」という誤判定を引き起こす。**実装時（BOA-138）に`getAvailableLanguages`を「最も長く一致するエントリを優先する」ロジックに修正すること**（`.find()`ではなく、一致した候補をパス長でソートして最長一致を採用する等）。この修正は`/venues`と`/venues/region`のような入れ子パスが今後も増える可能性を考慮し、`languages.js`側で汎用的に対応する。
