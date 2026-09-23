# レース詳細の可視化強化（phase a）tasks

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)

ADR: [ADR-0068](../../adr/0068-course-baseline-precomputation.md)

モック（承認済み、2026-09-23）: https://claude.ai/artifact/N3e6TSHmoPXzLNX1SSSLZK

マイグレーション案（すべて未適用）: [094](../../db-migration/094_course_baselines.sql) / [095](../../db-migration/095_phase_a_numeric_public_read.sql) / [096](../../db-migration/096_original_exhibition_public_read.sql)

---

## 着手前に読むもの

- 各タスクの「1コミット〜1PR」の粒度は目安。**T3・T5のように同じタブを触るタスクは1PRにまとめてよい**（タブ単位でPlaywrightの自己検証が1回で済む）
- `/step4` を都度呼ぶ運用にする。会話が圧縮された直後・別セッションで再開する際は、記憶ではなく**このファイルを読み直してから続ける**（`.claude/rules/sdd-workflow.md`）
- 実装着手前に、`getRacerScopedRaceStats` の既存の返り値（`src/services/supabaseDataService.js:3756`）と `RaceWakuInfoTab.jsx` の冒頭コメントを読む。後者には**現在は成り立たない前提が2つ書かれている**（screens.md §1）
- **本tasks.mdは2026-09-23に一度全面改訂している**。`/step4` 着手前の独立エージェントレビュー（`.claude/rules/sdd-workflow.md`）で33件の指摘を受け、うち数値・前提が誤っていたものを測り直して設計をやり直した（[spec.md 設計の訂正履歴](./spec.md)）。**旧版の受入基準の数値（安定率 67.9%/45.8% 等）は使わない**

---

## Phase 0: 取得エラーの伝播を構造的に直す（最優先。他の全タスクの前）

> **2026-09-23にスコープを差し替えた**。当初は「`fetchAllByIn` の `break` を `throw` に変える」1関数の修正だったが、着手前の調査で**同じ欠陥が76箇所あり、同型の障害が4層・7チケットで再発している**ことが判明した（[ADR-0069](../../adr/0069-query-error-propagation.md)）。1関数の修正は「1つずつ直す」の8回目になり、同じ結果になるため、`supabase-js` 標準の `.throwOnError()` をクライアント生成時に既定で適用する方式に変更した（ユーザー判断、2026-09-23）。
>
> あわせて、当初のタスク文にあった「呼び出し元6箇所」「最大7日間キャッシュ」は実測と合っていなかったため訂正した（実際は**18メソッド32箇所**が `fetchAllByIn` を使い、ST考察の `getRacerScopedRaceStats` のキャッシュは**30分**。7日になるのは `race-*-{raceId}` キーの6メソッド）。

- [x] **T0-1** Supabaseクライアントで `.throwOnError()` を既定にする（[ADR-0069](../../adr/0069-query-error-propagation.md)）
  - `src/services/supabaseClient.js` で `.from()` / `.rpc()` をラップし、返る builder の `select`/`insert`/`update`/`upsert`/`delete` に `.throwOnError()` を自動適用する
  - **成功時の戻り値の形は変わらない**ため、呼び出し側87箇所は変更不要
  - **受入基準**: 本番の匿名キーで7項目を実測して確認済み（正常系で `{data,error}` が保たれる／異常系で例外／`order`・`range` のチェーンが壊れない／権限エラー42501も例外）
- [x] **T0-2** 意図的にエラーを飲む箇所を try/catch に移す
  - `getRacePitReport`: 権限エラー（42501）だけ `state: "forbidden"` に倒す。**phase a の FR-4（095/096適用前にセクションを隠す）がこれに依存する**
  - `getRaceMotorMaintenanceBreakdown`: 「column does not exist」のときだけ旧列で再取得
  - `fetchVenueWinRateMap`: バッジの補助値なので失敗時は空マップ（**E2Eが実際に検知した退行**。補助値の失敗でレース一覧全体が消えていた）
  - **受入基準**: E2E「匿名に権限が無い場合（086未適用）はセクションごと出さない」「取得エラーは『未公開』『対象外』に化けさせず再読み込みを出す」が通る
