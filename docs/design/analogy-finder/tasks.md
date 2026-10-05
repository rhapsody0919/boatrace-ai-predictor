# アナロジー・ファインダー tasks（モック Version 16 準拠）

元: [spec.md](./spec.md)・[screens.md](./screens.md)・[plan.md](./plan.md)。依存順。1タスク＝1コミット〜1PR。2026-10-02 までの版は `git show fa61e6213:docs/design/analogy-finder/tasks.md`（済みのタスクの記録もそちら）。

**着手条件**: design-reviewer と受け入れ E2E（`/step4` の事前条件。済み、Q-A〜Q-E の追随は 2026-10-05）、BOA-635 との合意（T0-2）、ユーザーの実装の承認（オーケストレーター経由）。本番 DB への書き込み（マイグレーションの適用）はユーザーが行う。

## 済み（旧版から引き継ぐもの）
- [x] Phase M（寄与度用モデル、MD-1〜MD-7）。v16 では AIの見立てと類似レースの距離の重みに使う
- [x] FR-1 の学習の本番化（#1118・#1121。118 は本番適用済み）
- [x] 出走表時点専用モデルと日次の特徴量ジョブ（#1176・#1178。127・128 は未適用）
- [x] JS の TreeSHAP と直前情報8列の関数（#1177）。v16 では直前情報の関数だけを使う（展示後の並べ直し）
- [x] モック Version 16 の承認（2026-10-04、mock/APPROVED.md）

## T0 準備
- [x] T0-1 spec の Q1〜Q7 をユーザーに確認し（2026-10-04「全部推奨で」）、spec・screens・plan に反映。受け入れ E2E を acceptance-test-writer に追随させる
- [x] T0-2 BOA-635 のレーンと行の渡し方を合意し直す（2026-10-04 合意。plan「BOA-635 との接続」）。FR-2 側で決めたもの: layer ファイルのキー名（`race_id` を行に足した）、読み出しは `/api/analogy/layer/[raceId]` を FR-2 側が T5-1 で作る、層の説明文は `src/utils/analogyLayer.js` の `describeAnalogyLayer`（T6-2）、描画位置は #1122 で master 済み。オーケストレーター経由で BOA-635 に知らせた
- [x] T0-3 マイグレーション 120 を消した（2026-10-05）: `120_analogy_strata.sql`・`verify-analogy-strata-migration.js`・`package.json` の `verify:analogy-strata-migration`・`verify-registry.json` の行・`check-anon-access.js` の ANON_RPCS の13本。APPLIED.md の 120 の行は「廃止（v16 で置き換え、適用しない）」、plan の 120 の ER 図も消した
- [x] T0-4 学習側レーンと分担を確かめる（2026-10-04 合意。plan「寄与度用モデルの集計」「既存の表・マイグレーションの扱い」）
  - 127・128・日次の特徴量ジョブは廃止。学習側が小さい PR で消す（workflow の削除を含むのでマージはユーザーの承認）
  - 7テーマ・Version 14 の量の定義・向き・出走表時点のモデル3本（profiles stage=racecard）・118 の stage 列（132）・優勝戦の判定は、学習側の新しいセッションで1本の PR＋列追加のマイグレーション。学習は1回。着手の条件は「向き」の定義が plan にあること（2026-10-04 に書いた）
  - 一致検査 `treeshap-parity.js` は今の2本のまま。「寄与度のモデルを6本にする」は取り下げ
  - #1207 は学習側が「学習の dispatch＋v16 の朝のバッチの dispatch」に作り直す（v16 の起動は T2-5b で FR-2 側が足す）
- [x] T0-5 dispatch 用の fine-grained PAT（Actions: Read and write、boatrace-ai-predictor のみ）を Vercel の環境変数 `GITHUB_ACTIONS_DISPATCH_TOKEN`（Production）に登録（ユーザー、2026-10-05）。有効期限が来たら作り直して差し替える

