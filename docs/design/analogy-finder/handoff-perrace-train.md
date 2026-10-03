# 引き継ぎ: BOA-271 レースごとの寄与度（B）学習側

2026-10-02 のセッション（オーケストレーターの下の「BOA-271 寄与度 学習側レーン」）から次のセッションへ。報告・確認はオーケストレーター（「オーケストレーター（2026-09-29〜）」）へ SendMessage。マージはしない。

## 正本
- 設計: このブランチ（`feature/boa-271-perrace-train`、#1134 の上）の plan「学習側の設計」節・tasks「T10」・事前登録5（`analysis/fr2-strat/preregistration-5.md`、SHA 588546508、追記 d867d2b8d）
- 分担（確定）: SHAP の計算は出走表時点・展示後の両段とも推論側（JS）。学習側は特徴量の表・モデル2本・ダンプ・一致検査の固定データ・日次ジョブまで

## PR
| PR | 中身 | 状態（2026-10-02 夜） |
|---|---|---|
| #1176 | T10-1〜3（特徴量を朝 6:40 の値で定義、win_racecard、書き出し、版の固定） | CI 待ち。緑ならオーケストレーターがマージ。その後 #1177（T3c-1 の treeshap-parity.js）がマージされる |
| #1178 | T10-5・6（マイグレーション 123・124、日次の特徴量ジョブ） | #1176 の上に積んである。#1176 のマージ後に base を master に変える |

## 残り（順）
1. #1176 のマージ後、#1178 の base を master に変える（`gh pr edit 1178 --base master`）。必要なら rebase する
2. **T10-4**（BOA-696 #1166 のマージ後）
   - `export_pool.js` の `KB_CACHE_VERSION` を v2 にする。`features.check_final_day` が、BOA-696 の前のキャッシュを拒否するため
   - `train-analogy.yml` で、Storage へのアップロードの前に `node scripts/ml/analogy/treeshap-parity.js data/ml/analogy/out/` を実行する。終了コード 0=一致・1=不一致・2=入力の不備。1・2 ならアップロードも切り替えもせず、Slack に知らせる
   - actionlint を通す
3. **T10-7**
   - `api/cron/analogy-dispatch.js` を、共通ラッパ `createScrapeCronHandler` の `kind: "continuous"` で書く。`?job=train|daily-features`、`only_if_missing` は 7:20 の拾い直し用
   - `registry.js` に登録し、`vercel.json` の crons を足す（UTC で書き JST を併記。日次は `40 21,0,4 * * *` と 7:20＝`20 22 * * *`、週次は日曜 JST 4:00）
   - モードが off の間は何もしない。PAT（`GITHUB_ACTIONS_DISPATCH_TOKEN`）はユーザーの作業
   - 7:20 の回: 今日の対象に行が無いレースがあれば dispatch する。対象が0件のときは「充足」とせずに通知する。dispatch の HTTP 失敗も通知する
4. **T10-7b**: `verify-analogy-race-features.js`（nightly）。保存した行と、その日の終わりのデータで作り直した値を列ごとに比べ、不一致率を出す
5. **T10-8**
   - 学習を手動実行する（`record_perrace: true`）
   - 品質ゲート・`perrace_record.json`（Storage の `{版}/perrace_record.json.gz`）を、事前登録5 の SHA つきで `analysis/` に記録する
   - その後、`reference.json` を win_racecard を含む版に更新するか判断する
6. 本番適用（ユーザー）: 123 → 124。適用後に APPLIED.md を「適用済み」に直す。日次ジョブの有効化の順序は `analogy-daily-features.yml` の冒頭に書いてある
7. 本番の実測・継続監視（tasks T10 の末尾3行）

## 2026-10-03 の進捗（後継セッション）
| PR | 中身 | 状態 |
|---|---|---|
| #1178 | T10-5・6 | master を取り込み、ml-tests の失敗（`export_pool.js` の import が CI に無い依存を読む）を直した（`weekRanges` を `week-ranges.js` に分けた） |
| #1205 | T10-4（一致検査をアップロードの前に、`KB_CACHE_VERSION` v2） | #1178 の上に積んだ。マージ後に base を master に |
| #1207 | T10-7（Vercel Cron → workflow_dispatch） | 同上。メモからの変更点は PR 本文の表（kind を monitor に、エンドポイントを2本に、7:20 は時刻で判定、`failureAlertAfter: 1`） |

