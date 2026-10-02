# アナロジー・ファインダー tasks

元: [spec.md](./spec.md)・[screens.md](./screens.md)・[plan.md](./plan.md)。依存順。1タスク＝1コミット〜1PR。

**着手条件（spec「実装開始の前提条件」）**: K/B 補完の完了判定（PR #1037、月別×列 99% 以上、2026-10-05 予定）。T0 は判定前でも進めてよいが、T3 以降の本番データでの学習は判定の後。

## Phase M（済み）
- [x] MD-1/MD-5 主モデル（[phase-m-result.md](./analysis/phase-m-result.md)）
- [x] MD-3 オッズ（[md3-v2-result.md](./analysis/md3-v2-result.md)。今回は材料にしない）
- [x] MD-4 遡及項目（phase-m-result.md）
- [x] MD-6 類似レースの方式（[md6-result.md](./analysis/md6-result.md)。会場ペナルティつき k-NN）
- [ ] MD-3 の再判定: 2026-10-02 以降のまだ使っていないレース約6,100R で、条件付きロジット・ε=0.001・締切10〜60分前で最も近い時点で判定する（2026-11中旬の見込み）。採れたら T4 の themes に「市場」を足す（Phase U の着手は待たない）

## T0 準備
- [x] T0-0 FR-2 の類似の定義の比べ直し → 層別 S*（2026-10-02 ユーザー決定）。軸の上限を外した前向き選択でも S* のまま（[fr2-strat-result.md](./analysis/fr2-strat-result.md) 4）。技術判断は ADR-0082、マイグレーションは 120
- [ ] T0-1 ユーザー確認（モック https://claude.ai/artifact/C8UpMVkF4G3jaZAvJGYtna）: Q1 案A（チップ）／案B（チップ＋輪）、Q2 末尾からだけ外す、Q3 200件未満は自動で外す、Q4 割合は件数÷n（平滑化しない）、Q5 任意で条件を足すチップを作るか。回答で spec FR-2・screens・T7 を直す
- [x] T0-1b BOA-635 のレーンと行の渡し方を合意（2026-10-02）。120 に `get_analogy_similar_races`（自動の深さ・最大2,000件）を足した（plan「BOA-635 との接続」）
- [ ] T0-2 干渉効果のコールアウトに出すパターンを実データで選ぶ（spec FR-3。人が決めた1例に頼らない）。類似レースの層の中で（`course_flow` の件数から）、1着の決まり手×進入コースごとに2着の分布が全体から最も離れる組み合わせを上位から選び、n の下限と一緒に `analysis/` に記録する
- [ ] T0-3 FR-3 の3着の段の注記（件数が少ないとき）の n の目安を決めて spec に書く（小標本フラグはレース数で数えると決めた。screens の表）
- [x] ~~T0-4・T0-5・T0-6~~ 層別では不要（k-NN の近傍の距離と、その説明の一行の確認だった）
- [ ] T0-7 10/5 の補完判定の後、spec MD-2 の充足率を更新する。2026-04〜09 の展示・気象はデータ取得レーンの補完計画に入った（2026-10-01）。例外の承認済み一覧を確認する
- [x] ~~T0-8~~ 層別では Storage を使わない

## T1 本番の器
- [x] T1-0 マイグレーション 118（FR-1）は本番適用済み
- [ ] T1-1 マイグレーション 120 の本番適用をユーザーに依頼する（書き込み SQL だけを渡す）。適用後、読み取りで2表・公開ポリシー2本・匿名の EXECUTE が6関数だけであること（120 末尾の確認 SQL）を確かめ、APPLIED.md を「適用済み」に直す。`check-anon-access.js` の ANON_RPCS は 120 の PR で更新済み
- [ ] T1-2 長期分の初回投入（`backfill-analogy-pool.js`、3か月ずつ。ユーザーが実行）。前後でダッシュボードの Disk IO を確認する
- [ ] T1-3 （FR-1 の残り）週次学習の dispatch 用の fine-grained PAT を作り、Vercel の環境変数 `GITHUB_ACTIONS_DISPATCH_TOKEN` に入れる（ユーザーの作業）。FR-2 には要らない

