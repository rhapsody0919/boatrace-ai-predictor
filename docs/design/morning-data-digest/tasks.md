# 「本日のデータ一覧」ページ tasks

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)

Linear: [BOA-402](https://linear.app/boat-ai/issue/BOA-402)　モック（承認済み、2026-09-24・案A）: https://claude.ai/artifact/7Dytu5kJjB82f7xLngAoHP

ADR: [ADR-0070](../../adr/0070-morning-digest-precomputed-rows.md) / [ADR-0071](../../adr/0071-venue-adjusted-skill-delta.md)

マイグレーション案（**未適用**）: [097](../../db-migration/097_morning_data_digest.sql)

---

## 着手前に読むもの

- 会話が圧縮された直後・別セッションで再開する際は、**記憶ではなくこのファイルを読み直してから続ける**（`.claude/rules/sdd-workflow.md`）。`/step4` を都度呼ぶ運用にする
- 粒度は目安。**同じファイルを触るタスクは1PRにまとめてよい**（UIはタブ/セクション単位でPlaywrightの自己検証が1回で済む）
- `src/**` を編集する前に `.claude/rules/frontend-data-fetch.md` と `.claude/rules/component-reuse.md` が自動で読み込まれる。`supabaseClient.js` は `.throwOnError()` 既定適用（[ADR-0069](../../adr/0069-query-error-propagation.md)）なので、**`if (error) return []` を書かない**
- spec §1 の実測値は 2026-09-24 時点のもの。**日が経つほど古くなるため、T1-1 の着手時に再実測して spec を更新する**

---

## ⛔ ゲート: `/step4` の前に独立エージェントのレビューを通す（省略不可）

`.claude/rules/sdd-workflow.md`「実装着手前に天才エンジニアの独立レビューを必ず挟む」（2026-09-23〜）。phase a で同じ位置に33件の指摘が出て、うち数値・前提の誤りで設計を巻き戻した実績がある。

- [x] **G-0** Agent tool で独立エージェントに spec.md / screens.md / plan.md / tasks.md / ADR-0070 / ADR-0071 / 097 を渡し、批判的レビューを依頼する

  **完了（2026-09-24）。Critical 3件・High 7件・Medium 14件・Low 7件の指摘。うち重要なものは全て自分で実測して再現し、設計に反映した。** 反映内容:
  - **C-1**: `featured` のスコア式 `skill_delta × consistency` が破綻（実測で若松12Rが1位、モックの戸田4Rは3位）。逸脱をzスコアに標準化する式に変更（plan §3.3。修正後は戸田4Rが1位）
  - **C-2**: FR-7 の受入基準「ホームと表示値が一致」は原理的に不可能（`predictions` は日中に再生成。実測で9/20は08:36〜22:51の15時間帯に分散）。「`generated_at` 時点の値と一致」に変更
  - **C-3**: `getVenuesWithTodaysRaces()` は会場コードの配列しか返さない。screens.md §4 を訂正
  - **H-1**: `volatilityPercentile` は 0〜1。×100 して保存する旨を plan §2.2・097 に明記
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

- [ ] **T1-1** spec §1 の実測値を再測し、ずれていれば spec・plan を更新する
  - 対象: データ期間（`min(race_date)` と日数）／1コース進入の母数分布（30・60・90・120・180・全期間）／逃げのベースレート／会場別逃げ率の最大最小／`finish_mark` の100%運用開始日／`race_special_notes` の件数
  - **受入基準**: 再測したクエリと結果を spec §1 に反映し、変化があった箇所を明示する。窓の日数が変わっていても**固定値をコードに書かない**方針は変えない

- [ ] **T1-2** `src/utils/wilson.js`（純関数）を新規作成する
  - `wilsonLowerBound(successes, n, z = 1.96)` → 下限（0〜1）。`n === 0` は `null`
  - `isSmallSample(successes, n, baseRate)` → Wilson95%下限が `baseRate` 未満なら true
  - **受入基準**: p̂=0.70 のとき n=8→0.366 / n=20→0.481 / n=30→0.521 / n=35→0.535 を**小数第3位まで**再現する（spec §1.2 の表と一致）。`n=0` で例外を投げずに `null` を返す

- [ ] **T1-3** `src/utils/digestMetrics.js`（純関数）を新規作成する
  - `computeSkillDelta({ rate, expected })` → `rate - expected`
  - `computePredicted({ venueBaseline, skillDelta })` → `[0, 100]` にクランプし、クランプしたかを `{ value, clamped }` で返す（plan.md §2.2）
  - 指標ごとのベースレート定数（逃げ・まくり・逃がし）をここに1箇所だけ置く。**他所に第2の定義を作らない**
  - **受入基準**: ADR-0071 の表の4件（山本光雄 course2 +22.4pt / 横川聖志 course3 −14.0pt / 柘植政浩 course2 +6.4pt / 松尾拓 course4 −0.8pt）を**小数第1位まで**再現する。`clamped` が金子賢志（91.5%）・吉田裕平（92.4%）では false になる

---

## Phase 2: マイグレーションと夜間バッチ（B1）

- [ ] **T2-1** (ユーザー承認) マイグレーション097を適用し、`APPLIED.md` を「適用済み」に更新する
  - 適用前に長時間クエリが0件であることを確認する
  - 適用後の確認（読み取りのみ）: 4表が存在・RLS有効・`has_table_privilege('anon', …, 'SELECT')=true` かつ `'INSERT'=false`・公開読み取りポリシー各1件・`morning_digest_rows` のFKが `morning_digest_days` を指す
  - **受入基準**: 上記がすべて満たされ、`scripts/maintenance/check-anon-access.js --expect-applied` が通る

- [ ] **T2-2** 集計RPC 2本を097に追加する（`compute_venue_course_technique_baseline` / `compute_racer_course_technique_stats`）
  - 094 の `compute_st_course_baseline()` と同じ形（`SECURITY INVOKER`・`STABLE`・service_role のみ EXECUTE、anon/authenticated は REVOKE）
  - `window_start` / `window_end` / `window_days` は**実測値**を返す。365等の固定値を書かない
  - 除外条件は plan.md §2.2 の共通条件どおり。**`race_results.course_1〜6` を使わない**
  - **受入基準**: RPCの戻り値と、同じ定義を `node -e` で書いた独立のSQLの結果が**全行一致**する。`venue_course_technique_baseline` が約612行（実在セル468＋`ALL` 144）、`racer_course_technique_stats` が実測9,471行と一致する
  - **注**: T2-1で097を適用済みの場合、RPCの追加は別マイグレーション（098）に切り出す。T2-1着手前にこのタスクを終えて1ファイルにまとめるのが望ましい

- [ ] **T2-3** `scripts/lib/unchangedRows.js` の `NUMERIC_SCALES` に097の4表を追加する
  - `venue_course_technique_baseline`: `nige_rate` 2 / `makuri_rate` 2 / `nigashi_rate` 2
  - `racer_course_technique_stats`: `nige_rate` `nige_expected` `makuri_rate` `makuri_expected` `nigashi_rate` `nigashi_expected` `nige_rate_90d` `makuri_rate_90d` `nigashi_rate_90d` 各2
  - `morning_digest_rows`: `metric_value` `metric_expected` `metric_skill_delta` `metric_venue_baseline` `metric_predicted` `rate_90d` `motor_2rate` `volatility_percentile` 各2
  - **受入基準**: 未登録のままだと毎日全行が「変更あり」になることを、登録前後の書き込み行数の差で確認する（T2-4の2回目実行で検証）

- [ ] **T2-4** `scripts/daily/update-racer-course-technique-stats.js` と `.github/workflows/aggregate-racer-course-technique-stats.yml`（JST 01:10）を作成する
  - `venue_course_technique_baseline` → `racer_course_technique_stats` の順に更新（後者が前者を参照する）
  - `upsertChangedRows` で変更のある行だけ書く
  - 「集計結果が0行」はエラー、「変更が無くて書き込み0行」は正常、として区別する
  - `continue-on-error` は付けない
  - **受入基準**: 本番で1回目に全行が投入され、**2回目の実行で全行が「変更なしスキップ」になる**（`aggregate-course-baseline-stats.yml` と同じ確認）。実行時間を記録し、RPC化の要否（plan.md 未確定事項#5）を判断する

- [ ] **T2-5** `nigashi` の閾値（**+20pt**）と `makuri` の閾値を実データで最終確認する
  - `nigashi` は 2026-09-24 の実測で確定済み（+10pt→115件 / +15pt→43件 / **+20pt→12件（9会場、戸田1件）** / +25pt→3件）。`racer_course_technique_stats` 投入後に**直近14日ぶん**で再確認する
  - `makuri` は **25%のままだと0〜4件/日**でセクションとして薄い（全DBの候補セルは27/9,471。20%で81、15%で235）。閾値を20%に下げるか「まくり差し」を含めるかを実データで判断する（plan.md 未確定事項#4）
  - **受入基準**: `nigashi` の日次該当件数が5〜15件に収まり、**特定の1会場に集中しない**。`makuri` が日次で1件以上出る閾値を選ぶ。両方の測定結果を plan.md §7 に記録する

- [ ] **T2-6** バッチの書き込み量とDisk IO予算への影響を見積もり、plan.md に記録する（`.claude/rules/data-acquisition.md`）
  - B1: `venue_course_technique_baseline` 約612行 ＋ `racer_course_technique_stats` 9,471行。`upsertChangedRows` により2日目以降は変更行のみ
  - B2: `morning_digest_rows` 約50行/日の delete→insert ＋ `morning_digest_days` 1行/日
  - **受入基準**: 見積りと、本番実行前後のDisk IO消費の実測を完了報告に含める

---

## Phase 3: 早朝バッチ（B2）

- [ ] **T3-1** `scripts/daily/generate-morning-digest.js` の骨格と完全性チェックを作る
  - `--date=YYYY-MM-DD`（既定は JST の当日）。日付の判定は **JSTで行う**（DBの `current_date` はUTC。spec §1.6）
  - 完全性チェック4項目（plan.md §3.2。**会場数が前日の70%以上**を含む）を満たさなければ**書かずに終了**（終了コード0、ログに理由）
  - `predictions` は**必須にしない**。欠けていれば `volatility_percentile` を NULL にし、`featured` を生成せず `notes` に理由を残す
  - **書き込み順は `morning_digest_rows` が先、`morning_digest_days` が最後**（レビュー指摘M-8）。`morning_digest_days` の行の存在を完了マークとして扱う。逆順だと day 行だけ書かれた状態でクラッシュしたとき、ページが全セクションを「該当0件」と表示し、ADR-0070 が区別すると明言した「未生成」と「0件」が混同される。FKは `morning_digest_rows` → `morning_digest_days` なので、rows を先に書くには **day 行を先に INSERT してから rows、最後に `generated_at` を UPDATE** する形にする
  - `morning_digest_rows` は `digest_date` で全削除→再投入（1日ぶん約50行なので差分更新しない）
  - **受入基準**: 出走表が未投入の日付、または会場数が前日の70%未満の日付を指定したとき、行を書かずに理由をログに出して終了する。`--date` で過去日を指定して再生成できる。`generated_at` が NULL の day 行をページが「未生成」として扱う

- [ ] **T3-2** `nige` / `makuri` / `nigashi` セクションの抽出を実装する
  - `racer_course_technique_stats` と当日の `race_entries` を結合。`runs >= 10`、ベースラインの `runs >= 100`
  - 並びは `skill_delta` 降順。`nige` は最大25件
  - `makuri` は `detail.entryCourseTendency` に枠→進入コース分布を入れる（FR-9）
  - `is_small_sample` は `src/utils/wilson.js` で指標ごとのベースレートと比較して立てる
  - **受入基準**: 2026-09-24 を対象に実行したとき、`nige` に **金子賢志（racer_id=4539、津1R・88.2%・地力+36.6pt・予測91.5%）** と **吉田裕平（racer_id=4914、若松12R・90.3%・地力+35.6pt・予測92.4%）** が含まれ、値が**小数第1位まで**一致する。`makuri` に **笠置博之（racer_id=4538、戸田4R・38.5%・地力+33.2pt・予測40.6%）** が含まれる。同じ定義のSQLを `node -e` で独立実行した結果と全行一致する
  - ⚠️ 期待値は**グレード補正なし**で測った値。T2-2でグレード軸を入れた後は**測り直す**（実測で表示行の平均1.29pt・最大8.00pt動く）
  - ⚠️ **選手は氏名でなく `racer_id` で照合する**。同姓同名が実在する（山本幸也 = 5268 と 5385、松尾拓 = 4808 と 4828）。レビュー指摘L-3
  - `race_entries.player_name` は全角スペース詰め（`"山本　　幸也"`）。`morning_digest_rows.racer_name` に入れる際に**連続空白を1つに正規化する**（そのままだと表示とSNS本文が崩れる）

- [ ] **T3-3** `flying` / `returned` セクションの抽出を実装する
  - `flying`: 前日（JST）の `finish_mark='F'`。対象日が 2026-09-21 より前なら `flying_data_complete=false`
  - `returned`: 前日の出走表にいたが、当日も同一会場の開催が続いているのに当日の出走表にいない選手。**1会場20件超で抑制**し `suppressed_venues` に記録（黙って0件にしない）
  - `race_special_notes`（`category='absence'`）に該当があれば `detail.reason` に理由を入れる。無くても行は出す
  - ⚠️ **`race_special_notes` の結合キーは「前日（D）」**（レビュー指摘M-13）。石本裕武の理由行は `race_date = 2026-09-23`（D）であって `digest_date`（D+1）ではない。1日ずれると理由が永久に出ない。`(venue_code, race_date=D, racer_id, category='absence')` で引く
  - **受入基準**: **`digest_date = 2026-09-24`（＝前日 D = 2026-09-23 を対象）** で実行したとき、`flying` が **平見真彦（racer_id=4509、江戸川10R・枠1・F.01）** と **山本幸也（racer_id=5268、常滑9R・枠1・F.02）** の**2件だけ**。`returned` が7件（racer_id = 3931 / 4432 / 5194 / 3461 / 4700 / 3866 / 5267）で、**5267（石本裕武）にだけ** `detail.reason = "帰郷（公傷のため）"` が入る。直近14日の各日で `returned` が0〜20件に収まる
  - ⚠️ spec FR-14 は「2026-09-23を対象に」、当初の本タスクは「2026-09-24を対象に」と書いており**1日ずれていた**（レビュー指摘M-14）。本タスクでは `digest_date`（D+1側）で統一する。spec 側も同じ意味に読めるよう注記した
  - ⚠️ 節境界は「観測されなかった」のではなく**年間約11回起きる**。全期間295日で検出数20超の会場×日が11件、最大47件（2026-03-09 若松47 / 2026-03-08 平和島46 / 2026-04-23 唐津46）。正常時の最大は4〜10件で、11〜20の帯が空なので**閾値20は妥当**（レビュー指摘M-12）。spec FR-14 の「直近14日では破綻が観測されなかった」という根拠説明は弱い

- [ ] **T3-4** `featured` セクションの選定を実装する（plan.md §3.3）
  - **`z = (rate - expected) / sqrt(expected × (1 - expected) / n)` で標準化してから** `score = z × consistency` で並べる。**pt単位の `skill_delta` をそのまま横断比較しない**（ベースレートが逃げ53%・まくり4%と桁違いのため、生ptだと恒常的に `nige` が選ばれる）
  - 同点は `race_id` 昇順で決定的に解決
  - `volatility_percentile` が NULL（`isFallback`、または `predictions` 未生成）の行は候補から除外。全候補がNULLなら `featured` を書かない
  - 選定理由の文を `detail.reason` にテンプレートで組み立てる（**数値の根拠を必ず含める**）
  - 候補0件の日は `featured` を書かない
  - **受入基準**: 同じ入力で10回実行して常に同じ `race_id` が選ばれる。2026-09-24 では **戸田4R（`2026-09-24-02-04`、笠置博之 racer_id=4538、まくり地力+33.2pt・z=7.57・イン崩れ指数83.7%・score 6.34）** が選ばれる。**当初案（生ptスコア）では若松12Rが1位で戸田4Rは3位だった**ので、実装が旧式に戻っていないことの検証になる
  - ⚠️ 期待値は**グレード補正なし**で測った値。T2-2 の後に測り直す

- [ ] **T3-5** `.github/workflows/generate-morning-digest.yml`（JST 05:30 と 06:30）を作成する
  - 2回目は1回目が完全な結果を書けていれば何もしない
  - 2回目でも完全性チェックを満たせなければ**ジョブを失敗させる**（`continue-on-error` を付けない）
  - **受入基準**: `workflow_dispatch` で手動実行でき、当日ぶんが生成される。既に生成済みの日に再実行しても結果が変わらない（冪等）

---

## Phase 4: サービス層と画面（案A）

- [ ] **T4-1** `getMorningDigest(date)` を `src/services/supabaseDataService.js` に追加する
  - `morning_digest_days` と `morning_digest_rows` を `digest_date` で引き、セクション別に整形して返す
  - `withCache`。TTLは当日30分・過去日7日を**明示的に渡す**。既存の `inferTtlFromKey`（`supabaseDataService.js:99`）は race_id 形式の末尾を要求する正規表現のため、`morning-digest-2026-09-20` のようなキーではマッチせず過去日でも30分になる（レビュー指摘L-1）
  - **`if (error) return []` を書かない**。失敗は例外として伝播させる
  - `morning_digest_days.generated_at` が NULL の日は「未生成」として返す（「該当0件」と区別する）
  - **受入基準**: `npm run verify:query-errors` が通る。存在しない日付で空の結果（例外ではない）を返し、DB障害では例外を投げる。過去日のキャッシュTTLが7日になっていることをテストで確認する

- [ ] **T4-2** 共通コンポーネント3点を作る（`DigestSection` / `DigestRaceCard` / `RateWithBaseline`）
  - `src/components/digest/` に新設し、`index.js` の barrel export を作る
  - `DigestRaceCard` の指標部分は **props の分岐ではなく `children` で差し替える**
  - 色は `design-tokens.css` の変数のみ。**ページ背景に直接乗るテキストは意味トークン（`--text-primary` / `--text-secondary`）必須**
  - 差分バッジは**色だけに頼らず ▲▼ の記号も付ける**
  - **受入基準**: 3コンポーネントが `nige`/`makuri`/`nigashi` の3セクションで再利用されている。モバイル320pxでページ全体の横スクロールが出ない

- [ ] **T4-3** `MorningDataDigest.jsx` とルーティング・SEOを実装する（T4-2と1PRにまとめてよい）
  - `src/AppRouter.jsx` に `<Route path="today" …>`。`TRANSLATED_PATHS` には**登録しない**（ja専用）
  - `useSocialMeta` の canonical は `?date=` の有無にかかわらず常に `/today`
  - 4状態（ローディング／取得失敗／該当0件／データ不完全）をすべて実装する（screens.md §6）。**セクションを消さない**
  - 選手名・会場名に `translate="no"`
  - **受入基準**: Playwrightで `/today` と `/today?date=2026-09-23` を開き、ライト／ダークの両方でスクリーンショットを撮って目視確認する。`document.querySelector('link[rel=canonical]')` が `?date=` 付きでも `/today` を指す

- [ ] **T4-4** 残りのコンポーネント4点（`FeaturedRaceCard` / `PeriodTrendSparkline` / `EntryCourseTendencyBar` / `FlyingRacerList` / `ReturnedRacerList`）を実装する
  - スパークラインはインラインSVG（Rechartsを使わない）
  - `PeriodTrendSparkline` は `racer_period_stats` 由来。**最新期が2026年2期であり「今期のデータは期終了後に反映される」旨をUIに出す**（spec FR-8）
  - **受入基準**: 推移が3期未満の選手でスパークラインが破綻しない。ダークモードでSVGのstrokeがページ背景に埋もれない

- [ ] **T4-5** ホーム（`VenueGridPage.jsx`）に `/today` への導線を1つ追加する
  - `TodaysVolatilityHighlights` の近傍
  - **受入基準**: 追加によってホームのCLSが悪化しない（要素の高さを確保する）。`npm run test:e2e` が通る

- [ ] **T4-6** `scripts/generate-sitemap.js` の `staticPages` に `/today` を追加する（**T4-3と同一PRで必須**）
  - **受入基準**: `npm run verify:sitemap` が通る

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

- [ ] **T6-1** `docs/design/morning-data-digest/content-index.json` を作成する（フローA-2）
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

## Phase 2 として切り離した範囲（このtasks.mdの対象外）

`race_special_notes` の `equipment_change` 区分に実例が無いため、**本日の途中追加選手・本日の中間整備**は対象外（spec §3）。関連: [BOA-319](https://linear.app/boat-ai/issue/BOA-319) / [BOA-320](https://linear.app/boat-ai/issue/BOA-320) / [BOA-328](https://linear.app/boat-ai/issue/BOA-328)。

**昨日の帰郷選手は T3-3 で Phase 1 に含む**（2026-09-24に格上げ。`race_entries` の日次差分で算出できると判明したため）。
