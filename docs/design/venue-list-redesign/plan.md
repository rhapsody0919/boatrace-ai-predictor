# 開催場一覧ページ再設計 plan（システム設計）

`docs/design/venue-list-redesign/spec.md`・`screens.md`、`docs/adr/0026-venue-list-redesign-url-structure.md`を前提とする。

## 1. データ設計

### 新規テーブル・カラム
なし。開催日目（`series_day`）・最終日フラグ（`is_final_day`）・大会名（`race_title`）は`race_conditions`テーブルに既存カラムとして存在する（`docs/db-migration/001_schema.sql`）。次開催日（BOA-225）は本プロジェクトのスコープ外のため、新規テーブルはBOA-225実装時に別途設計する。

### RPC拡張

対象は以下の2系統（いずれも`race_conditions`とのJOINが未実施）。

| RPC関数 | 現行定義 | 用途 |
|---|---|---|
| `get_today_races()` | `docs/db-migration/034_get_today_races_unified_volatility.sql` | 本日の会場一覧（FR-1）・会場別レース一覧（FR-2） |
| `get_predictions_by_date(target_date)` / `get_predictions_by_date_light(target_date)` | `docs/db-migration/037_add_racer_id_to_predictions_rpc.sql` | 過去日付の会場一覧（FR-1）・会場別レース一覧（FR-2） |

**変更方針**:
- 各関数内の`FROM races r ...`に`LEFT JOIN race_conditions rc ON rc.race_id = r.race_id`を追加
- venue単位のJSONオブジェクトに`seriesDay`（`rc.series_day`）、`isFinalDay`（`rc.is_final_day`）、`raceTitle`（`rc.race_title`）を追加する。これらは同一会場・同日であれば全レース共通のため、venue単位（レース単位ではなく）で1回だけ持たせれば十分（先頭レースの値を採用、または`MAX`/`bool_or`等で集約）
- 既存フィールドは削除・変更しない（後方互換、他画面への影響なし）
- `race_conditions`にレコードが無い過去レース（機能導入前のデータ等）は`NULL`になる想定。フロントエンド側は「日目不明」等のフォールバック表示を用意する（`screens.md`の未解決点を参照）

**実装時の注意**: 上記2関数はいずれも100〜300行規模のJSON構築ロジックを含む。誤転記による既存フィールド欠落を避けるため、`/step4`（実装）ではSupabase上の現行デプロイ済み定義を直接取得（`mcp__supabase__list_migrations`等）した上でJOINを追加し、新規migrationファイル（`docs/db-migration/038_add_series_day_to_race_rpcs.sql`を想定、番号は実装時に最新を再確認）として`CREATE OR REPLACE FUNCTION`する。本plan.mdでは全文を先出ししない。

## 2. コンポーネント構成・データフロー

### ルート構成
`docs/adr/0026-venue-list-redesign-url-structure.md`の通り。

```
/                          → VenueGridPage(date=today)         [FR-1、既存URL]
/races/:date                → VenueGridPage(date)               [FR-1、既存URL・中身差し替え]
/venue/:venueCode           → VenueRaceListPage(date=today, venueCode)  [FR-2、新設]
/races/:date/:venueCode     → VenueRaceListPage(date, venueCode)        [FR-2、新設]
/race/:raceId                → RaceDetailPage(raceId)            [FR-3、新設]
```

### コンポーネントツリー

```
VenueGridPage(date)
  └ VenueGrid
      └ VenueGridCard × 24
          （開催中: onClick → navigate(/venue/:code または /races/:date/:code)）
          （非開催: リンクなし、「本日開催なし」表示のみ）

VenueRaceListPage(date, venueCode)
  └ （日程タブは実装中にseriesDay/isFinalDayが実データ0件と判明したため今回は実装せず。BOA-226参照）
  └ RaceCard × N（既存コンポーネント流用）
      （onClick → navigate(/race/:raceId)）

RaceDetailPage(raceId)
  └ PredictionSection（既存、そのまま）
      └ PredictionPanel / RaceResult / RaceReview（既存、そのまま）
  └ RaceNavCard / RaceBottomNav（既存を拡張）
      （onNavigate → navigate(/race/:otherRaceId)、onVenueChange → navigate(/venue/:otherCode または /races/:date/:otherCode)）
```

### データ取得方針