## T1 データの前提と定義（spec「実装で直すこと」）
- [x] T1-0a （#1262 マージ済み 2026-10-05）`export_pool.js` に列を足す（実進入・決まり手・3連単の払戻・展示の進入・展示 ST・start_flag・本番 ST と F・出遅れ、返還艇の判定に使う `finish_mark`・`refund_boats`）。`KB_CACHE_VERSION` を上げ、学習の workflow を1回回して長期分を書き出し直す（plan「前提の作業」）。BOA-635 の値の約束 D-1〜D-5（plan「BOA-635 との接続」）を固定データの pytest で固定する（3連単は `payout_trio`、F・出遅れ・欠場の ST は null、不成立の払戻は null、実進入不明は null、1〜3着に返還艇が入るレースと不成立は layer の行に入れない）
- [x] T1-0b （#1262 マージ済み。本番の書き出しで 24,871・1,117 を再現）タブ3の母集団（返還の除外・進入不明の除外）を Python で作り、モックの SQL の母集団（若松・6艇ともA1 1,117件、全国・6艇ともA1 24,871件）を再現する pytest
分析の規律（旧 T3b）に従う: 事前登録を単独でコミット・push → second-opinion-reviewer で方法論を見る → 実行 → 結果のコミットに事前登録の SHA。数値には出典（値／指標／比較／母集団／期間／データ版／JSON#キー）。
- [x] T1-1 （JS は #1262、Python は学習側 #1259、どちらもマージ済み。82件の JS⇔Python の突き合わせは #1259）優勝戦・準優勝戦の判定を v2 に広げる（分析は済み 2026-10-04: [analysis/t1/t1-result.md](./analysis/t1/t1-result.md)。ルールは spec「優勝戦・準優勝戦の判定」、正は `t1-1-stage-rule.json` の `rules` と一致検査の文字列82件 `consistency_check_strings`。ユーザーに戻した3件は 2026-10-05 に決定: 関ヶ原決戦・オオムラGP は優勝戦にしない、準優進出戦は準優勝戦にしない（Q-C））。分担（2026-10-05 オーケストレーター）:
  - Python（`features.py` の `round_from_stage`・`round_from_kb_kind`）は学習側レーンが入れる（plan「寄与度用モデルの集計」5）
  - JS（`src/constants/raceStageConfig.js` の `RACE_STAGE_CATEGORY_RULES`）は v16 のこのタスクで入れる。サイトの優勝戦のバッジと今節の得点（`seriesPoints.js`）の分類が本体で6レース変わる（準決勝戦 2、決勝戦・王将位決定戦・県内選手権優・賞金女王決定 各1）。画面が変わるので、変わる6レースの一覧（race_id・名前・旧→新）を PR に書き、ユーザーの承認を得てからマージする。該当画面（優勝戦のバッジ・今節の得点）を E2E で確かめる
  - JS 側の一致検査: `verify-analogy-facts.js`（ci）に82件を入れる。Python 側の `tests/test_features.py` の `test_round_matches_race_stage_config_js` の `STAGES` に82件の名前を足し、JS と Python の答えが82件の `expected` と一致することを確かめる
  - ずれる期間（Python が先に v2、JS が旧のまま）の扱い:
    - 今の `test_round_matches_race_stage_config_js`（#1229、ml-tests）の `STAGES` 30件は旧と v2 で答えが同じ（2026-10-05 に `t1_1_stage_rule.py` の RULES_OLD と RULES_V2 で確認、差0件）。学習側の PR はこのテストを変えずに通る
    - 学習側は82件を Python だけの検査（`expected` との一致）として入れ、JS との比較には足さない。82件を JS との比較に足すのは、JS を v2 にするこのタスクの PR（同じ PR でテストと JS を変える）
    - この間、学習のラウンドの特徴量と v16 のバッチ（Python）は v2、サイトのバッジ・今節の得点（JS）は旧。v16 の画面のラウンドは facts・scenario の応答（Python 側の判定）から作るので（screens「細部の約束」）、v16 の中では食い違わない。サイトの表示が旧のままの6レースは、このタスクのマージで直る
  - 最終日12R の照合は pytest の検査だけ。6艇ともA1の優勝戦で取りこぼしていた22R が入ることを確かめる
