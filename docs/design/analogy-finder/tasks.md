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
- [ ] T0-1 ユーザー確認: FR-2 の絞り込み（件数／類似度%）と、似ている理由の一行（モック v6）。回答で screens.md と T8 を直す
- [ ] T0-2 干渉効果のコールアウトに出すパターンを実データで選ぶ（spec FR-3。人が決めた1例に頼らない）。近傍の集合の中で、1着の決まり手×進入コースごとに2着の分布が全体から最も離れる組み合わせを上位から選び、n の下限と一緒に `analysis/` に記録する
- [ ] T0-3 FR-3 の3着の段の注記（件数が少ないとき）の n の目安を決めて spec に書く（小標本フラグはレース数で数えると決めた。screens の表）
- [ ] T0-4 近傍を出走表時点の1段にする確認: 全 test（2026-04〜09、28,185R）で「展示・気象を距離から外した k-NN」と「全部入り」の決まり手の対数損失を比べ、外しても層別に有意に勝つことを確かめる（設計レビューは 4,000R で差 約0.0008）
- [ ] T0-5 ローリング特徴量を日単位でずらす定義に変えて、MD-5（基準1に勝つ）と MD-6（層別に勝つ）が保たれることを確かめる
- [ ] T0-6 近傍の性質を出走表時点の1段で測り直し、FR-2 の「似ている理由」の一行を確定する
- [ ] T0-7 10/5 の補完判定の後、spec MD-2 の充足率を更新する。2026-04〜09 の展示・気象はデータ取得レーンの補完計画に入った（2026-10-01）。例外の承認済み一覧を確認する
- [ ] T0-8 Supabase Storage のファイルサイズ上限をダッシュボードで確認する（ユーザー）。分割サイズを決める

## T1 本番の器
- [ ] T1-1 マイグレーション 115 の本番適用をユーザーに依頼する（書き込み SQL だけを渡す）。適用後、読み取り MCP で4テーブル・公開ポリシー4本・`get_analogy_neighbors` の EXECUTE（anon）・`activate_analogy_model` が service_role だけであることを確認し、APPLIED.md を「適用済み」に更新する。同じ PR で `scripts/maintenance/check-anon-access.js` の匿名 RPC の一覧に `get_analogy_neighbors` を足す
- [ ] T1-2 Supabase Storage にバケット `analogy` を用意する（`storage-models.js` と同じく、無ければ作る処理をスクリプトに入れる）。版は直近3つだけ残す
- [ ] T1-3 workflow_dispatch 用の fine-grained PAT（このリポジトリの Actions の write だけ）を作り、Vercel の環境変数 `GITHUB_ACTIONS_DISPATCH_TOKEN` に入れる（ユーザーの作業）

