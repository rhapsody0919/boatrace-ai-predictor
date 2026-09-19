# 画面・コンポーネント洗い出し

対応spec: [spec.md](./spec.md)

FR-1（BOA-284、`course_entry_tendency`集計切り替え）とFR-2（自前計算関数）は画面変更を伴わないデータ・分析機能のため、本ドキュメントの対象外（`/step2`で扱う）。以下はFR-3〜FR-5のUI機能のみを対象にする。

## 影響する画面・コンポーネント

### FR-3: レース出走表への統合

#### 1. `src/components/race/raceIndicators.jsx`（既存コンポーネントの拡張）

データ出走表（転置マトリクス、行=指標・列=艇番）の指標定義が集約されているファイル。既存の`courseRate`行（468行目付近、`key: "courseRate"`、`tab: "attackdefense"`）と同じ形式で、新規行`maezuke`（枠なり率）を追加する。UIモック v4（2026-09-19了承）では、各セルに「値・走数・会場平均」の3段とタグ（全国値/参考/動く傾向）を表示する。掲載場所自体は[BOA-348](https://linear.app/boat-ai/issue/BOA-348)で見直すため暫定。

```js
{
  key: "maezuke",
  label: t("dataTable.rowMaezuke"),
  shortLabel: t("review.cols.maezuke"),
  tab: "maezuke",  // FR-5で新設するタブキー（後述）と一致させる
  best: null,
  render: (p) => {
    const cell = resolveCourseEntryCell({ venueEntry, nationalEntry, baselineEntry, waku: p.number });
    /* cell = { value, n, source: "venue"|"national", isReference, tags[], baselinePct } */
  },
}
```

値の解決とタグ判定は新規の純関数`src/components/race/courseEntryCell.js`の`resolveCourseEntryCell`に集約し、FR-5と共有する（3画面のうち2画面で同じ判定が必要なため、`.claude/rules/component-reuse.md`の「2箇所以上で使うUIパターンは共通化」に従う）。`venueEntry`は`racerStats.course_entry_tendency.venues[今日の会場][waku]`、`nationalEntry`は`.all[waku]`、`baselineEntry`は`venues.course_entry_baseline.waku[waku]`。BOA-293の`venue_entry_course_stats`は使わない。

#### 2. `src/components/race/DataRaceTable.jsx`（変更不要）

行定義を`raceIndicators.jsx`から読み込んで描画する設計のため、新規行を追加するだけで自動的に表示される。コード変更は不要。

#### 3. `src/components/race/termHints.js`（既存ファイルの拡張）

各指標のツールチップ文言を集約するファイル。既存の`courseRate`エントリ（「そのコースから進入した際の過去の勝率です」）と同じ形式で`maezuke`エントリを追加する。

#### 4. `src/locales/{ja,en,zh-TW,ko}/common.json`（4言語i18nキー追加、**spec.mdに未記載だった制約**）

`raceIndicators.jsx`の`label`/`shortLabel`は`t("dataTable.rowCourseRate")`のように`react-i18next`経由で取得しており、レース詳細ページ（`/race/:raceId`）自体が`TRANSLATED_PATHS`（`src/config/languages.js`）に含まれる4言語翻訳対象と確認した。既存の`dataTable.rowCourseRate`/`review.cols.courseRate`と同じキー命名で`dataTable.rowMaezuke`/`review.cols.maezuke`を**4言語同一PRで**追加する必要がある（`.claude/CLAUDE.md`の「新機能・新ページ追加時の多言語化」ルール、および`docs/reference/i18n-glossary.md`準拠）。

### FR-4: 選手ページ（概要バッジ＋詳細セクション）

#### 5. `src/components/racer/RacerCourseEntryBadge.jsx`（新規コンポーネント）

`RacerGradeBadge.jsx`（`src/components/racer/RacerGradeBadge.jsx`）と同じ設計方針（stateless、propsで判定結果を受け取り表示するだけ）で新規作成する。

```jsx
function RacerCourseEntryBadge({ tendency }) {
  if (!tendency || !tendency.isNotable) return null;
  return <span className={`racer-course-entry-badge racer-course-entry-${tendency.level}`}>{tendency.label}</span>;
}
```

判定ロジック（`tendency.level`/`label`の算出）はコンポーネント内に持たず、`supabaseDataService.js`側の関数（後述）が返す形にする（既存`RacerGradeBadge`が`grade`という既に確定した値を受け取るだけなのと同じ設計）。

#### 6. `src/components/racer/RacerCourseEntryBadge.css`（新規CSS）

`RacerGradeBadge.css`と同じ設計トークン利用パターン（`var(--radius-sm)`・`var(--font-size-xs)`・`color-mix()`によるトーン合成）を踏襲する。**RacerGradeBadge.css冒頭のコメント「レースのグレード（`--color-grade-sg`等）とは意味が異なるため転用せず、選手級別用の配色を新規に定義する」と同じ考え方で、前づけ傾向用の新規配色トークンを定義する**（グレードバッジの配色を転用しない）。

#### 7. `src/components/racer/RacerPerformanceStats.jsx`（既存コンポーネントの拡張）

選手ページ（`/racer/:racerId`）の成績・調子セクション本体（PR #686でADR-0063の常時表示構成に改修済み、1043行）。

**実機確認済みの構成（2026-09-16、`http://localhost:5173/racer/4444`で確認）**:
```
成績・調子（見出し）
フィルタ（会場・枠番・グレード・レース種別）
.racer-stat-cards-grid（517行目〜）: 「選手調子（全国勝率）」「平均ST」の2カード
全国勝率・当地勝率の推移（グラフ、577行目〜）
会場別成績・枠番別成績のクロス集計テーブル（フィルタの固定状況で表示切り替え）
  ※「枠番別成績（全会場計）」テーブルには既存の脚注として
    「実際の進入コース変化（前づけ）は現時点では区別できないため、
    発走前に決まる枠番（艇番）基準で表示しています」という注記がある（641行目）。
    本FRはまさにこの制約を解消するデータを追加する
枠番別回収率（過去180日、748行目）
決まり手傾向（常時表示、866行目）
展示タイムの推移（常時表示、892行目）
STの推移（常時表示、920行目）
レース一覧（常時表示・ページングあり、948行目）
```

- **概要バッジの追加**: `.racer-stat-cards-grid`（「選手調子（全国勝率）」「平均ST」の2カード、517行目）に、`RacerCourseEntryBadge`を追加する（新規カードとして追加するか、既存カードの隅に配置するかは実装時に決める）
- **詳細セクションの追加**: 「決まり手傾向」（866行目）・「展示タイムの推移」（892行目）・「STの推移」（920行目）・「レース一覧」（948行目）と同じ並び（同じ`vcData`ベースのフィルタ連動パターン）に、新規セクション「進入コース遷移傾向」を追加する。既存4セクションと同じ`h3`見出し＋条件付きレンダリングの構造を踏襲する。挿入位置は「STの推移」と「レース一覧」の間を推奨（詳細な生データ一覧の直前に置くことで、集計→個別データという情報の流れを保つ）。セクションの中身（UIモック v4）は、枠番ごとに「進入したコースの内訳（1〜6コースの積み上げバー、色は艇番カラーと同じ）・枠なり率（走数）・会場平均」を1行ずつ並べ、5走未満は薄字＋「参考」タグ、0走は「データなし」、会場平均より20pt以上低い枠番は「動く傾向」タグを付ける。会場フィルタが「全会場」のときの会場平均は24会場の合算。データは`aggregateRacerCourseEntryStats()`（クライアント集計、追加通信なし）と会場平均（`venues.course_entry_baseline`）
- **既存脚注の扱い**: 「枠番別成績（全会場計）」テーブルの脚注（641行目）は、実際の進入コースが区別できるようになった後も、このテーブル自体は引き続き枠番（艇番）基準の集計のため、脚注の文言修正は本FRのスコープに含めない（テーブルの集計軸を変える話ではなく、別セクションとして新データを追加する話のため）

（初回のscreens.md作成時、本worktreeがPR #686マージ前の古いコードを参照していたため「レース一覧セクションが見当たらない」という誤った記載をしていた。`git merge origin/master`でコードを最新化し、実機確認の上で訂正した）

#### 8. `src/components/racer/RacerPerformanceStats.css`（既存CSSの拡張）

新規セクションのレイアウトは既存の決まり手傾向・推移セクションのクラス（`.racer-technique-profile`等）を流用する。新規CSSはバッジ配置の微調整程度に留める見込み。

### FR-5: 分析タブ新設（`/winning-technique`）

#### 9. `src/components/analysis/RacerMaezukeChart.jsx`（新規コンポーネント）

`RacerTechniqueProfileChart.jsx`（`src/components/analysis/RacerTechniqueProfileChart.jsx`、337行）と同じ設計パターンで新規作成する:
- 会場セレクタ（`selectedVenue`）→ レースセレクタ（`selectedRace`）→ 出走選手の傾向一覧（`breakdown`）という3段階の状態遷移
- 出走6選手の`racer_aggregated_stats`（`venue_code=0`）と会場平均（`venues.course_entry_baseline`）から、FR-3と同じ`resolveCourseEntryCell`で表示する（新規RPCは作らない）
- 会場平均の表（全24会場の2〜6枠の枠外進入率、江戸川も表示する。枠外進入率0.0%は実態）を同タブ内に追加する
- URLクエリパラメータ（`initialVenueCode`/`initialRaceId`）を受け取る既存パターンを踏襲する（`RaceCard.jsx`等からのディープリンクに対応するため）

#### 10. `src/components/analysis/RacerMaezukeChart.css`（新規CSS、または既存`MotorConditionChart.css`等の流用）

`RacerTechniqueProfileChart.jsx`が`MotorConditionChart.css`を流用している例にならい、既存の分析タブ共通CSSの流用を優先する。新規CSSは表要素の列構成差分のみに留める。

#### 11. `src/components/analysis/index.js`（バレルエクスポートの追加）

`export { default as RacerMaezukeChart } from "./RacerMaezukeChart";` を追加する。

#### 12. `src/pages/WinningTechniqueAnalysis.jsx`（既存コンポーネントの拡張）

- `TAB_KEYS`配列（29行目付近）に`"maezuke"`を追加
- import文に`RacerMaezukeChart`を追加
- `{activeTab === "maezuke" && <RacerMaezukeChart />}`のレンダー分岐を追加
- 必要であれば`BLOG_LINKS`（ja専用の解説記事リンクマップ）にエントリを追加するか判断する（未確定、/step2）

#### 13. `src/locales/{ja,en,zh-TW,ko}/common.json`（4言語i18nキー追加、spec.md記載済み制約の再掲）

新規タブのラベル・説明文を4言語で追加する（`docs/reference/i18n-glossary.md`準拠、用語「前づけ」の訳語が未確定の場合は先にglossaryへ追記してから翻訳する）。

## 共通: データ取得関数（FR-3/FR-4/FR-5で共用）

### 14. `src/services/supabaseDataService.js`（既存ファイルの拡張）

[plan.md](./plan.md)のとおり、選手側は既存基盤の拡張のみで、新規のフロント向け取得関数は最小限にする。

- `getRacerRaceHistory()`（拡張）: `race_results`のselect列に`actual_course_1〜6`を追加し、行に`actualCourse`を追加（FR-4詳細セクション用）
- `aggregateRacerCourseEntryStats(history, venueCode, boatNumber, raceGrade, raceStage)`（新規・純関数）: 4軸フィルタで絞り込み、枠番ごとに`{ n, courses }`を返す（FR-4詳細セクション用）
- 会場平均の取得関数（新規）: `venues.course_entry_baseline`を全会場分1回で取得しキャッシュ（FR-3・FR-4・FR-5共用）
- 出走表（FR-3）と分析タブ（FR-5）の選手側データは、既存の`racerStatsMap`（`racer_aggregated_stats`の`venue_code=0`の行）から取得する。取得経路の変更は無い

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

| 部分 | 対応 |
|---|---|
| 概要バッジ（FR-4） | 新規CSS必要（`RacerGradeBadge.css`と同パターンだが配色トークンは新規定義） |
| 選手ページ詳細セクション（FR-4） | 既存`.racer-technique-profile`等のセクションレイアウトをそのまま使う |
| データ出走表の新規行（FR-3） | 新規CSS少量（既存`.drt-value`/`.drt-sub`のセルスタイルを使い、タグ3種（全国値/参考/動く傾向）と薄字のみ追加） |
| 分析タブ新規コンポーネント（FR-5） | 既存`MotorConditionChart.css`等の流用を優先、表列構成差分のみ新規CSS |

## コンポーネント再利用チェックリスト（`.claude/rules/component-reuse.md`準拠）

- [x] 同じ判定（解決順・タグ）がデータ出走表と分析タブの2画面で必要になるため、`courseEntryCell.js`の純関数に集約し、表示コンポーネントのみ画面ごとに分ける方針とした（表示形式が画面ごとに大きく異なるため、表示コンポーネント自体の共通化はしない）
- [x] 新規コンポーネント（`RacerCourseEntryBadge.jsx`・`RacerMaezukeChart.jsx`）は`src/components/racer/index.js`・`src/components/analysis/index.js`のbarrel exportに追加する
- [x] 既存パターン（`RacerGradeBadge.jsx`・`RacerTechniqueProfileChart.jsx`・`raceIndicators.jsx`の行追加）をそれぞれ踏襲し、新規デザインパターンは発明しない
