# 過去に発生した割合を見る tasks

元: [spec.md](./spec.md)・[screens.md](./screens.md)・[plan.md](./plan.md)。依存順。1タスク＝1コミット〜1PR。

**着手条件（spec「実装開始の前提条件」）**: BOA-271 FR-2（層別 S*）のマイグレーション119（`get_analogy_similar_races` を含む）が本番に適用され、母集団の投入とスナップショットの日次作成が動いていること。BOA-271 の `BoatBadge` の切り出しと T9-1（節の描画を分岐の外に出す）が master に入っていること。T0 は FR-2 の層の定義（分析スクリプト）があれば先に進めてよい（画面のコードは書かない）。

本機能は新しいデータ取得を含まない（FR-2 の母集団と RPC を読むだけ）ので、`data-acquisition.md` の「完了の定義」3行は BOA-271 FR-2 の tasks 側で満たす。本機能は T0-3 で、本番の母集団に値の約束が守られていることだけを実測する。

## 再開するときに読むこと（引き継ぎ）
- 土台: BOA-271 FR-2 の層別 S*（ブランチ feature/boa-271-fr2-strat、PR #1134、マイグレーション119、ADR-0082）。`get_analogy_neighbors`（115、近傍800件）は作られない。spec・plan・ADR-0081 はすべて119 の `get_analogy_similar_races` 前提に書き直し済み
- FR-2 レーンとの合意（2026-10-02）: 層の新しい順最大2,000件、8列、行の外の項目、深さは自動に固定、行の範囲は `pool_cutoff` 以前（直近7日の作り直しで行の出入りあり）、Edge API `/api/analogy/similar-races/[raceId]` は本機能で作る、深さ1〜3の索引3本は本番適用後に EXPLAIN を見て使われないものを落とす
- ユーザー承認済み: 主文の文言（切り詰めなし「過去{N}レース中」、切り詰め「同じ条件の新しい{N}レース中」）、件数が少なくても%を出す。オーケストレーター判断で採用: Q1（チップ・スライダー非連動）、Q2（絶対値の線15/5と事前に固定した検証）、画面差分 D1〜D4
- 着手条件の状況: `BoatBadge` の切り出しは master に入った（#1118）。T9-1 は #1122（寄与度の画面）の範囲で未マージ。119 は本番未適用
- T0-1 を進めるときは、#1138 で入る分析ルールに従う: 事前登録（FR-3 の手順1〜8）を単独コミットで push してから数値を見る。その前に `second-opinion-reviewer` で方法論を1パス見てもらう。数値には出典を付ける。FR-2 の層の分析スクリプトが master に入ってから使う
- 受け入れ E2E（`e2e/acceptance/past-rate-check.spec.js`、112件）は spec・screens だけから書かせたもの。実装者は書き換えない（`.claude/rules/sdd-workflow.md`）。線を出さない結論になった場合（FR-3 手順6）は、ラベル系のテストを `acceptance-test-writer` に書き直させる
- 別スコープ: BOA-665（更新ボタンが `boatai:` のユーザー設定を消す）は多言語・共通UIレーンに回った