## T2 特徴量と学習の本番化（scripts/ml/analogy/）
寄与度の分は PR #1121 でマージ済み（T2-1〜T2-5・T2-7・T2-8。マイグレーションは 118 に切り出し）。本番適用と初回の手動実行はユーザーの作業（#1121 の本文）。
- [x] T2-1 `export_pool.js`: 長期（kb_archive）と本体から書き出す。Phase M の `export-data.js` を土台に、補完後のデータで欠損の扱いを見直す。長期分は初回だけ書き出して Storage（`analogy/source/`）に置き、週次は本体の差分だけ読む。2025-12-02 の重なりは本体を優先
- [x] T2-2 `features.py`: 近傍の距離は出走表時点の1段（ローリングは日単位でずらす）、寄与度のモデルは直前情報も使う。学習・母集団・今日のレースで同じ関数を使う。ラウンドの区分は本体が `getRaceStageCategory` と同じ規則、長期は `kb_archive_races.stage_kind`
- [x] T2-3 `tests/`（pytest）: 当日以降の結果（同じ日の前のレースを含む）が特徴量に混ざらない、近傍の距離に直前情報の列が入っていない、ラウンド区分が `raceStageConfig.js` と一致、テーマ集計の合計が1、analogy_pool_outcomes の値の約束（3連単は本体の `payout_trio` から・F/出遅れ/欠場の ST は NULL・不成立の払戻は NULL・実進入不明は NULL・不成立と1〜3着に返還艇が入るレースは母集団に入れない。plan の get_analogy_neighbors の節）。テストは先に書き、落ちることを確かめてから実装する
- [x] T2-4 `train.py`: 主モデル3本（1着・2着以内・3着以内）、木の数固定、時系列の最後の分割での評価。品質ゲート（基準1に有意に勝つ・前の版より 0.005 以上悪化しない）
- [x] T2-5 `profiles.py`: SHAP をテーマに集計（`themes` 配列から。テーマ数は可変）、直近12か月、スライス（着順3×会場25×グレード6×ラウンド5×艇番7、グレード不明は「全グレード」にだけ）、seed 5回の SD、テーマ内の内訳（似た意味の項目はまとめる）
- [x] ~~T2-6 `pool.py`~~ 層別では不要（母集団は 120 の SQL 関数で作る）
- [x] T2-7 `db.py`: PostgREST への書き込み（service key）。analogy_pool_outcomes は差分だけ upsert、書き込み0件はエラー
- [x] T2-8 `.github/workflows/train-analogy.yml`（schedule なし、workflow_dispatch のみ）。版の切り替えは `activate_analogy_model`。初回は手動実行
- [ ] 本番実測: analogy_models に is_active の1行、analogy_contribution_profiles が全スライスの期待件数（n>0 のセル数。算出根拠を書く）であることを実測クエリで確認する
- [ ] 継続監視: 週次の学習が失敗・品質ゲートで止まったら Slack に通知されること、最終成功から8日を過ぎたら検知されることを確認する

## T3 母集団とスナップショット（FR-2・BOA-627。SQL と Vercel Cron）
- [x] T3-00 マイグレーションの番号を 120 に振り直した（119 は #1145、121 は #1158 が使う。2026-10-02 オーケストレーター確定）。BOA-635 の文書の「119」は BOA-635 のレーンが直す
- [x] T3-0 マイグレーション 120（母集団・スナップショット・関数・RPC）と PGlite の検証 `verify-analogy-strata-migration.js`（ci）
- [ ] T3-1（公開前の必須条件）`scripts/ml/analogy/strata.py`（参照実装。`cm2.py` の `build_axes` の境界を固定し 1/100単位で比較、完全レースの判定は `features.py`）と pytest（境界ちょうど・同率・勝率の欠け）
- [ ] T3-2 `scripts/maintenance/verify-analogy-pool.js`（**nightly-verify-db.yml で毎晩**。補完で過去の行が変わるため manual にしない。`verify-registry.json` に登録。公開前の必須条件）: 期間を区切って参照実装と母集団の「完全レースの集合」「条件4値」「決まり手・1着艇・1着の進入コースのラベル」を照合。元テーブルと母集団の行数の差、スナップショットの件数と数え直しの一致率も出す
- [ ] T3-3 `scripts/maintenance/backfill-analogy-pool.js`（手動 CLI）: 期間を3か月ずつに切って `refresh_analogy_pool` を呼ぶ。`--dry-run` は `analogy_pool_rows_*` の件数だけ
- [ ] T3-4 `api/cron/analogy-pool.js`・`api/cron/analogy-snapshots.js`（`createScrapeCronHandler`、モード off／shadow／live）と `vercel.json` の crons（plan「スクリプト構成」の時刻。UTC で書き JST を併記）。ジョブのレジストリに登録。0件の判定: 母集団は期待件数が0でないのに source_rows が0なら失敗、スナップショットは対象があるのに0件なら失敗
- [ ] T3-5 運用: K/B 補完・BOA-523 の実進入の補完が終わったら、その期間で `backfill-analogy-pool.js` を回す（data-acquisition レーンに知らせる）
- [ ] 本番実測（件数）: analogy_pool_outcomes が、2019-04〜前日の完全レース数（算出根拠: 元テーブルで完全レースの条件を数えたもの。Phase M の 2019-04〜2026-09 で 409,588R）に対し99%以上。差は理由つきで報告する
- [ ] 本番実測（スナップショット）: 土日を含む直近5日で、その日の開催レース（中止を除く）に対するスナップショットの割合が98%以上、作成時刻が締切前であること
- [ ] 応答時間: 深さ1〜4それぞれで `get_analogy_similar` の実行時間（目標 2秒以内）
- [ ] 継続監視: 当日のスナップショットの充足率と、母集団の最終日（前日まで入っているか）を日次で計測し、閾値（98%・最終日が2日以上古い）で Slack に通知されること。Cron の失敗・未実行（最終成功からの経過時間）が通知されること

