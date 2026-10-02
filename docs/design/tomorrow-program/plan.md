# 明日の出走表 plan

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / ADR: [0084](../../adr/0084-tomorrow-program-separate-table-from-b-file.md)

## 1. 全体の流れ

```mermaid
flowchart LR
  B[(公式 B ファイル<br/>bYYMMDD.lzh<br/>www1.mbrace.or.jp)] -->|15分ごと 14:00-23:45 JST<br/>Last-Modified が変わったときだけ解析| J[tomorrowProgramJob.js<br/>api/cron/tomorrow-program.js]
  J -->|変更のある行だけ upsert| T[(tomorrow_program)]
  RS[(race_series)] --> J
  J -->|未公開の会場・0件・そろわない| M[scrape_job_state<br/>→ 既存の監視・Slack]
  T --> S1[トップの明日タブ]
  RS --> S1
  T --> S2[明日の出走表 /tomorrow/:venueCode]
  RP[(racer_profiles)] --> S2
```

当日の流れ（races・race_entries・朝の初期化・予想）には一切触れない。

## 2. データ設計

マイグレーション案: [`docs/db-migration/123_tomorrow_program.sql`](../../db-migration/123_tomorrow_program.sql)（未適用。コードのマージより先にユーザーが適用する）

```mermaid
erDiagram
    tomorrow_program {
        date race_date PK
        smallint venue_code PK
        smallint race_number PK
        smallint boat_number PK
        text series_title
        smallint series_day
        boolean is_final_day
        text stage
        smallint distance_m
        time deadline_time
        integer racer_id
        text racer_name_raw
        smallint age
        text branch
        smallint weight
        text class
        numeric(4,2) national_win_rate
        numeric(5,2) national_2rate
        numeric(4,2) local_win_rate
        numeric(5,2) local_2rate
        smallint motor_number
        numeric(5,2) motor_2rate
        smallint boat_id
        numeric(5,2) boat_2rate
        text series_results_raw
        timestamptz source_modified_at
        timestamptz created_at
        timestamptz updated_at
    }
    tomorrow_program_venues {
        date race_date PK
        smallint venue_code PK
        text status
        text series_title
        smallint series_day
        boolean is_final_day
        smallint race_count
        timestamptz source_modified_at
        timestamptz created_at
        timestamptz updated_at
    }
```

- `tomorrow_program`: 1行＝1艇。レース・節の項目は艇の行に重ねる（1日最大1,728行）
- `tomorrow_program_venues`: 1行＝1会場（B ファイルに会場ブロックがある会場だけ）。status は published / pending。行が無い会場＝明日開催なし。B ファイル未公開の間は0行。公開状況の分母 m はこの表の行数（race_series は10月分が未取得で不完全なため、開催の有無に使わない。グレード表示だけに使う）
- 保存する列は上の ER 図のとおり。parseBText の出力のうち保存しないもの: venue_name（venue_code で足りる）・title_short・day_label（series_day・is_final_day で足りる）・stage_raw（stage で足りる）・date_in_body（対象日のガードに使うだけ）・正規化済みの name（name_raw を racer_name_raw に保存）
- 名前は B ファイルの表記のまま（4文字で切れる）。正式名は画面が `racer_profiles`（匿名で読める）から登番で引く。未登録は B の名前
- `source_modified_at` は「行の値が最後に変わったときの B ファイルの Last-Modified」。比較対象からは外し（`ignoreColumns`）、値が変わった行にだけ入れる（ファイル更新のたびに全行を書き直さないため）
- `created_at`・`updated_at` と `source_modified_at` で、公開→取り込みの遅れを実測する
- 外部キー・既存テーブルへのリレーションは無し（`racer_id` は `racer_profiles.racer_id` と同じ値だが FK は張らない。新人の未登録で取り込みを止めないため）

### 書き込み量（Disk IO）

- 1日: 初回の最大1,728行の INSERT。以降は B ファイルの更新（夕方〜夜に数回）で値が変わった行だけ UPDATE（実測では準優・選手交代等で数十〜数百行）
- Last-Modified が変わらない tick は解析も書き込みもしない（1日40 tick のうち大半）
- 掃除: 対象日を過ぎた行を1日1回 DELETE（最大1,728行）

## 3. 取得ジョブ（(a)）

### 3.1 配置

