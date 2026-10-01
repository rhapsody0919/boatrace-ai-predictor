# 過去に発生した割合を見る tasks

元: [spec.md](./spec.md)・[screens.md](./screens.md)・[plan.md](./plan.md)。依存順。1タスク＝1コミット〜1PR。

**着手条件（spec「実装開始の前提条件」）**: BOA-271 の T1（115 の本番適用）・T3（近傍のバッチ）・T5-2（`analogyService.js`）・T5-1（`BoatBadge`）・T9-1（節の描画を分岐の外に出す）が master に入っていること。T0 は BOA-271 の Phase M の分析環境があれば先に進めてよい（画面のコードは書かない）。

本機能は新しいデータ取得を含まない（BOA-271 の近傍を読むだけ）ので、`data-acquisition.md` の「完了の定義」3行は BOA-271 の tasks（T3）側で満たす。本機能は T0-3 で、本番の近傍に値の約束が守られていることだけを実測する。

## T0 準備（分析のみ、画面なし）
- [ ] T0-1 定番／レアの線の検証（spec FR-3 の手順1〜8で固定済み。**BOA-271 T0-4・T0-5 の後**）: `scripts/analysis/past-rate-check/label-threshold.py`。BOA-271 の本番の定義（出走表時点の1段・日単位のずらし）で test 2026-04〜09 の近傍800件を作り、型ごとに線のまわりの実際の発生率で合否、ラベルが付く割合・Wilson 区間・Brier skill を報告。初期値 (15, 5) → 候補 (20, 5)・(15, 3)・(25, 3)・(10, 3) の順で最初に全型で合格した線を採る。手順7に当たる型はユーザーに戻す（オーケストレーター経由）。結果を `analysis/label-threshold-result.md` に書き、spec FR-3 に x・y を書き戻す
- [ ] T0-1a 判定式の二重実装の検査: 固定データ10件で、Python の判定と `src/utils/pastRate/count.js`（T1-1 で書く）の件数が一致することを確かめる小さな検査を同じディレクトリに置く（T1-1 の後に実行）
- [ ] T0-2 形に添える全国の出現率を、K/B 補完後のデータ（2026-03〜09 以降の最新6か月、F・出遅れ・欠場を除く、コース順の本番 ST、1/100秒の整数で比較。コース順の源は本体 `race_results.actual_course_*`・長期 `kb_archive_boats.course`。`race_start_timings.entry_course` は 2026-08 までほぼ空なので使わない）で出し直し、`analysis/slit-pattern-rates.md` に件数・期間・クエリと一緒に残す。`patterns.js` に入れる値はこの表から取る
- [ ] T0-3 本番の値の約束の実測（BOA-271 T2・T3 の後）: `analogy_pool_outcomes` で、(a) `payout_3tan` が本体の `race_results.payout_trio` と一致し `payout_trifecta`（3連複）と一致しないこと（無作為100R）、(b) F・出遅れのあるレースで該当コースの `st_by_course` が NULL、(c) 不成立のレースで `payout_3tan` が NULL（`race_status` が NULL の行も含め、返還艇が6艇・払戻 NULL の不成立候補で確かめる。`race_status` は 2026-09-20 より前でほぼ NULL）、(d) 実進入不明の期間で `course_by_boat` が艇番で埋まっていないこと、(e) rank1〜3 に返還艇が入るレースが決着なしになっている（D-5）、(f) 1レースのスナップショットが版をまたいで1つ（D-6）。結果を `analysis/pool-contract-check.md` に残す。違えば BOA-271 のレーンに戻す

## T1 判定の純粋関数（画面より先）
- [ ] T1-1 `scripts/maintenance/verify-past-rate-count.js` を先に書き、落ちることを確かめる（固定の近傍データ20件程度。期待値は SQL の numeric で出したもの。各形で差が線ちょうどの行（0.15/0.10、0.21/0.16 等の浮動小数で割れる組を含む）、除いた件数の理由の混在（決着なし＋ST 欠け）、6型の一致件数・分母・除いた件数・着順の点数・流しの内訳・展開の2着の内訳・スリット2形の AND・3形目で最古が外れる・自分で作るの判定・配当の境界 1,000／10,000 ちょうど・N=0）。`verify-registry.json` に ci で登録
- [ ] T1-2 `src/utils/pastRate/patterns.js`（7形・強さの段・1艇身 0.13秒・全国の出現率）と `count.js`（`countPastRate`・`orderPoints`・`decisionOf`）を書き、T1-1 を通す。決まり手は `TECHNIQUE_NAMES` で DB の日本語と対応させる
- [ ] T1-3 `src/utils/pastRate/label.js`（T0-1 の x・y）。境界値（x ちょうどで定番、y ちょうどは無印）を T1-1 に足す