### FR-1 の評価期間の穴（verification-round1 P1-6）の結論
- 版 2026-10-02（run 36968972725、05:26:56Z 開始）は、ST の行の挿入（10-01 22:49〜22:51Z）と展示タイムの挿入（10-02 00:12〜00:22Z）の**後**に学習した。ST・展示タイムの穴は、この版ですでに埋まっている。当時の `export_pool.js` は本体分を毎回 DB から読み、長期分のキャッシュ v1 もこの run が作った（data-accuracy-verifier が再現）
- 今の本番 DB の充足率（2025-12〜2026-09、欠場・中止・不成立を除く）: 展示タイム 99.81〜99.97%、本番 ST 99.80〜99.95%、天候・風速・波高 100%
- 再学習で直るもの
  - 最終日: この版は長期分が全件 false で学習したので、3モデルとも `is_final_day_num` の分岐が0本（寄与は常に0）。BOA-696 の後の v2 で直る
  - 2025-12-03 の108レース（test の約0.2%）: 別の選手の値で特徴量を作っていた（BOA-580 の是正が学習の後）
- 再学習でも直らないもの（集計から外す月は無い。外すなら下の2点の扱いを決めてから）
  - 体重・支部: `race_entries.weight_kg`・`branch` が 2026-02 16%・03 0%・04〜08 3〜8%・09 37%。前日までの最後の値を期限なしで持ち回るので、本体期間は数か月前の値になる（「選手・属性」）
  - **風向**: 下の節

### 風向（オーケストレーターの申し送り2）→ #1213 で対応（ユーザー決定は案1。回転は方位マークから決まる固定値、除外なし。docs/design/analogy-finder/wind-basis.md）
- 本体の `race_conditions.wind_direction` は 2025-12・01 がほぼ全件 NULL（K/B 補完は風向を書かない。`kbGapFill.js` のコメント）、2026-02〜09 は約1割が NULL（うち約6割は風速0で、features.py が無風＝0 にする。残りの風速>0 の NULL は月 117〜278 レース）
- より大きい問題: K ファイル（長期分＝fit 期間）と DB（直前情報ページ。test・推論）で風向の基準が違う。固定データの日（2026-09-11 の12会場・2026-03-15 の2会場）で突き合わせると、会場ごとにほぼ一定の回転がある（江戸川 K北→DB西南西 10/12、平和島 K北→DB東 5/5、児島 K南→DB西・K南東→DB南西（+90°）、宮島 K東→DB南東 6/11、若松 K北東→DB東北東）。DB の風向は、ページの水面の図に対する向き（会場ごとに回る）と推定する（未確認）
  - 影響: fit は K の基準だけで学習しているので、test と推論の `wind_x`・`wind_y` は別の座標で入る。「環境」テーマの風の寄与と、レースごとの寄与度（直前情報8列に風が入る）がずれる
- 案（推奨は1）
  1. 会場ごとの回転を K と DB の重なる期間（2025-12〜2026-09 の K ファイル）で推定し、本体の風向を K の基準に直してから特徴量にする。features.py と JS（`analogyRaceFeatures.js` の直前情報）の両方に同じ表を入れ、一致検査の固定データも作り直す。2025-12・01 の NULL は K の値で埋められる（K の基準なので回転は不要）。会場内の回転のばらつき（円の標準偏差）が大きい会場は、その会場だけ風向を欠損にする
  2. 風向を特徴量から外し、風速だけにする（簡単で、基準のずれは無くなる。向かい風・追い風の区別を失う）
  - どちらも画面の数字が変わるので、決まったら独立エージェントで検証する

## ユーザー作業の手順
### A. 学習のやり直し（1回にまとめる。#1178 → #1205 → #1213（風向）のマージの後）
前提: #1213 まで master にあること、欠場艇の行の補完（#1199）の本番適用が済んでいること（本体分は毎回 DB から読むので、学習より前に入っていればよい）。#1205 が無いまま走らせると、長期分は v1 のキャッシュ（最終日が全件 false）を読み、`check_final_day` で止まる。
1. Supabase Dashboard → Storage → バケット `analogy` → `source/v1/` を削除する（v2 にしたので読まれないが、BOA-696 の前の値を残さない）
2. GitHub → Actions → Train Analogy Finder → Run workflow（branch: master、`record_perrace`: **true**）。風向の扱いが決まり特徴量が確定したので、事前登録5 の記録もこの1回で取る
   - 初回は長期分（2019-04〜2025-12）を DB から読み直して v2 のキャッシュを置くので、普段より Disk IO が多い（Dashboard の Disk IO を前後で確認する）
3. 確認: Step Summary の「版 … に切り替えた」、一致検査（Parity check）が緑、`analogy_models` の新しい版が is_active、`per_race_meta.json` に `wind_basis` がある
   - 手元で同じデータを使った学習（2026-10-03）は品質ゲートを通過した（1着の対数損失 1.19099、参照版より -0.00056）