## T0 準備（分析のみ、画面なし）
- [ ] T0-1 定番／レアの線の検証（spec FR-3 の手順1〜8で固定済み）: `scripts/analysis/past-rate-check/label-threshold.py`。test 2026-04〜09 の各レースで、FR-2 の層別 S* と同じ規則（自動の深さの層、そのレースの日より前の母集団、新しい順最大2,000件）で比べる行を作り、型ごとに線のまわりの実際の発生率で合否、ラベルが付く割合・Wilson 区間・Brier skill を報告。初期値 (15, 5) → 候補 (20, 5)・(15, 3)・(25, 3)・(10, 3) の順で最初に全型で合格した線を採る。手順7に当たる型はユーザーに戻す（オーケストレーター経由）。結果を `analysis/label-threshold-result.md` に書き、spec FR-3 に x・y を書き戻す
- [ ] T0-1a 判定式の二重実装の検査: 固定データ10件で、Python の判定と `src/utils/pastRate/count.js`（T1-1 で書く）の件数が一致することを確かめる小さな検査を同じディレクトリに置く（T1-1 の後に実行）
- [ ] T0-2 形に添える全国の出現率を、K/B 補完後のデータ（2026-03〜09 以降の最新6か月、F・出遅れ・欠場を除く、コース順の本番 ST、1/100秒の整数で比較。コース順の源は本体 `race_results.actual_course_*`・長期 `kb_archive_boats.course`。`race_start_timings.entry_course` は 2026-08 までほぼ空なので使わない）で出し直し、`analysis/slit-pattern-rates.md` に件数・期間・クエリと一緒に残す。`patterns.js` に入れる値はこの表から取る
- [ ] T0-3 本番の値の約束の実測（FR-2 の母集団の投入の後）: `analogy_pool_outcomes` で、(a) `payout_3tan` が本体の `race_results.payout_trio` と一致し `payout_trifecta`（3連複）と一致しないこと（無作為100R）、(b) F・出遅れのあるレースで該当コースの `st_by_course` が NULL、(c) 不成立のレースで `payout_3tan` が NULL（`race_status` が NULL の行も含め、返還艇が6艇・払戻 NULL の不成立候補で確かめる。`race_status` は 2026-09-20 より前でほぼ NULL）、(d) 実進入不明の期間で `course_by_boat` が艇番で埋まっていないこと、(e) rank1〜3 に返還艇が入るレースと不成立のレースが母集団に無い（D-5。`race_start_timings.finish_mark` と `race_results.refund_boats` を独立の正解として照合する。119 はフラグだけで判定しているので、差があれば FR-2 レーンに戻す）、(f) `get_analogy_similar_races` を発走前と発走後に呼んで、条件・深さ・cutoff が同じで、行の出入りが直近7日の作り直しの分だけであること（D-6・行の範囲の固定）、(h) 深さ1〜4の RPC で `EXPLAIN (ANALYZE, BUFFERS)` を取り、FR-2 レーンが119 に足した深さ1〜3用の索引3本が使われているかを確かめ、使われない索引は落とす（FR-2 レーンと合意）、(i) 層が2,000件を超えるレース（切り詰め）の割合を数え、spec の推測（1〜2割）を実測で置き換える、(g) 応答の gzip 後の大きさ（100KB を超えるなら FR-2 レーンに1,000件への変更を依頼）。結果を `analysis/pool-contract-check.md` に残す。違えば BOA-271 のレーンに戻す

## T1 判定の純粋関数とデータ取得（画面より先）
- [ ] T1-1 `scripts/maintenance/verify-past-rate-count.js` を先に書き、落ちることを確かめる（固定の行データ20件程度。期待値は SQL の numeric で出したもの。各形で差が線ちょうどの行（0.15/0.10、0.21/0.16 等の浮動小数で割れる組を含む）、除いた件数の理由の混在（決着なし＋ST 欠け）、6型の一致件数・分母・除いた件数・着順の点数・流しの内訳・展開の2着の内訳・スリット2形の AND・3形目で最古が外れる・自分で作るの判定・配当の境界 1,000／10,000 ちょうど・N=0）。`verify-registry.json` に ci で登録
- [ ] T1-2 `src/utils/pastRate/patterns.js`（7形・強さの段・1艇身 0.13秒・全国の出現率）と `count.js`（`countPastRate`・`orderPoints`・`decisionOf`）を書き、T1-1 を通す。決まり手は `TECHNIQUE_NAMES` で DB の日本語と対応させる
- [ ] T1-3 `src/utils/pastRate/label.js`（T0-1 の x・y）。境界値（x ちょうどで定番、y ちょうどは無印）を T1-1 に足す
- [ ] T1-4 Edge API `api/analogy/similar-races/[raceId].js`（RPC `get_analogy_similar_races` の結果を返す。キャッシュはスナップショットあり・締切前 `s-maxage=300`、締切後 `86400`、なし `300`、NULL・エラーは `no-store`。FR-2 の `api/analogy/similar` と同じ流儀）
- [ ] T1-5 `src/services/analogyService.js` に `getAnalogySimilarRaces(raceId)`（T1-4 の API、失敗時は RPC `get_analogy_similar_races` の直読み、`raceId` 単位のキャッシュ、NULL・エラーは残さない）と `useAnalogySimilarRaces` を足す。失敗を state に持つ（`frontend-data-fetch.md` の3）

