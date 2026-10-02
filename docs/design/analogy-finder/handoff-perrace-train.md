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

## 手元で動かすとき
- Python は 3.12 の venv に `scripts/ml/analogy/requirements.txt` を入れる（pandas 3.0.6・lightgbm 4.7.0）。macOS では `DYLD_LIBRARY_PATH` に `site-packages/sklearn/.dylibs` を通す。`nice` を挟むと SIP で DYLD が消えるので、挟まない
- `train.py` の結合確認は合成データで行える。今回は、`tests/test_perrace.py` の `synthetic()` で 6,000R を作り、`out/reference/` に参照版の3本を置いて最後まで流した
