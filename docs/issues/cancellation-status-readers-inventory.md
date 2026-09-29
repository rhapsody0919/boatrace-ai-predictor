# races.cancellation_status の読み手・書き手の棚卸し（BOA-512）

BOA-512（2026-09-12 に、結果のある32本が誤って `confirmed` になった）の「調べること」の3つ目。誤った `confirmed` が残ったとき、読み手ごとに何が起きるかを洗い出した。対象は origin/master（750d459e）の scripts/・api/・src/・docs/db-migration/。

`confirmed` は「中止・順延」と「発走90分後までに結果が取れなかった」の両方を表す（マイグレーション047）。誤りには2つの型がある。

| 型 | 例 | 危険な読み手 |
|---|---|---|
| A. 結果があるのに `confirmed` | 2026-09-12 の32本 | 画面（中止バッジ）・監視の分母 |
| B. 結果がまだ無いのに `confirmed`（本当は開催された） | 読み取りの失敗・結果の公開の遅れ | 予定表（結果スロットの終端）・日次の再取得の除外。**結果が恒久的に欠ける** |

## 結論

- **`confirmed` を自動で消す経路は無い。** DBトリガーも無く、結果を書く経路（スロットの `runForRaces`・`scrapeAndSaveResults`・Kファイル同期）はどれも `cancellation_status` を見ない。消せるのは手動の `backfill-results-by-race-id.js`（結果の行があれば `null` に戻す）だけ
- `update-race-info.js` の遷移（`computeCancellationTransition`）は `tentative` だけを扱い、`confirmed` には触らない
- 結果の有無と AND している読み手は3つだけ: `delete-cancelled-race-predictions.js`・`data-health-report.js`（窓内取得率・検知の遅れ）・`dailyReconcile.js`（Kファイルと矛盾したら `cancelled_but_in_k` として検知する）
- 型Aの自動検知は、これまで `dailyReconcile` の `cancelled_but_in_k` だけだった。BOA-512 で `data_health` の `cancellation.with_result` を足した

## 読み手

重さは、誤った `confirmed` が残ったときの影響。

### 型Bで結果が欠ける（重さ: 高）

| 箇所 | 用途 | 判定 | 影響 |
|---|---|---|---|
| `075_scrape_slots_and_job_state.sql`（`claim_scrape_slots` の手順1）、`092_claim_scrape_slots_by_offset.sql` | pending のスロットを `cancelled_race` で終端 | `= 'confirmed'` | 型Bでは結果スロットが終端され、以後スロット経路で取らない。型Aは結果スロットが done 済みで実害なし |
| `scripts/lib/scrapeJobs/resultHandlers.js`（`createResultCatchupRun` の手順1） | 日次の再取得の対象から除く | `isCancellationConfirmed` | 型Bは再取得されない |

### 画面（重さ: 中。利用者に見える）

| 箇所 | 用途 | 判定 | 影響 |
|---|---|---|---|
| `src/components/race/RaceCard.jsx` | 中止バッジ。締切・カウントダウン・結果反映待ちを出さない | `isRaceCancelled` | 型Aで**的中/外れバッジと中止バッジが同時に出る**（的中/外れは `result.finished` で別に出る） |
| `src/components/race/PredictionPanel.jsx` | 中止バナー | `isRaceCancelled` | 型Aで結果のあるレースに中止バナー |
| `src/components/race/TodaysVolatilityHighlights.jsx` | 注目レースから除く | `isRaceCancelled` | 発走90分後以降だけ。ほぼ影響なし |
| `api/predictions/[date].js`・`api/races/today.js`（RPC経由）、`src/services/supabaseDataService.js`、`src/pages/RaceDetailPage.jsx` | 値を渡すだけ | — | 上の3つに届く |

### 監視・予測（重さ: 中）

| 箇所 | 用途 | 判定 | 影響 |
|---|---|---|---|
| `scripts/lib/scrapeJobs/monitor.js`（`isCancelledRace`） | 窓内取得率の分母から除く、expired・未実行を通知しない | `outcome === 'cancelled_race'` または `isCancellationConfirmed` | そのレースの取得失敗が監視から消える |
| `monitor.js`（補完の expired） | 補完の期限切れを通知しない | truthy（tentative も） | 同上 |
| `scripts/daily/generate-predictions.js`（`fetchRaceDataFromSupabase`） | 予測を作らない | truthy（tentative も） | 型A・Bは発走後なので再生成・バックフィルだけ。**tentative の誤検出は発走前の予測を丸ごと欠かす** |
| `scripts/lib/dailyReconcile.js` | Kファイル照合から除く。Kに完走艇があれば `cancelled_but_in_k` | `isCancellationConfirmed` | 型Aを検知する側。ただしそのレースの値の比較はしない |
| `scripts/daily/update-race-info.js`（`computeCancellationTransition`） | 暫定検知の遷移 | ヘルパー。`confirmed` なら何もしない | `confirmed` を消す経路が無い原因の1つ |

