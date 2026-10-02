# アナロジー・ファインダー FR-1（寄与度）実装の引き継ぎ

BOA-271 の実装レーン（2026-10-02）から次のセッションへの引き継ぎ。設計の正本は Draft PR #1039 の `docs/design/analogy-finder/`（spec.md・plan.md・tasks.md と、近傍をバッチで事前計算する ADR 案（Draft PR #1039）。master の spec.md は #643 時点の古い版）。ここには、実装で決めたこと・本番の状態・残りの作業だけを書く。

## 1. 本番の状態

| 対象 | 状態 |
|---|---|
| マイグレーション 118（`analogy_models`・`analogy_contribution_profiles`・`activate_analogy_model`） | 本番適用済み。事後確認（RLS・ポリシー・権限・部分一意インデックス）済み |
| 学習（`.github/workflows/train-analogy.yml`） | workflow_dispatch のみ。初回を手動実行済み（run 36968972725、約50分）。版 2026-10-02 が is_active |
| Storage バケット `analogy` | `2026-10-02/`（モデル3本＋train_meta）と、長期データの月ごとのキャッシュ `source/v1/` |
| API `GET /api/analogy/contribution` | 本番稼働。版が無い・テーブル未適用は `{available:false}`・no-store |
| 画面（AI予想タブの「アナロジー・ファインダー」節、寄与度のみ） | master に入っているが、機能フラグで非表示。`src/config/featureFlags.js` の `ANALOGY_FINDER_PUBLIC` を true にすれば全員に出る。内部確認は URL に `?analogy=1`（端末に覚える。`?analogy=0` で戻す） |

初回の版の数字: 1着の対数損失 1.192（基準1 1.318）、2着以内・3着以内も基準に勝つ。寄与度 12,180 行（着順ごと 4,060 セル）。全体の n=54,728 レース（test 2025-10-03〜2026-10-02）。データ精度の検証（data-accuracy-verifier）は合格。

## 2. 実装で決めたこと（設計書に未反映。#1039 にまとめて反映する）

- **寄与度の集計窓**: データの最終日から遡る12か月を test にし、表示に使うモデルはその前（2019-04〜）で学習する。末尾3か月は温度合わせだけに使う。寄与度はすべて標本外で数える（Phase M の F5 と同じ形）
- **木の数は固定**（1着 250・2着以内 250・3着以内 330）。early stopping で版ごとに揺らさない
- **ローリング特徴量は日単位でずらす**。その日の最初の走が min_periods に届かないときも、同じ日の後の走の値を配らない（レビューで見つかったリークを直した）
- **ラウンド**: 本体は `getRaceStageCategory` と同じ規則で、qualifier・qualifierSpecial→予選、semifinal→準優、final→優勝、その他→other、空→不明（「全ラウンド」にだけ入る）。長期は `stage_kind`
- **グレード**: 長期は `kb_archive_venue_days.race_grade`、本体は `races.race_grade`。無ければ `race_series` で補う
- **品質ゲート**: 1着・2着以内・3着以内のそれぞれで、(1) 基準に日クラスタ CI で有意に勝つこと、(2) 固定した参照版（`scripts/ml/analogy/reference.json`、今は 2026-10-02）を同じ test で評価し直し、悪化が許容幅（1着 0.005、2・3着以内は艇あたり 0.002）を超えないこと。参照版の学習の終わりから183日を過ぎたら、Slack で更新を促す
- **share_sd** = sqrt(seed 5回の揺れ² + 日単位のブートストラップ100回の揺れ²)。画面では「隣の順位との差が SD の2倍に満たないなら、順位バッジを出さない」に使う
- **版の由来**: `metrics.provenance` に GITHUB_SHA・`export_manifest.json`（テーブルごとの行数・最大キー・SHA-256）・特徴量の要約を残す
- **シェアの変化**: 前の版から 0.03 以上動いたテーマがあれば Slack に知らせる（`drift.json`。止めない）
- **Storage**: 直近3版、表示中の版、参照版は消さない。表示中の版と同じ名前ではアップロードしない
- **寄与度の行の保持**: 表示中の版と、切り替え直前の版だけ残す
- **画面**: レース数が30未満のスライスは、会場→ラウンド→グレードの順に一段ずつ広げ、選んだ条件と広げた範囲を枠で示す。棒は大きい順に並べ、長さはシェアそのもの。表示する % は最大剰余法で丸め、合計を100%（内訳は親の値）にそろえる。比較中は全艇の順位バッジを出さない

## 3. 測った事実（判断の材料）

- **テーマの大きさによる偏りの点検**（`data/analysis/analogy-finder/theme-bias-check.json`、参照版の1着モデル・5,000レース）
  - SHAP のシェアの順位は 選手・基礎成績 .395 ＞ 会場×枠 .353 ＞ ST・直前 .129
  - テーマ単位の並べ替え重要度の順位は 会場×枠 .721 ＞ 選手・基礎成績 .232 ＞ ST・直前 .029
  - 上位3つの顔ぶれと4〜6位は同じで、**1位と2位だけが測り方で入れ替わる**。画面で1位と2位の差を強調するかは、ユーザーの判断待ち
