# racer-news-feature 画面・コンポーネント洗い出し

対応: [spec.md](./spec.md)

## 1. 新規ルート

`src/AppRouter.jsx`の`races`/`blog`ブロックに並べて追加する。

```jsx
<Route path="racer/:racerId" element={<RacerProfile />} />
```

- `racer-fortune-telling`の実データ確認で判明した通り、`race_entries.racer_id`と`racer_profiles.racer_id`はどちらもnumber型（結合可能）
- ja専用区分（`.claude/CLAUDE.md`の3区分ルール）のため`TRANSLATED_PATHS`には登録しない。`/en/racer/123`等の言語プレフィックスURLは自動的にja版へリダイレクトされる既存の仕組みがそのまま適用される（追加実装不要）

## 2. 新規ページ: `src/pages/RacerProfile.jsx` + `RacerProfile.css`

最も近い既存パターンは`VenueGuide.jsx`（`VenueGuideDetail`、エンティティのプロフィールページとして構造が酷似）。`BlogPost.jsx`からはMarkdown非使用の要約表示・関連コンテンツカードのパターンを流用する。

### 構成（上から順）

1. **メタ情報ブロック**（React 19の`<title>`/`<meta>`/`<link>`head hoisting、`BlogPost.jsx`と同じ書き方）
   - `<title>`・`<meta name="description">`・`<link rel="canonical">`
   - **新規**: `{!hasIndexableContent && <meta name="robots" content="noindex, follow" />}` — spec.md要件4「検索エンジン露出制御」に対応。既存の`noindex`実装（`Holmes.jsx`/`Poirot.jsx`）は無条件・ハードコードのみで、**条件付きnoindexは本機能が初** [調査で確認済み]
   - Person構造化データ（JSON-LD、`VenueStructuredData.jsx`と同じ形式でPerson用に新規作成: `src/components/RacerStructuredData.jsx`）
2. `<Header />`
3. パンくず: `← 選手一覧` 相当のリンク（`VenueGuide.jsx`の`evg-breadcrumb`パターン踏襲）。**選手一覧ページはspec.mdのスコープに含まれていないため、パンくずの戻り先は暫定的にホームまたは出走表ページとする**（要検討、下記「未解決の論点」参照）
4. **RacerProfileHeader**（新規コンポーネント、名前・支部・級別を大きく表示。ヒーロー相当）
5. **RacerProfileCard**（新規コンポーネント）: `VenueGuide.jsx`の`eg-facts-grid`パターンを流用した基本情報グリッド
6. **RacerNewsList**（新規コンポーネント）: ニュースが無い選手は非表示、または「まだニュースはありません」の空状態表示
7. CTA/戻りリンク（他ページへの導線、`VenueGuide.jsx`末尾のCTAパターン踏襲）

### 表示項目の詳細（spec.md未確定事項の決定）

`racer_profiles`テーブル（racer-fortune-tellingで新規作成済み、1,618/1,637人分のデータが既にDBにある）から取得できる項目のうち、以下を選手個別ページに表示する。

| 項目 | データソース | 表示要否 |
|---|---|---|
| 氏名（`name`/`name_kana`） | `racer_profiles` | 表示（`translate="no"`必須） |
| 生年月日（`birth_date`） | `racer_profiles` | 表示 |
| 支部（`branch`） | `racer_profiles` | 表示（`translate="no"`） |
| 出身地（`hometown`） | `racer_profiles` | 表示（`translate="no"`） |
| 登録期（`registration_period`） | `racer_profiles` | 表示 |
| 身長・体重（`height_cm`/`weight_kg`） | `racer_profiles` | 表示（任意項目、無ければ非表示） |
| 血液型（`blood_type`） | `racer_profiles` | 表示（任意項目） |
| 級別 | **`race_entries`の最新出走時点の値を使う**（`racer_profiles.grade_at_scrape`はスクレイピング時点のスナップショットで、級別は年2回昇降級するため陳腐化する。racer-fortune-telling ADR 0019で既に指摘済みの論点） | 表示 |
| 占いスコア（今日の運勢等） | — | **表示しない**（racer-fortune-telling Step1の検証結果を受け、占いスコアはSNS発信限定でサイトUIには載せない方針。ユーザーとの合意事項） |

- プロフィールが無い選手（`racer_profiles`に行が無い、スクレイピング失敗の10人）はページ自体は表示するが基本情報セクションは「情報がありません」の空状態にする（spec.mdスコープ「全選手ページ自体は作るが、内容が空の選手も多く存在する前提」に対応）

## 3. 選手ニュース候補提示→承認フロー（要件2、実装形態は未確定のまま2案を提示）

spec.mdの未確定事項として`/step2`で決定するとされているが、画面洗い出しの参考として2案を挙げる。

- **案A: 管理画面**（`src/pages/admin/`配下に新規、既存の`AdminRules.jsx`と同じパターン）
  - 単純な「候補リスト＋承認ボタン」構成で、既存パターン（`useState`一覧 + `useEffect`初期ロード + serviceモジュール経由の承認mutation、認証ガード無し・非公開URL）にそのまま乗せられる
  - 新規: `src/pages/admin/AdminRacerNews.jsx` + `src/services/racerNewsService.js`
- **案B: スクリプト+チャット承認**（既存のSNS投稿承認運用と同じ形。UIを作らず、Claudeが候補をチャットで提示しユーザーが承認したらスクリプトでDBに直接INSERT）
  - この場合、画面としては選手個別ページ側の表示コンポーネント（RacerNewsList）のみが対象になり、承認UI自体は本screens.mdの対象外になる