- [ ] T1-2 今節の平均着順点を前日までの定義にする（spec Q6）。走数では過去を絞らない（2026-10-05 決定 Q-D。T1-2 の分析は k*＝3、日目の効果と分けられない）。today に6艇それぞれの前日までの走数を入れ、画面で序盤の注記（spec A-4）を出す。実装は T2-1（定義）・T2-5（today）・T7-2（注記）
- [x] T1-3 （2026-10-04、記録だけ。カド一撃の4号艇は除外で +0.4pt 程度、2pt に届かない）返還レースの除外がカド一撃の4号艇の1着率に与える影響を数えて記録（第10・11回）
- [x] T1-4 （2026-10-04、6条件とも今の値を残す）手がかりの条件のしきい値（.01／.02／.03）を期間分割で確かめる（第10回）
- [x] T1-5 （2026-10-04 分析、2026-10-05 決定 Q-E）1号艇の展示タイムは位置・測り方の分で約0.017秒速い。③の1号艇の表の注記を spec C-4 の文に直す（実装は T7-6・T7-8）
- [x] T1-6 （#1267。diff_from_mock に層 14→15件・NCR 566→599件などを記録）例のレース（2026-09-27 若松12R）のモックの数字を、本番の定義で出し直した期待値の固定データを作る（`scripts/ml/analogy/testdata/v16-example.json`）。T1-1 で数字が変わるもの（優勝戦の層・類似レースの14件）は出し直した値にし、差を記録する

## T2 朝のバッチ（scripts/ml/analogy/）
- [x] T2-1 （#1267）`v16_defs.py`: plan「定義」の表の Python 側（級別の組み合わせ・6艇中の順位と同じ値・進入の型・スリットの7形（展示 F は負）・手がかりの8条件・攻める艇・今節の平均着順点・コース別の平均ST）と pytest。テストは先に書き、落ちることを確かめてから実装する
- [x] T2-2 （#1267。tab1.json と全件一致）`v16_facts.py`: 範囲キーごとの facts（艇番×項目×順位×着順の件数、全体、来たときの平均の順位、VA の風速区分）。pytest で例のレースの tab1.json の値を再現
- [x] T2-3 （#1267。prep9b・mark1・t1-4 と突き合わせ）`v16_scenario.py`: 範囲キーごとの scenario（進入×形の結果、30件未満の行、手がかりの当否の件数、③の表）。例のレースの prep8・mark1・slitpred2_hint の値を再現
- [ ] T2-4 （層・距離・33項目は #1267、出力の形は #1269 で済み。残りは展示後の近似の一致率の測定（朝のバッチの初回の後））`v16_similar.py`: そろえる条件の層、出走表時点の距離（重みは表示中の版の `model_win`、L は cal で引き直す）、上位 min(層の件数, 10,000) 件の候補ファイルと表示する上位800件、BOA-635 用の layer ファイル（plan「BOA-635 との接続」の形。並びは race_date 降順・race_id の文字列の降順、D-5 の除外、`n_total` は除外後の件数）、全33項目の「同じ・近い」と全レースで同じ割合、比べる相手の層。例のレースで knn78.md の14件の並びを再現（T1-1 の後は出し直した値）。**展示後の並べ直しの近似の一致率**: 過去の 1,000レースで、全件の厳密な展示後の上位800件と、候補の中で並べ直した上位800件の一致率を、層の大きさ別に測り、`analysis/` に記録（目標 99%以上。足りなければ候補を増やすか、大きい層は全件にする）
- [ ] T2-5 （コードは #1267。残りは本番での初回の実行。学習の workflow を1回回した後に dispatch する）`v16_morning.py`: 上の3つを今日のレースに対して回し、Storage（非公開のバケット `analogy-v16`、`{日付}/{実行ID}/`、上書きしない）に書き終えてから `analogy_v16_snapshots`（stage=racecard）に書く。対象・作り直しの条件・失敗の扱いは plan。過去の日付を指定して作り直す CLI の引数も付ける
- [ ] T2-5b `.github/workflows/analogy-v16-morning.yml`（workflow_dispatch のみ）と、学習側が作り直した #1207 の `scripts/lib/analogyDispatch.js` に v16 の起動を足す（`api/cron/analogy-dispatch-v16.js`、JST 7:10・9:40・13:40、7:40 は racecard の段が無いレースがあるときだけ）。`vercel.json` の crons（UTC で書き JST を併記）とジョブのレジストリ（kind monitor・`failureAlertAfter: 1`）に登録。初回の起動と結果の確認（T0-5 の PAT が要る）
- [ ] T2-6 所要時間と出力の大きさを本番と同じ条件で1回測る（7:10 の回で20分以内、facts・scenario のファイルが gzip 後100KB 以内か、layer が2,000件で gzip 後100KB 以内か。layer が超えたら1,000件に下げて BOA-635 に知らせる）。超えたら plan を直す
- 完了の定義（data-acquisition.md）:
  - 件数: 土日を含む直近5日で、その日の開催レース（中止・欠場ありを除く）に対して today・similar がそろった割合が99%以上（data-acquisition.md の原則どおり。バッチなので取得の失敗に左右されない）
  - タイミング: 作成時刻がすべて締切前。7:10 の回が 7:30 までに終わる
  - 継続監視: `verify-analogy-v16.js`（T5-3）が前日の欠け・作成時刻を毎晩数え、閾値（99%）を下回ったら Slack に通知。workflow の失敗・Cron の未実行（最終成功からの経過時間）も Slack に通知