- [x] **T0-3** throw 化で「永久スケルトン」になる箇所に catch を足す
  - `RaceBasicInfoTab`（公式勝率）・`RaceBeforeInfoTab`（今節展示情報）。どちらも同じファイル内の隣の effect では既に catch 済みという不統一だった
  - 未処理のPromise拒否になっていた `RaceBeforeInfoTab`（本日成績サマリー）・`RaceResult`（ST）・`useUnifiedModelAccuracy`・`useUnifiedVolatilityAccuracy` にも catch を足す
  - **受入基準**: 失敗を注入してもスケルトンが残らず、未捕捉のレンダー例外が出ない（Playwrightで確認済み）
- [x] **T0-4** 消費側の無害化を解く（消費側81件のうち27件が `.catch(() => [])` だった）
  - `useRaceAnalysisData`（9件）・`useVenueTendencyStats`（4件）に `failed` / `hasFailure` / `reload()` を持たせる
  - `VenueCharacteristicsCard`（4件）は失敗時にカードを無言で消さない
  - 新規の共通部品 `src/components/InlineFetchError.jsx`（セクション単位・`onRetry` で該当箇所だけ再取得）を `DataRaceTable`・`VenueTendencyPanel`・`VenueCharacteristicsCard` で使う
  - **受入基準**: 失敗を注入すると `.inline-fetch-error` が出る。正常系では出ない（Playwrightで確認済み）
- [x] **T0-5** 恒常対策（機械検査・ルール）
  - `npm run verify:query-errors`（`scripts/maintenance/verify-query-errors.js`）: `src/` 配下で `createClient()` の直接呼び出し・`@supabase/supabase-js` の直接importを禁止し、`supabaseClient.js` が `.throwOnError()` を適用していることを検査する
  - `.github/workflows/verify-query-errors.yml`: PR時に自動実行（既存の `verify-cache-config.yml` と同じ形）
  - `.claude/rules/frontend-data-fetch.md`: 読み取り側のルールを明文化（書き込み側の `data-acquisition.md` に対応するものが無かった）
  - **受入基準**: 違反ファイルを一時的に置くと exit 1 になり、消すと exit 0 に戻ることを確認済み
- [ ] **T0-6** バッチ側（`scripts/`）は別チケットにする
  - `scripts/lib/supabaseClient.js` の `fetchAll` は `throwOnError = false` が既定のまま（呼び出し121箇所）。`getRaceSchedule` ほか8関数が同じ escape hatch を持つ
  - 121箇所への影響確認が要るため本PRには含めない。BOA-359 のバッチ側として起票し、`verify-query-errors.js` の `BATCH_TODO` に記録済み

## Phase 1: サービス層と純関数（DBへの変更なし・Phase 0の後）

- [x] ~~**T1-1** `CrossTabGrid`（FR-0）を新規作成する~~ → **取り下げ（2026-09-23、ユーザー判断）**
  - 着手前に、**このコンポーネントを使う箇所が1つしか無い**ことが判明した。FR-2（基本情報タブ）は screens.md §3.2 と T5-2 で「グリッド化はしない」と決定済みで、「条件別」タブは行＝条件・列＝値とnの1次元テーブル（クロス集計ではない）。spec.md FR-0 の受入基準「FR-1・FR-2の2箇所が使う」が成立しない
  - 1箇所しか使わない汎用コンポーネントを props で抽象化しても読みにくくなるだけなので、**共通化せず T3-1 で `RaceWakuInfoTab` に直接実装する**（KISS/YAGNI）。2例目が現れた時点で切り出す
  - FR-0 はこれで**2回**前提が崩れた（1回目は「既存2例で rule of three」が誤り、2回目が本件）
- [x] **T1-2** `getRacerScopedRaceStats` に派生フィールドを足す（追加クエリ0本。plan.md §3.1）
  - `isFlying` / `stForRank`（**Fの行はnull。符号反転はしない**）・`raceBestSt`（Fを除いた最小）・`innerMinSt`（Fを除いた内側最小。1コースはnull）・`stRank`（Fを除く）・`grade` を各行に追加
  - **生の6艇分の配列は返さない**。`soleFastestBoatByRace` と同じ要領でレース単位の前処理として計算する
  - **受入基準**: `is_flying=true` の行で `stForRank` が **null**（負値ではない）。Fの艇が同じレースの他艇の `raceBestSt` に影響しない（Fのあるレースで、他艇の `raceBestSt` がFを除いた最小値と一致する）。`innerMinSt` が1コースでnull。既存の戻り値のキー（`startTiming`・`actualCourse` 等）と既存の利用箇所（基本情報タブ・直前情報タブ）の表示が変わらない
