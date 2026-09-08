# 選手検索フィルタ拡張・選手一覧ページ 画面・コンポーネント一覧

`spec.md`のFR1〜FR6に対応する画面・コンポーネントの洗い出し。事前調査（`.claude/rules/component-reuse.md`準拠）の結論: **ソート可能テーブル・ページ番号方式ページネーション・複数選択/範囲指定フィルタのいずれも、このリポジトリに既存の再利用可能コンポーネントは無い**（`src/pages/admin/AdminRules.jsx`にソート・ページネーションの類似ロジックがあるが、管理画面専用のprev/nextページネーションでFR2の要件（ページ番号方式）と異なり、汎用コンポーネント化もされていない）。そのため主要な表示コンポーネントは新規作成するが、**支部・身長・体重・級別・登録期・出身地の6フィルタ項目はFR1（ヘッダー）とFR2（一覧ページ）の2箇所で使うため、共通コンポーネント化する**。

## 新規ページ

### `RacersPage.jsx`（`src/pages/`、新規）
`/racers`のページ本体。`useSearchParams`（FR4）でフィルタ・ソート・ページ状態をURLと同期し、フィルタ済み・ソート済み・ページ分割済みのデータを`RacerTable`（デスクトップ）/`RacerCompactRow`一覧（モバイル）に渡す。既存`VenueGridPage.jsx`と同様、`Header`・ページ本体・（必要なら）フッターを含む最上位ページコンポーネントとして新規作成する。ja専用（`TRANSLATED_PATHS`未登録）のため`t()`を使わず日本語文字列を直書きする（既存`RacerProfile.jsx`と同じ方針）。

## 新規共通コンポーネント（FR1・FR2で共有）

`src/components/racer/`配下に追加する（既存の`RacerProfileCard.jsx`等と同じディレクトリ）。

| コンポーネント | 役割 | 備考 |
|---|---|---|
| `BranchFilterSelect.jsx` | 支部の選択式フィルタ（ドロップダウン） | FR1では既存パネル内、FR2ではツールバー内に配置。レイアウトは呼び出し側のCSSで制御し、コンポーネント自体はロジック+最小限のマークアップに留める |
| `RangeFilterInput.jsx` | min/max範囲指定の汎用入力 | **身長・体重の両方で使う**（`label`・`unit`propで差し替え）ため、最初から共通化して作る。DRY原則に合致する明確な2箇所利用ケース |
| `GradeFilterChips.jsx` | 級別（A1/A2/B1/B2）の複数選択チップ | モックアップのチップUIをそのままコンポーネント化 |
| `RegistrationPeriodFilterSelect.jsx` | 登録期の複数選択（ドロップダウン） | 選択肢はDB値（例:「99期」）をそのまま使用。ソート時のみ数値抽出（表示コンポーネントでなくソートロジック側の責務） |
| `HometownFilterSelect.jsx` | 出身地の複数選択（ドロップダウン、47都道府県） | 日本地図UIはBOA-261で別途検討、今回は対象外 |

## 新規コンポーネント（FR2専用）

| コンポーネント | 役割 | 備考 |
|---|---|---|
| `RacerFilterToolbar.jsx`（`src/components/racer/`） | 上記5つの共通フィルタコンポーネントを一覧ページ用の横並びレイアウトで束ねる | `RacersPage.jsx`から状態を受け取るコンテナ。フィルタ自体のロジックは各`*FilterSelect`/`RangeFilterInput`側に閉じ込め、本コンポーネントはレイアウトのみ担当 |
| `RacerTable.jsx`（`src/components/racer/`） | デスクトップ用ソート可能テーブル（選手名・支部・身長・体重・級別・登録期・出身地・勝率・年齢） | `<th>`クリックでソート方向をトグルする。行クリックで`/racer/:racerId`へ`<Link>`遷移（FR2） |
| `RacerCompactRow.jsx`（`src/components/racer/`） | モバイル用の折りたたみ行（FR5） | 行本体は`<Link>`、▼アイコンのみ`onClick`で`e.preventDefault()`+`e.stopPropagation()`し展開状態をトグルする独立ボタンとして実装（スペック確定済みのタップ領域分離） |
| `RacerListPagination.jsx`（`src/components/racer/`） | ページ番号方式のページネーション（1 2 3 … 33） | 既存の管理画面用prev/nextページネーションとは要件が異なるため新規作成。汎用化はせず`/racers`専用として作る（YAGNI、他ページでの利用要求が出た時点で共通化を検討） |

## 既存コンポーネントの拡張（変更あり）

| コンポーネント | 変更内容 |
|---|---|
| `RacerSearchBox.jsx`（`src/components/`） | 新規共通フィルタコンポーネント5つをパネル内に追加（FR1）。既に220行あるため、フィルタ部分は新規共通コンポーネントへの委譲で完結させ、本体ファイルの肥大化を避ける。あわせてパネル下部に`/racers`への誘導リンクを追加する（FR7） |
| `RacerSearchBox.css` | フィルタブロック用のスタイル追加（モックアップの`.filter-block`/`.filter-grid`相当）。デザイントークンで賄える（`--surface-page`/`--border-hairline`/`--radius-sm`/`--font-size-xs`等）。新規CSSが要るのはグリッドレイアウト（`.filter-grid`のcolumn数）とチップの選択状態程度 |
| `Header.jsx` | ハンバーガーサブメニューに「選手一覧」（仮称）へのリンクを追加する（FR7）。既存の`submenu-item`パターン（`<Link to={localize("/xxx")} className="submenu-item">`）をそのまま踏襲する |
| `src/AppRouter.jsx` | `/racers`ルートを追加。`racer/:racerId`と同じパターン（`LocalizedRoutes`内に無条件で追加、`TRANSLATED_PATHS`/`LANGUAGE_ONLY_PATHS`いずれにも登録しないことでja専用として振る舞う）を踏襲 |
| `scripts/generate-sitemap.js` | `staticPages`に`/racers`を追加（FR6、フローA-4準拠） |
| `src/services/supabaseDataService.js` | 一覧取得用の新規関数（フィルタ・ソート・ページングに対応、`withCache`パターン踏襲）とFR3のキャッシュ参照関数を追加。詳細は`/step2`で設計 |

## `/racers`への導線（FR7、確定）
ハンバーガーメニュー・ヘッダー検索パネルの両方に導線を設ける（2026-09-08合意）。

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

- **トークンで賄える**: 配色（`--surface-page`/`--surface-card`/`--border-hairline`/`--text-primary`/`--text-secondary`/`--brand-accent-primary`）、角丸（`--radius-sm`/`--radius-md`/`--radius-lg`）、フォントサイズ（`--font-size-xs`〜`--font-size-xl`）、影（`--shadow-md`）。ライト/ダーク両テーマの出し分けも既存トークンの自動反転に乗るだけで済む
- **新規CSSが必要**: テーブルの列ヘッダのソート矢印表示、折りたたみ行のタップ領域分離（▼ボタンの独立した当たり判定とアニメーション）、級別バッジの配色（`--color-grade-*`はレースのグレード用トークンで意味が異なるため転用しない。選手の級別バッジは新規に定義する）、ページネーションのカレントページ強調スタイル

## 未解決事項
なし（すべてユーザー確認済み）。
