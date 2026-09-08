# 選手検索フィルタ拡張・選手一覧ページ システム設計

`spec.md`（FR1〜FR7）・`screens.md`を実現するためのデータ設計・コンポーネント構成・データフロー。技術選定の比較は[ADR-0043](../../adr/0043-racer-grade-win-rate-cache-strategy.md)参照。

## データ設計

### 新規マイグレーション
| ファイル | 内容 |
|---|---|
| `docs/db-migration/054_racer_grade_cache_table.sql` | `racer_grade_cache`テーブル新設（`key`/`data(JSONB)`/`updated_at`、`race_history_cache`と同形状）。RLS `allow_anon_read`込み |
| `docs/db-migration/055_get_latest_racer_grades_rpc.sql` | 複合インデックス`idx_race_entries_racer_id_race_id (racer_id, race_id DESC)`（`CONCURRENTLY`のためSQL Editorで単独実行）＋ RPC関数`get_latest_racer_grades()`（`DISTINCT ON (racer_id)`で選手ごとの最新級別・勝率を1クエリで返す） |

`racer_profiles`・`race_entries`とも既存カラムのみで完結し、スキーマ変更（列追加）は不要（`branch`/`height_cm`/`weight_kg`/`registration_period`/`hometown`/`birth_date`は全て既存列、`race_entries.grade`/`win_rate`も既存列）。

### 新規バッチスクリプト
`scripts/daily/update-racer-grade-cache.js`（新規、`update-race-history-cache.js`と同じ構成）:
1. `supabase.rpc("get_latest_racer_grades")`を1回呼び出す（約1,627行が返る）
2. 整形（`[{racer_id, grade, win_rate}, ...]`のJSON配列）
3. `racer_grade_cache`に`upsert({key: "latest_grades", data, updated_at: new Date()})`

`.github/workflows/calculate-accuracy.yml`に、既存の`node scripts/daily/xxx.js`ステップと同じ形式で1ステップ追加する（新規ワークフローは作らない、23:30 JST既存cronに相乗り）。

## コンポーネント構成・データフロー

```
[初回] RacerSearchBoxのhover/focus/touchstart
  or  RacersPageのマウント
        │
        ▼
supabaseDataService.getAllRacersWithGrade()  ← withCacheで24hキャッシュ（キー共有）
        │  ① racer_profiles select
        │     (racer_id, name, name_kana, branch, height_cm,
        │      weight_kg, registration_period, hometown, birth_date)
        │  ② getRacerGradeCache()
        │     (racer_grade_cache から {racer_id, grade, win_rate}[] を取得)
        │  ③ ①②をracer_id突き合わせでクライアント側マージ
        ▼
  マージ済み選手配列（約1,627件、メモリ上に保持）
        │
   ┌────┴─────────────────┐
   ▼                       ▼
RacerSearchBox           RacersPage
（名前+フィルタでAND絞込、  （URLクエリ(useSearchParams)の
  最大8件表示）              フィルタ・ソート・ページを適用し
                             50件だけスライスして表示）
```

- **キャッシュキー共有**: `RacerSearchBox`と`RacersPage`は同じ`getAllRacersWithGrade()`（`withCache`の同一キー）を呼ぶため、どちらかを先に開いていればもう一方は追加のSupabase通信無しで即表示できる
- **年齢の算出**: `birth_date`から表示コンポーネント側（`RacerTable`/`RacerCompactRow`）で都度計算する（キャッシュに焼き込まない、`new Date()`基準のため日付が変わると値も変わる性質のデータ）
- **登録期のソート**: 表示文字列（「99期」）から数値部分を`parseInt`で抽出し、その数値でソートする専用コンパレータをフィルタ/ソートロジック側に実装する（`RacerTable`・`RacersPage`のソート処理内、表示コンポーネント自体はロジックを持たない）

## サービス層（`src/services/supabaseDataService.js`）変更

| 関数 | 変更内容 |
|---|---|
| `getAllRacersLite()` | select列に`registration_period`/`hometown`/`birth_date`を追加（既存の`racer_id, name, name_kana, branch`に加える）。既存呼び出し元（`RacerSearchBox`）への破壊的変更にはならない（列が増えるだけ） |
| `getRacerGradeCache()`（新規） | `racer_grade_cache`から`key='latest_grades'`の行を`withCache`（24h TTL）経由で取得し、`data`（JSON配列）を返す |
| `getAllRacersWithGrade()`（新規） | `getAllRacersLite()`と`getRacerGradeCache()`を`Promise.all`で並行取得し、`racer_id`でクライアント側マージした配列を返す。`RacerSearchBox`・`RacersPage`双方はこの関数を呼ぶ（`getAllRacersLite()`を直接は呼ばなくなる） |

`withCache`の既存シグネチャ（`withCache(key, fetcher, ttl?)`、`src/services/supabaseDataService.js:190-212`）をそのまま使う。新規キャッシュキーは`"all-racers-lite"`（既存）と`"racer-grade-cache"`（新規）の2つで、`getAllRacersWithGrade()`自体はメモ化しない（軽量なマージ処理のため、素通しでよい）。

## 既存コンポーネント連携との整合性

- `RacerSearchBox.jsx`は`getAllRacersLite()`の呼び出し箇所を`getAllRacersWithGrade()`に差し替えるのみで、既存の正規化・部分一致ロジック（`normalize()`）はそのまま使う
- `Header.jsx`のサブメニュー項目追加（FR7）はデータ層に影響しない、純粋なUI変更
- `AppRouter.jsx`・`scripts/generate-sitemap.js`の変更（FR6・ルーティング）もデータ層に影響しない
