# アナロジー・ファインダー tasks（モック Version 16 準拠）

元: [spec.md](./spec.md)・[screens.md](./screens.md)・[plan.md](./plan.md)。依存順。1タスク＝1コミット〜1PR。2026-10-02 までの版は `git show fa61e6213:docs/design/analogy-finder/tasks.md`（済みのタスクの記録もそちら）。

**着手条件**: spec の未確定 Q1〜Q5 の回答、design-reviewer と受け入れ E2E（`/step4` の事前条件）、ユーザーの実装の承認（オーケストレーター経由）。本番 DB への書き込み（マイグレーションの適用）はユーザーが行う。

## 済み（旧版から引き継ぐもの）
- [x] Phase M（寄与度用モデル、MD-1〜MD-7）。v16 では AIの見立てと類似レースの距離の重みに使う
- [x] FR-1 の学習の本番化（#1118・#1121。118 は本番適用済み）
- [x] 出走表時点専用モデルと日次の特徴量ジョブ（#1176・#1178。127・128 は未適用）
- [x] JS の TreeSHAP と直前情報8列の関数（#1177）。v16 では直前情報の関数だけを使う（展示後の並べ直し）
- [x] モック Version 16 の承認（2026-10-04、mock/APPROVED.md）

## T0 準備
- [ ] T0-1 spec の未確定 Q1〜Q7 をオーケストレーター経由でユーザーに確認し、spec・screens・plan に反映する。spec・screens が変わったら受け入れ E2E を acceptance-test-writer に書き直させる
- [ ] T0-2 BOA-635 のレーンと行の渡し方を合意し直す（plan「BOA-635 との接続」。`layer/{race_id}.json.gz` の形と、v16 の層を分母にしてよいか）。**T2 より前に済ませる**
- [ ] T0-3 マイグレーション 120 の扱い（Q4）に合わせて、120 と `verify-analogy-strata-migration.js` を消すか作り直す。`verify-registry.json`・`check-anon-access.js` の ANON_RPCS・APPLIED.md から 120 の分を外す
- [ ] T0-4 学習側レーンと分担を確かめる（plan「寄与度用モデルの集計」: Version 14 の量の定義・7テーマ・向き・出走表時点のモデルを3本にして同じ集計・118 の `analogy_contribution_profiles` に `stage` 列を足すマイグレーション・優勝戦の判定）。Q2 で「レースごとの寄与度をやめる」なら、日次の特徴量ジョブ・127・128・`parity_fixture.json` の切り替えの扱いを学習側と決める
- [ ] T0-5 dispatch 用の fine-grained PAT を作り、Vercel の環境変数 `GITHUB_ACTIONS_DISPATCH_TOKEN` に入れる（ユーザーの作業）

## T1 データの前提と定義（spec「実装で直すこと」）
- [ ] T1-0a `export_pool.js` に列を足す（実進入・決まり手・3連単の払戻・展示の進入・展示 ST・start_flag・本番 ST と F・出遅れ）。`KB_CACHE_VERSION` を上げ、学習の workflow を1回回して長期分を書き出し直す（plan「前提の作業」）
- [ ] T1-0b タブ3の母集団（返還の除外・進入不明の除外）を Python で作り、モックの SQL の母集団（若松・6艇ともA1 1,117件、全国・6艇ともA1 24,871件）を再現する pytest
分析の規律（旧 T3b）に従う: 事前登録を単独でコミット・push → second-opinion-reviewer で方法論を見る → 実行 → 結果のコミットに事前登録の SHA。数値には出典（値／指標／比較／母集団／期間／データ版／JSON#キー）。
- [ ] T1-1 優勝戦・準優勝戦の判定を広げる（名前のルールだけ。準優勝戦の判定を先に）。JS `raceStageConfig.js`・Python `features.py` を同じ規則にし、固定の文字列で一致検査（`tests/test_features.py`）。最終日12R の照合は pytest の検査だけ。6艇ともA1の優勝戦で取りこぼしていた22R が入ること、優勝戦のバッジ・今節の得点の画面が意図どおり変わることを確かめる
- [ ] T1-2 今節の平均着順点の as-of（spec Q6）を反映し、走数の絞り込み（3走以上か4走以上か）を決める（第9回 指摘3）
- [ ] T1-3 返還レースの除外がカド一撃の4号艇の1着率に与える影響を数えて記録（第10・11回）
- [ ] T1-4 手がかりの条件のしきい値（.01／.02／.03）を期間分割で確かめる（第10回）
- [ ] T1-5 1号艇の展示タイムが系統的に速い理由を調べ、③の注記を直すか決める（第11回）
- [ ] T1-6 例のレース（2026-09-27 若松12R）のモックの数字を、本番の定義で出し直した期待値の固定データを作る（`scripts/ml/analogy/testdata/v16-example.json`）。T1-1 で数字が変わるもの（優勝戦の層・類似レースの14件）は出し直した値にし、差を記録する

