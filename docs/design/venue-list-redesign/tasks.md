# 開催場一覧ページ再設計 tasks

`docs/design/venue-list-redesign/`の`spec.md`・`screens.md`・`plan.md`、`docs/adr/0026-venue-list-redesign-url-structure.md`を元にタスク分解する。依存順に並べる。`/step4`で1つずつ実装する。

## タスク一覧

- [x] **T1. RPC拡張: `get_today_races`/`get_predictions_by_date`/`get_predictions_by_date_light`に開催日目情報を追加**（2026-08-28完了）
  - Supabase上の現行デプロイ済み定義を取得し、`race_conditions`のLEFT JOINを追加した`CREATE OR REPLACE FUNCTION`を`docs/db-migration/038_add_series_day_to_race_rpcs.sql`として作成、ユーザーがSupabase Dashboardで適用済み
  - レース単位のJSONに`seriesDay`/`isFinalDay`/`raceTitle`を追加（既存フィールドは変更なし、`pg_get_functiondef`で3関数とも反映を確認済み）
  - **判明した問題**: `seriesDay`/`isFinalDay`は実データが0件（スクレイパー未実装）。[BOA-226](https://linear.app/boat-ai/issue/BOA-226)に切り出し、今回は`raceTitle`のみ利用する（spec.md FR-1参照）

- [x] **T2. `supabaseDataService.js`のレスポンスマッピング拡張**（2026-08-28完了）
  - `transformEdgeResponse`（Edge API経由のgetPredictions用）に`raceTitle`/`seriesDay`/`isFinalDay`を追加
  - `getRaces()`・`getPredictions()`のSupabase直接クエリフォールバックに`race_conditions`のネスト select（`series_day`/`is_final_day`/`race_title`）を追加し、レスポンスにマッピング
  - `getRaces()`のEdge APIパスは`...race`スプレッドで自動的にフィールドが通るため変更不要
  - **検証**: ローカルでVite devサーバーを起動（本番Edge Functionが無いためSupabase直接クエリのフォールバック経路を通る）、`npm run build`成功、ブラウザで`/`の既存UIが正常表示されることを確認（リグレッション無し）。`dataService.getRaces()`/`getPredictions()`を直接呼び出し、`raceTitle: "第７２回ボートレースメモリアル"`等の実データが返り、`seriesDay`/`isFinalDay`はスクレイパー未対応のため`null`（想定通り、BOA-226で対応）であることを確認

- [x] **T3. 時間帯アイコン判定ユーティリティの新規実装**（2026-08-29完了）
  - `src/utils/raceTimeOfDay.js`新規作成。1R発走時刻からモーニング/デイ/サマータイム/ナイター/ミッドナイトを近似判定（境界: 9:30/11:15/14:00/16:30）
  - 公式の開催区分ラベルはDBに無いため発走時刻からの近似（ユーザー承認済み）。2026-08-28実データ（桐生ナイター1R14:57、平和島サマータイム1R11:48等）と一致することを確認
  - node単体テスト15ケースALL PASS

- [x] **T4. `VenueGridCard`/`VenueGrid`コンポーネントの新規実装**（2026-08-29完了）
  - `src/components/race/VenueGrid(.jsx/.css)`・`VenueGridCard(.jsx/.css)`新規作成、barrel export追加
  - 開催中/非開催の出し分け、グレードバッジ（`GRADE_CONFIG`流用）、時間帯アイコン、大会名（`raceTitle`、`translate="no"`付き）、次レース時刻を表示
  - バッジ行に`min-height`を確保しBOA-222のバッジ後付けでレイアウトシフトが起きない構造にした
  - i18nキー`venueGrid.*`を4言語同時追加、時間帯用語はglossaryに追記済み

- [x] **T5. `VenueGridPage`実装 + `/`ルートを新UIに差し替え**（2026-08-29完了、T9と同時実装）
  - `src/pages/VenueGridPage(.jsx/.css)`新規作成。本日（`TodayVenueGridPage`、`getRaces()`使用）と過去日付（`PastVenueGridPage`、`getPredictions()`をグループ化）を1ファイルで提供
  - `/`のUpdateStatus・IntroBanner・ブログプレビュー・メタタグは旧App.jsxから移植
  - ブラウザ実機確認: 24会場固定表示・開催中/非開催出し分け・時間帯アイコン（桐生🌙/三国⏰/平和島☀️）・SG/G3バッジが実データと一致

- [x] **T6. `VenueRaceListPage`実装 + `/venue/:venueCode`ルート新設**（2026-08-29完了）
  - `src/pages/VenueRaceListPage(.jsx/.css)`新規作成。`useDatePredictions`フック（新規、RaceDetail.jsxの2段階ロードを共通化）でデータ取得し`venueCode`でフィルタ
  - 既存`RaceCard.jsx`を流用（締切時刻表示を追加拡張。`race.startTime`があるときのみ表示のためRaceDetail等の既存利用箇所に影響なし）
  - 不正な`venueCode`は会場一覧へリダイレクト

- [x] **T7. `RaceDetailPage`実装 + `/race/:raceId`ルート新設**（2026-08-29完了）
  - `src/pages/RaceDetailPage(.jsx/.css)`新規作成。`parseRaceId`（`src/utils/raceId.js`に追加）で日付をパースし`useDatePredictions`で取得→フィルタ
  - 既存`PredictionSection`をそのまま流用。本日のみ分析ツールリンク表示
  - ブラウザ実機確認: 直接URLアクセス（本日・過去日付とも）でデータ出走表・AI分析・レース結果・振り返りが表示される

- [x] **T8. `RaceBottomNav`/`RaceNavCard`のnavigateベース化**（2026-08-29完了）
  - コンポーネント自体は変更不要だった（元々コールバックprops設計）。`RaceDetailPage`から`onNavigate`/`onVenueChange`に`useNavigate`ベースの関数を渡す形で実現
  - DOM確認: 前後レースボタン・会場切替ピルが描画される

- [x] **T9. 過去日付対応: `/races/:date`のグリッド化 + `/races/:date/:venueCode`ルート新設**（2026-08-29完了、T5と同時実装）
  - `AppRouter.jsx`で`/races/:date`→`VenueGridPage`、`/races/:date/:venueCode`→`VenueRaceListPage`に接続
  - ブラウザ実機確認: `/races/2026-08-28`で24枠中12会場開催・大会名（「第７２回ボートレースメモリアル」等）表示、`/race/2026-08-28-01-01`で結果・振り返り表示

- [x] ~~T10. 日程タブ実装~~ — **今回のスコープから除外**（2026-08-28）。`series_day`/`is_final_day`が実データ0件と判明したため、[BOA-226](https://linear.app/boat-ai/issue/BOA-226)（スクレイパー実装）に切り出した。RPCのフィールド自体はT1で追加済み（常にnull）

- [x] **T11. i18n対応（4言語）**（2026-08-29完了）
  - `venueGrid.*`/`venueRaceList.*`/`raceDetailPage.*`キーを4言語同時追加。時間帯用語（モーニング/サマータイム/ナイター/ミッドナイト）・「本日開催なし」は`docs/reference/i18n-glossary.md`に追記してから翻訳
  - `TRANSLATED_PATHS`に`/venue`・`/race`プレフィックスを追加（`/races/:date`系は既存通りja専用のまま）
  - 会場名は`venues.*`キー使用、大会名に`translate="no"`付与
  - ブラウザ実機確認: `/en/venue/1`で英語タイトル・パンくず・「14:57 JST」（JST付記）表示

- [x] **T12. sitemap対応**（2026-08-29完了）
  - `staticPages`に`/venue/1〜24`（ja）、`LOCALIZED_PAGES`に同24件（3言語分）を追加
  - `getRacePages()`を拡張し`/races/:date/:venueCode`を直近7日ウィンドウで生成
  - `/race/:raceId`はsitemap非対象（generate-sitemap.jsにBOA-84の教訓をコメントで明記。verify-sitemapはパラメータ付きルートを検査対象外とするため`EXPECTED_EXCLUSIONS`への登録は不要だった）
  - `npm run verify:sitemap`パス（masterから引き継いだ`/admin/sns-hub`の登録漏れも`EXPECTED_EXCLUSIONS`追加で解消）

- [x] **T13. 旧実装のクリーンアップ**（2026-08-29完了）
  - `VenueSelector.jsx`削除（参照ゼロ確認済み）、barrel exportから除去
  - `App.jsx`を884行→タブシェルのみ（hit-races/accuracy/privacy/terms/contact）に縮小。races タブ・分析セクション・ブログプレビュー（VenueGridPageへ移設）を除去
  - `RaceDetail.jsx`削除。`RaceDetail.css`は新ページ群がレイアウトを流用するため残置（VenueGridPageからimport）
  - `HitRaces.jsx`の的中レースタップ遷移を`analyzeRace`+`navigate("/")`から`/race/:raceId`直接遷移に変更（propsから`allVenuesData`/`analyzeRace`を除去）

- [ ] **T14. e2eスモークテスト追加・既存テスト修正**
  - `e2e/smoke.spec.js`に新規主要導線（会場一覧→レース一覧→詳細、`/`・`/venue/:code`・`/race/:raceId`・`/races/:date`系）を追加
  - 既存30件超のテストがルーティング変更に追随することを確認（`npm run test:e2e`）

- [ ] **T15. ビルド・検証・ブログ記事**
  - `npm run build`でビルドエラー無しを確認
  - `.claude/CLAUDE.md`の「新機能リリース時のブログ記事ルール」に従い紹介記事1本を作成（1機能1記事、スクリーンショット・FAQ付き）。note/X下書きも同時生成
  - `/code-review`でセルフレビュー→指摘修正→PRコメント記載

## 依存関係の補足

- T1→T2は必須の順序。T3は独立して先行実装可
- T4はT3に依存（時間帯アイコンを使うため）
- T5〜T9は「本日→過去日付」の順で段階的に動く状態を保ちながら進める（T5完了時点で`/`は新UIで動作する）
- T10〜T12は並行して進めてよい（互いに依存しない）
- T13（クリーンアップ）はT9完了後、T14（テスト）はT13完了後が望ましい
