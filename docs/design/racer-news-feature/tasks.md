# racer-news-feature タスク分解

`docs/design/racer-news-feature/spec.md`・`screens.md`・`plan.md`に基づくタスク一覧。依存順に並べており、上から順に実装する。

## タスク一覧

- [x] **1. マイグレーション適用: racer_news テーブル作成**
  [docs/db-migration/036_create_racer_news.sql](../../db-migration/036_create_racer_news.sql)をSupabaseに適用する。適用後、service role keyで1行INSERT/SELECT/DELETEし、書き込み権限とRLS（匿名read-only）が設計通りか確認する。

- [x] **2. src/services/racerService.js 実装**
  `getRacerPageData(racerId)`を実装。`racer_profiles`（1行）・`race_entries`（`race_id`降順1件、`grade`取得、[ADR 0023](../../adr/0023-racer-grade-freshness.md)）・`racer_news`（`racer_id`一致、`created_at`降順）を並行取得し`{ profile, grade, news }`を返す。実在する`racer_id`（例: 4327）とプロフィール無しの`racer_id`（例: 3081、[[racer-fortune-telling]]のスクレイピング失敗選手）の両方で動作確認する。

- [x] **3. src/components/racer/ 新規コンポーネント実装**
  `RacerProfileHeader.jsx`（氏名`translate="no"`・支部・級別）、`RacerProfileCard.jsx`（`VenueGuide.jsx`の`eg-facts-grid`パターンで基本情報グリッド、値がある項目のみ表示）、`RacerNewsList.jsx`（ニュース一覧、0件時は空状態表示）、`index.js`（barrel export、`.claude/rules/component-reuse.md`準拠）を実装。

- [x] **4. src/components/RacerStructuredData.jsx 実装**
  `VenueStructuredData.jsx`と同形式でPerson型JSON-LDを出力。プロフィール無しの選手では構造化データを出力しない分岐を入れる。

- [x] **5. src/pages/RacerProfile.jsx 新設 + ルート登録**
  `src/AppRouter.jsx`に`<Route path="racer/:racerId" element={<RacerProfile />} />`を追加（`races`/`blog`ブロックに並べる）。ページ本体はタスク2〜4のservice/componentを組み合わせ、title/description/canonical/条件付きnoindex（`news.length === 0`時に`<meta name="robots" content="noindex, follow" />`）・パンくず（`/`固定）を実装する。

- [ ] **6. scripts/maintenance/add-racer-news.js 実装**
  CLI引数（`--racer-id`・`--title`・`--summary`・`--source-url`・`--source-name`・`--published-at`）を受け取り`racer_news`に1行INSERTするスクリプト（[ADR 0022](../../adr/0022-racer-news-approval-flow.md)）。`scripts/lib/supabaseClient.js`を再利用。

- [ ] **7. Phase1: 既存コンポーネントの選手名リンク化**
  screens.md「4. 既存コンポーネントの改修」のPhase1対象6コンポーネント（`RacerFormChart.jsx`・`RacerBoatReturnRateChart.jsx`・`RacerFormRankingChart.jsx`・`RacerTechniqueProfileChart.jsx`・`ExhibitionTimeTrendChart.jsx`・`StPredictabilityChart.jsx`）の選手名表示を`<Link to={`/racer/${racerId}`}>`でラップする。データ取得層の変更は不要（既に`racer_id`が含まれる）。

- [ ] **8. sitemap対応**
  `scripts/generate-sitemap.js`に`getRacerPages()`（`racer_news`に1件でも行がある`racer_id`のみ対象）を追加し`generateSitemap()`に組み込む。`npm run verify:sitemap`の`EXPECTED_EXCLUSIONS`に動的ルート`racer/:racerId`を理由付きで登録する。`npm run verify:sitemap`を実行し通ることを確認する。

- [ ] **9. 実ニュース候補のリサーチ・承認・掲載（受入基準の実証）**
  対象選手を1名選び、Claudeが実際にニュース候補をリサーチしてチャットで提示、ユーザー承認を得てからタスク6のスクリプトで掲載する（spec.md受入基準「候補提示→ユーザー承認→掲載という一連の操作が実行できる」の実証）。掲載後、該当選手ページで表示・indexable判定（`noindex`が外れる）を確認する。

- [ ] **10. 動作確認・PR作成**
  ローカルで`npm run dev`起動、Playwrightで(a) プロフィール有り選手ページ (b) プロフィール無し選手ページ (c) ニュース有り/無しでの`noindex`メタタグ切り替え (d) Phase1対象6コンポーネントからのリンク遷移 (e) モバイル幅でのレイアウトを確認する。`e2e/smoke.spec.js`に選手ページへの主要導線チェックを追記する。`npm run build`・`npm run test:e2e`・`npm run verify:sitemap`を実行し、`/create-pr`でPR作成する。