- [x] **T1-3** `src/utils/stConsideration.js`（純関数）と `src/utils/courseBaseline.js`（純関数）
  - `computeStConsideration(rows, { course })` → `{ n, stableRate, lateRate, breakoutCount, breakoutRate, avgSt, flyingCount }`。閾値は 0.05 / 0.07 / 0.10。`course === 1` の `breakoutCount` / `breakoutRate` は **null**（0や0%にしない）
  - **母数 `n` にFの走を入れない**。Fは `flyingCount` として別に返す
  - 小標本の判定はこの関数で行わない（呼び出し側が `SMALL_SAMPLE_THRESHOLD` で判断する。ST考察だけ別閾値を持たせない）
  - `courseBaseline.js` は **`(course, grade)` でセルを引き**、差分計算と「高いほど良い／低いほど良い」の向きを持つ（安定率・抜出回数は高いほど良い、出遅率は低いほど良い）
  - **受入基準**: spec.mdの再測値と一致する。**Fを除外し級別で分けた状態で、安定率 (1,A1) 74.4% / (6,B1) 42.4%、出遅率 (1,A1) 9.9% / (6,B1) 33.1%、抜出率 (3,A1) 3.50% / (6,A1) 0.73%**。**同じSQLをnode -eで実行して突き合わせる**

## Phase 2: 事前集計テーブルとバッチ（T3の前提）

- [x] **T2-1** (ユーザー承認) マイグレーション094を適用する（新規2表）。適用後に `APPLIED.md` を更新する
  - 適用前に長時間クエリが0件であることを確認する。適用後に `has_table_privilege('anon', ..., 'SELECT')=true` / `'INSERT'=false`、RLS有効、ポリシー各1件を確認する
  - `st_course_baseline` の主キーが `(course, grade)`、`window_start` / `window_end` / `window_days` の列があることを確認する
- [x] **T2-2** `scripts/daily/update-course-baseline-stats.js` と `.github/workflows/aggregate-course-baseline-stats.yml`（JST 00:50）
  - 1スクリプトで2表を更新する（基礎CTEを共有。分けるとDBスキャンが2倍になる）
  - **集計本体はRPC（SQL関数）側に寄せる**。基礎CTEは約56万行を読むため、Node側に持たず結果の24行＋最大120行だけ返す。RPCにしない場合は `.range(from, from + 999)` のページネーション必須（Supabaseのデフォルト上限は1000行）
  - **`window_start` / `window_end` / `window_days` は実測値を書く**（365や730の固定値を書かない）。窓は「利用可能な全期間」
  - **Fの行は基準（`min(st) filter (where not is_flying)`）からも母数（`where not is_flying`）からも除外する**。符号反転はしない
  - `upsertChangedRows`（`scripts/lib/unchangedRows.js`）で**変更のある行だけ書く**。そのために:
    - **`NUMERIC_SCALES`（`unchangedRows.js:40`）に `st_course_baseline` と `nige_second_by_course` のエントリを追加する**。未登録だと `NUMERIC_SCALES[table] ?? {}` で空になり、NUMERIC列が毎日「変更あり」と判定される
    - **`last_updated` に当日の日付を毎日入れない**。比較対象から外し、変更が検出された行にだけ書く
  - **エラーにするのは「集計結果が0行だった場合」**であり、「変更が無くて書き込みが0行だった場合」ではない。この2つを取り違えると値が安定した日に毎回失敗する
  - `continue-on-error` は付けない
  - **受入基準**: ローカルで dry-run（書き込みなし）を実行し、出力がT1-3の実測値と一致する。本番実行後に `st_course_baseline` が **24行**・`nige_second_by_course` が開催実績のある会場分。2日目の実行で「変更なしでスキップ」が大半になる（毎日全行書き換えになっていない）