## T3 DB と Storage
- [x] T3-1 （#1267。番号は 133、racecard_hash 列を足した）マイグレーション `analogy_v16_snapshots`（133）と PGlite の検証（ci）。118 への `stage` 列（132）は学習側の PR。ヘッダーに plan.md の参照を書き、`generate-er-diagram.js analogy-finder` で plan の ER 図を作り直す
- [x] T3-2 （2026-10-05 ユーザー適用、読み取りで確認、APPLIED.md 済み）マイグレーションの本番適用をユーザーに依頼する（書き込み SQL だけを渡す）。適用後、読み取りで表・ポリシー・匿名の権限を確かめ、APPLIED.md に行を足す
- [x] T3-3 （#1269。バケットは朝のバッチの初回で作る。similar/ の7日での削除は夜の確認の --cleanup）Storage の非公開のバケット `analogy-v16` を作り（`analogy` とは分ける）、`similar/`（候補）の7日の削除を夜の確認のジョブに入れる
- [x] T3-4 127・128 は適用せず廃止（Q2、T0-4 で学習側と合意。削除の PR は学習側）

## T4 展示後の段（Vercel の JS）
- [x] T4-1 （#1269。Python の展示後の厳密な並びと順位が完全一致、距離²の差 2.0e-7）`src/utils/analogySimilarRerank.js`（純粋関数）: 候補ファイルと展示の値から、展示後の距離で並べ直す。T2-4 の Python の結果と固定データで一致（順位が完全一致、距離の差 < 1e-6）
- [x] T4-2 （#1269。analogyScenario.js、Python の固定データと全件一致）今日の展示の値（展示タイムの順位・風速区分・展示の進入の型・展示 ST の形）を作る。`analogyScenario.js` を使う
- [ ] T4-3 （#1269 で Cron は済み。モードは off が既定。展示の取得からの呼び出しは公開前の実測で要否を決める）起動: 専用の Vercel Cron `api/cron/analogy-v16-exhibition.js`（2分ごと。6艇の展示タイムあり・締切前・展示後の段なし、件数に上限。展示の取得の Cron のモードに依存しない）と、`preRaceHandlers.js` の `runSlotsWithRefresh` の後からの呼び出し（失敗は取得の成否に影響させない）。欠場の検知（status='absent'）、厳密さの判定（`exact`）、Storage → DB の順に書く
- 完了の定義:
  - 件数: 土日を含む直近5日で、6艇の展示タイムがそろったレースのうち展示後の段が締切前に作られた割合が95%以上（99% にしないのは、展示の取得が締切の約10分前に集中し、取得の遅れ・Vercel の起動の遅れを除けないため。届かない分は画面で「展示前」のまま出せる）
  - タイミング: 展示の取得から段の作成までの時間の分布（中央値・p95）
  - 継続監視: `verify-analogy-v16.js` が前日の充足率を数え、閾値で Slack に通知

## T5 API と監視
- [x] T5-1 （#1269。AIの見立ては facts に入れず既存の /api/analogy/contribution を画面が読む）`api/analogy/facts/[raceId].js`・`api/analogy/similar/[raceId].js`・`api/analogy/scenario/[raceId].js`・`api/analogy/layer/[raceId].js`（BOA-635 用）と共通の読み出し `api/_lib/analogyV16.js`（plan「API」「BOA-635 との接続」。キャッシュ・失敗の扱い・status）
- [ ] T5-2 AIの見立て: `analogy_contribution_profiles` の表示中の版から、艇番×着順×段の7テーマと項目・向き（plan「向きの計算」の `direction`。揺れの確認・両端で上がる形は 2026-10-05 決定 Q-A・Q-B。`none` は「向きははっきりしない」）を返す（学習側の集計の変更 T0-4 の後）。`/api/analogy/contribution` に stage の条件を足す（学習側の 129 の後）
- [x] T5-3 （#1269。Nightly DB Verify に載せた。未稼働のときは通す）`scripts/maintenance/verify-analogy-v16.js`（nightly、`verify-registry.json` に登録）: 前日の出力の欠け・作成時刻・展示後の段の充足率、例のレースの固定データの再現
- [ ] T5-4 録画再生の E2E に新しい API が素通しされることの確認