## T2 特徴量と学習の本番化（scripts/ml/analogy/）
- [ ] T2-1 `export_pool.js`: 長期（kb_archive）と本体から書き出す。Phase M の `export-data.js` を土台に、補完後のデータで欠損の扱いを見直す。長期分は初回だけ書き出して Storage（`analogy/source/`）に置き、週次は本体の差分だけ読む。2025-12-02 の重なりは本体を優先
- [ ] T2-2 `features.py`: 近傍の距離は出走表時点の1段（ローリングは日単位でずらす）、寄与度のモデルは直前情報も使う。学習・母集団・今日のレースで同じ関数を使う。ラウンドの区分は本体が `getRaceStageCategory` と同じ規則、長期は `kb_archive_races.stage_kind`
- [ ] T2-3 `tests/`（pytest）: 当日以降の結果（同じ日の前のレースを含む）が特徴量に混ざらない、近傍の距離に直前情報の列が入っていない、ラウンド区分が `raceStageConfig.js` と一致、テーマ集計の合計が1。テストは先に書き、落ちることを確かめてから実装する
- [ ] T2-4 `train.py`: 主モデル3本（1着・2着以内・3着以内）、木の数固定、時系列の最後の分割での評価。品質ゲート（基準1に有意に勝つ・前の版より 0.005 以上悪化しない）
- [ ] T2-5 `profiles.py`: SHAP をテーマに集計（`themes` 配列から。テーマ数は可変）、直近12か月、スライス（着順3×会場25×グレード6×ラウンド5×艇番7、グレード不明は「全グレード」にだけ）、seed 5回の SD、テーマ内の内訳（似た意味の項目はまとめる）
- [ ] T2-6 `pool.py`: 母集団の特徴量行列（出走表時点、会場はコード、float16、50MB 以下に分割）、距離の重み（レース内で中心化した|SHAP|の平均）、会場ペナルティ λ（決まり手で選んだ値1つ）、`analogy_pool_outcomes` の行（長期と本体をそろえる）
- [ ] T2-7 `db.py`: PostgREST への書き込み（service key）。analogy_pool_outcomes は差分だけ upsert、書き込み0件はエラー
- [ ] T2-8 `.github/workflows/train-analogy.yml`（schedule なし、workflow_dispatch のみ）。版の切り替えは `activate_analogy_model`。初回は手動実行
- [ ] 本番実測: analogy_models に is_active の1行、analogy_contribution_profiles が全スライスの期待件数（n>0 のセル数。算出根拠を書く）、analogy_pool_outcomes が母集団の完全レース数（2019-04〜pool_cutoff、Phase M では 409,588R）に対し99%以上であることを実測クエリで確認する
- [ ] 継続監視: 週次の学習が失敗・品質ゲートで止まったら Slack に通知されること、最終成功から8日を過ぎたら検知されることを確認する

## T3 近傍のバッチ（BOA-627 の保存を含む）
- [ ] T3-1 `neighbors.py`: 今日の締切前・中止でない・スナップショット未作成のレースについて、出走表時点のスナップショットを作る。会場ペナルティつき k-NN 800件。`ON CONFLICT DO NOTHING`。対象が1件以上あるのに0件しか書けなければ失敗（対象0件は正常）
- [ ] T3-2 tests: 距離の対称性、会場ペナルティの効き方、Phase M の評価スクリプトと同じ近傍が出ること（小さな固定データで）
- [ ] T3-3 `.github/workflows/generate-analogy-neighbors.yml`（schedule なし、workflow_dispatch のみ、`concurrency` で1本）。Storage のモデル・行列を actions/cache で持つ
- [ ] T3-4 `api/cron/analogy-dispatch.js`（Vercel Cron、共通ラッパ `cronWrapper.js`）: JST 7:30・10:00・14:00 に近傍、日曜 JST 4:00 に学習を workflow_dispatch する。`vercel.json` の crons に足す（UTC で書き、JST を併記）
- [ ] T3-5 保存の運用: 1年を過ぎた analogy_snapshots の近傍の配列を NULL にする処理（週次の学習ジョブの最後）。寄与度の古い版の行は直近2版だけ残す
- [ ] 本番実測: 期待件数（その日の開催レース数、中止を除く。算出根拠を書く）に対し、スナップショットが99%以上あることを実測クエリで確認する
- [ ] タイミング実測: 土日を含む直近5日で、各レースの「締切−スナップショット作成時刻」の分布を出し、締切前に作られた割合を出す（欠落率2%以内）。dispatch から実行開始までの遅れも出す
- [ ] 継続監視: 当日のスナップショットの充足率を日次で計測し、閾値（98%）を下回ったら Slack に通知されること、dispatch の失敗（GitHub API のエラー）が通知されることを確認する

## T4 API
- [ ] T4-1 `api/analogy/contribution.js`（Edge）: is_active の版の themes と該当スライス。n=0 のスライスは一段広いスライスに戻し、戻したことを返す
- [ ] T4-2 `api/analogy/neighbors/[raceId].js`（Edge）: RPC の結果。締切前 s-maxage=60、締切後 86400
- [ ] T4-3 録画再生の E2E に新しい API が素通しされることの確認（`e2e/recording.json` の撮り直しは日次で自動）

