# 選手検索フィルタ拡張・選手一覧ページ タスク分解

`spec.md`・`screens.md`・`plan.md`（[ADR-0043](../../adr/0043-racer-grade-win-rate-cache-strategy.md)）に基づく実装タスク。依存順に並べる。各タスクは目安として1コミット〜1PR相当。

## データ層

- [x] **T1: DBマイグレーション適用**（`054_racer_grade_cache_table.sql`・`055_get_latest_racer_grades_rpc.sql`）
  Supabase Dashboard > SQL Editorで適用する（`055`の`CREATE INDEX CONCURRENTLY`はトランザクション外・単独実行が必須）。適用後、`get_latest_racer_grades()`を試しに1回呼び出し、選手数分（約1,627行）返ることを確認する

- [x] **T2: 級別・勝率キャッシュ夜間バッチの新設**（`scripts/daily/update-racer-grade-cache.js`）
  `get_latest_racer_grades()`を呼び出し`racer_grade_cache`へupsertするスクリプトを`update-race-history-cache.js`と同じ構成で実装。`.github/workflows/calculate-accuracy.yml`に1ステップ追加。ローカルで一度手動実行し、`racer_grade_cache`に実データが入ることを確認する（T4以降のUI実装がこのデータに依存するため、モックデータで進めず実データを先に用意する）

- [x] **T3: サービス層の拡張**（`src/services/supabaseDataService.js`）
  `getAllRacersLite()`のselect列に`registration_period`/`hometown`/`birth_date`を追加。`getRacerGradeCache()`（新規）と`getAllRacersWithGrade()`（新規、両者をマージ）を追加。T1・T2完了後、実データで動作確認する
  **副産物**: `getAllRacersLite()`が`.range()`ページネーション無しで実装されており、Supabaseのデフォルト1000件制限により全1,627選手中1,000人しか返さない（約4割が検索対象外）既存バグを発見・修正した（PR #578以来の潜在バグ）

## 共通コンポーネント（FR1・FR2で共有）

- [x] **T4: フィルタ入力コンポーネント一式の新規作成**（`src/components/racer/`）
  `BranchFilterSelect.jsx`・`RangeFilterInput.jsx`（身長・体重で共用）・`GradeFilterChips.jsx`・`RegistrationPeriodFilterSelect.jsx`・`HometownFilterSelect.jsx`。個々は小さいプレゼンテーショナルコンポーネントのため1タスクにまとめる。T3のマージ済みデータ形状を前提に、選択肢（支部一覧・登録期一覧・出身地一覧）は呼び出し側から渡す設計にする（コンポーネント自体はデータ取得しない）

## FR1: ヘッダー選手検索へのフィルタ追加

- [ ] **T5: `RacerSearchBox.jsx`へのフィルタ統合**
  T3の`getAllRacersWithGrade()`に差し替え、T4のフィルタコンポーネントをパネル内に追加。名前入力とのAND条件ロジックを実装。既存の正規化・部分一致・キーボード操作（↑↓+Enter）・8件表示制限等は変更しない
  受入基準: spec.md FR1の受入基準（支部・身長・体重・級別・登録期・出身地の単独/組み合わせ検索、名前とのAND条件）

- [ ] **T6: `RacerSearchBox.jsx`パネルから`/racers`への誘導リンク追加**（FR7の一部）
  T5完了後、パネル下部にリンクを追加（T11のルート追加後にリンク先が実在する状態になるため、リンク自体はT11と前後してもよいが実装はT5と同じPRにまとめて問題ない）

## FR2・FR5: 選手一覧ページ本体

- [ ] **T7: `RacerTable.jsx`（デスクトップ用ソート可能テーブル）の新規作成**
  選手名・支部・身長・体重・級別・登録期・出身地・勝率・年齢の列、`<th>`クリックでソート方向トグル、行クリックで`/racer/:racerId`へ`<Link>`遷移。登録期は数値抽出コンパレータでソートする専用ロジックを実装（spec.md FR2「100期」問題への対応）。年齢は`birth_date`から算出

- [ ] **T8: `RacerCompactRow.jsx`（モバイル用折りたたみ行）の新規作成**
  行本体は`<Link>`（選手ページへ遷移）、▼アイコンは`onClick`で`preventDefault`+`stopPropagation`し展開状態を独立してトグル。展開時に身長・体重・登録期・出身地・年齢を表示。モックアップで確定したタップ領域分離（[選手検索・一覧モック](https://claude.ai/code/artifact/1c1c9fc1-3ad3-422b-bf8c-5014ca17007d)参照）を再現する

- [ ] **T9: `RacerListPagination.jsx`（ページ番号方式ページネーション）の新規作成**
  50件/ページ、現在ページ強調表示、前後ページ・省略記号（…）表示に対応

- [ ] **T10: `RacerFilterToolbar.jsx`（一覧ページ用フィルタツールバー）の新規作成**
  T4の5コンポーネントを一覧ページ用の横並びレイアウトで束ねる。フィルタ状態自体は`RacersPage.jsx`（T11）から受け取る

- [ ] **T11: `RacersPage.jsx`本体の新規作成 + ルーティング追加**
  T3のデータ、T7・T8・T9・T10を統合。`useSearchParams`でフィルタ・ソート・ページ状態をURLと同期（FR4）。480px以下でT8（折りたたみ行）、それ以外でT7（テーブル）を出し分ける（FR5）。`src/AppRouter.jsx`に`/racers`ルートを`racer/:racerId`と同じパターン（ja専用、`TRANSLATED_PATHS`未登録）で追加
  受入基準: spec.md FR2・FR4・FR5の受入基準一式

## FR7（残り）・FR6

- [ ] **T12: `Header.jsx`ハンバーガーメニューへの「選手一覧」リンク追加**（FR7の残り）
  既存の`submenu-item`パターンをそのまま踏襲

- [ ] **T13: sitemap登録**（FR6）
  `scripts/generate-sitemap.js`の`staticPages`に`/racers`を追加。`npm run verify:sitemap`がパスすることを確認

## 検証・仕上げ

- [ ] **T14: 動作確認一式**
  `npm run build`・`npm run test:e2e`（`Header`・`RacerSearchBox`変更を伴うため必須）を実行し、既存スモークテストが通ることを確認。新規主要導線（`/racers`）としてスモークテストに簡単な到達確認を追記する。ライト/ダーク両テーマでのコントラスト確認（axe-core）。モバイル幅（320px〜480px）での折りたたみ行の展開/折りたたみ・タップ領域分離の実機（Playwright）確認
