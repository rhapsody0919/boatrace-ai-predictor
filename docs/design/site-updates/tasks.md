# 更新のお知らせ（site-updates）tasks

[plan.md](plan.md) の「PR の分け方」の順。各タスクは1つの PR。

- [x] T1 データと計算: `src/data/siteUpdates.js`（10月下旬以降の10件・今つくっている物2件。10月上旬の残りは次のデータの PR）・`src/pure/siteUpdates.js`・`scripts/maintenance/verify-site-updates.js`・`verify-registry.json` の1行
  - 完了: `node scripts/maintenance/verify-site-updates.js` が緑。暦日の境目（JST 23:59／00:00、TZ=UTC と Asia/Tokyo）・帯の×・14日の外・minor を帯に出さない・月の束ねを固定の時計で試す。データを壊した変異（日付の逆順・禁止語・4件目の making）で赤になることを確かめる
- [x] T2 ページ `/updates`: `src/pages/SiteUpdates.jsx`・`.css`・`src/AppRouter.jsx`・`scripts/lib/sitemapStaticPages.js`・`e2e/site-updates.spec.js`
  - 完了: 見出し・月・札・「見てみる」・畳み・今つくっている物・断りが出る。375〜1920px・ライト／ダークで崩れない（手元の dev と Playwright で確かめる）
- [x] T3 入口（帯とメニューの2つの PR）: `SiteUpdatesBanner.jsx`・`.css`・`VenueGridPage.jsx`・e2e ／ `Header.jsx`・`Header.css`・e2e
  - 完了: ja のトップにだけ帯、×で消えて再読み込みでも出ない、en のトップには出ない。メニューの項目と NEW・☰ の点。GA4 のイベント
- [ ] T4 候補の機械: `scripts/maintenance/site-updates-candidates.js`（判定の試験は T1 の verify に足す）
  - 完了: 2026-11-01 からの候補が出て、リファクタ・試験・SNS・既出の PR が外れる
- [ ] T5 運用の文書（公開の後）: `docs/operation/site-updates.md` と `docs/design/site-updates/content-index.json`（released に本番に出た日）（窓口が週1で候補を回し、1件の書き方・畳む基準・今つくっている物の出し入れ）