- **VenueGridPage**: 本日は既存`dataService.getRaces()`、過去日付は既存の日付ベース取得（`dataService.getPredictions(date, { light: true })`、RaceDetail.jsxの2段階ロードパターンを踏襲）をそのまま使う。RPC拡張後のレスポンスから`seriesDay`等を取得する
- **VenueRaceListPage**: VenueGridPageと同じデータソースを`venueCode`でフィルタする。新規APIコールを追加しない設計とし、`withCache`（`src/services/supabaseDataService.js`）のキャッシュを再利用する形にする（ページ遷移をまたいでも同一日付なら再フェッチしない）
- **RaceDetailPage**: `raceId`（`YYYY-MM-DD-VV-RR`形式）から日付を`src/utils/raceId.js`の逆パース処理で取り出し、既存の`getPredictions(date)`系関数で該当日全件を取得→`raceId`でフィルタする。App.jsx/RaceDetail.jsxに既存の`applyRaceData`相当のロジックをほぼそのまま移植する

### App.jsx / RaceDetail.jsx の扱い

- `App.jsx`（884行）の`tab="races"`部分（会場選択・レース一覧・分析セクション）を上記3ページに分割する。`hit-races`/`accuracy`/`privacy`/`terms`/`contact`等の他タブは`App.jsx`に残し、タブルーティングのシェルとして存続させる
- `RaceDetail.jsx`は新規3ページ（date対応版）に置き換え、独自実装（`VenueSelector`/`RaceCard`/`PredictionSection`等を直接組み合わせている現行コード）を廃止する
- `VenueSelector.jsx`は上記置き換えが完了すると参照ゼロになる見込み。実装時に`grep`で他の参照箇所が無いことを確認してから削除する（spec.md未確定事項3）

## 3. 既存サービス層との連携

- `src/services/supabaseDataService.js`の`getRaces`/`getPredictions`/`getPredictionsLight`に、RPC拡張分（`seriesDay`/`isFinalDay`/`raceTitle`）のフィールドマッピングを追加する
- `src/services/dataService.js`（薄いラッパー層、`supabaseDataService`をそのまま呼ぶ）は変更不要（新規フィールドはレスポンスオブジェクトにそのまま含まれるため、明示的なマッピング追加のみで済む）

## 4. i18n

- 新規UI文言（会場一覧・レース一覧・日程タブ・時間帯アイコンのラベル等）を`src/locales/{ja,en,zh-TW,ko}/`に追加。既存の`venueSelector.*`/`raceCard.*`/`raceNav.*`キーの命名パターンを踏襲する
- `src/config/languages.js`の`TRANSLATED_PATHS`に`/venue/:venueCode`・`/races/:date/:venueCode`・`/race/:raceId`のパターンを追加

## 5. sitemap

`docs/adr/0026`の方針を`scripts/generate-sitemap.js`に反映する。

- `staticPages`（または`LOCALIZED_PAGES`）に`/venue/:venueCode`を24件分追加（既存の`getRacePages()`のような動的生成関数、または固定リストで実装）
- `getRacePages()`と同様の仕組みで`/races/:date/:venueCode`を直近7日分×24会場（最大168件）生成する関数を追加
- `/race/:raceId`は`EXPECTED_EXCLUSIONS`に理由（個別レースは検索需要が乏しい粒度、BOA-84の教訓を踏襲）付きで登録する
- `npm run verify:sitemap`（`scripts/maintenance/verify-sitemap-coverage.js`）が新規ルートを正しく検知するか実装時に確認する

## 6. 実装順序の目安（`/step3`で詳細化）

1. RPC拡張（migration作成・適用）
2. `VenueGridPage`/`VenueGrid`/`VenueGridCard`実装（本日のみ、`/`に反映）
3. `VenueRaceListPage`実装（`/venue/:venueCode`）
4. `RaceDetailPage`実装（`/race/:raceId`、既存コンポーネント移植）
5. 過去日付対応（`/races/:date`のグリッド化、`/races/:date/:venueCode`）
6. `RaceBottomNav`/`RaceNavCard`のnavigateベース化
7. i18n・sitemap対応
8. `VenueSelector.jsx`削除・旧`App.jsx`/`RaceDetail.jsx`コードのクリーンアップ
9. e2eスモークテスト追加・既存テスト修正
