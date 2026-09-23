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

---

## Phase 1: 共通化とサービス層（DBへの変更なし・並行着手可）

- [ ] **T1-1** `CrossTabGrid`（FR-0）を新規作成し、`VenueGradeMatrix`（BOA-263）・`RacerPerformanceStats`（BOA-268）を載せ替える
  - `src/components/analysis/CrossTabGrid.jsx` + `.css`。行軸・列軸・セル指標・n併記・小標本フラグをpropsで受ける。データ取得はしない（整形済みの2次元データを受ける）
  - 行ラベル列を `position: sticky; left: 0`、**グリッド内だけ横スクロール**（ページ全体は横スクロールさせない）
  - `src/components/analysis/index.js` の barrel export に追加
  - **受入基準**: 載せ替えた2箇所の表示内容が**前後で変わらない**ことをPlaywrightで突き合わせる（値・n・小標本フラグ）。軸の数とセル指標をpropsで差し替えられる。モバイル320pxでページ全体の横スクロールが出ない
- [ ] **T1-2** `getRacerScopedRaceStats` に派生フィールドを足す（追加クエリ0本。plan.md §3.1）
  - `stNormalized`（`is_flying` なら符号反転）・`raceBestSt`・`innerMinSt`（1コースはnull）・`stRank` を各行に追加
  - **生の6艇分の配列は返さない**。`soleFastestBoatByRace` と同じ要領でレース単位の前処理として計算する
  - **受入基準**: `is_flying=true` の行で `stNormalized` が負値になる。`innerMinSt` が1コースでnull。既存の戻り値のキー（`startTiming`・`actualCourse` 等）と既存の利用箇所（基本情報タブ・直前情報タブ）の表示が変わらない
- [ ] **T1-3** `src/utils/stConsideration.js`（純関数）と `src/utils/courseBaseline.js`（純関数）
  - `computeStConsideration(rows, { course })` → `{ n, stableRate, breakoutRate, lateRate, avgSt }`。閾値は 0.05 / 0.07 / 0.10。`course === 1` の抜出率は **null**（0%にしない）
  - `courseBaseline.js` は差分計算と「高いほど良い／低いほど良い」の向きを持つ（安定率・抜出率は高いほど良い、出遅率は低いほど良い）
  - **受入基準**: 本specの検証で使った実測値と一致する。全国・直近1年で安定率 1コース67.9% / 6コース45.8%、出遅率 1コース14.7% / 6コース30.8%、抜出率（すべての内側艇基準）3コース3.1% / 6コース0.8%。**同じSQLをnode -eで実行して突き合わせる**

## Phase 2: 事前集計テーブルとバッチ（T3の前提）

- [ ] **T2-1** (ユーザー承認) マイグレーション094を適用する（新規2表）。適用後に `APPLIED.md` を更新する
  - 適用前に長時間クエリが0件であることを確認する。適用後に `has_table_privilege('anon', ..., 'SELECT')=true` / `'INSERT'=false`、RLS有効、ポリシー各1件を確認する
- [ ] **T2-2** `scripts/daily/update-course-baseline-stats.js` と `.github/workflows/aggregate-course-baseline-stats.yml`（JST 00:50）
  - 1スクリプトで2表を更新する（基礎CTEを共有。分けるとDBスキャンが2倍になる）
  - `upsertChangedRows`（`scripts/lib/unchangedRows.js`）で**変更のある行だけ書く**
  - **0件書き込みをエラーにする**（`st_course_baseline` は常に6行）。`continue-on-error` は付けない
  - 集計窓は「**実行時点から遡って365日**」の移動窓（GitHub Actionsの起動遅延で対象日がずれる失敗モードを避ける。ADR-0068の影響）
  - **受入基準**: ローカルで dry-run（書き込みなし）を実行し、出力がT1-3の実測値と一致する。本番実行後に `st_course_baseline` が6行・`nige_second_by_course` が開催実績のある会場分
- [ ] **T2-3** データ精度検証（`.claude/rules/analysis.md`「データ精度の検証」。コードレビューとは別の独立ステップ）
  - `nige_second_by_course.second_rate` を会場ごとに合計して **100%±0.5** に収まる（2着は必ず1艇）
  - `st_course_baseline` の6行が、同じ定義のSQLを直接実行した結果と一致する
  - `st_histogram` のビンの合計が `runs` と一致する
  - **受入基準**: 上記3点を実測クエリの結果つきで報告する

## Phase 3: 枠別情報タブ（FR-1・FR-6。T1・T2の後）

- [ ] **T3-1** コース別成績グリッド（実進入コース基準）に差し替え、既存の「コース別成績（バー＋ドリルダウン）」カードを廃止する
  - `CrossTabGrid` を使う。行＝今期/3ヶ月/1ヶ月/当地/一般戦/SG・G1、列＝コース1〜6、セル＝率＋n
  - コースは `actual_course_N`（実進入）。**既存の `courseRaceCounts`（艇番＝コース前提）はこのタブでは使わなくなる**
  - ドリルダウン（直近10走）をグリッドのセルタップに移す
  - **受入基準**: 期間の切り替えでセルの値とnが変わる。n<30で⚠と網掛け、n=0で「—」。セルタップでそのコースの直近10走が開く。`actual_course` が取れないレースが母数から落ちている（実データで件数を確認する）