## T3b 分析の規律（2026-10-02 データサイエンス体制のレビューを受けたユーザー承認済みの対策。公開前の必須条件）
- [ ] T3b-1 表示する推定量の評価: 画面に出す推定量（自動の深さの層の生の件数÷n。BOA-635 は同じ層の新しい順2,000件）を、選択に使ったのと同じ cal で1回評価し、`analysis/` に記録する。spec に「表示の推定量＝評価した推定量」の対応表を置く
- [ ] T3b-2 以後の分析は、事前登録を単独でコミット・push してから回し、結果のコミットに事前登録の SHA を書く。事前登録の前に second-opinion-reviewer で方法論（時点・リーク・test の使用履歴・ベースライン・指標とファンに見える差）を1回レビューする
- [ ] T3b-3 分析コードと結果は master に残せる形にする（入出力のパスは環境変数。scratchpad の絶対パスを書かない。既存の `scripts/analysis/analogy-finder-fr2-strat/` のパスも直す）。縮小版の結果 JSON には `scale` を必ず入れる
- [ ] T3b-4 報告・文書の数値には「値／指標／A−B（比較対象）／母集団・部分集合／期間（cal・test）／データ版／結果 JSON のパス#キー」を付ける

## T3c レースごとの寄与度（B、ADR-0083。推論側＝このレーン。学習側は feature/boa-271-perrace-train）
- [ ] T3c-1（**先にマージする**。学習ジョブがこれを必要とする）`src/utils/analogyTreeShap.js`（dump_model の JSON から推論と TreeSHAP。カテゴリ分岐・欠損の向き）と、直前情報8列を作る関数（float32: DB から読んだ値は fround、差は float32 の Kahan 和の平均を fround して引く、順位は float32 で同値は min、無風・風向 null の扱いは features.py に合わせる）、`scripts/ml/analogy/treeshap-parity.js`（parity_fixture.json を読み、特徴量は完全一致・SHAP は最大差 < 1e-9・合計＝生スコア。一致しなければ終了コード1）。CI 用の小さな固定モデルと固定データの verify（ci）
- [ ] T3c-2 マイグレーション（推論側）: `analogy_race_contributions`（主キー `(race_id, stage)`、RLS・匿名は SELECT のみ、締切前だけ書く・既にあれば書かない）
- [ ] T3c-3 `src/utils/analogyRaceContribution.js`: テーマ集計（中心化した |SHAP| のシェア、艇ごと・テーマごと・グループごとの符号つきの値、展示のグループが最も押し上げた艇）
- [ ] T3c-4 出走表時点の段: `api/cron/analogy-snapshots.js` で、特徴量があり段が無い締切前のレース（欠場が分かっていれば出さない）を計算
- [ ] T3c-5 展示後の段: 展示取得のフック（`runSlotsWithRefresh` の後）と、毎分の起動での拾い直し（6艇の展示あり・欠場なし・締切前・展示後の段なし、件数に上限）。切り替えは専用の環境変数。失敗は取得の成否に影響させない
- [ ] T3c-6 API `GET /api/analogy/race-contribution/[raceId]`
- [ ] T3c-7 本番実測: 土日を含む直近5日で、展示後の段が締切前に作られた割合（対象: 6艇の展示あり・欠場なしのレース）、計算時間の分布、本番の版での JS と Python の一致
- [ ] T3c-8 継続監視: 当日の段の充足率と一致検査の失敗を Slack に通知
- [ ] 公開の前提条件: workflow_dispatch の PAT（ユーザー）、日次の特徴量ジョブの本番条件での計測（学習側）

## T4 API
- [ ] T4-1 `api/analogy/contribution.js`（Edge）: is_active の版の themes と該当スライス。n=0 のスライスは一段広いスライスに戻し、戻したことを返す
- [ ] T4-2 `api/analogy/similar/[raceId].js`（Edge、`?depth=`）: `get_analogy_similar` の結果。キャッシュは plan「API」の表
- [ ] T4-3 録画再生の E2E に新しい API が素通しされることの確認（`e2e/recording.json` の撮り直しは日次で自動）