## T2 朝のバッチ（scripts/ml/analogy/）
- [ ] T2-1 `v16_defs.py`: plan「定義」の表の Python 側（級別の組み合わせ・6艇中の順位と同じ値・進入の型・スリットの7形（展示 F は負）・手がかりの8条件・攻める艇・今節の平均着順点・コース別の平均ST）と pytest。テストは先に書き、落ちることを確かめてから実装する
- [ ] T2-2 `v16_facts.py`: 範囲キーごとの facts（艇番×項目×順位×着順の件数、全体、来たときの平均の順位、VA の風速区分）。pytest で例のレースの tab1.json の値を再現
- [ ] T2-3 `v16_scenario.py`: 範囲キーごとの scenario（進入×形の結果、30件未満の行、手がかりの当否の件数、③の表）。例のレースの prep8・mark1・slitpred2_hint の値を再現
- [ ] T2-4 `v16_similar.py`: そろえる条件の層、出走表時点の距離（重みは表示中の版の `model_win`、L は cal で引き直す）、上位 min(層の件数, 10,000) 件の候補ファイルと表示する上位800件、BOA-635 用の層の全件（新しい順に最大2,000件）、全33項目の「同じ・近い」と全レースで同じ割合、比べる相手の層。例のレースで knn78.md の14件の並びを再現（T1-1 の後は出し直した値）。**展示後の並べ直しの近似の一致率**: 過去の 1,000レースで、全件の厳密な展示後の上位800件と、候補の中で並べ直した上位800件の一致率を、層の大きさ別に測り、`analysis/` に記録（目標 99%以上。足りなければ候補を増やすか、大きい層は全件にする）
- [ ] T2-5 `v16_morning.py`: 上の3つを今日のレースに対して回し、Storage（非公開のバケット `analogy-v16`、`{日付}/{実行ID}/`、上書きしない）に書き終えてから `analogy_v16_snapshots`（stage=racecard）に書く。対象・作り直しの条件・失敗の扱いは plan。過去の日付を指定して作り直す CLI の引数も付ける
- [ ] T2-5b `.github/workflows/analogy-v16-morning.yml`（workflow_dispatch のみ）と Vercel Cron `api/cron/analogy-v16-dispatch.js`（JST 7:10・9:40・13:40、7:40 は拾い直し）。`vercel.json` の crons（UTC で書き JST を併記）とジョブのレジストリに登録。初回の起動と結果の確認
- [ ] T2-6 所要時間と出力の大きさを本番と同じ条件で1回測る（6:40 の回で20分以内、facts・scenario のファイルが gzip 後100KB 以内か）。超えたら plan を直す
- 完了の定義（data-acquisition.md）:
  - 件数: 土日を含む直近5日で、その日の開催レース（中止・欠場ありを除く）に対して today・similar がそろった割合が99%以上（data-acquisition.md の原則どおり。バッチなので取得の失敗に左右されない）
  - タイミング: 作成時刻がすべて締切前。7:10 の回が 7:30 までに終わる
  - 継続監視: `verify-analogy-v16.js`（T5-3）が前日の欠け・作成時刻を毎晩数え、閾値（99%）を下回ったら Slack に通知。workflow の失敗・Cron の未実行（最終成功からの経過時間）も Slack に通知

## T3 DB と Storage
- [ ] T3-1 マイグレーション（`analogy_v16_snapshots` と、118 の `analogy_contribution_profiles` への `stage` 列。番号は origin/master の最新を確認）と PGlite の検証（ci）。ヘッダーに plan.md の参照を書き、`generate-er-diagram.js analogy-finder` で plan の ER 図を作り直す
- [ ] T3-2 マイグレーションの本番適用をユーザーに依頼する（書き込み SQL だけを渡す）。適用後、読み取りで表・ポリシー・匿名の権限を確かめ、APPLIED.md に行を足す
- [ ] T3-3 Storage の非公開のバケット `analogy-v16` を作り（`analogy` とは分ける）、`similar/`（候補）の7日の削除を夜の確認のジョブに入れる
- [ ] T3-4 127・128 の扱い（spec Q2 が「やめる」なら適用しない。学習側レーンと決める）

