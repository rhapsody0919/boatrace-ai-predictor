# ADR 0026: 開催場一覧ページ再設計のURL構造

## ステータス
採用

## 背景

`docs/design/venue-list-redesign/`で、トップページのドロップダウン選択を「会場一覧 → 会場別レース一覧 → レース詳細」の3階層ナビゲーションに再設計する。会場別レース一覧・レース詳細は新規ルートが必要（現状は同一ページ内のstate切替のみでURLを持たない）。

既存ルートは以下の通り（`src/AppRouter.jsx`）:
- `/` — 本日の予想ページ（`App tab="races"`）。SEO上の主要導線でURLを変更しない
- `/races` — 過去90日の日付一覧（`RaceHistory.jsx`、変更なし）
- `/races/:date` — 過去日付の予想ページ（`RaceDetail.jsx`）。既存URLを維持する

新設が必要なのは「会場別レース一覧」と「レース詳細」の2階層分。既存の`race_id`は`YYYY-MM-DD-VV-RR`形式（`src/utils/raceId.js`）で日付・会場コード・レース番号を内包しており、単独でレースを一意に特定できる。

## 決定

以下のURL構造を採用する。

| 画面 | 本日 | 過去日付 |
|------|------|---------|
| 会場一覧（FR-1） | `/`（既存URL維持） | `/races/:date`（既存URL維持、中身をグリッドに差し替え） |
| 会場別レース一覧（FR-2、新設） | `/venue/:venueCode` | `/races/:date/:venueCode` |
| レース詳細（FR-3、新設） | `/race/:raceId` | `/race/:raceId`（本日・過去日付で同一パターン） |

- レース詳細は本日・過去日付を問わず`/race/:raceId`に統一する。`raceId`が日付・会場を内包するため、URLに日付・会場を重複して持たせる必要がない
- 会場別レース一覧は、既存の「`/`＝本日」「`/races/:date`＝過去日付」という非対称な構造をそのまま踏襲し、本日は`/venue/:venueCode`、過去日付は`/races/:date/:venueCode`とする

## 却下した選択肢

### 案A: 全て`/races/:date/...`に統一（`/`も`/races/today`のエイリアスにする）
`/races/:date/:venueCode`、`/races/:date/:venueCode/:raceNo`のように日付を起点に完全対称な階層にする案。設計としては最もクリーンだが、`/`という既存のSEO主要導線のURL構造を変更する（内部的に`date=today`として扱うにしても、ルート定義・コンポーネント設計が複雑化する）。既存URLのSEO資産に触れるリスクを避けるため却下

### 案B: 会場別レース一覧を`?date=YYYY-MM-DD`のクエリパラメータで表現
`/venue/:venueCode?date=YYYY-MM-DD`のように過去日付をクエリで表現する案。実装は簡単だが、既存の`/races/:date`がパスセグメント方式のため一貫性が無い。クエリパラメータはシェア・SEO上もパスセグメントより弱いため却下

### 案C: レース詳細を`/venue/:venueCode/:date/:raceNo`のように毎回venueCode・date・raceNoを分解して持つ
`race_id`と二重管理になり、パース処理や不整合（存在しない会場コード×日付の組み合わせ等）のバリデーションが余計に必要になる。`race_id`が既に一意識別子として確立されているため却下

## 影響

- レース詳細ページ（`/race/:raceId`）は本日・過去日付で条件分岐が不要になり、実装がシンプルになる
- 会場一覧・会場別レース一覧は「本日」と「過去日付」でURLパターンが異なる非対称構造が残る。既存の`/`と`/races/:date`の非対称性を踏襲した結果であり、新規に非対称性を持ち込むものではない
- sitemap方針（`scripts/generate-sitemap.js`の実装を確認して訂正: `/races/:date`は除外ではなく、検索需要がほぼゼロだったため直近7日分のみに限定して掲載している。BOA-84）:
  - `/venue/:venueCode`（本日、24件固定）: 静的ページとして`staticPages`に登録
  - `/races/:date/:venueCode`（過去日付）: `/races/:date`と同じ直近7日分限定の方針を踏襲し、`getRacePages()`と同様の仕組みで24会場×直近7日分（最大168件）を生成する
  - `/race/:raceId`（レース詳細）: 1日24会場×最大12R＝最大288件/日と個別ページ単位では検索需要が見込めない粒度のため、`/races/:date`が限定前に抱えていた「クロールバジェット浪費」問題（BOA-84）を繰り返さないよう`EXPECTED_EXCLUSIONS`に理由付きで登録し、sitemap対象外とする
