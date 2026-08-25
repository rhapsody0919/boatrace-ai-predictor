# racer-news-feature システム設計

対応: [spec.md](./spec.md) / [screens.md](./screens.md)

## 全体データフロー

```
[Claudeがニュース候補をチャットでリサーチ・提示]
        │  ユーザー承認
        ▼
[scripts/maintenance/add-racer-news.js]
        │  INSERT
        ▼
racer_news テーブル（新規）
        │
        │                          racer_profiles（racer-fortune-telling作成済み、1,618人分）
        │                          race_entries.grade（最新出走時点、docs/adr/0023）
        ▼                                  ▼
[src/services/racerService.js] ←───────────┘
        │
        ▼
/racer/:racerId（RacerProfile.jsx）
        │
        ▼
[scripts/generate-sitemap.js getRacerPages()] ← racer_newsにracer_idが1件でもあれば対象
```

## データ設計

### racer_news テーブル（新規）

マイグレーション: [docs/db-migration/036_create_racer_news.sql](../../db-migration/036_create_racer_news.sql)

| カラム | 型 | 説明 |
|---|---|---|
| id | BIGSERIAL PK | |
| racer_id | INTEGER NOT NULL | `race_entries.racer_id`と同じ全国共通登録番号 |
| title | TEXT NOT NULL | 見出し |
| summary | TEXT NOT NULL | 要約（全文転載しない） |
| source_url | TEXT NOT NULL | 出典リンク |
| source_name | TEXT | 出典名（任意、例: "syuppan.net"） |
| published_at | DATE | 元記事の公開日（任意、取得できない場合はNULL許容） |
| created_at | TIMESTAMPTZ | 掲載（承認）日時 |

承認フローの決定根拠は[docs/adr/0022](../../adr/0022-racer-news-approval-flow.md)参照。`status`等の下書き管理カラムは持たない（承認済みのみ格納するため）。

### 既存テーブルとの結合

- `racer_news.racer_id` / `racer_profiles.racer_id` / `race_entries.racer_id` は全てINTEGERで結合可能（[[racer-fortune-telling]]で確認済み）
- **級別**: `race_entries`から`racer_id`一致・`race_id`降順（文字列ソートで日付降順と一致、`YYYY-MM-DD-VV-RR`形式のため）で1件取得した`grade`を使う（[docs/adr/0023](../../adr/0023-racer-grade-freshness.md)）。`racer_profiles.grade_at_scrape`は参照しない
- **インデックス判定（noindex/sitemap共通条件）**: `racer_news`に該当`racer_id`の行が1件以上存在すること。spec.mdは元々「ニュースまたは占い情報」としていたが、racer-fortune-telling Step1の検証結果を受けて占いスコアはサイトUIに表示しない方針に確定した（メモリ`racer_fortune_and_news_features_2026_08_24`参照）ため、**判定条件は「ニュースの有無」のみに簡略化する**。将来占い機能をUI化する場合はこの条件に追加する

## コンポーネント構成

### ページ: `src/pages/RacerProfile.jsx` + `RacerProfile.css`

`VenueGuide.jsx`（エンティティのプロフィールページ）の構造を踏襲。`useParams()`で`racerId`を取得し、`racerService.js`経由でデータ取得。

```jsx
const { racerId } = useParams();
const [data, setData] = useState(null); // { profile, grade, news }
useEffect(() => {
  racerService.getRacerPageData(racerId).then(setData);
}, [racerId]);

const hasNews = data?.news?.length > 0;

return (
  <>
    <title>{...}</title>
    <meta name="description" content={...} />
    <link rel="canonical" href={...} />
    {!hasNews && <meta name="robots" content="noindex, follow" />}
    <RacerStructuredData profile={data?.profile} />
    <Header />
    <nav className="breadcrumb"><Link to="/">← ホームに戻る</Link></nav>
    <RacerProfileHeader profile={data?.profile} grade={data?.grade} />
    <RacerProfileCard profile={data?.profile} />
    <RacerNewsList news={data?.news} />
  </>
);
```

- **パンくずの戻り先**: `/`（ホーム）に固定する。選手一覧ページが存在せず、遷移元は出走表・分析ツールなど複数想定されるため、汎用的な戻り先としてホームを採用する（screens.mdの未解決論点を解消）

### 新規コンポーネント: `src/components/racer/`

`race/`（レース関連）・`analysis/`（分析チャート）と並ぶ新規ディレクトリ。`.claude/rules/component-reuse.md`のbarrel export規約に従い`index.js`を用意する。

- `RacerProfileHeader.jsx` — 氏名（`translate="no"`）・支部・級別を大きく表示するヒーロー相当
- `RacerProfileCard.jsx` — `VenueGuide.jsx`の`eg-facts-grid`パターンを流用した基本情報グリッド（生年月日・支部・出身地・登録期・身長体重・血液型のうち、値がある項目のみ表示）
- `RacerNewsList.jsx` — ニュース一覧。0件の場合は「まだニュースはありません」の空状態表示
- `index.js` — barrel export