- [x] **T2-3** データ精度検証（`.claude/rules/analysis.md`「データ精度の検証」。コードレビューとは別の独立ステップ）
  - `nige_second_by_course.second_rate` を会場ごとに合計して **100%±0.5** に収まる（2着は必ず1艇）
  - **`exacta_rate` を会場ごとに合計した値が `nige_races / total_races * 100` と ±0.5pt 以内で一致する**（分母の取り違えを機械的に検知する。当初の設計で3.6%ずれていた）
  - `st_course_baseline` の24行が、同じ定義のSQLを直接実行した結果と一致する
  - `st_histogram` のビンの合計が `runs` と一致する
  - **F艇を含むレースを1件抜き出し、そのレースの他艇の安定率がF艇に引きずられていないことを手計算で確認する**（F1の再発防止）
  - **受入基準**: 上記5点を実測クエリの結果つきで報告する
  - **実測（2026-09-24）**: 5点すべて通過。件数 24行/120行・24会場、2着率の合計 99.99〜100.01%、2連単確率の合計と1コース逃げ率の差は最大0.010pt、st_histogramのビン合計不一致 0件、DBの安定率がF除外版と完全一致・F込み版とは不一致（(1,A1) 74.43 vs 74.32 等）

## Phase 3: 枠別情報タブ（FR-1・FR-6。T1・T2の後）

- [x] **T3-0** 実装前にST考察カードのモックを再提示してユーザー承認を得る
  - 既存モック（https://claude.ai/artifact/N3e6TSHmoPXzLNX1SSSLZK ）のST考察カードは**旧前提（F符号反転・コースのみベースライン・抜出率を%表示）**で作られている
  - 再設計後の表示（級別を明示したベースライン・抜出の実回数表示・集計期間の明示・Fバッジ）に差し替えて提示する（screens.md §3.1.2）
  - **受入基準**: ユーザーの承認を得てからT3-2に進む（`.claude/CLAUDE.md`「大規模な新機能はモック承認後に実装」）