## T2 端末内保存
- [ ] T2-1 `src/utils/pastRate/storage.js`（キー `boatai-user:past-rate-check:v1`、1レース×1型で置き換え、入力時刻から30日、上限1,000件、締切以降は保存しない、締切不明は未確定なら保存、壊れた値は捨てて作り直す、形の違う Entry だけ捨てる、書く直前に読み直す、締切以降の Entry は振り返りに出さない、例外は吸収して console）。T1-1 の verify に保存の節を足す（メモリ実装の localStorage を差し込み、`getItem`／`setItem` が例外を投げる場合、`dataService.clearCache()` 相当の `boatai:*` 全削除の後も残ること、照合は depth・poolCutoff・conditions で行い、snapshotAt が null から時刻に変わっただけでは「変わった」にしないことを含める）

## T3 入力と結果の部品
- [ ] T3-1 `BoatToggle`・`PastRate.css`（`prc-` 接頭辞、トークン、ダークモード）
- [ ] T3-2 `OrderInput`（3行×6艇、流す、やり直す、点数の要約）
- [ ] T3-3 `Boat1Input`・`TenkaiInput`・`EntryInput`・`PayoutBandInput`
- [ ] T3-4 `SlitScene`（SVG、実縮尺、1艇身の目盛り、`role="img"` と説明の `aria-label`）
- [ ] T3-5 `SlitInput`（7形の一覧と全国の出現率、強さ2段（横一線・内3艇だけのときは隠す、カド一撃の注記）、自分で作る（指定なし→出る→凹む）、最大2形）
- [ ] T3-6 `PastRateResult`（主文・ラベル・メーター・内訳・除いた件数・比べた相手の注記、N=0 の文言）
- [ ] T3-7 `PastRateChecker`（型の切り替え、型ごとの入力の保持、入力が変わったら結果を隠す、`types`・`value`/`onChange`・`persist`、ボタンで数えて保存）

## T4 組み込み
- [ ] T4-1 `PredictionPanel` → `RaceAiPredictionTab` に `raceStartTime` を渡し、タブの先頭（BOA-271 T9-1 で分岐の外に出した位置の先頭）に `PastRateChecker` を置く。中止・`rows` が0行・取得中では出さない。取得失敗は `InlineFetchError`（再試行つき）
- [ ] T4-2 `PastRateReview` を書き、`RaceResult` の払戻表の下に置く（保存した型を型の順に保存した数字とラベルで、無ければ決着の行だけ、決着は `buildResultRows` の着順で1〜3着がそろわなければ決着の行なし、不成立と `rows` が0行では出さない（`snapshot: false` でも出す）、取得失敗は `InlineFetchError`、スナップショットが違えば注記）
- [ ] T4-3 barrel export（`PastRateChecker`・`PastRateReview`）
- [ ] T4-4 i18n（`aiPredictionTab.pastRate.*`・`result.pastRate.*`、4言語）。スリットの形の名前・「艇身」の訳、決まり手は既存キー。画面に「競艇」を出さない。「AI がやらないこと」の文言を足さない

## T5 検証と仕上げ
- [ ] T5-1 `npm run test:layout` に AI予想タブの部品と結果タブの振り返りを足す（375/768/1024/1440/1920px）。スリットの7形の一覧が375px で横にはみ出さないこと。ダークモードの目視（Playwright のスクリーンショット）
- [ ] T5-2 受け入れ E2E（`e2e/acceptance/past-rate-check.spec.js`、`acceptance-test-writer` が書いたもの）をローカルで実行する。書き換えない
- [ ] T5-3 データ精度の検証（`data-accuracy-verifier`）: 本番の数レースで、`analogy_pool_outcomes` の同じ層の新しい順2,000件を SQL で数えた件数（6型、分母・除いた件数）と画面の数字が一致すること、結果タブの決着の行が一致すること
- [ ] T5-4 ファン評価ループ（`.claude/rules/review-fix-cycle.md`。新しい主要表示のため、オーケストレーターが「ファン評価あり」と指定した場合）
- [ ] T5-5 Linear: BOA-627 の保存項目3（ユーザーの読みと発走前の時刻）を本機能で満たしたことをコメントする
- [ ] T5-6 完了監査: このファイルの全チェックボックスと、コミット・実測を突き合わせる