## T5 共通部品
- [ ] T5-1 `BoatBadge` を `src/components/race/BoatBadge.jsx` に切り出し、`RaceOddsListTab.jsx` から使う（見た目が変わらないことを E2E で確認）
- [ ] T5-2 `src/services/analogyService.js`（専用のメモリキャッシュ。スナップショットが無い・エラーは残さない。API 失敗時は PostgREST 直読み）
- [ ] T5-3 `src/utils/analogyAggregate.js`: 件数 N の4分布、サンキーの流れ（1→2→3着、全ての流れを残す）、組み合わせ一覧、コールアウト。`scripts/maintenance/verify-analogy-aggregate.js` で固定データの期待値を検証（verify-registry に ci で登録）

## T6 FR-1 寄与度
- [ ] T6-1 `ContributionView`（レーダー＋テーマ別の棒、着順タブ、詳細条件の折りたたみ、n・期間・モデル版、小標本フラグ）。テーマは themes 配列から描く
- [ ] T6-2 `ContributionBreakdown`（テーマを押すと内訳。似た意味の項目はまとめ、個別値は参考の注記）
- [ ] T6-3 `BoatCompareTable`（艇番2つの重ね描きと比較表。チャートに数値ラベルを置かない）
- [ ] T6-4 順位の扱い: 隣どうしの差が SD の数倍に満たないテーマの順位を強調しない（spec FR-1 の安定性）

## T7 FR-2 類似レース
- [ ] T7-1 `SimilarRacesView`（4分布・n・期間・事故情報の常設注記・類似レース一覧、似ている理由の一行）
- [ ] T7-2 `SonarChart`（同心円は近さの順位、件数を絞ると自動ズーム、光点と一覧行の双方向ハイライト）
- [ ] T7-3 件数スライダー（T0-1 の回答で「類似度%」になれば差し替え）
- [ ] T7-4 データ段の表示（「出走表 7:30 時点のデータ（前日までの成績）」、確定後は「（発走前）」）

## T8 FR-3 組み合わせ
- [ ] T8-1 `FinishSankey`（3段を常に出す、全ての流れを艇の色で、少ない流れは薄く、帯タップで件数・%、1号艇の白は枠線）
- [ ] T8-2 `CombinationView`（「1号艇以外が1着」の切り替え、組み合わせ一覧の上位10件、コールアウト（T0-2 のパターン、n が下限未満なら出さない））

## T9 組み込みと仕上げ
- [ ] T9-1 `AnalogyFinderSection` を `RaceAiPredictionTab` に足す。予想の有無と切り離し、中止以外の3分岐（確定後・予想なし・未確定）で出す。is_active の版かスナップショットが無ければ節ごと出さない
- [ ] T9-2 i18n（`aiPredictionTab.analogy.*`、4言語。テーマ名・説明は themes[].key から）。「競艇」を画面に出さない。「AI がやらないこと」の文言を足さない
- [ ] T9-3 `npm run test:layout`（AI予想タブの節。375/768/1024/1440/1920px）とダークモードの目視
- [ ] T9-4 データ精度の検証（`data-accuracy-verifier`）: FR-1 のシェア・n、FR-2 の分布、FR-3 の帯と一覧、コールアウトの数値を実データで照合
- [ ] T9-5 受け入れ E2E（`e2e/acceptance/analogy-finder.spec.js`）をローカルで実行
- [ ] T9-6 `scripts/maintenance/verify-analogy-neighbors.js`（manual で登録）: 本番のスナップショットと再計算の近傍の一致、母集団の行列と analogy_pool_outcomes のレースの集合の一致
- [ ] T9-7 ファン評価ループ（`.claude/rules/review-fix-cycle.md`。新しい主要表示のため）
- [ ] T9-8 完了監査: このファイルの全チェックボックスと、コミット・本番の実測を突き合わせる
