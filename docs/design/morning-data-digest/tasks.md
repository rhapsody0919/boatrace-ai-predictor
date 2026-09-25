# 「本日のデータ一覧」ページ tasks

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)

Linear: [BOA-402](https://linear.app/boat-ai/issue/BOA-402)　モック（承認済み、2026-09-24・案A）: [mockup/](mockup/README.md)（旧Artifactはアカウント切替で参照不可。**実装は4回の改訂でモックから大きく離れている**ので、現在の仕様は screens.md §7 と本番 <https://www.boat-ai.jp/today> を見る）

ADR: [ADR-0070](../../adr/0070-morning-digest-precomputed-rows.md) / [ADR-0071](../../adr/0071-venue-adjusted-skill-delta.md)

マイグレーション案（**未適用**）: [098](../../db-migration/098_morning_data_digest.sql)

---

## 着手前に読むもの

- 会話が圧縮された直後・別セッションで再開する際は、**記憶ではなくこのファイルを読み直してから続ける**（`.claude/rules/sdd-workflow.md`）。`/step4` を都度呼ぶ運用にする
- 粒度は目安。**同じファイルを触るタスクは1PRにまとめてよい**（UIはタブ/セクション単位でPlaywrightの自己検証が1回で済む）
- `src/**` を編集する前に `.claude/rules/frontend-data-fetch.md` と `.claude/rules/component-reuse.md` が自動で読み込まれる。`supabaseClient.js` は `.throwOnError()` 既定適用（[ADR-0069](../../adr/0069-query-error-propagation.md)）なので、**`if (error) return []` を書かない**
- spec §1 の実測値は 2026-09-24 時点のもの。**日が経つほど古くなるため、T1-1 の着手時に再実測して spec を更新する**

---

## ⛔ ゲート: `/step4` の前に独立エージェントのレビューを通す（省略不可）

`.claude/rules/sdd-workflow.md`「実装着手前に天才エンジニアの独立レビューを必ず挟む」（2026-09-23〜）。phase a で同じ位置に33件の指摘が出て、うち数値・前提の誤りで設計を巻き戻した実績がある。

- [x] **G-0** Agent tool で独立エージェントに spec.md / screens.md / plan.md / tasks.md / ADR-0070 / ADR-0071 / マイグレーション案（当時097、現098）を渡し、批判的レビューを依頼する

  **完了（2026-09-24）。Critical 3件・High 7件・Medium 14件・Low 7件の指摘。うち重要なものは全て自分で実測して再現し、設計に反映した。** 反映内容:
  - **C-1**: `featured` のスコア式 `skill_delta × consistency` が破綻（実測で若松12Rが1位、モックの戸田4Rは3位）。逸脱をzスコアに標準化する式に変更（plan §3.3。修正後は戸田4Rが1位）
  - **C-2**: FR-7 の受入基準「ホームと表示値が一致」は原理的に不可能（`predictions` は日中に再生成。実測で9/20は08:36〜22:51の15時間帯に分散）。「`generated_at` 時点の値と一致」に変更
  - **C-3**: `getVenuesWithTodaysRaces()` は会場コードの配列しか返さない。screens.md §4 を訂正
  - **H-1**: `volatilityPercentile` は 0〜1。×100 して保存する旨を plan §2.2・098 に明記
  - **H-2**: グレード交絡（G1 62.2% 〜 G3 51.1%、11.1pt）を補正。ベースラインの主キーを `(venue_code, race_grade, course)` に変更（ADR-0071 §改訂1）
  - **H-3**: 小標本フラグの基準が まくり で逆に働く。「Wilson下限 < 抽出閾値」に変更
  - **H-4**: `nigashi` の閾値を +15pt → **+20pt**（実測: +15ptで43件は目標5〜15件の3倍。+20ptで12件・9会場）
  - **H-5**: 逃がし率にコース軸は無い（実測でコース1〜6が52.98で同値）。比較対象を「会場×グレード」に変更（ADR-0071 §改訂2）
  - **H-6**: 完全性チェックに「会場数が前日の70%以上」を追加
  - **H-7**: `predictions` を必須条件から外す（実測で9/20は08:36が最速で06:30に間に合わない）
  - **M-1〜M-14 / L-1〜L-7**: 数値の訂正（52.7→52.98、293日/295日の区別、`entry_course` は9/21以降100%、まくり率4・5コース）、書き込み順、キャッシュTTL、受入基準への `racer_id` 併記 等
  - **反論として残したもの**: 「`nigashi` にはグレード補正が不要」という指摘は採らない。指摘が測っていたのは選手の級別（A1〜B2）で、本設計が補正するのはレースのグレード（SG〜一般）。別の軸であり、自分で測ると `nigashi` のシフトは `nige` と同程度だった（ADR-0071 §反論として残すもの）

  以下は当初の依頼内容（記録として残す）。
  - 依頼する観点（最低限この4つを明示する）:
    1. **spec に書かれた実測値・統計値を、自分で同じクエリを実行して再現できるか**（293日・母数中央値8走/17走/26走・逃げベースレート52.7%・会場差20.3pt・1コース1着率と逃げの一致率95.47%・公式期別データとの相関0.964・帰郷の日次差分が競合6名＋若松1名を再現）
    2. **前提として引用した既存コードの挙動が実際のコードと一致しているか**（`racer_aggregated_stats` が使えない3つの理由、`race_results.course_N` が無効列、`entry_course` がほぼNULL、`getVenuesWithTodaysRaces` がイン崩れ指数を返す、マイグレーション094が適用済み、`.throwOnError()` が適用済み）
    3. **設計のキー・粒度・集計窓が実データの分布に対して妥当か**。**特に「地力窓＝利用可能な全期間」と「調子窓＝90日」の2層が成立するか、母数が実質0になるセルが無いか、窓の定義が複数箇所で食い違っていないか**を明示的に確認させる
    4. **失敗モード**（エラーの握りつぶし、キャッシュの残留、完全性チェックの空振り、節境界ガードの誤爆、ロールバック時に残る状態、`predicted` のクランプ）
  - 指摘は鵜呑みにしない。**一次情報（実DB・実コード）で自分で再現してから採否を決める**。再現できたものは設計に反映し、できなかったものは反論を明記して残す
  - **受入基準**: レビュー結果を「自分の結論」「レビューでの指摘」「指摘への対応（採用/反論）」の3点でまとめ、このファイルまたは spec/plan に反映する。反映が終わるまで T1-1 以降に着手しない

---

## Phase 1: 純関数と実測の再確認（DBへの変更なし）

- [x] **T1-1** spec §1 の実測値を再測し、ずれていれば spec・plan を更新する
  - **完了（2026-09-24）**: 逃げベースレート52.98%・コース別まくり率（3.76/5.08/4.92/1.25/0.62）・1コース1着の逃げ一致率95.47%・グレード別逃げ率（G1 62.2/SG 61.3/G2 54.4/ippan 52.5/G3 51.1）・racer×course セル9,471・本日156レース13会場 は**すべて再現**
  - 期間だけ「2025-12-04〜2026-09-23（暦日294・開催292）」に動いた（前回は暦日295・開催293）。移動窓なので当然で、**固定値を書かない設計の正しさを裏付ける結果**。specの数値は測定日を明記したまま据え置く

- [x] **T1-2** `src/utils/wilson.js`（純関数）を新規作成する
  - `wilsonLowerBound(successes, n, z = 1.96)` → 下限（0〜1）。`n <= 0` は `null`。**successes は整数でなくてよい**（率から逆算した値を渡すため。整数に丸めると n=8・率70% が p̂=0.75 にずれる）
  - `wilsonLowerBoundFromRate(rate, n, z)` → 率（0〜1）から直接
  - `isSmallSample(successes, n, referenceRate, z)` → 下限が基準未満なら true
  - **完了（2026-09-24）**: p̂=0.70 で n=8→0.366 / 10→0.397 / 15→0.448 / 20→0.481 / 26→0.508 / 30→0.521 / 35→0.535 を小数第3位まで再現。`n=0` は null、`successes>n` は例外
  - ⚠️ **実装中に小標本フラグの基準を変更した**（plan §2.3.1）。「Wilson下限 < 抽出閾値」は実データで逃げ89.4%・まくり100%の行に立ち判別力が無かったため、`runs < 20` に変更し、確からしさは下限値の併記で見せる

- [x] **T1-3** `src/utils/digestMetrics.js`（純関数）を新規作成する
  - `computeSkillDelta` / `computePredicted`（クランプの有無を返す）/ `computeZScore` / `computeConsistency` / `computeFeaturedScore` / `isSmallSampleByRuns` / `clearsThresholdWithConfidence` / `wilsonLowerPercent` / `normalizeRacerName`
  - 閾値・ベースレート・母数の定数をここに1箇所だけ置く（`EXTRACTION_THRESHOLDS` / `NATIONAL_BASE_RATES` / `MIN_RUNS` / `MIN_BASELINE_RUNS` / `MIN_RUNS_90D` / `MIN_RELIABLE_RUNS`）
  - **完了（2026-09-24）**: ADR-0071 の4件（山本光雄 +22.4 / 横川聖志 −14.0 / 柘植政浩 +6.4 / 松尾拓 −0.8）を小数第1位まで再現。予測値 金子91.5% / 吉田92.4% でクランプ無し、超過時は100にクランプ。zスコアで **戸田4R（笠置 score 6.33）が 吉田3.92・茅原3.98 を上回り1位**になることを確認（当初案の生ptスコアでは3位だった）

---

## Phase 2: マイグレーションと夜間バッチ（B1）

- [x] **T2-1** (ユーザー承認) マイグレーション098を適用し、`APPLIED.md` を「適用済み」に更新する ← **2026-09-24 適用済み**（`APPLIED.md` の098行に実測結果を記録）
  - 適用前に長時間クエリが0件であることを確認する
  - 適用後の確認（読み取りのみ）: 4表が存在・RLS有効・`has_table_privilege('anon', …, 'SELECT')=true` かつ `'INSERT'=false`・公開読み取りポリシー各1件・`morning_digest_rows` のFKが `morning_digest_days` を指す
  - **受入基準**: 上記がすべて満たされ、`scripts/maintenance/check-anon-access.js --expect-applied` が通る

- [x] **T2-2** 集計RPC 2本を098に追加する（`compute_venue_course_technique_baseline` / `compute_racer_course_technique_stats`）
  - 094 の `compute_st_course_baseline()` と同じ形（`LANGUAGE sql`・`STABLE`・PUBLIC/anon/authenticated から REVOKE、GRANT EXECUTE しない）
  - **CTEに `MATERIALIZED` を付けた**（094が「付けないと base が複数回スキャンされ statement timeout」と実測済み）
  - `window_start` / `window_end` / `window_days` は実測値。`race_results.course_1〜6` は使わない
  - `compute_racer_course_technique_stats` は `venue_course_technique_baseline` を読む。**5-1の結果を書いた後に呼ぶ**。セルの `runs < 100` なら `race_grade='ALL'` 行へフォールバック
  - 調子窓（90日）の基準日は**JSTの当日**（データ最終日ではない）
  - **完了（2026-09-24）**: 本番へのDDL適用前に、**関数本体のSQLを読み取り専用のSELECTとしてそのまま実行して検証**した
    - ベースライン: **612行（ALL 144 ＋ グレード別 468）**、window_days 294、**CHECK制約違反0件**（`vctb_rate_by_course` / `vctb_grade_values` / `vctb_venue_range` / makuri非NULL）。戸田の全期間逃げ率 40.24%・尼崎 58.91% が180日窓の実測（40.2 / 59.2）と整合
    - 選手別: **9,471行**（見積り通り）、**CHECK制約違反0件**（`rcts_rate_by_course` / `rcts_runs_positive` / expected の NULL 0件）

- [x] **T2-2b** グレード補正後の値で T3-2 / T3-4 の受入基準を測り直す（T2-2 の前提）
  - グレード補正による期待値の変化（実測）:

    | 選手 | 実績率 | 期待値（会場のみ） | 期待値（会場×グレード） | 地力（旧→新） |
    |---|---|---|---|---|
    | 金子賢志 4539 c1 | 88.24% | 51.7 | **51.57** | +36.6 → **+36.7** |
    | 吉田裕平 4914 c1 | 90.32% | 54.7 | **55.31** | +35.6 → **+35.0** |
    | 笠置博之 4538 c4（まくり） | 38.46% | 5.30 | **5.30** | +33.2 → **+33.2** |
    | 横川聖志 4359 c4（逃がし） | 73.91% | 52.0 | **51.50** | +21.9 → **+22.4** |

  - 注目レースの順位（グレード補正後、2026-09-24）。**戸田4Rが1位を維持**:

    | 順位 | section | レース | 選手 | n | 地力 | z | イン崩れ | score |
    |---|---|---|---|---|---|---|---|---|
    | **1** | **makuri** | **戸田4R** | **笠置博之 4538** | 26 | +33.2 | **7.54** | 83.7% | **6.32** |
    | 2 | nige | 若松12R | 吉田裕平 4914 | 31 | +35.0 | 3.92 | 1.4% | 3.87 |
    | 3 | nige | 若松8R | 飛田江己 5191 | 43 | +28.4 | 3.73 | 2.1% | 3.65 |
    | 4 | nige | 三国12R | 茅原悠紀 4418 | 46 | +27.2 | 3.71 | 1.7% | 3.65 |
    | 5 | makuri | 戸田9R | 笠置博之 4538 | 16 | +19.6 | 3.46 | 97.6% | 3.38 |

  - **3位と4位が score 3.65 で同点**。plan §3.3 の「同点は `race_id` 昇順」が実際に必要になるケースなので、T3-4 の実装で必ず検証する

- [x] **T2-3** `scripts/lib/unchangedRows.js` の `NUMERIC_SCALES` に098の表を追加する（**完了 2026-09-24**。`morning_digest_days` はNUMERIC列を持たないため3表）
  - `venue_course_technique_baseline`: `nige_rate` 2 / `makuri_rate` 2 / `nigashi_rate` 2
  - `racer_course_technique_stats`: `nige_rate` `nige_expected` `makuri_rate` `makuri_expected` `nigashi_rate` `nigashi_expected` `nige_rate_90d` `makuri_rate_90d` `nigashi_rate_90d` 各2
  - `morning_digest_rows`: `metric_value` `metric_expected` `metric_skill_delta` `metric_venue_baseline` `metric_predicted` `metric_wilson_lower` `rate_90d` `motor_2rate` `volatility_percentile` 各2
  - **受入基準**: 未登録のままだと毎日全行が「変更あり」になることを、登録前後の書き込み行数の差で確認する（T2-4の2回目実行で検証）

- [x] **T2-4** `scripts/daily/update-racer-course-technique-stats.js` と `.github/workflows/aggregate-racer-course-technique-stats.yml`（JST 01:10）を作成する
  - `venue_course_technique_baseline` → `racer_course_technique_stats` の順に更新（後者が前者を参照する）
  - `upsertChangedRows` で変更のある行だけ書く
  - 「集計結果が0行」はエラー、「変更が無くて書き込み0行」は正常、として区別する
  - `continue-on-error` は付けない
  - **完了（2026-09-24）**: 本番実行の実測
    - 1回目: `venue_course_technique_baseline` **612行**（グレード別468＋ALL 144）、`racer_course_technique_stats` **9,471行（1,639選手）** を投入。集計期間 2025-12-03〜2026-09-23（**295日**）、母数100未満のグレード別セル180件はALL行へフォールバック
    - 2回目: **全10,083行が「変更なしスキップ」・書き込み0件**。`NUMERIC_SCALES`（T2-3）の登録が効いていることを確認
    - 直近90日に1走も無い (racer, course) の組は238件（率はNULLで保存、CHECK制約どおり）
  - ⚠️ **dry-runで実装バグを2件発見して修正した**
    1. **RPCの戻り値にも1000行の上限がかかる**。`.range()` を付けないとエラーにならず黙って切り捨てられ、最初の実行は「1000行・172選手」しか返らなかった。`.claude/rules/frontend-data-fetch.md` §5 が読み取り側について警告している罠が集計RPCにもある（plan.md §3.1 は「RPCにしない場合はページネーション必須」と書いていたが、**RPCでも必須**だった）
    2. dry-runではベースライン未書き込みのため期待値が全NULLになり、整合チェックが原因の分かりにくいエラーを出していた。表が空なら選手側をスキップして理由を明示するようにした
  - **データ精度検証**: 投入された9,471行を独立に書いたSQLと突き合わせ、`runs` / `nige_rate` / `makuri_rate` / `nigashi_rate` すべて **mismatch 0件**

- [x] **T2-5** `nigashi` の閾値と `makuri` の閾値を実データで最終確認する
  - **完了（2026-09-24）**: 投入済みテーブルで**直近14日の日次該当件数**を実測した

    | 指標 | 閾値 | 平均/日 | 範囲 |
    |---|---|---|---|
    | 逃げ | 70% | 32.3 | 23〜43 |
    | まくり | 25% | **2.5** | 0〜4 |
    | まくり | 20% | 7.6 | 〜12 |
    | 逃がし | +15pt | 51.4 | 〜63 |
    | 逃がし | +20pt | 17.8 | 12〜24 |
    | 逃がし | **+22pt** | **9.8** | **5〜17** |
    | 逃がし | +23pt | 8.1 | 〜15 |
    | 逃がし | +25pt | 4.6 | 0〜10 |

  - **`nigashi` は +22pt に確定**（+20ptでは17.8件で目標5〜15を超え、+25ptでは空の日が出る。+22ptは最小5件で0件の日が無い）。`EXTRACTION_THRESHOLDS.nigashi` を 20→22 に変更済み
  - **`makuri` は 25% のまま維持する**。2.5件/日（0〜4）と薄いが、20%に下げると ADR-0071 が絶対閾値を残した理由（競合と同じ土俵で数値を比較されたときに「同じ選手が出てこない」不信を招かない）が崩れる。**このセクションは本来まれな事象を拾うもの**として設計し、0件の日は spec §6 の状態設計どおり「本日は該当なし」を出す
  - 逃げは32.3件/日で表示上限25件が常に効く。「上位25件を表示」とUIに明示する（screens.md §7 の既定どおり）

- [x] **T2-6** バッチの書き込み量とDisk IO予算への影響を見積もり、記録する（`.claude/rules/data-acquisition.md`）
  - **完了（2026-09-24）**: 投入後の実測サイズ

    | テーブル | 行数 | heap | total（索引込み） | bytes/行 |
    |---|---|---|---|---|
    | `racer_course_technique_stats` | 9,471 | 1,240 kB | 1,496 kB | 134 |
    | `venue_course_technique_baseline` | 612 | 64 kB | 136 kB | 107 |
    | `morning_digest_rows` | 0（未生成） | — | 24 kB | — |
    | `morning_digest_days` | 0（未生成） | — | 16 kB | — |

  - **4表合計で約1.7 MB**。日次の書き込みは、B1が「変更のある行だけ」（2回目の実行で全行スキップを確認済み）、B2が約50行/日の delete→insert で**1日あたり数十KB**。1年でも `morning_digest_rows` は約1.8万行・約2.5 MB の見込み
  - 既存の `predictions`・`race_odds` 等と比べて無視できる規模で、Disk IO予算（BOA-357）への影響は軽微

---

## Phase 3: 早朝バッチ（B2）

- [x] **T3-1** `scripts/daily/generate-morning-digest.js` の骨格と完全性チェックを作る
  - `--date=YYYY-MM-DD`（既定は JST の当日）。日付の判定は **JSTで行う**（DBの `current_date` はUTC。spec §1.6）
  - 完全性チェック4項目（plan.md §3.2。**会場数が前日の70%以上**を含む）を満たさなければ**書かずに終了**（終了コード0、ログに理由）
  - `predictions` は**必須にしない**。欠けていれば `volatility_percentile` を NULL にし、`featured` を生成せず `notes` に理由を残す
  - **書き込み順は `morning_digest_rows` が先、`morning_digest_days` が最後**（レビュー指摘M-8）。`morning_digest_days` の行の存在を完了マークとして扱う。逆順だと day 行だけ書かれた状態でクラッシュしたとき、ページが全セクションを「該当0件」と表示し、ADR-0070 が区別すると明言した「未生成」と「0件」が混同される。FKは `morning_digest_rows` → `morning_digest_days` なので、rows を先に書くには **day 行を先に INSERT してから rows、最後に `generated_at` を UPDATE** する形にする
  - `morning_digest_rows` は `digest_date` で全削除→再投入（1日ぶん約50行なので差分更新しない）
  - **受入基準**: 出走表が未投入の日付、または会場数が前日の70%未満の日付を指定したとき、行を書かずに理由をログに出して終了する。`--date` で過去日を指定して再生成できる。`generated_at` が NULL の day 行をページが「未生成」として扱う

- [x] **T3-2** `nige` / `makuri` / `nigashi` セクションの抽出を実装する
  - `racer_course_technique_stats` と当日の `race_entries` を結合。`runs >= 10`、ベースラインの `runs >= 100`
  - 並びは `skill_delta` 降順。`nige` は最大25件
  - `makuri` は `detail.entryCourseTendency` に枠→進入コース分布を入れる（FR-9）
  - `is_small_sample` は `src/utils/wilson.js` で指標ごとのベースレートと比較して立てる
  - **受入基準**: 2026-09-24 を対象に実行したとき、`nige` に **金子賢志（racer_id=4539、津1R・88.24%・期待51.57%・地力+36.7pt）** と **吉田裕平（racer_id=4914、若松12R・90.32%・期待55.31%・地力+35.0pt）** が含まれ、値が**小数第2位まで**一致する。`makuri` に **笠置博之（racer_id=4538、戸田4R・38.46%・期待5.30%・地力+33.2pt）** が含まれる。`nigashi` に **横川聖志（racer_id=4359、戸田8R・73.91%・期待51.50%・地力+22.4pt）** が含まれる。同じ定義のSQLを独立実行した結果と全行一致する（T2-2bで測定済みの値）
  - ⚠️ **選手は氏名でなく `racer_id` で照合する**。同姓同名が実在する（山本幸也 = 5268 と 5385、松尾拓 = 4808 と 4828）。レビュー指摘L-3
  - `race_entries.player_name` は全角スペース詰め（`"山本　　幸也"`）。`morning_digest_rows.racer_name` に入れる際に**連続空白を1つに正規化する**（そのままだと表示とSNS本文が崩れる）

- [x] **T3-3** `flying` / `returned` セクションの抽出を実装する
  - `flying`: 前日（JST）の `finish_mark='F'`。対象日が 2026-09-21 より前なら `flying_data_complete=false`
  - `returned`: 前日の出走表にいたが、当日も同一会場の開催が続いているのに当日の出走表にいない選手。**1会場20件超で抑制**し `suppressed_venues` に記録（黙って0件にしない）
  - `race_special_notes`（`category='absence'`）に該当があれば `detail.reason` に理由を入れる。無くても行は出す
  - ⚠️ **`race_special_notes` の結合キーは「前日（D）」**（レビュー指摘M-13）。石本裕武の理由行は `race_date = 2026-09-23`（D）であって `digest_date`（D+1）ではない。1日ずれると理由が永久に出ない。`(venue_code, race_date=D, racer_id, category='absence')` で引く
  - **受入基準**: **`digest_date = 2026-09-24`（＝前日 D = 2026-09-23 を対象）** で実行したとき、`flying` が **平見真彦（racer_id=4509、江戸川10R・枠1・F.01）** と **山本幸也（racer_id=5268、常滑9R・枠1・F.02）** の**2件だけ**。`returned` が7件（racer_id = 3931 / 4432 / 5194 / 3461 / 4700 / 3866 / 5267）で、**5267（石本裕武）にだけ** `detail.reason = "帰郷（公傷のため）"` が入る。直近14日の各日で `returned` が0〜20件に収まる
  - ⚠️ spec FR-14 は「2026-09-23を対象に」、当初の本タスクは「2026-09-24を対象に」と書いており**1日ずれていた**（レビュー指摘M-14）。本タスクでは `digest_date`（D+1側）で統一する。spec 側も同じ意味に読めるよう注記した
  - ⚠️ 節境界は「観測されなかった」のではなく**年間約11回起きる**。全期間295日で検出数20超の会場×日が11件、最大47件（2026-03-09 若松47 / 2026-03-08 平和島46 / 2026-04-23 唐津46）。正常時の最大は4〜10件で、11〜20の帯が空なので**閾値20は妥当**（レビュー指摘M-12）。spec FR-14 の「直近14日では破綻が観測されなかった」という根拠説明は弱い

- [x] **T3-4** `featured` セクションの選定を実装する（plan.md §3.3）
  - **`z = (rate - expected) / sqrt(expected × (1 - expected) / n)` で標準化してから** `score = z × consistency` で並べる。**pt単位の `skill_delta` をそのまま横断比較しない**（ベースレートが逃げ53%・まくり4%と桁違いのため、生ptだと恒常的に `nige` が選ばれる）
  - 同点は `race_id` 昇順で決定的に解決
  - `volatility_percentile` が NULL（`isFallback`、または `predictions` 未生成）の行は候補から除外。全候補がNULLなら `featured` を書かない
  - 選定理由の文を `detail.reason` にテンプレートで組み立てる（**数値の根拠を必ず含める**）
  - 候補0件の日は `featured` を書かない
  - **受入基準**: 同じ入力で10回実行して常に同じ `race_id` が選ばれる。2026-09-24 では **戸田4R（`2026-09-24-02-04`、笠置博之 racer_id=4538、まくり地力+33.2pt・z=7.54・イン崩れ指数83.7%・score 6.32）** が選ばれる（T2-2bで測定済み）。**当初案（生ptスコア）では若松12Rが1位で戸田4Rは3位だった**ので、実装が旧式に戻っていないことの検証になる
  - **同点解決を必ず検証する**。同日の3位（若松8R 飛田江己）と4位（三国12R 茅原悠紀）が score 3.65 で同点になるため、`race_id` 昇順で `2026-09-24-10-12`（三国）が `2026-09-24-20-08`（若松）より先に来ることを確認する

- [x] **T3-5** `.github/workflows/generate-morning-digest.yml`（JST 05:30 と 06:30）を作成する
  - 2回目は1回目が完全な結果を書けていれば何もしない
  - 2回目でも完全性チェックを満たせなければ**ジョブを失敗させる**（`continue-on-error` を付けない）
  - **受入基準**: `workflow_dispatch` で手動実行でき、当日ぶんが生成される。既に生成済みの日に再実行しても結果が変わらない（冪等）

---

### Phase 3 の完了記録（2026-09-24）

本番で 2026-09-22 / 09-23 / 09-24 の3日分を生成し、受入基準をすべて満たした。

| 日 | 会場/レース | 注目 | 逃げ（候補） | まくり | 逃がし | フライング | 帰郷 | 合計 |
|---|---|---|---|---|---|---|---|---|
| 09-22 | 14/168 | 1 | 25（34） | 2 | 14 | 0 | 2 | 44 |
| 09-23 | 13/156 | 1 | 25（30） | 3 | 9 | 5 | 8 | 51 |
| 09-24 | 13/156 | 1 | 25（29） | 2 | 5 | 2 | 7 | 42 |

**受入基準の確認**（2026-09-24）:
- `nige`: 金子賢志(4539) 88.24% / 期待51.59 / 地力+36.60 / 予測90.10、吉田裕平(4914) 90.63% / 55.65 / +35.00 / 92.00
- `makuri`: 笠置博之(4538) 38.46% / 5.28 / +33.20 / 40.70
- `nigashi`: 横川聖志(4359) 73.91% / 51.49 / +22.40 / 61.90
- `flying`: **平見真彦(4509) 江戸川10R 枠1 F.01** と **山本幸也(5268) 常滑9R 枠1 F.02** の**2件だけ**
- `returned`: **7件**（3931/4432/5194/3461/4700/5267/3866）。**5267（石本裕武）にだけ** `detail.reason = "帰郷（公傷のため）"`
- `featured`: **戸田4R（2026-09-24-02-04）笠置博之 score=6.34**。3回連続実行で同一（決定的）
- 選手名は全角スペース1つに正規化
- `is_small_sample` は n=16 で true・n=26 で false、`metric_wilson_lower` は 10.20〜75.80 と実際にばらつく
- クランプ発生 0 行、`suppressed_venues` 空、`flying_data_complete` true

**実装中に見つけた不具合（修正済み）**: 帰郷判定で `is_absent=true` の選手を前日名簿から除外していたため、**黄金井力良（津、4432）を取りこぼして6件になっていた**。欠場は帰郷の前段であることが多く、除外すると帰郷した選手そのものを落とす。前日・当日とも欠場者を含めた名簿で比較するよう修正し7件になった。指標セクションは「本日走る選手」が対象なので従来どおり除外する。

**追加したもの**: `scripts/maintenance/verify-morning-digest.js`。生成スクリプトは完全性チェック未達時に「書かずに終了コード0」で終わる設計のため、それだけだと毎日静かに空のままになりうる。2回目（JST 06:30）の後にこれを走らせ、書けていない日を失敗として顕在化させる。正常日と未生成日の両方で動作確認済み。

---

## Phase 4: サービス層と画面（案A）

- [x] **T4-1** `getMorningDigest(date)` を `src/services/supabaseDataService.js` に追加する
  - `morning_digest_days` と `morning_digest_rows` を `digest_date` で引き、セクション別に整形して返す
  - `withCache`。TTLは当日30分・過去日7日を**明示的に渡す**。既存の `inferTtlFromKey`（`supabaseDataService.js:99`）は race_id 形式の末尾を要求する正規表現のため、`morning-digest-2026-09-20` のようなキーではマッチせず過去日でも30分になる（レビュー指摘L-1）
  - **`if (error) return []` を書かない**。失敗は例外として伝播させる
  - `morning_digest_days.generated_at` が NULL の日は「未生成」として返す（「該当0件」と区別する）
  - **受入基準**: `npm run verify:query-errors` が通る。存在しない日付で空の結果（例外ではない）を返し、DB障害では例外を投げる。過去日のキャッシュTTLが7日になっていることをテストで確認する

- [x] **T4-2** 共通コンポーネント3点を作る（`DigestSection` / `DigestRaceCard` / `RateWithBaseline`）
  - `src/components/digest/` に新設し、`index.js` の barrel export を作る
  - `DigestRaceCard` の指標部分は **props の分岐ではなく `children` で差し替える**
  - 色は `design-tokens.css` の変数のみ。**ページ背景に直接乗るテキストは意味トークン（`--text-primary` / `--text-secondary`）必須**
  - 差分バッジは**色だけに頼らず ▲▼ の記号も付ける**
  - **受入基準**: 3コンポーネントが `nige`/`makuri`/`nigashi` の3セクションで再利用されている。モバイル320pxでページ全体の横スクロールが出ない

- [x] **T4-3** `MorningDataDigest.jsx` とルーティング・SEOを実装する（T4-2と1PRにまとめてよい）
  - `src/AppRouter.jsx` に `<Route path="today" …>`。`TRANSLATED_PATHS` には**登録しない**（ja専用）
  - `useSocialMeta` の canonical は `?date=` の有無にかかわらず常に `/today`
  - 4状態（ローディング／取得失敗／該当0件／データ不完全）をすべて実装する（screens.md §6）。**セクションを消さない**
  - 選手名・会場名に `translate="no"`
  - **受入基準**: Playwrightで `/today` と `/today?date=2026-09-23` を開き、ライト／ダークの両方でスクリーンショットを撮って目視確認する。`document.querySelector('link[rel=canonical]')` が `?date=` 付きでも `/today` を指す

- [x] **T4-4** 残りのコンポーネント4点（`FeaturedRaceCard` / `PeriodTrendSparkline` / `EntryCourseTendencyBar` / `FlyingRacerList` / `ReturnedRacerList`）を実装する
  - スパークラインはインラインSVG（Rechartsを使わない）
  - `PeriodTrendSparkline` は `racer_period_stats` 由来。**最新期が2026年2期であり「今期のデータは期終了後に反映される」旨をUIに出す**（spec FR-8）
  - **受入基準**: 推移が3期未満の選手でスパークラインが破綻しない。ダークモードでSVGのstrokeがページ背景に埋もれない

- [x] **T4-5** ホーム（`VenueGridPage.jsx`）に `/today` への導線を1つ追加する
  - `TodaysVolatilityHighlights` の近傍
  - **受入基準**: 追加によってホームのCLSが悪化しない（要素の高さを確保する）。`npm run test:e2e` が通る

- [x] **T4-6** `scripts/generate-sitemap.js` の `staticPages` に `/today` を追加する（**T4-3と同一PRで必須**）
  - **受入基準**: `npm run verify:sitemap` が通る

---

### Phase 4 の完了記録（2026-09-24）

`/today` を実装し、Playwrightで自己検証した（dev サーバーは検証後に停止済み）。

**検証結果**:
- 5セクションすべて描画。件数は「上位25件 / 29件」「2件」「5件」「2件」「7件」で、バッチの出力と一致
- **注目レースは戸田4R（笠置博之）**、理由の文が数値の根拠つきで表示される
- `document.documentElement.scrollWidth === window.innerWidth`（375px）で**横スクロールなし**
- canonical は `?date=` の有無にかかわらず `https://www.boat-ai.jp/today`
- **ライト／ダークの両方をスクリーンショットで目視確認**。意味トークンが正しく反転し、見出し・注記が不可視にならない
- `?date=2026-09-22`: 「9月22日（火） 14会場 168レース」＋「過去日」バッジ。その日の件数（34候補/25、2、14、0、2）が出る
- **「未生成」と「該当0件」が区別されている**: 2026-09-01（未生成）はセクション0件＋「この日のデータは生成されていません」、2026-09-22（フライング0件）はセクションを残したまま「前日のフライングはありませんでした」
- ホームの導線: `href="/today"`、高さ69pxで固定（CLS対策）
- `npm run verify:sitemap` OK（静的ルート25件）、`npm run verify:query-errors` OK
- **`npm run test:e2e` 919件パス・デグレなし**

**実装中に直したもの**:
1. ESLint が effect 内の同期 `setState` を指摘（カスケードレンダリング）。`RacePitReportSection` と同じ型（結果を「どの日付・何回目の試行か」とセットで持ち、loading を導出する）に書き直した（`.claude/rules/frontend-data-fetch.md` §3）
2. worktree に `VITE_SUPABASE_*` が無く `supabase` が null になっていた。`.env.local`（gitignore対象）に公開用の2変数だけを置いた

**付随して判明**: モックの日付表記「9月24日（水）」は誤りで、2026-09-24 は**木曜**（Nodeで検証）。実装側の `formatJaDate` が正しい。

---

## Phase 5: SNS展開

- [ ] **T5-1** `generate-morning-digest.js` から `sns_topics` にネタを登録する（種別 `morning_digest`）
  - **受入基準**: 生成後に sns-hub 管理画面（`/admin/sns-hub`）にネタが現れる

- [ ] **T5-2** チャネル別の生成プロンプトに `morning_digest` を追加する（X / ブログ / note / YouTube）
  - `docs/operation/sns-pipeline-{x,blog,note,youtube}.md` に型を追記
  - 生成前に `getRecentRevisions()` と `getActiveInsights({platform, format, language})` を確認する（`.claude/rules/sns-content-generation.md`）
  - `checkRiskRules(text, platform)` を通し該当を `risk_flags` に記録（ブロックしない）
  - リンクは**常に `?date=` なしの `/today`**
  - 「競艇」使用禁止
  - **受入基準**: 4チャネルぶんの下書きが sns-hub の承認待ちに現れ、本文の数値が `morning_digest_rows` と一致する。**投稿の最終送信は行わない**（1件ごとにユーザーの明示承認）

- [ ] **T5-3** `/today` をAIスナップショットの対象に追加する
  - `scripts/generate-ai-snapshots.js` と `src/config/aiCrawlerBots.js` の `resolveSnapshotPath`
  - **静的な説明部分（ページの目的・各指標の定義）だけ**を生成する（`/winning-technique` と同じ方式。日替わりの中身は入らない）
  - **受入基準**: `npm run build` 後に `dist/ai-snapshots/today.html` が生成され、`scripts/verification/verify-ai-snapshots.js` が通る。**本番URLでの検証まで行う**（ローカルビルド成功は偽陽性になる実績あり）

---

## Phase 6: 仕上げ

- [x] **T6-1** `docs/design/morning-data-digest/content-index.json` を作成する（フローA-2） ← **作成済み**（コミット 52f77d57）
  - テンプレート: `docs/design/_template/content-index.json`
  - **受入基準**: `npm run verify:content-index` が通る

- [ ] **T6-2** ブログ記事を1本書く（フローA-3の新機能リリース必須ルール）
  - 本文2,000〜3,500字、見出しで構造化、実際のスクリーンショットを最低1枚、「よくある質問」セクション、内部リンク最低1本
  - `blogPosts.js` の `title` 30〜60字・`description` 120〜160字、カバー画像の alt は空にしない
  - **データを扱う記事なので、比較対象が3件以上あるものは表や図解で構造化する**
  - 公開前に spec §「ブログ記事の公開前品質チェック」の6観点を実施し、合格/不合格を明示する
  - **受入基準**: `node scripts/maintenance/check-deprecated-terms.js` が通る。「競艇」が本文・見出し・UIに無い

- [ ] **T6-3** 完了監査と検証をまとめて実行する
  - このファイルの全チェックボックスと実際のコミット・コードを突き合わせる（記憶ではなくファイルと実コードの対応で判定する）
  - `npm run build` / `npm run test:e2e` / `npm run verify:sitemap` / `npm run verify:content-index` / `npm run verify:er-diagram` / `npm run verify:adr-numbers` / `npm run verify:migration-numbers` / `npm run verify:query-errors`
  - **新規のデータ集計機能なのでデータ精度の検証を独立ステップとして行う**（`.claude/rules/analysis.md`）。コードレビューとは別に「集計結果が実データと一致しているか」だけを見る
  - **受入基準**: 全コマンドが通り、データ精度検証の結果を完了報告に含める

---

## Phase 7: 定時実行の実測（2026-09-25 の障害を受けて追加）

`/today` が9/25の朝10時を過ぎても未生成だった障害の後処理。**コードはマージ済みだが「完了の定義」（`.claude/rules/data-acquisition.md`）のC（継続監視）が未達**で、定時実行での成功をまだ一度も観測していない。詳細な経緯は [plan.md §2.4](plan.md)、[ADR-0066 §改訂1](../../adr/0066-scraping-execution-consolidation-to-vercel.md)。

- [ ] **T7-1** Vercel Cron の定時実行が成功したことを実測する（**2026-09-26 以降に実施**）
  - 前提: PR #827 マージ済み（本番デプロイ `76883297e`、2026-09-25 JST 11:39）、マイグレーション099適用済み（両ジョブ `mode='live'`）
  - 実測クエリ:
    ```sql
    select job, mode, last_target_date, last_success_at, last_rows_written, last_error, consecutive_failures
      from scrape_job_state
     where job in ('racer_course_technique_stats','morning_digest');
    select max(window_end) from racer_course_technique_stats;
    select digest_date, generated_at from morning_digest_days order by digest_date desc limit 3;
    ```
  - **受入基準**（4つすべて）
    1. `racer_course_technique_stats.last_success_at` が **JST 13:00台**（旧 GitHub Actions の 01:10 ではない）
    2. `morning_digest.last_target_date` が当日、`last_success_at` が **JST 05:30台**
    3. `max(window_end)` が**前日**（13:00 の集計が kfile_sync の後に走っている証拠）
    4. `morning_digest_days` に当日の行があり、`generated_at` が当日 JST 05:30台
  - 満たさない場合は Vercel のログ（関数 `api/cron/morning-digest`・`api/cron/racer-course-technique-stats`）と `scrape_job_state.last_error` / `last_report` を見る。手動復旧は「集計 → ダイジェスト」の順に GitHub Actions を `workflow_dispatch`（両ワークフローとも手動実行用に残してある）
  - **この確認が済むまで BOA-402 を Done にしない**

- [ ] **T7-2** 監視が実際に鳴ることを確認する
  - `scrape-monitor`（`scripts/lib/scrapeJobs/monitor.js` の `evaluateJobStates`）の `daily_overdue` は、`kind: "daily"` かつ `mode='live'` のジョブが `targetTimeJst` から3時間以上たっても当日分を処理していなければ Slack へ通知する。`morning_digest` は `targetTimeJst=05:30` なので **JST 08:30以降**に鳴るはず
  - **受入基準**: T7-1 が満たされている日は通知が来ない／意図的に未処理の状態を作った場合に通知が来る、のどちらかを確認できる

---

## Phase 2 として切り離した範囲（このtasks.mdの対象外）

`race_special_notes` の `equipment_change` 区分に実例が無いため、**本日の途中追加選手・本日の中間整備**は対象外（spec §3）。関連: [BOA-319](https://linear.app/boat-ai/issue/BOA-319) / [BOA-320](https://linear.app/boat-ai/issue/BOA-320) / [BOA-328](https://linear.app/boat-ai/issue/BOA-328)。

**昨日の帰郷選手は T3-3 で Phase 1 に含む**（2026-09-24に格上げ。`race_entries` の日次差分で算出できると判明したため）。
