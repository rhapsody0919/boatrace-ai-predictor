# 明日の出走表 tasks

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)

順序: (a) 取得（T1〜T5）→ マイグレーション適用・shadow→live → (b) 画面（T6〜T10）→ 完了の実測（T11）。
(b) の着手は、モック承認（2026-10-02 済み: 当日のデータ出走表と同じ部品）と design-reviewer・受け入れ E2E がそろってから。モーター0の表示は BOA-702（当日側）を先に入れる。

## (a) 翌日の番組表の取得

- [ ] **T1 parseBText に「データ更新待ち」の判定を足す**（`scripts/lib/kbFileParser.js`）
  - 会場ブロックの本文が「この場のデータ更新は、いましばらくお待ちください。」だけなら `pending: true`、出走表があれば `false`（開催の無い会場はブロック自体が無い）
  - 再現テスト: 10/3 分の実ファイルから、更新待ちの会場と出走表のある会場を含む断片を fixture にし、`verify-kb-file-parser.js` に追加（修正前は `pending` が無く、更新待ちが空会場になることを確認してから足す）
  - 既存の呼び出し元（`fix-opening-day-entries-from-b.js` 等）の挙動が変わらないことを確認
- [ ] **T1b RPC 3本の「艇番×racer_id」版**（マイグレーション123に同梱。T2 の適用より前に書く。plan.md §8 の1・2）
  - `get_boats_st_predictability`・`get_boats_technique_profile`・`get_boats_return_rate`（引数 `p_boats int[], p_racer_ids int[], p_before text`、`race_id < p_before`、集計窓の下限は 029 と同じ `now()`）。同じファイルで `GRANT EXECUTE ... TO anon, authenticated`。`check-anon-access.js` の `ANON_RPCS` に追加。「元に戻す」に DROP FUNCTION
  - 再現テスト: 既存のレースの race_id を p_before に渡すと、race_id 版と同じ値（実データで1会場12R。`scripts/maintenance/` の manual verify、registry に manual で登録）
- [ ] **T2 マイグレーション案 123 の最終確認**（`docs/db-migration/123_tomorrow_program.sql`）
  - 2表（`tomorrow_program`・`tomorrow_program_venues`）と T1b の RPC 3本。列の型は design-reviewer が実ファイルで突き合わせ済み。`verify:migration-rls`・`verify:migration-numbers` を通す
  - 適用はユーザー（コードのマージより先）。APPLIED.md に記録済み
- [ ] **T3 取得ジョブ本体**（`scripts/lib/tomorrowProgramJob.js`、`api/cron/tomorrow-program.js`、registry、vercel.json）
  - plan.md §3.2 の1 tick（対象日=JST今日+1、14時前は何もしない、cursor `{date,lastModified,mode}`、404 は未公開で成功、Last-Modified 不変かつ DB がそろっていれば終了、本文の日付ガード、pending は venues だけ、`upsertChangedRows` の設定（chunkColumn・race_date の絞り込み・time 表記・ignoreColumns・TIMESTAMP_COLUMNS/NUMERIC_SCALES）、報告、22時以降の alerts）
  - 先に既存の time 列（PostgREST の返り値の表記）を実測する。`upsertChangedRows` が絞り込み条件を受け取れなければ拡張し、既存の呼び出しの挙動が変わらないことを `verify-unchanged-rows.js` で確認
  - Vercel の Cron 数の上限に余裕があるか確認（既存45件）
  - mode off/shadow/live。shadow は書かずに件数だけ
  - 再現テスト: `scripts/maintenance/verify-tomorrow-program-job.js`（新規、registry `ci`。supabase・fetch はモック）。plan.md §6 の全ケース（同じファイル2回目の書き込み0件を含む）
