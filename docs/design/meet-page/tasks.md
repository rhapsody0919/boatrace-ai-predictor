# 節ページ tasks

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)
目標: 2026-10-20 までに本番公開（ダービー記事のリンク先）。PR は BOA-682（本体）と BOA-683（導線）で分ける。

## Phase 0: 着手前（`/step4` の事前条件）

- [x] **T0-1** モックのユーザー承認（2026-10-02。spec.md「モック承認で決まった事項」）
- [x] **T0-2** design-reviewer のレビューと指摘の反映（2026-10-02。指摘9件。対応は plan.md §2・§4 と spec.md FR-1.4・FR-1.8）
- [x] **T0-3** acceptance-test-writer が `e2e/acceptance/meet-page.spec.js` を書く（spec.md・screens.md のみ渡す）

## Phase 1: 節ページ本体（BOA-682、PR 1）

- [x] **T1-1** 純関数 `src/utils/meetPageModel.js`: `meetDaysOf`・`meetPageState`・`pickMeetAnchor`・`buildQualifiers`・`pickShobugake`・対象外の節の判定（plan.md §2.2〜2.6）。夜・昼の各ケース（plan.md §2.4）と、2025-12〜の通常の SG/G1/G2 の節で予選最終日が series_day=4 であることは本番の実測（design-reviewer 対応時の SQL、plan.md §2.4 の根拠）で確認し、純関数側は児島の節のフィクスチャで固定する。`scripts/maintenance/verify-meet-page-model.js`（児島 2026-09-28 の節の実データ断片をフィクスチャにする）。`verify-registry.json` に ci で登録
- [x] **T1-2** `getMeetScoreboard` に第3引数 `{ prelimDone }`（キャッシュキー v24）。`getMeetPage(venueCode, startDate)`（`supabaseDataService.js`）。`race_series` が無い・初日に行が無い・対象外グレード・`meetStart` 不一致を、それぞれ状態として返す（例外で握りつぶさない）
- [x] **T1-3** `MeetPage.jsx` とルート（`AppRouter.jsx`）。title・description・canonical・`Breadcrumb`。読み込み失敗は `DataFetchError`
- [x] **T1-4** `MeetHeader`・`MeetRankingTable`（ボーダー線・順位外・勝負駆けの切り替え・金枠）・`MeetQualifiersSection`。375px 1行2段、1024px 以上 2カラム
- [x] **T1-5** i18n（`meetPage.*` を ja/en/zh-TW/ko。glossary 確認・追記）
- [x] **T1-6** sitemap（`scripts/generate-sitemap.js`、plan.md §4）。`verify-sitemap-coverage.js`・`verify-sitemap-lastmod.js` を通す
- [x] **T1-7** `e2e/meet-page.spec.js`（児島 2026-09-28: 46人に順位・18位で線・順位外6人・準優3レース18人。開幕前の URL でエラーにならない）。`e2e/layout.spec.js` の PAGES に追加
- [ ] **T1-8** 手元確認: `npm run build`、上記 spec 1本を `--workers=1`、Playwright でライト・ダーク・375/1440 のスクリーンショット。受け入れE2E をローカルで実行
- [ ] **T1-9** `content-index.json`（`docs/design/meet-page/`）。PR・自動レビュー・ファン評価ループ（Preview URL）

## Phase 2: 導線（BOA-683、PR 2。PR 1 のマージ後）

- [ ] **T2-1** `MeetRankingPreviewCard` を `VenueRaceListPage` 上部へ（SG/G1/G2 のときだけ。上位2位＋ボーダー）
- [ ] **T2-2** `RaceMeetTab` に「全選手を見る」リンク（SG/G1/G2 のときだけ）
- [ ] **T2-3** e2e（カードとリンクの出し分け）・layout・i18n。PR・自動レビュー・ファン評価ループ

## Phase 3: 公開後

- [ ] **T3-1** ダービー（`/venue/13/meet/2026-10-27`）を 10/27 の初日レース後に本番で確認（ランキングが出る・sitemap に載る）
- [ ] **T3-2** BOA-684 の照合結果（三国G1 10/4〜10/7）を受けて、早見の自社計算に差があれば別チケット