### 新規コンポーネント: `src/components/RacerStructuredData.jsx`

`VenueStructuredData.jsx`と同じ形式でPerson型のJSON-LDを出力（`schema.org/Person`、`name`・`birthDate`等）。プロフィールが無い選手（`racer_profiles`に行が無い10人）の場合は構造化データ自体を出力しない。

## 既存サービス層との連携

### `src/services/racerService.js`（新規）

```js
export async function getRacerPageData(racerId) {
  const [profile, grade, news] = await Promise.all([
    getRacerProfile(racerId),   // racer_profiles を1行取得
    getLatestGrade(racerId),    // race_entries を race_id 降順1件取得しgradeを返す
    getRacerNews(racerId),      // racer_news を racer_id で全件取得（created_at降順）
  ]);
  return { profile, grade, news };
}
```

- 既存の`supabaseDataService.js`（レース予想関連）とは責務が異なるため混在させず、新規ファイルに分離する（単一責任、既存ファイルの肥大化回避）
- ブラウザから直接Supabase（anon key）にアクセスする既存パターンをそのまま踏襲

### `scripts/maintenance/add-racer-news.js`（新規）

承認フロー（ADR 0022）でClaudeが実行するスクリプト。`scripts/maintenance/backfill-racer-ids.js`と同じCLI規約は不要（バッチではなく1件ずつの手動実行のため）。CLI引数で`--racer-id`・`--title`・`--summary`・`--source-url`・`--source-name`・`--published-at`を受け取り、`racer_news`に1行INSERTする。`scripts/lib/supabaseClient.js`を再利用する。

### Phase1（既存コンポーネントのリンク化、本チケットのスコープ）

screens.mdで洗い出した6コンポーネント（`RacerFormChart.jsx`等、`racer_id`が既にクエリに含まれるもの）の選手名表示を`<Link to={`/racer/${racerId}`}>`でラップする。データ取得層の変更は不要。

### Phase2（`racer_id`をRPC/クエリに追加、本チケットのスコープ外）

screens.mdの通り、`get_predictions_by_date`等の主要予想パイプラインへの変更を要するため別チケットとする。

## SEO・sitemap対応

### `scripts/generate-sitemap.js` に `getRacerPages()` を追加

`getRacePages()`（直近7日分のレースページのみ登録、コメントに理由が明記されている既存関数）と同じ構造。

```js
async function getRacerPages() {
  const racerPages = [];
  try {
    const { supabase, isSupabaseEnabled } = await import("./lib/supabaseClient.js");
    if (!isSupabaseEnabled()) return racerPages;
    // racer_newsに1件でも行がある racer_id のみ対象（docs/design/racer-news-feature/plan.md「インデックス判定」参照）
    const { data, error } = await supabase.from("racer_news").select("racer_id");
    if (error) throw new Error(error.message);
    const uniqueRacerIds = [...new Set((data ?? []).map((r) => r.racer_id))];
    for (const racerId of uniqueRacerIds) {
      racerPages.push({ loc: `/racer/${racerId}`, changefreq: "monthly", priority: "0.5" });
    }
  } catch (err) {
    console.error("選手ページ取得エラー:", err.message);
  }
  return racerPages;
}
```

- ページ側の`noindex`条件（`racer_news`の有無）とsitemap側の条件は同じクエリ（`racer_news`に該当`racer_id`の行があるか）を指しており、共通モジュール化はしない。理由: React側（ブラウザバンドル）とNode側（`scripts/`、ビルドツール）は実行環境が別で、コード共有のメリットより「同じ条件を2箇所に書く」ことの単純さが上回る（判定条件自体が「racer_newsに行があるか」という1行のシンプルな条件のため）。両実装がこのplan.mdの記述を参照して同期を保つ
- `npm run verify:sitemap`の`EXPECTED_EXCLUSIONS`に動的ルート`racer/:racerId`を理由付きで登録する

## i18n・モバイル対応

- ja専用（`TRANSLATED_PATHS`未登録）。追加実装不要、既存の自動リダイレクト機構に乗る
- 固有名詞（氏名・支部・出身地）に`translate="no"`を付与（既存パターン踏襲）
- モバイル余白は`.claude/CLAUDE.md`の基準（`design-tokens.css`の`--spacing-*`使用）に準拠

## 未確定事項（本plan.mdで解消済み、tasksへの持ち越しなし）

screens.mdで残していた4論点は全て本plan.mdで決定済み: 承認フロー（ADR 0022）・級別データソース（ADR 0023）・パンくず戻り先（ホーム固定）・Phase2の別チケット化（明記）。