## T2 端末内保存
- [ ] T2-1 `src/utils/pastRate/storage.js`（キー `boatai:past-rate-check:v1`、1レース×1型で置き換え、入力時刻から30日、上限1,000件、締切以降は保存しない、締切不明は未確定なら保存、壊れた値は捨てて作り直す、形の違う Entry だけ捨てる、書く直前に読み直す、締切以降の Entry は振り返りに出さない、例外は吸収して console）。T1-1 の verify に保存の節を足す（メモリ実装の localStorage を差し込み、`getItem`／`setItem` が例外を投げる場合、`dataService.clearCache()` 相当の `boatai:*` 全削除の後も残ること、`asof_at` の表記違い（Z と +00:00）を同じ時刻とみなすことを含める）

## T3 入力と結果の部品
- [ ] T3-1 `BoatToggle`・`PastRate.css`（`prc-` 接頭辞、トークン、ダークモード）
- [ ] T3-2 `OrderInput`（3行×6艇、流す、やり直す、点数の要約）
- [ ] T3-3 `Boat1Input`・`TenkaiInput`・`EntryInput`・`PayoutBandInput`
- [ ] T3-4 `SlitScene`（SVG、実縮尺、1艇身の目盛り、`role="img"` と説明の `aria-label`）
- [ ] T3-5 `SlitInput`（7形の一覧と全国の出現率、強さ2段（横一線・内3艇だけのときは隠す、カド一撃の注記）、自分で作る（指定なし→出る→凹む）、最大2形）
- [ ] T3-6 `PastRateResult`（主文・ラベル・メーター・内訳・除いた件数・比べた相手の注記、N=0 の文言）
- [ ] T3-7 `PastRateChecker`（型の切り替え、型ごとの入力の保持、入力が変わったら結果を隠す、`types`・`value`/`onChange`・`persist`、ボタンで数えて保存）

## T4 組み込み
- [ ] T4-1 `PredictionPanel` → `RaceAiPredictionTab` に `raceStartTime` を渡し、タブの先頭（BOA-271 T9-1 で分岐の外に出した位置の先頭）に `PastRateChecker` を置く。中止・近傍0行・取得中では出さない。取得失敗は `InlineFetchError`（再試行つき）
- [ ] T4-2 `PastRateReview` を書き、`RaceResult` の払戻表の下に置く（保存した型を型の順に保存した数字とラベルで、無ければ決着の行だけ、決着は `buildResultRows` の着順で1〜3着がそろわなければ決着の行なし、不成立とスナップショットなしでは出さない、取得失敗は `InlineFetchError`、スナップショットが違えば注記）
- [ ] T4-3 barrel export（`PastRateChecker`・`PastRateReview`）
- [ ] T4-4 i18n（`aiPredictionTab.pastRate.*`・`result.pastRate.*`、4言語）。スリットの形の名前・「艇身」の訳、決まり手は既存キー。画面に「競艇」を出さない。「AI がやらないこと」の文言を足さない

## T5 検証と仕上げ
- [ ] T5-1 `npm run test:layout` に AI予想タブの部品と結果タブの振り返りを足す（375/768/1024/1440/1920px）。スリットの7形の一覧が375px で横にはみ出さないこと。ダークモードの目視（Playwright のスクリーンショット）
- [ ] T5-2 受け入れ E2E（`e2e/acceptance/past-rate-check.spec.js`、`acceptance-test-writer` が書いたもの）をローカルで実行する。書き換えない
- [ ] T5-3 データ精度の検証（`data-accuracy-verifier`）: 本番の数レースで、`get_analogy_neighbors` の行を SQL で数えた件数（6型、分母・除いた件数）と画面の数字が一致すること、結果タブの決着の行が一致すること
- [ ] T5-4 ファン評価ループ（`.claude/rules/review-fix-cycle.md`。新しい主要表示のため、オーケストレーターが「ファン評価あり」と指定した場合）
- [ ] T5-5 Linear: BOA-627 の保存項目3（ユーザーの読みと発走前の時刻）を本機能で満たしたことをコメントする
- [ ] T5-6 完了監査: このファイルの全チェックボックスと、コミット・実測を突き合わせる