### B. T10-7 の有効化（A が1回成功し、123・124 を適用した後）
1. GitHub → Settings → Developer settings → Fine-grained tokens → 新規。Repository access はこのリポジトリだけ、Permissions は Actions: Read and write だけ。有効期限を決めてカレンダーに入れる（期限切れは scrape-monitor が1回目の失敗から Slack に出す）
2. Vercel → Project → Settings → Environment Variables に `GITHUB_ACTIONS_DISPATCH_TOKEN`（Production）を足し、再デプロイ
3. SQL（Supabase、書き込み）: `insert into scrape_job_state (job, mode) values ('analogy_dispatch_train','shadow'),('analogy_dispatch_features','shadow') on conflict (job) do update set mode = excluded.mode;`
4. 翌朝 6:40・7:20 の応答（`last_report`）で `wouldDispatch` を確かめ、`mode='live'` にする

## 2026-10-03 午後の状態（次のセッションはここから）
- マージ済み: #1178（マイグレーションは 127・128 に振り直した。126 は #1219）、#1205（T10-4）、#1213（風向）
- ユーザーに依頼中（オーケストレーター経由）: 127・128 の適用 → Storage の analogy/source/v1/ の削除 → train-analogy.yml を1回（record_perrace: true）。手順書はオーケストレーターに送った
- #1207（T10-7）: ユーザーの確認待ち（PAT・Vercel の環境変数）
- 寄与度の定義の変更（Version 14。二重の中心化、1号艇の行だけ boat1 グループを national に足す、枠を割合から除く）は、モック作り直しレーンが profiles.py と JS の集計で持つ。特徴量もモデルも変えない
- 2回目の学習は、下の「6本への拡張」と定義の PR がそろってから、ユーザーに1回だけ頼む（オーケストレーターが説明する）

### 次の作業: 3タブ用に、レースごとの寄与度のモデルを6本にする（このレーンの担当、ユーザー承認済み 10/3）
事前登録5 の追記B（84c23dd86・a1b3d4aab）で、判定と記録は学習の前に決めてある。実装はこの通りにする（変えたら事後と明記）。
- train.py
  - `RACECARD` を3本のリストにする: `("win_racecard","y_win",250)`、`("top2_racecard","y_top2",250)`、`("top3_racecard","y_top3",330)`。特徴量は `RACECARD_FEATURES`、seed 0
  - 評価: win は `evaluate_win_races`、top は `evaluate_topk`（レース単位の対数損失の配列も返すようにする。記録1のペア差に要る）
  - `OPTIONAL_REFERENCE`・`TARGET_LABEL`・`GATE_MAX_DEGRADATION`（top は 0.002）に2本を足す。`quality_gate` の `names` の固定の一覧も広げる。`reference_logloss` も3本を回す
  - `write_perrace`: 6本（win・top2・top3・3本の racecard）を `model_dump` し、per_race_meta の models・一致検査の固定データの expected に入れる。記録1に top2・top3 の展示の効果（`*_racecard` − 展示後）、記録2に 2着以内・3着以内の2段のシェアの分布と1位の入れ替わり、`missing_types` を6本ぶん
  - `train_meta` の `racecard` を3本ぶんに
- perrace.py: `per_race_meta(version, models: dict[name, (booster, dump)], maps)` に変える。`parity_fixture` は渡したモデルを全部回す（既に dict）
- storage.js: `PER_RACE_FILES` に `model_top2.json`・`model_top3.json`・`model_top2_racecard.json`・`model_top3_racecard.json` を足す（`OPTIONAL_REFERENCE_FILES` に racecard の .txt 2本も）
- treeshap-parity.js: `MODELS` を6本にする。`prepareModels` の約束は「racecard 3本は同じ列」「展示後3本は racecard の列＋直前情報8列」。`raceInputs` は名前で racecard か展示後かを判定して入力を作る
- `src/utils/analogyRaceContribution.js` は列名と SHAP を受け取るだけで、モデルの種類に依存しないので変えなくてよい（モック作り直しレーンとぶつからない）
- daily_features.py・analogy_race_features は変えない（racecard 3本は同じ36列。並びは win_racecard の feature_names）
- CI の固定データ（make_treeshap_testdata.py）を6本で作り直し、verify-analogy-treeshap.js・pytest を広げる。手元で合成データの train.py を最後まで流す（tests の `synthetic()`）
- 学習時間は、seed 0 の学習2本ぶん（全体の1割程度）増える見込み

## 手元で動かすとき
- Python は 3.12 の venv に `scripts/ml/analogy/requirements.txt` を入れる（pandas 3.0.6・lightgbm 4.7.0）。macOS では `DYLD_LIBRARY_PATH` に `site-packages/sklearn/.dylibs` を通す。`nice` を挟むと SIP で DYLD が消えるので、挟まない
- `train.py` の結合確認は合成データで行える。今回は、`tests/test_perrace.py` の `synthetic()` で 6,000R を作り、`out/reference/` に参照版の3本を置いて最後まで流した
