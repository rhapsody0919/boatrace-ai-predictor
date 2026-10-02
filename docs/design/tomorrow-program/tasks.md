# 明日の出走表 tasks

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)

順序: (a) 取得（T1〜T5）→ マイグレーション適用・shadow→live → (b) 画面（T6〜T10）→ 完了の実測（T11）。
(b) の着手は、モック承認（出走表の列・モーター2連率0の表示）と design-reviewer・受け入れ E2E がそろってから。

## (a) 翌日の番組表の取得

- [ ] **T1 parseBText に「データ更新待ち」の判定を足す**（`scripts/lib/kbFileParser.js`）
  - 会場ブロックの本文が更新待ちの文言だけなら `pending: true`、出走表があれば `false`
  - 再現テスト: 10/3 分の実ファイルから、更新待ちの会場と出走表のある会場を含む断片を fixture にし、`verify-kb-file-parser.js` に追加（修正前は `pending` が無く、更新待ちが空会場になることを確認してから足す）
  - 既存の呼び出し元（`fix-opening-day-entries-from-b.js` 等）の挙動が変わらないことを確認
- [ ] **T2 マイグレーション案 123 の最終確認**（`docs/db-migration/123_tomorrow_program.sql`）
  - 列の型を parseBText の出力（整数・小数・文字列）と1列ずつ突き合わせる。`verify:migration-rls`・`verify:migration-numbers` を通す
  - 適用はユーザー（コードのマージより先）。APPLIED.md に記録済み
- [ ] **T3 取得ジョブ本体**（`scripts/lib/tomorrowProgramJob.js`、`api/cron/tomorrow-program.js`、registry、vercel.json）
  - plan.md §3.2 の1 tick（対象日=JST今日+1、14時前は何もしない、Last-Modified 不変なら終了、pending の会場は書かない、全列そろえて `upsertChangedRows`、報告）
  - mode off/shadow/live。shadow は書かずに件数だけ
  - 再現テスト: `scripts/maintenance/verify-tomorrow-program-job.js`（新規、registry `ci`。supabase・fetch はモック）。対象日（0時台・13:59・14:00・23:45）、Last-Modified 不変で書かない、pending を書かない、shadow で書かない、Last-Modified が変わったのに出走表0会場ならエラー
- [ ] **T4 監視と掃除**
  - 最終 tick でそろわない会場を `last_error` に記録し、既存の monitor→Slack に流れることを確認（`verify-scrape-monitor.js` に追加）
  - 対象日を過ぎた行の削除（既存の `scrape-cleanup` に足せるか読んで決める。足せなければ14:00の最初の tick で消す）
- [ ] **T5 本番の段階的な有効化**（マイグレーション適用後）
  - `scrape_job_state` に job='tomorrow_program' を mode=shadow で入れる（ユーザー操作。本番書き込みは Claude からはできない）→ 1日分の報告（未公開・件数）を確認 → live
  - 本番実測: 期待件数（算出根拠: 対象日に race_series の節がある会場数×12R×6艇。中止・欠場を除き、除いた件数も報告）に対し、充足率99%以上であることを実測クエリで確認する
  - タイミング実測: 可変データ（夕方〜夜に更新される）なので、土日を含む直近5日で「created_at − source_modified_at」の分布を実測する（30分以内が98%以上、欠落率2%以内）
  - 継続監視: 上記指標が日次で自動計測され、閾値超過（最終 tick でそろわない・Last-Modified が変わったのに0件・未実行）で Slack 通知されることを確認する

## (b) 「明日」タブの画面

- [ ] **T6 データ取得**（`src/services/supabaseDataService.js`）
  - `getTomorrowVenueSummary(date)`・`getTomorrowProgram(date, venueCode)`（plan.md §4.2。withCache 5分、エラーは throw）
  - 会場の状態（program / waiting / none）を決める純関数を `src/utils/` に置き、`verify-frontend-pure-functions.js` に追加（節あり・出走表なし→waiting、節なし→none、出走表あり→program）
- [ ] **T7 DayTabs とトップの明日タブ**（`src/components/race/DayTabs.jsx` 新規、`VenueGridPage.jsx`）
  - `?day=tomorrow` で明日。初期は本日。明日タブを開くまで明日のデータを取らない
  - `TomorrowPublishNotice`（公開前 / 公開途中 n/m / 全公開は非表示）
- [ ] **T8 VenueGridCard の明日の状態**（`VenueGridCard.jsx` 拡張）
  - program（グレード・節名・日次・1R締切予定、リンク `/tomorrow/:venueCode`）/ waiting「出走表準備中」/ none「明日開催なし」＋次開催日（BOA-225）
- [ ] **T9 明日の出走表ページ**（`src/pages/TomorrowProgramPage.jsx`・`TomorrowRaceProgram` 新規、ルート `/tomorrow/:venueCode`）
  - 前日時点の注記（Last-Modified の時刻、JST）、12R、列はモック承認どおり、選手名は racer_profiles の正式名（未登録は B の名前）、`translate="no"`
  - レース詳細へのリンクは置かない
- [ ] **T10 多言語・ルーティング・レイアウト**
  - 4言語の `tomorrow.*` キー（用語は i18n-glossary）、`TRANSLATED_PATHS` に `/tomorrow`、sitemap の `EXPECTED_EXCLUSIONS`
  - `e2e/layout.spec.js` に `/?day=tomorrow`・`/tomorrow/:venueCode`（5軸）。受け入れ E2E（`e2e/acceptance/tomorrow-program.spec.js`）が通る
  - ダークモードの目視（Playwright）

## 完了

- [ ] **T11 データ精度と完了報告**
  - data-accuracy-verifier: 実データで1会場の明日の出走表が B ファイルと全艇一致
  - 「ファン評価あり」ならファン評価ループ（review-fix-cycle.md）
  - 完了報告に T5 の3つの実測を添付
