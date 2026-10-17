# 本番の値の約束の実測（BOA-635 T0-3）

[spec.md](../spec.md)「母集団の約束」D-1〜D-6 が、本番の layer ファイル（`GET /api/analogy/layer/{raceId}`）で守られているかを測った。読み取りだけ（DB・Storage に書かない）。2026-10-16 data-scientist が実施。スクリプトは `scripts/analysis/past-rate-check/pool-contract-check.mjs`、結果は `data/analysis/past-rate-check/pool-contract-check.json`。

## 結論
- 9項目すべて合格。違反0件。BOA-271 側に戻すものは無い
- `LAYER_FIRST_DATE` = **2026-10-06**
- 同じ run_id なら、発走前・発走後・Storage の実体で応答は同じ（D-6）。逆に、run_id が変わっても行が変わらない作り直しが、5日で137レースあった（下の「run_id の作り直し」）。振り返りの照合は run_id ではなく layer の中身の印で行う（spec FR-4、2026-10-16 オーケストレーター判断）
- gzip 後の大きさは、実際の転送で最大 50,248 バイト。「約50KB」の上限まで約1KB しか余裕が無い

## 標本
- 本番の layer API の取得は210件（ok 209・absent 1）。2026-10-06〜10-14 は各日6レースを無作為に、2026-10-15 は全レース（156R）
- 行の和集合は 108,382 レース。本体（2025-12-03〜2026-10-14）40,011、長期（2019-04〜2025-12-02）68,371
- 取得は 2026-10-16 23:35 JST、乱数の種は 20261016

## 結果
| 項目 | 方法 | 結果 | 合否 |
|---|---|---|---|
| (a) D-1 3連単 | `payout_3tan` を本体は `race_results.payout_trio`、長期は `kb_archive_races.payout_3tan` と比べた。3連複（`payout_trifecta`／`payout_3fuku`）とも比べた | 無作為100R: 本体・長期とも100/100一致、3連複との一致0。全件: 本体は 40,005 一致・両方 null 6・不一致 0、長期は 68,371/68,371 一致。3連複と金額が偶然同じは各1件 | 合格 |
| (b) D-2 F・出遅れの ST | `race_start_timings` の `is_flying`・`is_late_start`・`finish_mark` F/L/欠 の艇（期間内 1,631艇）について、そのコースの `st_by_course` を見た | 本体 892/892 が null。実進入が null の270艇は ST が置かれない。負の ST の行は0。長期（3,000R 抜き取り）63/63 が null | 合格 |
| (c) D-3・D-5 不成立 | `races.cancellation_status`（期間内553R）、`race_results` 無し・`rank1` null・`is_cancelled`・`is_no_race`・`race_status=no_race`、長期の `has_result` | 行に入っていたのは本体0・長期0。行の `race_status` は normal 39,061、partial_refund 950 | 合格 |
| (d) D-4 実進入 | `course_by_boat` を艇ごとに `race_results.actual_course_1〜6`（長期は `kb_archive_boats.course`、3,000R）と照合 | 本体 240,066艇が一致（null の艇は DB でも null、268行）。layer にだけ値がある艇は0、値が違う艇は0。長期 18,000艇一致 | 合格 |
| (e) D-5 返還艇 | 独立の正解: `refund_boats`・`finish_mark` F/L/欠・`is_flying`・`is_late_start`（長期は `finish_raw` F/L0/L1 と各フラグ） | 1〜3着に返還艇がいる行は本体0/40,011、長期0/3,000。3着より下に返還艇がいるレースは946Rが行に残っている（除きすぎていない）。rank1〜3 は DB と全件一致 | 合格 |
| (f) D-6 | ①発走前の取得（2026-10-13-04-12、15:10 JST 取得、締切 16:20）と今の API。②10/13 に取った36レース（締切後）と今の API。③今の API と Storage の実体（30R）。④作り直された run の新旧の layer（137R） | ①1/1、②36/36、③30/30 で完全一致。④137/137 で行も run_id 以外の全項目も一致 | 合格 |
| (g) 大きさ | 応答の JSON を手元で gzip。大きい5件は curl で実際の転送量（`Content-Encoding: gzip`）も測った | 手元の gzip: 中央値 44,290・p90 45,493・最大 46,379 バイト（2026-10-15-13-04）。50KiB 超は0件。実際の転送は最大 50,248 バイト。gzip 前の最大は 428,672 バイト | 合格 |
| (h) 切り詰め | `n_returned < n_total` | 10-15 の全レース 129/155（83.2%）、標本全体 176/209（84.2%）。snapshot の `n_layer` が2,000超は 1,254/1,507（83.2%、10-06〜10-15 の全レース）。`n_total` の中央値 6,480・p90 58,474。`n_returned` が200未満は 5/155 | 測定済み |
| (i) 最初の日 | 10-01〜10-10 の各日、4会場の1R・12R を API で取り、`analogy_v16_snapshots`（racecard）を数えた | 10-01〜10-05: snapshot 0件、API はすべて not_saved。10-06〜: すべて ok | 2026-10-06 |