- **SG と G2 の併催日**: 約36レースの G2 が SG に入る（グレードを会場日の単位でしか持っていないため）→ BOA-687
- **所要時間**: GitHub Actions で約50分（seed 5回×3着順の学習と SHAP）。日単位のブートストラップで、さらに約20分増える見込み（レビューでの手元計測からの推定）。timeout は240分

## 4. 残りの作業

| 作業 | 前提・メモ |
|---|---|
| T1-1（115 の残り: `analogy_pool_outcomes`・`analogy_snapshots`・`get_analogy_neighbors`） | FR-2 の類似の定義の決着待ち。`analogy_models` に `pool_cutoff`・`neighbor_k`・`venue_penalty` を ADD COLUMN IF NOT EXISTS で足す（118 では外した）。115 の番号は振り直す |
| T2-6（母集団の行列・距離の重み）、T3（近傍のバッチ）、T7（FR-2 画面）、T8（FR-3 サンキー） | 同上 |
| T3-4 週次起動（Vercel Cron → workflow_dispatch、日曜 JST 4:00）と最終成功8日の検知 | fine-grained PAT（`GITHUB_ACTIONS_DISPATCH_TOKEN`）はユーザーの作業。今は手動実行のみ |
| BOA-677 | 寄与度から、このレースの該当データ（出走表の列・モータータブ等）への導線。テーマ→遷移先の対応は themes 配列側に持たせる |
| BOA-678 | ファン評価の P3 まとめ（節の名前・順位バッジの言い方・レーダーの目盛りとダークの網目・比較表の行順など） |
| BOA-687 | 併催の節のレース単位のグレード |
| 公開 | `ANALOGY_FINDER_PUBLIC = true`。公開前に、上の「1位と2位の入れ替わり」の扱いを決める |
| 受け入れ E2E（#1039 の `e2e/acceptance/analogy-finder.spec.js`） | FR-2・FR-3 を含むので、FR-1 分だけ流すなら `?analogy=1`（または localStorage）を立てる必要がある |

### ユーザー判断待ち: レースごとの寄与度（案B、展示後の出し直し込み）の分担の想定

今の寄与度は「条件が近い過去のレース全体」の集計で、そのレースの6艇それぞれへの寄与ではない。案B は、そのレースの各艇について SHAP を出す（出走表時点で1回、展示後に出し直す）。採用された場合の分担の想定（未確定）:

- **学習側（このレーンの続き）**: `train.py` に **出走表時点専用のモデル**（展示タイム・気象など展示後にしか分からない特徴を除く）を足す。今のモデル（展示後の特徴を含む）と合わせて2段にする。2本とも、LightGBM の `dump_model()` の **JSON を Storage に置く**（推論側が Python なしで木をたどって SHAP を計算できるように）。品質ゲート・参照版は段ごとに持つ
- **推論側**: 出走表がそろった時点と展示後に、レースごとの SHAP を計算して保存する。保存先は BOA-627 のスナップショットと同じ考え方（時点つき、発走後は書き換えない）。実行基盤は近傍のバッチ（T3）と同じ GitHub Actions＋Vercel Cron の workflow_dispatch か、JSON を読んで Node で計算する Vercel 関数かを、展示から締切まで中央値20分という制約で選ぶ
- **画面側**: 寄与度の節に「このレース」の表示を足す。テーマの並び・丸め・SD の扱いは今の部品（`themeEntries`・`roundToTotal`）を使う

## 5. 手元で動かすとき

- Python: `pip install -r scripts/ml/requirements.txt pytest`。macOS で lightgbm が libomp を見つけられないときは、`DYLD_LIBRARY_PATH` に scikit-learn の同梱品（`site-packages/sklearn/.dylibs`）を通す
- データ: `node --env-file=.env.local scripts/ml/analogy/export_pool.js --no-cache`（手元では Storage を読み書きしない）→ `python features.py` → `python train.py`。`ANALOGY_DATA_DIR`・`ANALOGY_SEEDS`・`ANALOGY_N_BOOT`・`ANALOGY_TRAIN_FRAC` で小さく回せる。全期間を手元で回すのは、開発機の負荷が高いときは避ける（CI と GitHub Actions に任せる）
- テスト: `python -m pytest scripts/ml/analogy/tests`（PR では quality-gates の `ml-tests` ジョブが、`scripts/ml/` か `raceStageConfig.js` の変更時に回す）、`node scripts/maintenance/verify-analogy-contribution.js`・`verify-analogy-storage.js`、`e2e/analogy-contribution.spec.js`

## 6. 関連 PR

#1118（API）・#1121（学習・118）・#1122（画面・機能フラグ）・#1142（再現性と品質ゲート）・#1144（その追補）。設計は #1039（Draft）。
