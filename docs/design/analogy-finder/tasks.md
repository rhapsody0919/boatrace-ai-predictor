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
- [ ] T0-3 FR-3 の3着の段の注記（件数が少ないとき）の n の目安と、FR-1 の小標本フラグ（n<30）の数え方（艇数かレース数か）を決めて spec に書く

## T1 本番の器
- [ ] T1-1 マイグレーション 115 の本番適用をユーザーに依頼する（書き込み SQL だけを渡す）。適用後、読み取り MCP で4テーブル・公開ポリシー4本・RPC の EXECUTE（anon）を確認し、APPLIED.md を「適用済み」に更新する
- [ ] T1-2 Supabase Storage にバケット `analogy` を用意する（`storage-models.js` と同じく、無ければ作る処理をスクリプトに入れる）

## T2 特徴量と学習の本番化（scripts/ml/analogy/）
- [ ] T2-1 `export_pool.js`: 長期（kb_archive）と本体から書き出す。Phase M の `export-data.js` を土台に、補完後のデータで欠損の扱いを見直す
- [ ] T2-2 `features.py`: as-of の2段（出走表時点・直前情報時点）。学習・母集団・今日のレースで同じ関数を使う。グレード・ラウンドの区分は `getRaceStageCategory` と同じ規則
- [ ] T2-3 `tests/`（pytest）: 当日以降の結果が特徴量に混ざらない（`shift(1)`）、段ごとに使う列が決まっている、ラウンド区分が `raceStageConfig.js` と一致、テーマ集計の合計が1。テストは先に書き、落ちることを確かめてから実装する
- [ ] T2-4 `train.py`: 主モデル3本（1着・2着以内・3着以内）、木の数固定、時系列の最後の分割での評価。品質ゲート（基準1に有意に勝つ・前の版より 0.005 以上悪化しない）
- [ ] T2-5 `profiles.py`: SHAP をテーマに集計（`themes` 配列から。テーマ数は可変）、スライス（着順3×会場25×グレード6×ラウンド5×艇番7）、seed 5回の SD、テーマ内の内訳（似た意味の項目はまとめる）
- [ ] T2-6 `pool.py`: 母集団の特徴量行列（段ごと）、距離の重み（レース内で中心化した|SHAP|の平均）、会場ペナルティ λ、`analogy_pool_outcomes` の行（長期と本体をそろえる）
- [ ] T2-7 `db.py`: PostgREST への書き込み（service key）。analogy_pool_outcomes は差分だけ upsert、書き込み0件はエラー
- [ ] T2-8 `.github/workflows/train-analogy.yml`（日曜 JST 4:00）。初回は手動実行（workflow_dispatch）
- [ ] 本番実測: analogy_models に is_active の1行、analogy_contribution_profiles が全スライスの期待件数（n>0 のセル数。算出根拠を書く）、analogy_pool_outcomes が母集団の完全レース数（2019-04〜pool_cutoff、Phase M では 409,588R）に対し99%以上であることを実測クエリで確認する
- [ ] 継続監視: 週次の学習が失敗・品質ゲートで止まったら Slack に通知されること、最終成功から8日を過ぎたら検知されることを確認する

## T3 近傍のバッチ（BOA-627 の保存を含む）
- [ ] T3-1 `neighbors.py`: 今日の未締切・中止でないレースについて、出走表時点・直前情報時点のスナップショットを1回ずつ作る。会場ペナルティつき k-NN 800件。締切後は書かない。対象があるのに0件なら失敗
- [ ] T3-2 tests: 距離の対称性、会場ペナルティの効き方、Phase M の評価スクリプトと同じ近傍が出ること（小さな固定データで）
- [ ] T3-3 `.github/workflows/generate-analogy-neighbors.yml`（UTC 23:00〜12:30 の10分ごと＝JST 8:00〜21:30）。Storage のモデル・行列を actions/cache で持つ
- [ ] T3-4 保存の運用: 180日を過ぎた analogy_snapshots の近傍の配列を NULL にする処理（週次の学習ジョブの最後に入れる）
- [ ] 本番実測: 期待件数（その日の開催レース数×2段、中止を除く。算出根拠を書く）に対し、スナップショットが99%以上あることを実測クエリで確認する
- [ ] タイミング実測: 土日を含む直近5日で、直前情報時点のスナップショットが締切前に作られたレースの割合と、「展示データの取得時刻→スナップショット作成」の遅れの分布を出す（欠落率2%以内。間に合わないレースは出走表時点が表示される）
- [ ] 継続監視: 当日のスナップショットの充足率を日次で計測し、閾値（98%）を下回ったら Slack に通知されることを確認する

## T4 API
- [ ] T4-1 `api/analogy/contribution.js`（Edge）: is_active の版の themes と該当スライス。n=0 のスライスは一段広いスライスに戻し、戻したことを返す
- [ ] T4-2 `api/analogy/neighbors/[raceId].js`（Edge）: RPC の結果。締切前 s-maxage=60、締切後 86400
- [ ] T4-3 録画再生の E2E に新しい API が素通しされることの確認（`e2e/recording.json` の撮り直しは日次で自動）

## T5 共通部品
- [ ] T5-1 `BoatBadge` を `src/components/race/BoatBadge.jsx` に切り出し、`RaceOddsListTab.jsx` から使う（見た目が変わらないことを E2E で確認）
- [ ] T5-2 `src/services/analogyService.js`（`withCache`、API 失敗時は PostgREST 直読み）
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
- [ ] T7-4 データ段の表示（「直前情報 14:52 時点のデータ」／出走表時点）

## T8 FR-3 組み合わせ
- [ ] T8-1 `FinishSankey`（3段を常に出す、全ての流れを艇の色で、少ない流れは薄く、帯タップで件数・%、1号艇の白は枠線）
- [ ] T8-2 `CombinationView`（「1号艇以外が1着」の切り替え、組み合わせ一覧の上位10件、コールアウト（T0-2 のパターン、n が下限未満なら出さない））

## T9 組み込みと仕上げ
- [ ] T9-1 `AnalogyFinderSection` を `RaceAiPredictionTab` の末尾に足す。is_active の版かスナップショットが無ければ節ごと出さない。中止確定のレースは出さない
- [ ] T9-2 i18n（`aiPredictionTab.analogy.*`、4言語。テーマ名・説明は themes[].key から）。「競艇」を画面に出さない。「AI がやらないこと」の文言を足さない
- [ ] T9-3 `npm run test:layout`（AI予想タブの節。375/768/1024/1440/1920px）とダークモードの目視
- [ ] T9-4 データ精度の検証（`data-accuracy-verifier`）: FR-1 のシェア・n、FR-2 の分布、FR-3 の帯と一覧、コールアウトの数値を実データで照合
- [ ] T9-5 受け入れ E2E（`e2e/acceptance/analogy-finder.spec.js`）をローカルで実行
- [ ] T9-6 `scripts/maintenance/verify-analogy-neighbors.js`（manual で登録）: 本番のスナップショットと再計算の近傍の一致
- [ ] T9-7 ファン評価ループ（`.claude/rules/review-fix-cycle.md`。新しい主要表示のため）
- [ ] T9-8 完了監査: このファイルの全チェックボックスと、コミット・本番の実測を突き合わせる
