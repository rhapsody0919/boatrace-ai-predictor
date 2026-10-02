# 引き継ぎ: BOA-271 FR-2（似たレース・層別）とレースごとの寄与度（B）の実装レーン

2026-10-02 のセッション（オーケストレーターの下の「BOA-271 FR-2 層別 実装レーン」）から次のセッションへ。設計ブランチは `feature/boa-271-fr2-strat`（Draft PR #1134、#1039 の上に積んだもの）。マージはオーケストレーターの判断。報告・確認依頼は SendMessage でオーケストレーター（「オーケストレーター（2026-09-29〜）」）へ。

## 1. 決まっていること（ユーザー承認済み）
- **FR-2 は層別 S***: 勝率差5帯 → 1号艇の級別 → 会場 → 勝率1位の艇。200件未満なら末尾から外す。AI の予測と混ぜない。文面ルール6つ（spec FR-2）
- 4軸の上限を外して選び直しても S* のまま（fr2-strat-result.md 4）
- **30件未満でも%を出す**（件数は常に添える）
- **寄与度の条件ごとの表示に「全体との差（pt）」と「ほぼ同じ」の線引きを足す（A）**。share_sd は #1142 から seed の揺れ＋日単位のブートストラップを含むので、それを使う
- **レースごとの寄与度（B）を作る**。朝に出走表時点（専用モデル）、展示後に JS の TreeSHAP で出し直す（展示ありモデル）。FR-2 と同時に公開する。失敗時は「展示前の値」。似たレースは出走表時点のままで、チップの強調にだけ使う。見出しで「AI のモデルの説明」と分ける。展示後に置き換え、展示前は折りたたみ
- 分担: 学習側（train.py の専用モデル・JSON ダンプ・一致検査の固定データ・日次の特徴量ジョブ）は FR-1 の学習レーン。JS の TreeSHAP・一致検査・展示フック・表と API はこのレーン
- 分析の規律（tasks T3b）: 事前登録を単独コミット＋push → second-opinion で方法論レビュー → 実行 → 結果コミットに事前登録の SHA。数値には出典（値／指標／比較／母集団／期間／データ版／JSON#キー）

## 2. 成果物（すべて PR #1134）
- ADR-0082（FR-2 を SQL の RPC で数える）・ADR-0083（レースごとの寄与度。second-opinion の指摘10件を反映済み、FR-1 学習レーンとの合意待ち）。ADR-0080 は FR-2 部分を置き換え済み
- マイグレーション `docs/db-migration/120_analogy_strata.sql`（未適用。119 は #1145、121 は #1158）と PGlite の検証 `scripts/maintenance/verify-analogy-strata-migration.js`（ci、全項目通過）
  - 母集団 `analogy_pool_outcomes`・スナップショット `analogy_snapshots`（自動の深さの分布を保存）・`refresh_analogy_pool`・`create_analogy_snapshots`・`get_analogy_similar`（画面）・`get_analogy_similar_races`（BOA-635、自動の深さ・新しい順最大2,000件）
  - 返還艇は is_flying・is_late_start・finish_mark（F・L・欠）・refund_boats で判定（BOA-635 の依頼）
- plan.md（層別・Vercel Cron 2本・BOA-635 との接続・レースごとの寄与度の境界）、tasks.md、spec.md（ファンパネル3回分・分析の限界・つなぎ方の対応表）
- 分析: fr2-strat-result.md 4・5（事前登録3・4）、perrace-contribution.md（探索的。列順の不具合を訂正済み）、`scripts/analysis/analogy-finder-perrace/treeshap.mjs`（JS の TreeSHAP 試作、Python と一致）
- モック: 条件チップ https://claude.ai/artifact/C8UpMVkF4G3jaZAvJGYtna 、寄与度とのつなぎ方3案 https://claude.ai/artifact/Dwz1KHwxzDj8BSYqmTd2nV

## 3. 待っていること
- （2026-10-02 追記）ADR-0083 は学習レーンと合意して採用。T3c-1（JS の TreeSHAP・一致検査）は別セッションに切り出し済み。screens.md を書き直し、統合モック https://claude.ai/artifact/PmBJj2kX13venVRWs5E2Cw と Q1〜Q7（screens.md の末尾）をオーケストレーター経由でユーザー確認中。回答で screens.md を確定 → 受け入れ E2E（acceptance-test-writer）→ design-reviewer
- FR-1 学習レーンの返事: ADR-0083 の境界（plan「レースごとの寄与度（B）」）。とくに表のマイグレーションをどちらが出すか、日次ジョブの時刻、win_racecard の品質ゲート
- ユーザーの確認 Q1〜Q6（モックの見せ方。レースごとの寄与度を入れた形で組み直してから出し直す。前回版の要点: 案2（1本の流れ）＋案1のハイライト、末尾からだけ外す、200件未満は自動で外す、割合は件数÷n、任意の追加チップ、見出しの言い方）

## 4. 次にやること（順）
1. 境界の合意を受けて、spec（FR-1 にレースごとの節）・tasks（B の分担とタスク）を書く
2. screens.md を書き直し（条件チップ・寄与度とのつなぎ・レースごとの寄与度・展示前後）、モックを作り直してオーケストレーター経由でユーザー確認
3. 受け入れ E2E（acceptance-test-writer）と design-reviewer（`/step4` の事前条件）
4. 実装（承認後）: マイグレーション 120 の適用依頼（書き込み SQL だけを渡す）、参照実装 `strata.py` と `verify-analogy-pool.js`（nightly）、Cron 2本、API、画面、JS の TreeSHAP と一致検査、展示フック。画面は「ファン評価あり」
5. tasks T3b-1: 画面に出す推定量（生の件数÷n、2,000件の切り詰め）を cal で1回評価して記録

## 5. 注意
- 開発機は高負荷（load average 数百）。重い計算はサブエージェントに出し、load を見る。Playwright・dev サーバーは使い終わったら止める
- 分析レーンの worktree（`recursing-poincare-93292f`）の data/ml は読むだけ
- モデルに特徴量を渡すときは `booster.feature_name()` の並びを使う（`themes.FEATURES` と並びが違う。perrace.py で実際に取り違えた）
- マイグレーション番号は実装 PR の時点で origin/master の最新を確認する