## T5 共通部品
- [ ] T5-1 `BoatBadge` を `src/components/race/BoatBadge.jsx` に切り出し、`RaceOddsListTab.jsx` から使う（見た目が変わらないことを E2E で確認）
- [ ] T5-2 `src/services/analogyService.js` に `getAnalogySimilar(raceId, depth)` を足す（`(raceId, depth)` 単位のメモリキャッシュ。NULL・エラーは残さない。API 失敗時は PostgREST の RPC を直接呼ぶ）と `useAnalogySimilar`
- [ ] T5-3 `src/utils/analogyAggregate.js`（RPC の件数から、分布の行・サンキーの流れ・組み合わせ一覧・「1号艇以外が1着」・コールアウト）と `src/utils/analogyReason.js`（似ている理由の一文。spec FR-2 の文面ルール6つ）。`scripts/maintenance/verify-analogy-aggregate.js`（ci）で固定データの期待値と文面ルールを検証

## T6 FR-1 寄与度
- [ ] T6-1 `ContributionView`（レーダー＋テーマ別の棒、着順タブ、詳細条件の折りたたみ、n・期間・モデル版、小標本フラグ）。テーマは themes 配列から描く
- [ ] T6-2 `ContributionBreakdown`（テーマを押すと内訳。似た意味の項目はまとめ、個別値は参考の注記）
- [ ] T6-3 `BoatCompareTable`（艇番2つの重ね描きと比較表。チャートに数値ラベルを置かない）
- [ ] T6-4 順位の扱い: 隣どうしの差が SD の数倍に満たないテーマの順位を強調しない（spec FR-1 の安定性）

## T7 FR-2 類似レース（T0-1 の回答で確定する）
- [ ] T7-1 `SimilarRacesView`: 似ている理由の一文（主役、件数を大きく）、4分布（決まり手・1着の艇番・1着の進入コース・よく出た出目）、n と期間、事故情報の常設注記、同じ条件の過去レース（新しい順）
- [ ] T7-2 `ConditionChips`: 4条件を順に並べ、末尾から「外す」・外した条件を「戻す」。自動で外したときは理由の一文。深さを変えたら取り直す（Q2・Q3）
- [ ] T7-3 （Q1 で案B のときだけ）`DepthRings`: 一致する条件の数の輪と、深さごとの件数・1号艇1着率。輪か行を押すとその深さ
- [ ] T7-4 （Q5 で作るときだけ）任意の追加条件のチップ。足す前に件数を予告、30件未満は%を出さない。母集団に列を足すマイグレーションが別に要る
- [ ] T7-5 データ段の表示（「出走表 7:30 時点のデータ（前日までの成績）」、確定後は「（発走前）」、スナップショットが無いときは保存なしの一文）

## T8 FR-3 組み合わせ
- [ ] T8-1 `FinishSankey`（3段を常に出す、全ての流れを艇の色で、少ない流れは薄く、帯タップで件数・%、1号艇の白は枠線）
- [ ] T8-2 `CombinationView`（「1号艇以外が1着」の切り替え、組み合わせ一覧の上位10件、コールアウト（T0-2 のパターン、n が下限未満なら出さない））。データは FR-2 と同じ層（同じ深さ）の `trifecta`・`course_flow`

## T9 組み込みと仕上げ
- [ ] T9-1 `AnalogyFinderSection` を `RaceAiPredictionTab` に足す。予想の有無と切り離し、中止以外の3分岐（確定後・予想なし・未確定）で出す。FR-1 は is_active の版が無ければ出さない、FR-2・FR-3 は `get_analogy_similar` が NULL なら出さない。**BOA-635 も同じ場所（分岐の外）に部品を置く前提なので、この形を変えるときは BOA-635 のレーンに知らせる**
- [ ] T9-2 i18n（`aiPredictionTab.analogy.*`、4言語。テーマ名・説明は themes[].key から）。「競艇」を画面に出さない。「AI がやらないこと」の文言を足さない
- [ ] T9-3 `npm run test:layout`（AI予想タブの節。375/768/1024/1440/1920px）とダークモードの目視
- [ ] T9-4 データ精度の検証（`data-accuracy-verifier`）: FR-1 のシェア・n、FR-2 の分布、FR-3 の帯と一覧、コールアウトの数値を実データで照合
- [ ] T9-5 受け入れ E2E（`e2e/acceptance/analogy-finder.spec.js`）をローカルで実行
- [ ] T9-6 本番で `verify-analogy-pool.js` を実行し、結果を PR に記録する
- [ ] T9-7 ファン評価ループ（`.claude/rules/review-fix-cycle.md`。新しい主要表示のため）
- [ ] T9-8 完了監査: このファイルの全チェックボックスと、コミット・本番の実測を突き合わせる
