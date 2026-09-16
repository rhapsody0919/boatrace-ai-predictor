# 画面・コンポーネント洗い出し

対応spec: [spec.md](./spec.md)

FR-1（BOA-284、`course_entry_tendency`集計切り替え）とFR-2（自前計算関数）は画面変更を伴わないデータ・分析機能のため、本ドキュメントの対象外（`/step2`で扱う）。以下はFR-3〜FR-5のUI機能のみを対象にする。

## 影響する画面・コンポーネント

### FR-3: レース出走表への統合

#### 1. `src/components/race/raceIndicators.jsx`（既存コンポーネントの拡張）

データ出走表（転置マトリクス、行=指標・列=艇番）の指標定義が集約されているファイル。既存の`courseRate`行（468行目付近、`key: "courseRate"`、`tab: "attackdefense"`）と同じ形式で、新規行`maezuke`（前づけ傾向）を追加する。

```js
{
  key: "maezuke",
  label: t("dataTable.rowMaezuke"),
  shortLabel: t("review.cols.maezuke"),
  tab: "maezuke",  // FR-5で新設するタブキー（後述）と一致させる
  best: bestOf(cand.maezuke),
  render: (p) => { /* 対象10会場は会場サイトデータ優先、それ以外はFR-2自前計算値 */ },
}
```

新規コンポーネントは不要（既存の指標追加パターンで完結、`.claude/rules/component-reuse.md`準拠）。

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

選手ページ（`/racer/:racerId`）の成績・調子セクション本体（PR #686でADR-0063の常時表示構成に改修済み、690行）。

- **概要バッジの追加**: 236行目付近の`.racer-stat-cards-grid`（「選手調子（全国勝率）」「平均ST」の2カード）に、`RacerCourseEntryBadge`を追加する（新規カードとして追加するか、既存カードの隅に配置するかは実装時に決める）
- **詳細セクションの追加**: 581行目「決まり手傾向」・629行目「展示タイムの推移」・657行目「STの推移」と同じ並び（同じ`vcData`ベースのフィルタ連動パターン）に、新規セクション「進入コース遷移傾向」を追加する。既存3セクションと同じ`h3`見出し＋条件付きレンダリングの構造を踏襲する

**要確認事項（screens.md作成時に判明した差異）**: PR #686のSummary本文・設計ドキュメント（`docs/design/racer-stats-drilldown/screens.md`）には「レース一覧」セクション（日付/会場/R/着順等の表形式、ページングあり）の記載があったが、実際にマージされた`RacerPerformanceStats.jsx`を確認したところ該当セクションが見当たらなかった（`getRacerRaceHistory`の呼び出しは残っているが、決まり手・推移チャートの集計元として使われているのみ）。新規セクションの挿入位置は「決まり手傾向」〜「STの推移」の並びを基準にし、この差異自体は本FRのスコープ外として/step2着手前に別途確認する（実装漏れの可能性、または意図的な変更の可能性の両方がありうる）。

#### 8. `src/components/racer/RacerPerformanceStats.css`（既存CSSの拡張）

新規セクションのレイアウトは既存の決まり手傾向・推移セクションのクラス（`.racer-technique-profile`等）を流用する。新規CSSはバッジ配置の微調整程度に留める見込み。

### FR-5: 分析タブ新設（`/winning-technique`）

#### 9. `src/components/analysis/RacerMaezukeChart.jsx`（新規コンポーネント）

`RacerTechniqueProfileChart.jsx`（`src/components/analysis/RacerTechniqueProfileChart.jsx`、337行）と同じ設計パターンで新規作成する:
- 会場セレクタ（`selectedVenue`）→ レースセレクタ（`selectedRace`）→ 出走選手の傾向一覧（`breakdown`）という3段階の状態遷移
- `supabaseDataService`から新規関数（例: `getRaceMaezukeBreakdown(selectedRace)`）を呼び出す
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

FR-2（`scripts/analysis/`または新規`scripts/lib/`側の集計ロジック）の結果を返すフロントエンド向け関数を追加する。既存の`aggregateRacerCrossStats`（PR #686で追加済み）と同じ「バックエンド集計ロジックをサービス層経由でフロントに渡す」設計を踏襲する。

- `getRacerCourseEntryTendency(racerId)`: 全国集計版（FR-4概要バッジ用）
- `getRacerCourseEntryTendencyFiltered(racerId, {venueCode, boatNumber, grade, stage})`: フィルタ対応版（FR-4詳細セクション用）
- `getTodayMaezukeIndicator(raceId)`: 今日のレースの出走6艇分、対象10会場は`venue_entry_course_stats`優先・それ以外はFR-2自前計算値を返す（FR-3用）
- `getRaceMaezukeBreakdown(raceId)`: FR-5タブ用（`getTodayMaezukeIndicator`とほぼ同じ形だが、分析タブは過去レースも選択可能なため独立関数とする）

具体的な入出力の型・SQLクエリ設計は`/step2`（システム設計）で確定する。

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

| 部分 | 対応 |
|---|---|
| 概要バッジ（FR-4） | 新規CSS必要（`RacerGradeBadge.css`と同パターンだが配色トークンは新規定義） |
| 選手ページ詳細セクション（FR-4） | 既存`.racer-technique-profile`等のセクションレイアウトをそのまま使う |
| データ出走表の新規行（FR-3） | 新規CSS不要（既存`.drt-value`/`.drt-sub`等のセルスタイルをそのまま使う） |
| 分析タブ新規コンポーネント（FR-5） | 既存`MotorConditionChart.css`等の流用を優先、表列構成差分のみ新規CSS |

## コンポーネント再利用チェックリスト（`.claude/rules/component-reuse.md`準拠）

- [x] 同じUIパターンが複数箇所（データ出走表・選手ページ・分析タブ）に必要になるため、判定ロジック・データ取得は`supabaseDataService.js`に集約し、表示コンポーネントのみ画面ごとに分ける方針とした（表示形式が3画面で大きく異なるため、表示コンポーネント自体の共通化はしない）
- [x] 新規コンポーネント（`RacerCourseEntryBadge.jsx`・`RacerMaezukeChart.jsx`）は`src/components/racer/index.js`・`src/components/analysis/index.js`のbarrel exportに追加する
- [x] 既存パターン（`RacerGradeBadge.jsx`・`RacerTechniqueProfileChart.jsx`・`raceIndicators.jsx`の行追加）をそれぞれ踏襲し、新規デザインパターンは発明しない