| ファイル | 役割 |
|---|---|
| `api/cron/tomorrow-program.js`（新規） | `createScrapeCronHandler({ job: "tomorrow_program", run })`。`maxDuration` は registry と同値 |
| `scripts/lib/tomorrowProgramJob.js`（新規） | 1 tick の本体（§3.2） |
| `scripts/lib/kbFileParser.js`（拡張） | `parseBText` の会場に `pending`（本文が「この場のデータ更新は、いましばらくお待ちください。」だけ）を足す。既存の呼び出し元（kbArchiveRows・kbResultsBackfillRows・kb-backfill・fix-opening-day-entries-from-b・verify 2本）は races・entries しか見ないので影響なし |
| `scripts/lib/scrapeJobs/registry.js`（追加） | `tomorrow_program: { kind: "continuous", activeWindowJst: ["14:00", "23:59"], leaseSec: 120, maxDurationSec: 120, hosts: ["mbrace.or.jp"] }` |
| `scripts/lib/scrapeJobs/monitor.js`（拡張） | continuous の死活判定（運用窓 07:00〜23:59・25分。monitor.js:451-470）で、registry に `activeWindowJst` があればその窓だけで判定する。無いと毎日 07:25〜14:00 に死活の誤報が出る |
| `scripts/lib/scrapeJobs/cleanup.js`（追加） | 2表の `race_date < 今日` を削除（scrape-cleanup、04:00） |
| `vercel.json`（追加） | `*/15 5-14 * * *`（UTC。JST 14:00〜23:45）。Vercel の Cron 数の上限に余裕があるかを T3 で確認する（既存45件） |

既存部品: `buildKbUrl("B", date)`・`decodeLzhText`（kbFileParser.js。kfile_sync は kfileParser.js の独自展開だが、どちらも `@kirinsaninc/lhats` の LhaReader で Vercel 上の稼働実績がある）、`politeFetch`（レスポンスヘッダーを保持）、`upsertChangedRows`（`scripts/lib/unchangedRows.js`）、Cron 共通ラッパ（認証・リース・モード off/shadow/live・cursor の保存）、`last_report.alerts` による通知（monitor.js:474-487 の job_report 経路）。

### 3.2 1 tick の処理

1. 対象日 = JST の今日+1。JST 14:00 より前は何もしない
2. cursor は `{ date, lastModified, mode }`。対象日か mode が違えば無視する（共通ラッパは mode を問わず cursor を保存するため、shadow で保存した値で live が止まらないように。日付をまたいだ比較をしないように）
3. B ファイルを取得する
   - 404 → 未公開。成功として件数0で報告する（例外にしない。14時台に連続失敗の誤報を出さないため）。JST 17:00 以降も 404 なら `alerts` に入れる
   - 200 で Last-Modified が cursor と同じ、かつ DB の件数（venues の行数・published の会場×72）がそろっている → 解析・書き込みをせず終了。DB の件数が足りなければ（行が消えた等）同じファイルで処理し直す
4. 本文の日付（`date_in_body`）が対象日と違えば書かずにエラー（取り違えたファイルのガード）
5. `parseBText` で解析し、会場ごとに
   - 出走表あり → `tomorrow_program` の行（全列をそろえる）と、venues の行（published）
   - `pending` → venues の行（pending）だけ。出走表は書かない
   - 12R・6艇に満たない会場 → 書くが、件数を報告に出す
6. 書き込み: `upsertChangedRows` を次の設定で使う
   - `chunkColumn: "venue_code"`。読み出しは `race_date = 対象日` で絞り、1チャンク4会場以下（288行以下。PostgREST の1000行上限に掛からない）。ヘルパーが絞り込みの条件を受け取れなければ受け取れるように拡張する（既定の `chunkColumn` は `race_id` で、この表には無い）
   - `deadline_time` は DB が返す表記（既存の time 列で実測してから決める。`HH:MM:SS` なら `HH:MM:00` にそろえる）で書き、毎回「変更あり」にしない
   - `source_modified_at` は `ignoreColumns`。`TIMESTAMP_COLUMNS`・`NUMERIC_SCALES` に新しい表を登録する
   - `stampUpdatedAt: true`
   - 再現テスト: 同じファイルを2回処理すると、2回目の書き込みが0件
7. 報告（`last_report`）: ファイルの会場数 m、published 数 n、pending の会場、書いた行数、Last-Modified。shadow は書かずに件数だけ
8. 通知: JST 22:00 以降の毎 tick（最終 tick に頼らない。Vercel Cron は best-effort）で n < m なら `alerts`（key `tomorrow_program_incomplete`、text に未公開の会場、until は翌日 14:00）に入れる。判定は DB の件数で行うので、3. で早期終了する tick でも行う

### 3.3 失敗の扱い

- 取得（404 以外）・展開・解析・日付の不一致は例外にし、共通ラッパの `consecutive_failures` に乗せる（3回で通知）
- 「Last-Modified が変わったのに会場ブロックが0」はエラー。初公開の版で全会場が pending のことはありうるが、pending も会場ブロックとして数えるので誤報にならない

### 3.4 掃除

- `scrape-cleanup`（`scripts/lib/scrapeJobs/cleanup.js`、04:00）に2表の `race_date < 今日` の削除を足す（`client.from(...).delete().lt("race_date", today)`。rowsWritten に加算）

## 4. 画面（(b)）

### 4.1 ルート

| パス | 画面 | i18n |
|---|---|---|
| `/`（`?day=tomorrow`） | トップの明日タブ（S1） | 翻訳対象（既存） |
| `/tomorrow/:venueCode` | 明日の出走表（S2） | 翻訳対象。`TRANSLATED_PATHS` に `/tomorrow` を登録。sitemap 対象外（日替わり。`EXPECTED_EXCLUSIONS`） |

