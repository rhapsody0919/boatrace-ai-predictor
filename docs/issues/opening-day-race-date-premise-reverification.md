# 初日(2025-12-03)120件のrace_date/race_id前提の再検証(BOA-413)

調査日: 2026-09-25。読み取り専用調査（本番DBへの書き込みは無し）。対象は[BOA-325](https://linear.app/boat-ai/issue/BOA-325)（Done、PR #664/666）が「`race_date`列側が正しい」という前提で修正した、自社データ初日(2025-12-03)の`races`120件（10会場×12レース）。[BOA-407](https://linear.app/boat-ai/issue/BOA-407)（PR #818）の調査で、この前提が疑わしいと判明したことを受けた再検証。

## 1. 結論

**BOA-325の前提は9会場（108レース）については正しく、津(09)の12レースについてのみ誤っていた。**

- **9会場（桐生01・戸田02・多摩川05・蒲郡07・住之江12・尼崎13・鳴門14・宮島17・芦屋21）は`race_date`列（2025-12-03）が正しい**。公式K-file（2025-12-03分）の出走表と、自社DBの`race_entries`（艇番1〜6の`racer_id`）が12レース中12レース（鳴門のみ10レース、後述）で完全一致した。BOA-325がこれらの`race_id`日付部分を2025-12-02→2025-12-03に訂正したのは正しい対応だった
- **津(09)の12レースのみ`race_id`側（2025-12-02）が正しく、`race_date`列（2025-12-03）が誤り**。公式K-file 2025-12-03分には津(09)のブロック自体が存在せず、2025-12-02分に同一レース番号（R1〜R12）が存在し、自社DBの出走表と完全一致した。BOA-325はこの1会場については逆方向の誤った訂正をしてしまっていた（BOA-407が既に指摘した内容の再確認）
- 影響範囲は限定的：津の12レースは`race_results`が0件（=公式結果と紐付いておらず、的中率・回収率集計には一切混入していない）。ただし`racerService.js`・`supabaseDataService.js`の一部関数（展示タイム推移・勝率推移等、§4参照）は`race_id`の日付部分をそのまま出走日として使う設計のため、現状（`race_id`=2025-12-03）は表示上も誤っている

## 2. 調査方法

### 2.1 対象120レースの会場内訳の特定

BOA-325の修正スクリプト`scripts/maintenance/fix-opening-day-race-id-date.js`が実行時に生成したレポート（`data/analysis/racer-season-stats/fix-opening-day-race-id-date-report.json`、コミット`dbe7eb1c4`時点、dry-run・120件全件）から、対象の`race_id`（当時は`2025-12-02-VV-RR`形式）を集計した。

| 会場コード | 会場名 | レース数 |
|---|---|---:|
| 01 | 桐生 | 12 |
| 02 | 戸田 | 12 |
| 05 | 多摩川 | 12 |
| 07 | 蒲郡 | 12 |
| 09 | 津 | 12 |
| 12 | 住之江 | 12 |
| 13 | 尼崎 | 12 |
| 14 | 鳴門 | 12 |
| 17 | 宮島 | 12 |
| 21 | 芦屋 | 12 |
| **計** | **10会場** | **120** |

### 2.2 公式K-fileとの突き合わせ

パース済みの公式K-file中間JSON（`data/kb-archive/parsed/202512/kb-2025-12-02.json.gz`・`kb-2025-12-03.json.gz`、`scripts/maintenance/kb-backfill.js parse`の出力）を用い、10会場×12レースそれぞれについて、以下3点を突き合わせた（読み取りのみ、`mcp__supabase__execute_sql`でのSELECTのみ使用）。

1. 自社DB `race_entries`（現在の`race_date=2025-12-03`分、720行=120レース×6艇）の艇番1〜6→`racer_id`
2. 公式K-file 2025-12-02分の同一会場・同一レース番号の艇番1〜6→`racer_id`
3. 公式K-file 2025-12-03分の同一会場・同一レース番号の艇番1〜6→`racer_id`

6艇×12レース=72値の完全一致を「その日その会場に実際に開催された」根拠とした（登録番号は事実上一意のため、偶然の一致では説明できない。BOA-407 §2.3と同じ判定基準）。

## 3. 結果

| 会場 | 12/02のK-fileと一致 | 12/03のK-fileと一致 | 備考 |
|---|---:|---:|---|
| 01 桐生 | 0/12 | 12/12 | race_date(12/03)が正しい |
| 02 戸田 | 0/12 | 12/12 | race_date(12/03)が正しい |
| 05 多摩川 | 0/12 | 12/12 | race_date(12/03)が正しい |
| 07 蒲郡 | 0/12 | 12/12 | race_date(12/03)が正しい |
| **09 津** | **12/12** | **0/12（K-fileにブロック自体が無い）** | **race_id(12/02)が正しい** |
| 12 住之江 | 0/12 | 12/12 | race_date(12/03)が正しい |
| 13 尼崎 | 0/12 | 12/12 | race_date(12/03)が正しい |
| 14 鳴門 | 0/12 | 10/12（R11・R12はK-fileに無し） | race_date(12/03)が正しい。R11/R12は別問題（§5参照） |
| 17 宮島 | 0/12 | 12/12 | race_date(12/03)が正しい |
| 21 芦屋 | 0/12 | 12/12 | race_date(12/03)が正しい |

公式K-file 2025-12-03分には、上記10会場のうち津(09)を除く9会場＋大村(24、BOA-325の対象外）の計10会場のブロックが存在する。津(09)のブロックは2025-12-03分には存在せず、2025-12-02分にのみ存在する。

この結果は「races.created_atが特定時刻帯に集中していない」（BOA-407 §3.2）等の状況証拠ではなく、**選手の実際の乗艇割当（racer_id）という一次情報の完全一致**に基づく確定的な判定である。

## 4. 影響範囲の確認

津(09)の12レース（`race_id`=`2025-12-03-09-01`〜`12`、現状）について、関連テーブルの行数を確認した（2026-09-25時点、読み取りのみ）。

| テーブル | 件数 |
|---|---:|
| race_entries | 72（12レース×6艇） |
| predictions | 12（`model_id='standard'`のみ。`is_hit_win`等は全て`NULL`、`is_shadow=false`） |
| race_results | **0** |
| race_conditions | 0 |
| race_odds | 0 |
| exhibition_data | 0 |
| race_start_timings | 0 |
| prediction_odds | 0 |
| bet_recommendations | 0 |
| model_bet_candidates | 0 |
| sns_campaign_entries | 0 |
| mycroft_predictions / poirot_predictions / watson_predictions | 0 |

**的中率・回収率集計への影響は無い**: `race_results`が0件のため、`race_results!inner`で結合する的中率集計（`calculate-accuracy.js`系）にはそもそも含まれない。`predictions`の12行も`is_hit_*`が全て`NULL`のため、確定済み集計には混入していない（BOA-407 PR #818 §5の推定と一致）。

**選手個人ページの一部の推移表示には影響がある**: 以下の関数は`race_entries`のみを取得し、`race_id.slice(0, 10)`（`race_id`の先頭10文字）で日付を復元しており、`race_results`の有無（＝そのレースが実際に成立したか）を一切チェックしていない。津の12レースはこれらの関数では「出走日」データ点としてそのまま含まれてしまう（現状は2025-12-03、本来は2025-12-02）。

- `src/services/racerService.js`の`getCurrentMeetRaceEntries`・`getRacerCurrentMotorStatus`（節間の展示タイム推移`meetTrend`・最新パーツ交換日`latestPartsEvent`を構築）
- `src/services/supabaseDataService.js`の`getRacerFormTrend`（勝率・当地勝率の推移）
- `src/services/supabaseDataService.js`の`getExhibitionTimeTrend`（展示タイム推移、`exhibition_data`とのみJOIN）

一方、同じ`supabaseDataService.js`の`getRacerRaceHistory`・`getRacerVenueStats`・`getRacerBoatReturnRate`は`race_results`をJOINし共通ヘルパー`isUsableRaceResult`（`!result.is_cancelled && !result.is_no_race && result.rank1 !== null`）で除外する安全な設計であり、津の12レース（`race_results`0件）が対戦成績として表示されることはない。

影響は「対戦成績」ではなく「出走日・推移グラフの日付点」に限られ、表示件数・影響選手数も限定的（1会場・1日・最大72出走枠）。なお`scripts/analysis/aggregate-racer-stats.js`（分析用スクリプト、本番非公開）の`total_races`は`race_entries`と`race_start_timings`のJOINで算出しており`race_results`を見ないため同種の懸念があるが、津の12レースは`race_start_timings`も0件のため今回のケースでは実害が無いことを確認済み。

選手の「期別成績」（出走回数・勝率等）は`scripts/lib/racerSeasonStats.js`が公式サイト（boatrace.jp）を直接スクレイピングして取得しており、自社DBの`race_entries`/`race_date`から算出していないため、この日付の食い違いによる影響を受けない。

## 5. 副次的に発見した別問題（本チケットのスコープ外）

調査の過程で、鳴門(14)の`2025-12-03-14-11`・`2025-12-03-14-12`について、公式K-file 2025-12-03分に該当レース番号が存在しない（同日の鳴門はK-fileではR1〜R10までで打ち切り）にもかかわらず、`races.cancellation_status`が`confirmed`のままになっていることを確認した。また、この2レースの出走表（`racer_id`の組み合わせ）は前後複数日（2025-11-28・12-01・12-02・12-04・12-05）のいずれのK-fileとも一致しなかった。

- `race_results`は0件（未確定のまま）
- BOA-406（Done、PR #817、`race_not_in_k_venue`分類・269件の`cancellation_status`是正）の対象範囲（2025-12-03〜2026-03-31）に含まれるはずだが、なぜこの2件が是正対象から漏れたのかは未調査
- BOA-325の120件修正の対象日（初日）と重なるため、当時の一連の修正作業の影響を受けた可能性はあるが未確認

この2件は本チケット（津の日付前提）とは別種の問題（打ち切り未反映、または別の初日特有のデータ異常）であり、本チケットの調査範囲外として別途起票を推奨する。

## 6. 修正方針の提案

### 6.1 対象

津(09)の12レース（`race_id`=`2025-12-03-09-01`〜`12`）のみ。他9会場は現状（race_date=2025-12-03）のままで問題ない。

### 6.2 選択肢

**選択肢A: 修正する（`race_id`・`race_date`とも2025-12-02に統一する）**

- 方法: `fix-opening-day-race-id-date.js`と同じ手順（新IDでの`races`行INSERT→子テーブルの`race_id`付け替え→旧行DELETE）を津の12レースのみに適用する。対象の子テーブルは`race_entries`(72)・`predictions`(12)のみで、他は全て0件のため、当時の120件修正（14テーブル・UNIQUE制約回避の退避処理が必要）より大幅に単純
- 利点: 選手個人ページの対戦日表示が正確になる。`races`テーブル全体の`race_date`とK-fileの実開催日の対応が完全に一致する状態に戻る
- 留意点: `scripts/maintenance/kb-backfill.js`の`MAIN_TABLES_START = "2025-12-03"`（本体テーブルは2025-12-03以降、それより前はアーカイブ表が担当という境界の前提）に、津(09)の2025-12-02分12レースだけ本体`races`テーブルに存在するという例外ができる。実害はない（`races`と`kb_archive_races`はテーブルが別のため主キー衝突等は起きない）が、将来2025-12-02分をアーカイブ表へ投入する際にこの例外をコメントで明記しておく必要がある

**選択肢B: 現状維持（`race_date`=2025-12-03のまま）**

- 理由: `race_results`・`race_conditions`・`race_odds`等の実データが0件で、的中率集計・回収率集計への実害が既に無いことを確認済み。影響は選手個人ページの対戦日表示（1会場・12レース・最大72出走枠分）のみに限定される
- リスク: 修正しない限り、この表示上の誤りは半永久的に残る。将来同様の初日データ調査をする際に、再び「なぜここだけ食い違っているのか」を調べ直すコストが発生しうる

### 6.3 推奨

**選択肢A（修正）を推奨する。** 影響を受ける行数が72＋12件と小さく、必要な子テーブル付け替えも2テーブルのみ（当時の120件修正より大幅に軽量）で、選手個人ページの表示不整合という実害が現に存在するため、修正のメリットがコストを上回ると判断する。ただし本チケットは調査のみを目的としており、**実際の修正（本番DB書き込み）は別途ユーザー承認を得た上で実行する**。

修正を実行する場合の手順案:

1. `fix-opening-day-race-id-date.js`を一般化し、対象`race_id`リストと訂正先日付を引数で指定できるようにする（または津専用の小さいワンオフスクリプトを新規に用意する）
2. `--dry-run`で対象12件・影響テーブル（race_entries 72件・predictions 12件）が本書の想定と一致することを確認する
3. ユーザー承認後、実行
4. 実行後、`race_id`が`2025-12-02-09-01`〜`12`に変わったことと、選手個人ページ（該当選手の登録番号）での対戦日表示が2025-12-02になったことを確認する
5. `scripts/maintenance/kb-backfill.js`のファイル冒頭コメントに、津(09)の2025-12-02分12レースが例外的に本体`races`テーブル側にある旨を追記する

## 7. 参考

- BOA-325（Done）: 自社データ初日(2025-12-03)の`race_id`日付ズレ120件の修正、PR #664/666
- BOA-407（Done）/ PR #818: `venue_not_in_k`408件の原因調査、§4.1で本チケットの前提となる疑義を指摘
- BOA-406（Done）/ PR #817: 中止・打ち切りレースの`cancellation_status`是正（269件）
- `scripts/maintenance/fix-opening-day-race-id-date.js`: BOA-325の修正スクリプト（子テーブル付け替え・UNIQUE制約回避の実装）
- `scripts/maintenance/kb-backfill.js`: K/Bアーカイブの取得・解析CLI（`MAIN_TABLES_START`定数）
- `src/services/racerService.js`・`src/services/supabaseDataService.js`: 選手個人ページの対戦履歴・推移データ取得（一部関数が`race_id`から日付復元、§4参照）
- `scripts/lib/racerSeasonStats.js`: 選手の期別成績（公式サイト直接スクレイピング、本件の影響を受けない）