- [x] **T3-1** コース別成績グリッド（実進入コース基準）に差し替え、既存の「コース別成績（バー＋ドリルダウン）」カードを廃止する
  - **`RaceWakuInfoTab` に直接実装する**（T1-1は取り下げ。共通コンポーネントは作らない）。行＝今期/3ヶ月/1ヶ月/当地/一般戦/SG・G1、列＝コース1〜6、セル＝率＋n
  - 行ラベル列を `position: sticky; left: 0`、**グリッド内だけ横スクロール**（ページ全体は横スクロールさせない）。モバイル320pxでページ全体の横スクロールが出ないこと
  - コースは `actual_course_N`（実進入）。**既存の `courseRaceCounts`（艇番＝コース前提）はこのタブでは使わなくなる**。グリッドに「実進入コース基準」と注記する（[BOA-302](https://linear.app/boat-ai/issue/BOA-302) が横断課題として起票済み）
  - ドリルダウン（直近10走）をグリッドのセルタップに移す
  - **受入基準**: 期間の切り替えでセルの値とnが変わる。**`n < 6` で⚠と網掛け**（`SMALL_SAMPLE_THRESHOLD`。旧版の n<30 は使わない）、n=0で「—」。セルタップでそのコースの直近10走が開く。`actual_course` が取れないレースが母数から落ちている（実データで件数を確認する）
- [ ] **T3-2** `RaceStConsiderationCard`（ST考察）: 値＋**同コース・同級別の平均**との差
  - 差の色は `--color-success-text` / `--color-error-text`（指標ごとに符号の向きを反転）
  - **ベースラインのラベルに級別を出す**（「A1・1コース平均 74.4%」）。どのセルと比べているかが読めるようにする
  - **抜出は実回数だけを出す（率は画面に出さない）**。セルは `3回` ＋ `平均2.1`（同コース・同級別の期待回数）。走数は専用行。**1コースの抜出は空欄**（0回とも0%とも出さない）＋理由を添える。**期待回数が1回未満のセルで `0回` のときは差の色を付けない**（赤くすると誤読される）
  - **カード見出しに集計期間を出す**（`st_course_baseline.window_start` / `window_end` をそのまま表示）
  - **Fの走は母数に入れず、級別セルの中に `F1` バッジを出す**（艇番ヘッダは枠色で塗られており金・赤のバッジがコントラスト不足になるため）。**F1は金、F2は赤**で色を分ける。`l_count >= 1` のときだけLバッジを出す（実データで4件しか無い）
  - **安定率・抜出・出遅率のラベルの隣に `?`（`TermHintButton`）を置く**。行ラベル列は58px。抜出の `?` だけ金の塗りにする。**Fバッジ自体も `<button>` にして `?` を兼ねる**
  - 強調は金14%（1位）/ 金7%（2位）の2段階
  - **受入基準**: 差の符号と大きさが `st_course_baseline` の `(course, grade)` セルと一致する。生の値がほぼ同じ2艇で、差の符号が正反対に出る（screens.md §3.1.2の実例。守屋美穂 A1・5コース 25.9%＝+12.1pt と 吉原快誓 B2・6コース 26.0%＝−10.6pt を実データで再現して突き合わせる）。B2級の選手が全コースで一律「平均より悪い」と出ない（級別ベースラインが効いていることの確認）
- [ ] **T3-3** ST分布・ST履歴をST考察カード内の折りたたみに入れる（`.lede-detail` パターン）
  - ST分布: 選手のSTヒストグラム（0.05刻み）に同コース・同級別の分布（`st_histogram`）を薄く重ねる
  - ST履歴: 直近10走の「もっと見る」で期間を伸ばす（表示件数はT3-3の実装時に決める。plan.md §8の#2）
  - **受入基準**: 折りたたみを開く前はカードの高さが変わらない。ヒストグラムのビンの合計が母数と一致する
- [ ] **T3-4** `RecentRunsBar`（直近10走）: 進入コース（枠色）／着順／ST＋**ST順位「(1位)」**
  - 1位を金、最下位を赤。着順の色は既存の `rr-pos`（`src/App.css`）を流用する
  - モバイル390pxでは5本×2段に折り返す
  - **受入基準**: 帯の進入コース・着順・STが `race_results` の実値と一致する。`stRank` がそのレースのST順（Fを除く）と一致する。Fの走は `F` と表示しST順位を付けない。モーター2連対率は出さない
- [ ] **T3-5** `NigeSimulationCard`（逃げシミュレーション、FR-6）
  - 横棒（個別の棒。積み上げ1本にしない）＋2連単確率。母数を明記する。**会場別のみ・全国へのフォールバックはしない**
  - 1行要約＋「くわしく見る」で算出方法と母数を開く
  - **受入基準**: 2着率の合計が100%（丸め誤差を除く）**かつ2連単確率の合計が「1コース逃げ率」と一致する**。表示値が `nige_second_by_course` と一致する。追加クエリは1本
- [ ] **T3-6** i18n（ja/en/zh-TW/ko）と `termHints`
  - 既存の名前空間に追加（`wakuInfo.*`）。Rechartsを使う箇所は data key を翻訳しない（`name` prop）
  - `termHints` に `stStable` / `stBreakout` / `stLate` / **`flyingCount`** / `nigeSimulation`（ja専用）。**自前定義なので定義を説明する**＋「当サービスの独自集計で、他サイトの同名の指標とは一致しません」を付ける（ピットレポートの★と扱いが逆）。文面はscreens.md §7の表をそのまま使う
  - **`stBreakout` のヒントに「なぜ回数で出しているか」を入れる**（外側コースは率にすると0%が並ぶため）
  - **`flyingCount` のヒントに「期は5月1日と11月1日に切り替わり、期が変わると0に戻る」を必ず入れる**。これが無いとF0を「一度もフライングしていない」と誤読される（screens.md §7「Fバッジの仕様」で一次情報を確認済み。推測で書き換えない）
  - **受入基準**: 4言語のJSONが構文エラーなし。非ja言語で見出し・ラベルが翻訳される
- [ ] **T3-7** Playwrightでの自己検証とE2Eの追記
  - ライト・ダーク・モバイル320px/390pxで、枠別情報タブの全カードを確認する。**強調の2段階（金14%/7%）がダークで判別できるかを目視で確認し、できなければ1位のみに落とす**（screens.md §5.3）
  - `e2e/smoke.spec.js` に追記: グリッドの値とnの整合、ST考察の差の表示、逃げシムの合計100%、**`st_course_baseline`/`nige_second_by_course` の権限がない場合にカードが出ない**
  - `npm run build` / `npm run test:e2e` / `npm run verify:er-diagram` / `npm run verify:migration-numbers` / `npm run verify:migration-rls`

## Phase 4: 本日の成績サマリーの移設（FR-5。他と独立・並行着手可）

[BOA-222](https://linear.app/boat-ai/issue/BOA-222) に統合済みのスコープ。

- [ ] **T4-1** `VenueDaySummaryCard` を切り出す（直前情報タブ内のインライン実装から）
  - **受入基準**: 切り出し前後で直前情報タブの表示が変わらない
- [ ] **T4-2** 結果タブ（払戻の下）と会場ページに追加し、**文言を開催日基準に変える**（4言語）
  - `todaySummaryTitle` / `todaySummaryNote` を「この日の水面傾向」「{{date}}にこの会場で確定した{{n}}レースの集計です」相当に変更する
  - `/venue/:venueCode` と `/races/:date/:venueCode` は**同じ `VenueRaceListPage.jsx`**（過去日でも出る）
  - **受入基準**: 過去日のレース・過去日の会場ページで「本日」と表示されない
- [ ] **T4-3** 直前情報タブからカードを削除し、`getVenueDaySummary` の呼び出しも外す
  - **受入基準**: 直前情報タブに本日の成績サマリーが出ない。他のカード（気象・展示・詳細テーブル・ピットレポート）が崩れない
- [ ] **T4-4** 傾向コメントの生成（「今日の多摩川はイン逃げ67%（8/12）。このレースは3コースまくりで、傾向から外れた1本」）
  - `race_results.winning_technique` と `actual_course_N` から生成する（追加取得なし）
  - **受入基準**: コメントの数値が実データの集計と一致する。当該レースの決まり手・進入が正しく反映される
- [ ] **T4-5** Playwrightでの自己検証とE2Eの追記（3箇所の表示、過去日の文言）

## Phase 5: 基本情報タブ（FR-2・FR-4c・FR-4d）

- [ ] **T5-1** (ユーザー承認) マイグレーション095を適用する（数値3表の匿名公開）。適用後に `APPLIED.md` を更新する
  - **T5-2・T5-3・T7-1 の前提**。画面の実装・自己検証の後に適用してもよい（画面は権限エラーを「出さない」で扱うため）
- [ ] **T5-2** バー展開に3つ目のタブ「条件別」を追加する（`rbit-expanded-tabs`）
  - 行: 全国／当地／一般戦／SG・G1／**初日**／**最終日**（`race_series.start_date` / `end_date`）／**波5cm超**（`race_conditions` の波高）／**前期**（`racer_period_stats`）／F持ち時（バックフィル後。当面は「—」）
  - **ナイター・F持の行は出さない**（screens.md §3.2。データが揃っていない）
  - **グリッド化はしない**。既存のチップ＋バーとデータ出走表は変更しない
  - **受入基準**: 各行の値とnが表示される。データが無い行は「—」＋n=0。初日・最終日の判定が `race_series` と一致する（実データで1節分を手で突き合わせる）
- [ ] **T5-3** 選手名の隣にF数バッジ（`race_entries.f_count`）
  - 色は `--color-error-text`。`f_count` が取れないレースでは出さない（2026-09-21以降のみ揃っている）
  - **受入基準**: `f_count > 0` の選手にバッジが出る。取れていないレースでバッジも空欄も出ない
- [ ] **T5-4** i18n・Playwrightでの自己検証・E2Eの追記

## Phase 6: 今節成績（FR-3。T1-2の後・新規取得なし）

- [ ] **T6-1** 節内の日別の進入コース・ST・着順を表示する
  - 節の判定は既存の `src/utils/meetGrouping.js`（直前情報タブの今節展示情報と同じ）
  - **受入基準**: 表示された日別の着順・進入が `race_results` の実値と一致する。**節をまたがない**（前節の結果が混ざらないことを、節の境目のレースで確認する）

## Phase 7: モータ情報タブ（FR-4a。T5-1の後）

- [ ] **T7-1** `MotorWakuStatsGrid` に前検タイム・節時点の2連対率の列を追加する
  - データは2026-09-22以降のみ（604行）。**取れていない節では列ごと出さない**
  - **受入基準**: 列が表示され `motor_pretest_stats` の実値と一致する。データが無い節で列が出ない

## Phase 8: オリジナル展示（FR-4b。他と独立。ADR-0067の判断が挟まる）

他のFRを待たせないため独立させる（plan.md §7の#9）。

- [ ] **T8-1** 出典表記の設計とモックの提示（ユーザー承認）
  - 「出典: BOATCAST」・取得時刻・再配布しない旨。ピットレポートの出典表記（`RacePitReportSection`）を先例にする
- [ ] **T8-2** 直前情報タブの詳細テーブル（`buildBeforeInfoRows`）に一周・まわり足・直線タイムの行を追加する
  - **受入基準**: 行が表示され `race_original_exhibition_values` の実値と一致する。データが無いレースでは行ごと出さない。**権限がない場合も行を出さない**（096適用前）
- [ ] **T8-3** (ユーザー確認) ADR-0067への追記（承認の記録）を確定する
- [ ] **T8-4** (ユーザー承認) マイグレーション096を適用する。適用後に `APPLIED.md` を更新する
- [ ] **T8-5** 本番での表示確認とPlaywrightでの自己検証

## Phase 9: 仕上げ

- [ ] **T9-1** `docs/design/analysis-visualization-upgrade/content-index.json` を作成する（フローA-2）
  - 新機能のトレーサビリティ。ブログ・SNSへの展開の要否はフローA参照。対象が無ければ `not_applicable: true` ＋理由
  - `npm run verify:content-index` を通す
- [ ] **T9-2** `RaceWakuInfoTab.jsx` の冒頭コメントを更新する（screens.md §1の訂正2件）
  - 「ST考察・逃げシミュレーションに相当する集計・カラムは自社DBに存在しない」→ 生データから算出できる（本specで実証）
  - 「艇番＝コース前提。BOA-257の制約により区別できない」→ BOA-257はDoneで `actual_course_N` は99.7〜99.9%
- [ ] **T9-3** 完了監査（`/create-pr` の前）
  - このファイルの全チェックボックスと、実際のコミット・コードを突き合わせる。「会話でやった記憶がある」ではなくファイルと実コードの対応で判定する
  - `npm run build` / `npm run test:e2e` / `verify:content-index` / `verify:er-diagram` / `verify:adr-numbers` / `verify:migration-numbers` / `verify:migration-rls`

---

## 完了の定義（バッチ分。`.claude/rules/data-acquisition.md` の適用）

本機能のバッチ（T2-2）は**外部サイトを取得しない**（自社DBの集計のみ）ため、同ルールの「完了の定義」A（期待件数）・B（タイミング実測）はそのままは当てはまらない。plan.md §5.2で読み替えた3点で判定する。

- [ ] **件数**: `st_course_baseline` が**24行**（コース6 × 級別4）、`nige_second_by_course` が「1コース逃げが1件以上あった会場 × 2〜6コース」の行数（24会場開催なら120行）であることを実測クエリで確認する
- [ ] **整合1**: `nige_second_by_course.second_rate` を会場ごとに合計して100%±0.5に収まることを実測クエリで確認する（2着は必ず1艇）
- [ ] **整合2**: `exacta_rate` の会場ごとの合計が `nige_races / total_races * 100` と±0.5pt以内で一致することを実測クエリで確認する（分母の取り違えの検知）
- [ ] **継続監視**: **`last_updated` ではなく `window_end`** が2日以上古い場合を日次で検知してSlack通知することを確認する。**既存の `scrape-monitor` の `daily_overdue` は使えない**（行数が固定のテーブルでは空振りする）。バッチ自身が整合チェックに失敗したら非0終了して既存のSlack経路に流す形にする（plan.md §5.2）

---

## スコープ外として残すもの（別チケット）

- **`courseRaceCounts`（艇番＝コース前提）を使う他の4箇所** — T3-1で枠別情報タブは実進入コース基準になるが、`DataRaceTable` の「枠番勝率」行（`raceIndicators.jsx`）・`RaceCardDataTable`・`AttackDefenseTable`（超展開データ）・選手ページの `RacerPerformanceStats` は艇番＝コース前提のまま。**同じサイト内で2つの基準が混在する**
  - これは phase a のスコープを超える横断課題で、既に [BOA-302](https://linear.app/boat-ai/issue/BOA-302)（「BOA-257『コース→枠番』コピー修正が3チケット目、データソースの根本リネームを検討」）として起票されている。**重複起票しない**
  - T3-1では、グリッドの注記に「実進入コース基準」と明記して、`DataRaceTable` の「枠番勝率」（艇番基準）との違いが読み取れるようにする
- **data-catalog の N13・N14 の記述の訂正** — 「取得なし」は現状と合っていない（`race_entries.f_count` / `l_count` / `weight_kg` / `branch` は列も値も実在。充足率は全期間で約4.5%）。取得基盤側（BOA-353配下）の担当なので、本specでは直さず申し送りにする
- **分析ツール（`/winning-technique`、17タブ）の可視化強化** — phase aの次段階として別specに分ける
- **オッズ検索タブ（[BOA-310](https://linear.app/boat-ai/issue/BOA-310)）・事故率の表示・逃げシミュレーションの3着以降** — spec.mdの「やらないこと」