その他の検査も違反0件。
- 同じ過去レースが複数の layer に入るとき、行の値は同じ
- 行の race_date が `pool_cutoff` より後、または当日以降のものは無い
- 並び順（race_date の新しい順、同じ日は race_id の降順）は守られている
- `rows.length = n_returned ≤ n_total`

## run_id の作り直し
| 日 | run | 作り直されたレース | 新旧で行が同じ |
|---|---|---:|---:|
| 2026-10-06 | 09:26・13:42 | 1 | 1 |
| 2026-10-09 | 07:12・13:41 | 1 | 1 |
| 2026-10-10 | 07:12・13:41 | 2 | 2 |
| 2026-10-11 | 07:13・13:42 | 1 | 1 |
| 2026-10-13 | 07:12・07:41 | 132（全レース） | 132 |

- 昼の作り直しは締切の10〜50分前に起きた。snapshot は新しい run を指す
- 同じ run_id なら同じ行（D-6）は成り立つ。一方、run_id が違っても行が同じことがある
- 出走表の中身が変わって行まで変わる作り直しは、この期間に観測されなかった

## 言えること／言えないこと
- 言える: 10-06〜10-15 の本番の layer では D-1〜D-6 が守られている。`LAYER_FIRST_DATE` は 2026-10-06。層の約83%で2,000件に切り詰める
- 言えない（未検証）
  - BOA-523 の欠落期間（6列とも null）の再現。本番の DB ですでに補完済みで、標本の範囲で0件だった。確かめたのは、艇ごとに null の実進入が艇番で埋まっていないところまで
  - 発走前の取得の標本は1件だけ
  - 本体で `payout_3tan` が null の6行（DB でも3連単・3連複とも null、単勝あり）が特払いか取得の欠けか
- 補足
  - 10-06 は156R中5R（14-01〜03・18-01〜02、締切 08:35〜09:27）に snapshot が無い。朝の run（09:26）より前か直後に締切が来たため not_saved になる
  - `n_total` と snapshot の `n_layer` は 171/209 で違う（spec に記載のとおり、合わせない）

## 再実行
```bash
node --env-file=.env.local scripts/analysis/past-rate-check/pool-contract-check.mjs
```

- 環境変数: `PCC_SAMPLE_DAYS`（既定 2026-10-06..2026-10-15）、`PCC_FULL_DAY`（既定 2026-10-15）、`PCC_PRIOR`（過去の取得結果の JSON を「,」区切りで渡す。(f) に使う）、`PCC_WORK`・`PCC_OUT`
- 取得した layer は `data/analysis/past-rate-check/work/pool-contract/`（gitignore）
- (f) を増やすには、締切前に1回実行し、締切後にもう1回実行して、結果の `digests`（レースごとの run_id と応答の sha256）を比べる