## T6 共通部品と純粋関数
- [x] T6-1 （#1118 で切り出し済み。`src/components/race/BoatBadge.jsx`、クラス名は rol- のまま）`BoatBadge` を `src/components/race/BoatBadge.jsx` に切り出す（見た目が変わらないことを E2E で確認）
- [x] T6-2 （(d1)。順位・Wilson・判定は Python の固定データ `testdata/v16-ui-cases.json`（`make_v16_ui_cases.py`）と一致。Wilson は既存の `src/utils/wilson.js` に `wilsonInterval` を足した。展開シナリオの画面の判定は `analogyScenario.js` に足した）`analogyFacts.js`・`analogyScenario.js`・`analogyAggregate.js`・`analogyFormat.js`・`analogyLayer.js`（層の説明文 `describeAnalogyLayer`。BOA-635 と共用）・Wilson 区間と `scripts/maintenance/verify-analogy-facts.js`（ci）。Python の T2-1 と同じ固定データ
- [x] T6-3 （(d1)。フックは `src/hooks/useAnalogyV16.js`。キャッシュは CDN と同じ60秒）`src/services/analogyService.js` に3つの取得、`useAnalogyFacts`・`useAnalogySimilar`・`useAnalogyScenario`

## T7 画面（screens.md）
- [ ] T7-1 `AnalogyFinderSection` の作り直しと `AnalogyControls`（時点・着順・タブ、状態の表）
- [ ] T7-2 来る艇の条件: `ConditionFactsTab`・`FactHexagon`・`FactCard`（今節の平均着順点の注記2種: 序盤 Q-D・優勝戦/準優勝戦の日 Q7）・ボートの折りたたみ・`WindWaveFacts`
- [ ] T7-3 `AiOutlook`（AIの見立て、展示前の準備中）
- [ ] T7-4 類似レース: `SimilarRacesTab`・`SimilarSonar`・`SimilarityItems`・`SimilarCompareList`
- [ ] T7-5 決まり方の共用部品: `OutcomeBars`・`FinishSankey`・`TrifectaList`
- [ ] T7-6 展開シナリオ: `ScenarioTab`・`EntryPatternPicker`・`SlitHint`・`SlitShapePicker`・`SlitShapeIcon`・`AttackTable`（1号艇の表の注記 Q-E）・`ScenarioRaceList`
- [ ] T7-7 `DataSources`（使っている項目）
- [ ] T7-8 i18n（`aiPredictionTab.analogy.*`、4言語）。「競艇」「寄与度」「モデル」を画面に出さない。日本語の直し 1〜49 を反映

## T8 仕上げ
- [ ] T8-1 `npm run test:layout`（AI予想タブの節の3タブ。375/768/1024/1440/1920px）とダークモードの目視
- [ ] T8-2 データ精度の検証（`data-accuracy-verifier`）: 3タブの数字を本番 DB から数え直して照合。例のレースはモックの数字との差を説明できること
- [ ] T8-3 受け入れ E2E（`e2e/acceptance/analogy-finder.spec.js`）をローカルで実行。例のレースの raceId は `2026-09-27-20-12`（`ANALOGY_RACE_ID=2026-09-27-20-12 npx playwright test --config=playwright.acceptance.config.js e2e/acceptance/analogy-finder.spec.js`）。級別が混ざる予選と優勝戦の日の確認（Q1・Q7）は、テストが facts・scenario の応答を差し替えて行う
- [ ] T8-4 承認モックとの比較（`mock-diff-checker`）と、ファン評価ループ（`.claude/rules/review-fix-cycle.md`。新しい主要表示のため）
- [ ] T8-5 完了監査: このファイルの全チェックボックスと、コミット・本番の実測を突き合わせる