## T4 展示後の段（Vercel の JS）
- [ ] T4-1 `src/utils/analogySimilarRerank.js`（純粋関数）: 候補ファイルと展示の値から、展示後の距離で並べ直す。T2-4 の Python の結果と固定データで一致（順位が完全一致、距離の差 < 1e-6）
- [ ] T4-2 今日の展示の値（展示タイムの順位・風速区分・展示の進入の型・展示 ST の形）を作る。`analogyScenario.js` を使う
- [ ] T4-3 起動: 専用の Vercel Cron `api/cron/analogy-v16-exhibition.js`（2分ごと。6艇の展示タイムあり・締切前・展示後の段なし、件数に上限。展示の取得の Cron のモードに依存しない）と、`preRaceHandlers.js` の `runSlotsWithRefresh` の後からの呼び出し（失敗は取得の成否に影響させない）。欠場の検知（status='absent'）、厳密さの判定（`exact`）、Storage → DB の順に書く
- 完了の定義:
  - 件数: 土日を含む直近5日で、6艇の展示タイムがそろったレースのうち展示後の段が締切前に作られた割合が95%以上（99% にしないのは、展示の取得が締切の約10分前に集中し、取得の遅れ・Vercel の起動の遅れを除けないため。届かない分は画面で「展示前」のまま出せる）
  - タイミング: 展示の取得から段の作成までの時間の分布（中央値・p95）
  - 継続監視: `verify-analogy-v16.js` が前日の充足率を数え、閾値で Slack に通知

## T5 API と監視
- [ ] T5-1 `api/analogy/facts/[raceId].js`・`api/analogy/similar/[raceId].js`・`api/analogy/scenario/[raceId].js`（plan「API」。キャッシュ・失敗の扱い）
- [ ] T5-2 AIの見立て: `analogy_contribution_profiles` の表示中の版から、艇番×着順×段の7テーマと項目・向きを返す（学習側の集計の変更 T0-4 の後）
- [ ] T5-3 `scripts/maintenance/verify-analogy-v16.js`（nightly、`verify-registry.json` に登録）: 前日の出力の欠け・作成時刻・展示後の段の充足率、例のレースの固定データの再現
- [ ] T5-4 録画再生の E2E に新しい API が素通しされることの確認

## T6 共通部品と純粋関数
- [ ] T6-1 `BoatBadge` を `src/components/race/BoatBadge.jsx` に切り出す（見た目が変わらないことを E2E で確認）
- [ ] T6-2 `analogyFacts.js`・`analogyScenario.js`・`analogyAggregate.js`・`analogyFormat.js`・Wilson 区間と `scripts/maintenance/verify-analogy-facts.js`（ci）。Python の T2-1 と同じ固定データ
- [ ] T6-3 `src/services/analogyService.js` に3つの取得、`useAnalogyFacts`・`useAnalogySimilar`・`useAnalogyScenario`

## T7 画面（screens.md）
- [ ] T7-1 `AnalogyFinderSection` の作り直しと `AnalogyControls`（時点・着順・タブ、状態の表）
- [ ] T7-2 来る艇の条件: `ConditionFactsTab`・`FactHexagon`・`FactCard`・ボートの折りたたみ・`WindWaveFacts`
- [ ] T7-3 `AiOutlook`（AIの見立て、展示前の準備中）
- [ ] T7-4 類似レース: `SimilarRacesTab`・`SimilarSonar`・`SimilarityItems`・`SimilarCompareList`
- [ ] T7-5 決まり方の共用部品: `OutcomeBars`・`FinishSankey`・`TrifectaList`
- [ ] T7-6 展開シナリオ: `ScenarioTab`・`EntryPatternPicker`・`SlitHint`・`SlitShapePicker`・`SlitShapeIcon`・`AttackTable`・`ScenarioRaceList`
- [ ] T7-7 `DataSources`（使っている項目）
- [ ] T7-8 i18n（`aiPredictionTab.analogy.*`、4言語）。「競艇」「寄与度」「モデル」を画面に出さない。日本語の直し 1〜49 を反映

## T8 仕上げ
- [ ] T8-1 `npm run test:layout`（AI予想タブの節の3タブ。375/768/1024/1440/1920px）とダークモードの目視
- [ ] T8-2 データ精度の検証（`data-accuracy-verifier`）: 3タブの数字を本番 DB から数え直して照合。例のレースはモックの数字との差を説明できること
- [ ] T8-3 受け入れ E2E（`e2e/acceptance/analogy-finder.spec.js`）をローカルで実行
- [ ] T8-4 承認モックとの比較（`mock-diff-checker`）と、ファン評価ループ（`.claude/rules/review-fix-cycle.md`。新しい主要表示のため）
- [ ] T8-5 完了監査: このファイルの全チェックボックスと、コミット・本番の実測を突き合わせる