### 集計の分母・対象から除くだけ（重さ: 低）

| 箇所 | 判定 | 影響 |
|---|---|---|
| `089_data_health_functions.sql` の関数群（正本は `scripts/lib/dataHealth/coverageSpec.js`・`functions.js`）: coverage・pre_race_fields・pit_reports・race_series・racer_period_stats・monthly_result | `is distinct from 'confirmed'`（monthly は `=` でも数える） | 型Aは分子・分母から同時に抜け、率はほぼ不変。型Bは欠損を隠す |
| `100_data_health_entries_duplicates.sql` | 同上 | 複製検知の対象から漏れる |
| `scripts/analysis/data-health-report.js`（取得時刻の集計） | 同上 | 分母が少し減る |
| `scripts/lib/scrapeJobs/expectedUnpublished.js` | `isCancelledRace` と同形 | 想定内の未公開の判定から漏れる |
| `scripts/lib/dailyReconcileJob.js` | `isCancellationConfirmed` | 照合の期待件数が減る |
| `scripts/lib/motorPretestRows.js` | `isCancellationConfirmed` | 前検の期待選手が減る |
| `scripts/lib/raceStatusJob.js` | `isCancellationConfirmed` | 告知の候補から先に外れ、矛盾の検出に載らない |
| `scripts/daily/todays-volatility-digest.js` | `.eq` に定数 | 朝の実行時点では確定がほぼ無い |
| `scripts/daily/scrape-results.js`（`confirmCancellationsForRaceIds`）、`resultHandlers.js`（`createResultOnTick`） | 確定済みを書き込み対象から外す | 再確定しないだけ |
| `scripts/maintenance/`: `audit-missing-results.js`・`backfill-series-day.js`・`backfill-race-conditions.js`・`backfill-kb-recent-results.js`・`check-*-shadow.js` | 各種 | 手動の補修・検証から漏れる |
| `scripts/maintenance/delete-cancelled-race-predictions.js` | `not is null` かつ結果なし | 安全 |

テスト（verify-*.js）は18ファイル・104か所で参照している。

## 書き手

| 箇所 | 書く値 | 条件 |
|---|---|---|
| `scripts/daily/scrape-results.js`（`confirmCancellationsForRaceIds`） | `confirmed` | 結果の行が無く、未確定のもの。読み取りに失敗したら書かずに例外（PR #743）。呼び出し元: GitHub Actions の `confirmOverdueCancellations`、スロット経路の毎分の tick（直後に claim が結果スロットを終端する）、日次23:50の再取得、`raceStatusJob.js`（公式の中止告知） |
| `scripts/daily/update-race-info.js` | `tentative` / `null` | 選手0人が3回続いたら `tentative`、選手が取れたら `null`。`confirmed` には触らない |
| `scripts/maintenance/audit-missing-results.js`（手動 `--apply`） | `confirmed` | 結果が無く、結果ページが中止表示 |
| `scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js`（手動・一回限り） | `confirmed` | 結果が無く、Kファイルにその会場が無い |
| `scripts/maintenance/backfill-results-by-race-id.js`（手動） | `null` | 再取得後に結果の行があるもの。**`confirmed` を消す唯一の経路** |

## ヘルパー

| ファイル | 関数 |
|---|---|
| `scripts/lib/cancellationStatus.js` | `isCancellationConfirmed`・`computeCancellationTransition`・定数 |
| `src/utils/raceCancellation.js` | `isRaceCancelled`・`isCancellationSuspected`（未使用）・定数 |

どちらも結果の有無を見ない。`verify-race-cancellation-usage.js` は JS の `===`/`!==` による文字列の直比較だけを禁じており、SQL・PostgREST の文字列・truthy の判定は対象外。

## 残る改善（BOA-512 では実装しない）

1. **結果が入ったら `confirmed` を消す経路**（scripts/。型Aの自己修復）。結果（rank1 あり）の書き込みの後に、そのレースの `cancellation_status` を `null` に戻す。`backfill-results-by-race-id.js` と同じ処理を自動経路にも入れる形
2. **画面で「結果があるなら中止扱いしない」**（src/。`isRaceCancelled` に結果の有無を足す等）。BOA-490（PR #916）が集計側で採った「中止が確定 かつ 結果が無い」と同じ考え方
3. **型Bの被害を減らす**: 誤った `confirmed` が結果スロットを終端すると、以後自動では取り直されない。日次の再取得（`createResultCatchupRun`）の除外を「中止告知で確定したものだけ」に絞る等。確定の出所を列に持っていないため、設計の判断が要る

いずれも挙動が変わるため、着手の判断は別に行う。