`/venue/:venueCode` の配下にしない（本日の会場ページと日付の意味が混ざる）。

### 4.2 データ取得（`src/services/supabaseDataService.js` に追加）

| 関数 | クエリ | 使う画面 |
|---|---|---|
| `getTomorrowVenueSummary(date)` | `tomorrow_program_venues` を `race_date=date` で select（≤24行。status・節名・日次） ＋ `tomorrow_program` を `race_date=date, race_number=1, boat_number=1` で select（1R締切） ＋ `race_series` を `start_date<=date<=end_date` で select（グレードだけ） | S1 |
| `getTomorrowProgram(date, venueCode)` | `tomorrow_program` を `race_date, venue_code` で select（≤72行） ＋ `racer_profiles` を登番で select（正式名） | S2 |

- いずれも `withCache`（TTL は短め。15分ごとの更新に合わせ5分）。エラーは throw（画面は `DataFetchError`）
- 明日タブを開くまで呼ばない（本日タブの速度を変えない）
- RPC は作らない（≤72行の単純な select で足り、RPC の `CREATE OR REPLACE` によるキーの取りこぼしの経路を増やさない）

### 4.3 コンポーネント（screens.md）

```mermaid
flowchart TB
  VGP[VenueGridPage 本日ビュー] --> DT[DayTabs 新規]
  DT -->|today| VG1[VenueGrid → VenueGridCard mode=today 既存]
  DT -->|tomorrow| N[TomorrowPublishNotice 新規]
  DT -->|tomorrow| VG2[VenueGrid → VenueGridCard mode=tomorrow 拡張]
  VG2 -->|出走表あり| P[TomorrowProgramPage 新規 /tomorrow/:venueCode]
  P --> R[TomorrowRaceProgram ×12 新規]
```

- `VenueGridCard` の明日の状態: `program`（venues=published。グレードは `race_series.grade`、引けなければ出さない）／`waiting`（venues=pending）／`none`（venues に行が無く、他の会場には行がある。BOA-225 の次開催日を併記）／`before`（venues が0行＝B 未公開。「—」）
- 選手名: `racer_profiles.name` の全角空白（可変長）を表示用に1つにまとめる純関数を `src/utils/` に置く（既存に無い）。再現テスト付き
- 公開状況の案内（`TomorrowPublishNotice`）: 公開前（venues 0行）と公開途中（n<m）と全公開（n=m、非表示）
- 列（モック承認待ち）: 艇・選手・級・全国勝率・当地勝率・モーター。モーター2連率0の表示もモック承認で決める

## 5. 既存への影響

| 対象 | 影響 |
|---|---|
| races・race_entries・朝の初期化・予想・監視の0件判定 | なし（別テーブル） |
| `parseBText` の既存の呼び出し元（`fix-opening-day-entries-from-b.js` 等） | 会場に `pending` が増えるだけ。空会場として扱っていた処理は、`pending` を見なくても従来どおり動く（races が空の会場） |
| トップの本日タブ | タブの追加のみ。初期表示は本日（`?day` なし） |
| sitemap・AI スナップショット | `/tomorrow/*` は対象外に登録 |

## 6. テスト

- 解析: `parseBText` の `pending` 判定（B ファイルの実物の断片を fixture にして、更新待ちの会場と出走表のある会場が混ざるケース） → `scripts/maintenance/verify-kb-file-parser.js` に追加
- ジョブ: 対象日（0時台・14時前・23時台）、404 は成功で件数0・17時以降は alerts、Last-Modified 不変で DB がそろっていれば書かない・そろっていなければ処理し直す、cursor の日付・mode 違いは無視、本文の日付違いはエラー、pending の会場は出走表を書かない、shadow で書かない、同じファイル2回目の書き込み0件、22時以降の未公開で alerts → `scripts/maintenance/verify-tomorrow-program-job.js`（新規、registry `ci`。supabase・fetch はモック）
- 監視: `activeWindowJst` の窓外で死活を出さない → `verify-scrape-monitor.js` に追加
- 画面: 受け入れ E2E（acceptance-test-writer、時計を固定して4状態）、`e2e/layout.spec.js` に `/tomorrow/:venueCode` と `/?day=tomorrow`
- データ精度: 実データで1会場の明日の出走表が B ファイルと全艇一致（data-accuracy-verifier）

## 7. 完了の定義（data-acquisition.md §2）

- A 件数: 対象日に節がある会場×12R×6艇（中止・欠場を除く）の99%以上が、23:45 までに入っている。実測クエリを完了報告に添付
- B タイミング: `created_at − source_modified_at` の分布を土日を含む直近5日で実測（目標: 30分以内が98%以上）
- C 継続監視: 22時以降の未公開の会場・17時以降の未公開（404）は `alerts`、取得失敗は consecutive_failures、ジョブの未実行は monitor の死活（`activeWindowJst` の窓内）で Slack に流す