- [ ] **T3-2** `RaceStConsiderationCard`（ST考察）: 3指標 × 6艇、値＋同コース平均との差
  - 差の色は `--color-success-text` / `--color-error-text`（指標ごとに符号の向きを反転）
  - **1コースの抜出率は空欄**（0%と出さない）＋理由を添える
  - 強調は金14%（1位）/ 金7%（2位）の2段階
  - **受入基準**: 差の符号と大きさが `st_course_baseline` の値と一致する。5号艇・6号艇の出遅率で、生の値と差で順位が逆転して見える（screens.md §3.1.2の実例）
- [ ] **T3-3** ST分布・ST履歴をST考察カード内の折りたたみに入れる（`.lede-detail` パターン）
  - ST分布: 選手のSTヒストグラム（0.05刻み）に同コース平均の分布（`st_histogram`）を薄く重ねる
  - ST履歴: 直近10走の「もっと見る」で期間を伸ばす（表示件数はT3-3の実装時に決める。plan.md §8の#2）
  - **受入基準**: 折りたたみを開く前はカードの高さが変わらない。ヒストグラムのビンの合計が母数と一致する
- [ ] **T3-4** `RecentRunsBar`（直近10走）: 進入コース（枠色）／着順／ST＋**ST順位「(1位)」**
  - 1位を金、最下位を赤。着順の色は既存の `rr-pos`（`src/App.css`）を流用する
  - モバイル390pxでは5本×2段に折り返す
  - **受入基準**: 帯の進入コース・着順・STが `race_results` の実値と一致する。`stRank` がそのレースのST順と一致する。モーター2連対率は出さない
- [ ] **T3-5** `NigeSimulationCard`（逃げシミュレーション、FR-6）
  - 横棒（個別の棒。積み上げ1本にしない）＋2連単確率。母数を明記する。**会場別のみ・全国へのフォールバックはしない**
  - 1行要約＋「くわしく見る」で算出方法と母数を開く
  - **受入基準**: 2着率の合計が100%（丸め誤差を除く）。表示値が `nige_second_by_course` と一致する。追加クエリは1本
- [ ] **T3-6** i18n（ja/en/zh-TW/ko）と `termHints`
  - 既存の名前空間に追加（`wakuInfo.*`）。Rechartsを使う箇所は data key を翻訳しない（`name` prop）
  - `termHints` に `stStable` / `stBreakout` / `stLate` / `nigeSimulation`（ja専用）。**自前定義なので定義を説明する**＋「当サービスの独自集計です」を付ける（ピットレポートの★と扱いが逆）
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

- [ ] **件数**: `st_course_baseline` が6行、`nige_second_by_course` が「直近1年に1コース逃げが1件以上あった会場 × 2〜6コース」の行数（24会場開催なら120行）であることを実測クエリで確認する
- [ ] **整合**: `nige_second_by_course.second_rate` を会場ごとに合計して100%±0.5に収まることを実測クエリで確認する（2着は必ず1艇）
- [ ] **継続監視**: `last_updated` が2日以上古い場合を日次で検知してSlack通知することを確認する（`scrape-monitor` の `daily_overdue` と同じ枠組み）

---

## スコープ外として残すもの（別チケット）

- **`courseRaceCounts`（艇番＝コース前提）を使う他の4箇所** — T3-1で枠別情報タブは実進入コース基準になるが、`DataRaceTable` の「枠番勝率」行（`raceIndicators.jsx`）・`RaceCardDataTable`・`AttackDefenseTable`（超展開データ）・選手ページの `RacerPerformanceStats` は艇番＝コース前提のまま。**同じサイト内で2つの基準が混在する**
  - これは phase a のスコープを超える横断課題で、既に [BOA-302](https://linear.app/boat-ai/issue/BOA-302)（「BOA-257『コース→枠番』コピー修正が3チケット目、データソースの根本リネームを検討」）として起票されている。**重複起票しない**
  - T3-1では、グリッドの注記に「実進入コース基準」と明記して、`DataRaceTable` の「枠番勝率」（艇番基準）との違いが読み取れるようにする
- **data-catalog の N13・N14 の記述の訂正** — 「取得なし」は現状と合っていない（`race_entries.f_count` / `l_count` / `weight_kg` / `branch` は列も値も実在。充足率は直近1年で約4.5%）。取得基盤側（BOA-353配下）の担当なので、本specでは直さず申し送りにする
- **分析ツール（`/winning-technique`、17タブ）の可視化強化** — phase aの次段階として別specに分ける
- **オッズ検索タブ（[BOA-310](https://linear.app/boat-ai/issue/BOA-310)）・事故率の表示・逃げシミュレーションの3着以降** — spec.mdの「やらないこと」