judgment: 既存の`AdminRules.jsx`という直接再利用できる型が既にあるため、案Aの方が実装コストは低い。ただし掲載頻度が低い（都度手動リサーチ）機能に専用画面を作る費用対効果は`/step2`で判断する。

## 4. 既存コンポーネントの改修（選手名表示→選手ページへのリンク化）

現状、選手個別ページへの導線が無いと機能として発見されない。既存の選手名表示箇所を調査した結果、`racer_id`のデータ有無で改修コストに差があるため2フェーズに分ける。

### Phase 1（低コスト、本PRのスコープ候補）: `racer_id`が既にクエリに含まれている箇所

| コンポーネント | 画面 |
|---|---|
| `RacerFormChart.jsx` | データ分析ツール → 調子（勝率変化） |
| `RacerBoatReturnRateChart.jsx` | データ分析ツール → 選手×艇番の連対率 |
| `RacerFormRankingChart.jsx` | ホーム → 本日の調子ランキング |
| `RacerTechniqueProfileChart.jsx` | データ分析ツール → 決まり手プロファイル |
| `ExhibitionTimeTrendChart.jsx` | データ分析ツール → 展示タイム推移 |
| `StPredictabilityChart.jsx` | データ分析ツール → ST安定性 |

これらは選手名表示部分を`<Link to={`/racer/${racerId}`}>`でラップするだけで済む（データ取得層の変更不要）。

### Phase 2（要追加調査・別タスク候補、本PRのスコープ外を推奨）: `racer_id`がクエリ/RPCに含まれていない箇所

| コンポーネント | 画面 | 追加が必要な箇所 |
|---|---|---|
| `RaceCardDataTable.jsx` / `AttackDefenseAnalysis.jsx` | データ出走表・攻め守り分析 | `getRaceEntriesDetail`の`.select()` |
| `RaceReview.jsx` / `DataRaceTable.jsx` / `AiAnalysisSection.jsx`（`PredictionPanel.jsx`経由） | レース詳細（データで振り返る・データ出走表・AI予想） | `getPredictions`の直接クエリ**および**Supabase RPC `get_predictions_by_date`/`get_predictions_by_date_light`（SQL変更、`docs/db-migration/019_restore_prediction_odds_to_rpc.sql`） |
| `MotorConditionChart.jsx` | データ分析ツール → モーター調子 | `getRaceMotorBreakdown`の`.select()` |
| `HolmesSherlock.jsx`/`HolmesWatson.jsx`/`HolmesMycroft.jsx` | 実験的AI予想モデル | `sherlockService.js`/`watsonService.js`/`mycroftService.js`の`.select()` |

**判断が必要な論点**: Phase2はRPC（SQL）変更を含み、主要な予想表示パイプライン（`get_predictions_by_date`）に手を入れるため、影響範囲・テスト負荷がspec.mdが想定する「UI機能追加」の規模を超える。本チケットではPhase1のみを実装し、Phase2は選手ページの効果（アクセス状況等）を見てから別チケット化することを推奨する。

## 5. SEO・sitemap対応（要件4）

`scripts/generate-sitemap.js`の`getRacePages()`（直近7日分のレースページのみ登録するロジック、日別ページの二の舞回避のため導入済み）と同じ「Supabaseクエリ→フィルタ→push」パターンを流用する。

```js
// 新規: getRacerPages()
// ニュースまたは占い情報を持つ選手のみ sitemap に登録する
async function getRacerPages() {
  const racerPages = [];
  // racer_newsテーブル(仮、/step2で決定) or racer_profilesの占いフラグ等でフィルタ
  // 該当racer_idのみ racerPages.push({ loc: `/racer/${racerId}`, ... })
  return racerPages;
}
```

- ページ側の`noindex`条件（`hasIndexableContent`）とsitemap側のフィルタ条件は**同じロジックを参照する必要がある**（どちらか一方だけ更新して不整合を起こさないよう、`/step2`で共通の判定関数（例: `scripts/lib/racerIndexability.js`）に切り出すことを推奨）
- `npm run verify:sitemap`の対象外ルールとして動的ルート（`racer/:racerId`）を`EXPECTED_EXCLUSIONS`に登録する必要がある（静的ルート突き合わせの対象外にするため）

## 6. デザイントークン・共通コンポーネント

- 色・スペーシング・タイポグラフィは全て`src/styles/design-tokens.css`の既存CSS変数（`--color-primary-*`・`--spacing-*`・`--font-size-*`等）で表現可能。新規CSS変数の追加は不要
- `Header`コンポーネントは無条件で含める。`Header.jsx`内のアクティブタブ判定（`location.pathname.startsWith(...)`のハードコード分岐）に`/racer`用の分岐が無いため、ナビゲーション上でハイライトさせたい場合は`Header.jsx`に1行追加が必要（任意、ナビに`racer`への直接リンクは無い想定のため優先度低）
- 選手名・支部・出身地等の固有名詞には`translate="no"`を付与する（`RaceReview.jsx`等の既存パターンをそのまま踏襲）

## 未解決の論点（`/step2`で決定）

- パンくず・関連導線の戻り先（選手一覧ページは今回のスコープ外だが、無いとパンくずの行き先に困る。ホーム固定にするか、出走表からの遷移元に戻すかを決める）
- ニュース候補提示→承認フローの実装形態（案A: 管理画面 / 案B: スクリプト+チャット承認）
- 級別表示のデータソース（`race_entries`最新値 vs `racer_profiles.grade_at_scrape`の定期再スクレイピング）
- Phase2（既存の主要予想パイプラインへのracer_id追加）を別チケット化するかどうか
