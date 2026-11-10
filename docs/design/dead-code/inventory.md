# 死にコード候補4件の呼び手の確認（BOA-1402）

origin/master（b482bc307）で Grep により api・scripts・e2e・src・vercel.json・docs・.github を引いた結果。コード・設定・検査は変えていない。`api/` と `vercel.json` に該当の参照は4件とも無い。

| 対象 | 呼び手 | 消すと落ちる守り | 消す票を起こしてよいか |
|---|---|---|---|
| `src/pure/favoriteRuns.js` | src: `components/favorites/FavoriteRunsSection.jsx`、`hooks/useFavoriteRunStats.js`（import）、`components/favorites/FavoritesFallback.jsx`（コメントのみ）。scripts: `scripts/maintenance/verify-favorite-runs.js`。docs: `docs/reference/shared-logic-index.md`、`docs/knowledge/ui-implementation.md` | `verify-favorite-runs.js`（verify-registry 登録済み）。画面もビルドで壊れる | **死にコードではない**。票を起こさない |
| `src/pure/semifinalCount.js` | scripts: `scripts/maintenance/verify-frontend-pure-functions.js`（37行の読み込み表と suite）だけ。src・api・e2e に import は無い。docs: `docs/reference/shared-logic-index.md`、`docs/knowledge/data-definitions.md` | `verify-frontend-pure-functions.js`（`npm run verify:frontend-pure-functions`、registry 登録済み） | 製品からの呼び手は無いが、消すと verify が落ちる。**オーナーの例外が要る** |
| `src/utils/analogyTreeShap.js` | scripts: `scripts/ml/analogy/treeshap-parity.js`（import）。src・api・e2e に import は無い。docs: `docs/reference/shared-logic-index.md`、`docs/design/analogy-finder/analysis/perrace-race-level.md` ほか。`scripts/analysis/analogy-finder-perrace/race_level.py`（文字列のみ） | `treeshap-parity.js` を呼ぶ `.github/workflows/train-analogy.yml`（一致検査。落ちると学習ジョブが止まる）と、それを守る verify-registry.json 133行の検査 | 消すと verify と CI の学習ジョブが落ちる。**オーナーの例外が要る**（`.github/workflows/` は作り手が変えられない） |
| `src/pages/admin/sns-hub/BlogPrReview.jsx` | e2e: `e2e/support/sns-existing-fixes-server.js`（import、`playwright.existing-fixes.config.js` の webServer が起動）。src に import は無い（画面から使われていない） | `playwright.existing-fixes.config.js` 経由の E2E | 画面からは未使用だが、消すと e2e の確認用サーバーが落ちる。**オーナーの例外が要る**（`playwright.config.*` と `e2e/` の期待値は変えられない） |

## 結論

- 4件のうち favoriteRuns は生きている。測りの「verify だけが使う」は誤り。
- 残り3件は製品（`src/` の画面）からの呼び手が無いが、いずれも verify・CI・e2e が読む。消す票はオーナーの例外の判断を待つ。