- [ ] **T4 監視と掃除**
  - `monitor.js` の continuous の死活判定に registry の `activeWindowJst` を効かせる（窓外で誤報しない）。再現テストを `verify-scrape-monitor.js` に追加
  - 22時以降の未公開・17時以降の 404 が `last_report.alerts` 経由で Slack に流れることを確認（同上）
  - `scrape-cleanup`（cleanup.js）に2表の `race_date < 今日` の削除を足す
- [ ] **T5 本番の段階的な有効化**（マイグレーション適用後）
  - `scrape_job_state` に job='tomorrow_program' を mode=shadow で入れる（ユーザー操作。本番書き込みは Claude からはできない）→ 1日分の報告（未公開・件数）を確認 → live
  - shadow の間に、B ファイルの Last-Modified の変化回数と公開の最終時刻を記録し、22時の通知時刻を確定する
  - 本番実測: 期待件数（算出根拠: 対象日の B ファイル最終版の会場ブロック数×12R×6艇。欠場・12R未満の会場を除き、除いた件数も報告）に対し、充足率99%以上であることを実測クエリで確認する
  - タイミング実測: 可変データ（夕方〜夜に更新される）なので、土日を含む直近5日で「created_at − source_modified_at」の分布を実測する（30分以内が98%以上、欠落率2%以内）
  - 継続監視: 上記指標が日次で自動計測され、閾値超過（最終 tick でそろわない・Last-Modified が変わったのに0件・未実行）で Slack 通知されることを確認する

## (b) 「明日」タブの画面

- [ ] **T6 データ取得**（`src/services/supabaseDataService.js`）
  - `getTomorrowVenueSummary(date)`・`getTomorrowProgram(date, venueCode)`（plan.md §4.2。withCache 5分、エラーは throw）
  - 会場の状態（program / waiting / none / before）を決める純関数と、選手名の全角空白をまとめる純関数を `src/utils/` に置き、`verify-frontend-pure-functions.js` に追加（venues=published→program、pending→waiting、venues に行が無く他の会場にはある→none、venues 0行→before）
- [ ] **T7 DayTabs とトップの明日タブ**（`src/components/race/DayTabs.jsx` 新規、`VenueGridPage.jsx`）
  - `?day=tomorrow` で明日。初期は本日。明日タブを開くまで明日のデータを取らない
  - `TomorrowPublishNotice`（公開前 / 公開途中 n/m / 全公開は非表示）
- [ ] **T8 VenueGridCard の明日の状態**（`VenueGridCard.jsx` 拡張）
  - program（グレード・節名・日次・1R締切予定、リンク `/tomorrow/:venueCode`）/ waiting「出走表準備中」/ none「明日開催なし」＋次開催日（BOA-225）
- [ ] **T8b DataRaceTable の表示部分の切り出し**（`DataRaceTableView`）
  - 当日の DOM（クラス・id・順序）を変えない。`.drt-` を参照する E2E 5本（layout・race-detail-wide-screen・smoke・race-detail-mobile-table・flying-late-badge）が通ること（plan.md §8 の12）
  - `buildBasicIndicatorRows` に除外する行の key、View に `linkRows: false`、バッジを非リンクで出す引数（§8 の3。既定は今のまま）
  - `useTomorrowAnalysisData`（plan.md §4.0・§8 の各行を racer_id・艇番で、会場の全レース分まとめて取得。モーターは会場単位の一括取得と集計式の純関数化（§8 の4）、全艇0なら再計算しない（§8 の5）、players・モーター行の組み立ての純関数と再現テスト（§8 の8・9）、今節の前走は groupIntoMeetBeforeRace（§8 の10）、`fetchAllByIn`（§8 の11））
- [ ] **T9 明日の出走表ページ**（`src/pages/TomorrowProgramPage.jsx` 新規、ルート `/tomorrow/:venueCode`。各レースは見出し＋ `DataRaceTableView`＋表の下の案内）
  - 前日時点の注記（Last-Modified の時刻、JST）、12R、選手名は racer_profiles の正式名（未登録は B の名前）、`translate="no"`、モーター0の実績なしは BOA-702 の規則
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
