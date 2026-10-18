# 過去に発生した割合を見る tasks

元: [spec.md](./spec.md)・[screens.md](./screens.md)・[plan.md](./plan.md)。依存順。1タスク＝1コミット〜1PR。

**着手条件（spec「実装開始の前提条件」）**:
- 済み: v16 の朝のバッチが本番で layer ファイルと `analogy_v16_snapshots` を作り、`GET /api/analogy/layer/[raceId]` が master にある
- 済み: `BoatBadge`（#1118）、AI予想タブの `PredictionBlocks` の外の位置（#1122・#1333）、`describeAnalogyLayer`、`slitForms`・`SlitShapeIcon`
- 済み: T0-2（スリットの全国の出現率）
- T0-1（定番／レアの線）は本 PR のマージ前に済ませる（2026-10-13 オーケストレーター判断。オーナーの決まり「UI/UX に要る統計検証は見せ方・設計を決める前に」）。合格しなかった材料は FR-3 どおり出さない形で設計を確定する。統計のやり直しは3回まで
- 未: 設計の承認（本 PR のマージ）

本機能は新しいデータ取得を含まない（v16 の layer API を読むだけ）ので、`data-acquisition.md` の「完了の定義」3行は BOA-271 v16 の tasks 側で満たす。本機能は T0-3 で、layer ファイルに値の約束が守られていることだけを実測する。

## 再開するときに読むこと（引き継ぎ）
- 2026-10-13 に v16 公開後の master に合わせて設計を書き直した（[handoff-v16.md](./handoff-v16.md)）。オーナー決定: 呼び名「同じ条件の過去レース」、layer の新しい順2,000件のまま、思考アシストへの埋め込み（旧 FR-6）は外す
- 旧 draft PR #1093（`feature/boa-635-past-rate`）は本ブランチの PR で置き換えて閉じた。その履歴の k-NN・層別 S*（119／120）の設計は使わない
- 受け入れ E2E（`e2e/acceptance/past-rate-check.spec.js`）は 2026-10-13 に spec・screens だけから作り直した。実装者は書き換えない（`.claude/rules/sdd-workflow.md`）。線を出さない結論になった場合（FR-3 手順6）や、オーケストレーターの回答で置き場所・同時に起きない2形の扱いが変わった場合は、`acceptance-test-writer` に書き直させる
- BOA-822（イン崩れ注意度）が `RaceAiPredictionTab.jsx` を書き換える。本機能は `PredictionBlocks` の外の末尾に足すだけ。後に入る側が並びを合わせる
- 進入の型（2026-10-03 ユーザー承認の BOA-271 の展開シナリオ用の型: 枠なり／前付けあり／1号艇がインを取られた）は龍神ソナー側で実装済み（`entryType`）。本機能の FR-1「進入」型（艇ごとのコース）とは別物のまま。統一は今回しない
- 本 PR は ADR-0081 を足す。ADR-0081 が参照する ADR（0085・0087）は master にある

## T0 準備（分析のみ、画面なし）
- [x] T0-1 定番／レアの線の検証（2026-10-13、線 (15, 5)。[analysis/label-threshold-result.md](./analysis/label-threshold-result.md)）（spec FR-3 の手順1〜8）。(1) FR-3 の検証方法の節を単独コミットで push し、`second-opinion-reviewer` で方法論を1パス見る、(2) v16 の列がそろう export を `export_pool.js` で作り直す（読み取りだけ）、(3) `scripts/analysis/past-rate-check/label-threshold.py` で実行。結果を `analysis/label-threshold-result.md` に書き、spec FR-3・`label.js` に x・y を書き戻し、`docs/knowledge/stat-findings.md` に1行足す。手順7に当たる型はオーケストレーター経由でユーザーに戻す
- [x] T0-1a 判定式の二重実装の検査: 固定データ10件で、Python の判定と `src/utils/pastRate/count.js`（T1-2）の件数が一致することを確かめる小さな検査を同じディレクトリに置く（T1-2 の後に実行）
- [x] T0-2 形に添える全国の出現率（1段目・2段目）と2形 AND の件数（2026-10-13、[analysis/slit-pattern-rates.md](./analysis/slit-pattern-rates.md)）
- [x] T0-3（2026-10-16、[analysis/pool-contract-check.md](./analysis/pool-contract-check.md)。9項目合格、LAYER_FIRST_DATE=2026-10-06）本番の値の約束の実測: 数レースの layer ファイルで、(a) `payout_3tan` が本体の `race_results.payout_trio` と一致し `payout_trifecta`（3連複）と一致しないこと（無作為100R）、(b) F・出遅れのあるレースで該当コースの `st_by_course` が null、(c) 不成立のレースが行に無い、(d) 実進入不明の期間で `course_by_boat` が艇番で埋まっていないこと、(e) rank1〜3 に返還艇が入るレースが行に無い（`race_start_timings.finish_mark` と `race_results.refund_boats` を独立の正解として照合）、(f) 同じ run_id なら発走前と発走後で同じ行が返る（D-6）、(g) 応答の gzip 後の大きさ、(h) 層が2,000件を超えるレース（`n_returned < n_total`）の割合、(i) 本番で layer ファイルがある最初の日（`LAYER_FIRST_DATE`）。結果を `analysis/pool-contract-check.md` に残す。違えば BOA-271 側に戻す

## T1 判定の純粋関数とデータ取得（画面より先）
- [x] T1-1 `scripts/maintenance/verify-past-rate-count.js` を先に書き、落ちることを確かめる（固定の行データ20件程度。各形で差が線ちょうどの行（1段目・2段目、0.15/0.10、0.21/0.16 等の浮動小数で割れる組を含む）、`st_by_course`・`course_by_boat` が要素の null（同じコースに2艇で2要素、範囲外のコースでその艇だけ）の行と、守りとして配列ごと null の行、除いた件数の理由の混在、6型の一致件数・分母・除いた件数・着順の点数・流しの内訳・展開の2着の内訳・スリット2形の AND・3形目で最古が外れる・同時に起きない形・自分で作るの判定・配当の境界 1,000／10,000 ちょうど・N=0・`n_returned < n_total` の切り詰めの判定）。`verify-registry.json` に ci で登録
- [x] T1-2 `slitForms(stByCourse, level = 1)` に段の引数と `SLIT_LEVELS` を足し（`verify-analogy-facts.js` が通ることを確かめる）、`src/utils/pastRate/count.js`（`countPastRate`・`orderPoints`・`isTruncated`・`incompatibleForms`）と `slitRates.js` を書いて T1-1 を通す。決まり手は `TECHNIQUE_NAMES` で DB の日本語と対応させる
- [x] T1-3 `src/utils/pastRate/label.js`（`rateLabel(rate, type, input)`・`subtypeOf`・`thresholdNote`。T0-1 の線と、小分けごとに出すラベル）。境界値（x ちょうどで定番、y ちょうどは無印）と、出さない小分けでラベルと線の文が出ないことを T1-1 に足す
- [x] T1-4 `LAYER_FIRST_DATE`（T0-3 で確かめた日）より前のレースでは取得しない。`getAnalogyLayer(raceId)`（`analogyService.js`、`getV16`）と `useAnalogyLayer(raceId, enabled)`（`useAnalogyV16.js`、`useAnalogyResource`）。失敗を state に持つ（`frontend-data-fetch.md` の3）

## T2 端末内保存
- [x] T2-1 `src/utils/pastRate/storage.js`（キー `boatai-user:past-rate-check:v1`、1レース×1型で置き換え、入力時刻から30日、上限1,000件、締切以降は保存しない、締切不明は未確定なら保存、壊れた値は捨てて作り直す、形の違う Entry だけ捨てる、書く直前に読み直す、締切以降の Entry は振り返りに出さない、例外は吸収して console）。T1-1 の verify に保存の節を足す（メモリ実装の localStorage を差し込み、`getItem`／`setItem` が例外を投げる場合、`clearCache()` の後も残ること、照合は `snapshot.layerKey`（layer の中身の印）で行い、先頭と末尾の行が同じで中だけ違う layer でも「変わった」になることを含める）

## T3 入力と結果の部品
- [x] T3-1 `BoatToggle`・`PastRate.css`（`prc-` 接頭辞、トークン、ダークモード）
- [x] T3-2 `OrderInput`（3行×6艇、流す、やり直す、点数の要約）
- [x] T3-3 `Boat1Input`・`TenkaiInput`・`EntryInput`・`PayoutBandInput`
- [x] T3-4 `PAST_RATE_SLIT_EXAMPLE`（段ごとの形の絵の例。カド受け凹みは新定義を満たす差。龍神ソナーの `SLIT_EXAMPLE.d3` は新定義を満たさないので別タスクに切り出した）を `analogyScenario.js` に足す。絵は `SlitShapeIcon` を使う
- [x] T3-5 `SlitInput`（7形の一覧と全国の出現率・母数の注記、強さ2段（横一線・内3艇だけのときは隠す、カド一撃の注記）、同時に起きない形を押せなくする、自分で作る（指定なし→出る→凹む）、最大2形）
- [x] T3-6 `PastRateResult`（主文・ラベル・メーター・内訳・除いた件数・比べた相手の注記（`describeAnalogyLayer`）、N=0 の文言）
- [x] T3-7 `PastRateChecker`（型の切り替え、型ごとの入力の保持、入力が変わったら結果を隠す、ボタンで数えて保存）

## T4 組み込み
- [x] T4-1 `PredictionPanel` → `RaceAiPredictionTab`・`RaceResult` に `raceStartTime` を渡す。`RaceAiPredictionTab` の `PredictionBlocks` の後ろに `PastRateSlot`（layer の取得、`ok` 以外・0行・取得中は出さない、取得失敗は `InlineFetchError`）。BOA-822 の PR と並びを合わせる
- [x] T4-2 `PastRateReview` を書き、`RaceResult` の払戻表の下に置く（保存した型を型の順に保存した数字とラベルで、無ければ決着の行だけ、決着は `buildResultRows` の着順で1〜3着がそろわなければ決着の行なし、不成立・`ok` 以外・0行では出さない、取得失敗は `InlineFetchError`、`layerKey`（layer の中身の印）が違えば注記）
- [x] T4-3 barrel export（`PastRateChecker`・`PastRateReview`）
- [x] T4-4 i18n（`aiPredictionTab.pastRate.*`・`result.pastRate.*`、4言語）。先に `docs/reference/i18n-glossary.md` に「同じ条件の過去レース」「定番」「レア」「艇身」とスリット7形の名前を登録する（`.claude/rules/i18n-new-pages.md`。7形の名前は龍神ソナーのキーがあれば共用）。決まり手は既存キー、層の説明文は `aiPredictionTab.analogy.layer.*`。画面に「競艇」を出さない。「AI がやらないこと」の文言を足さない。新しい文は `wording-editor` を通す

## T5 検証と仕上げ
- [x] T5-1 `npm run test:layout` に AI予想タブの部品と結果タブの振り返りを足す（375/768/1024/1440/1920px）。スリットの7形の一覧が375px で横にはみ出さないこと。ダークモードの目視（Playwright のスクリーンショット）
- [x] T5-2（2026-10-18、60/60 pass。固定データの前提（実在するレース・時計・ロケータ）を acceptance-test-writer が直した。期待値は変えていない）受け入れ E2E（`e2e/acceptance/past-rate-check.spec.js`）をローカルで1本ずつ・`--workers=1` で実行する。書き換えない。実行は `npx playwright test --config=playwright.acceptance.config.js e2e/acceptance/past-rate-check.spec.js`（本体の config では走らない）
  - 実行の前提で未解決のもの（2026-10-13 の外部点検 U3。テストの書き換えではなく前提のそろえ方の問題なので、実装時に確かめる）: テストの固定レース `2099-12-31-01-01` は日付の予想一覧に無いと詳細が描画されない（`RaceDetailPage.jsx`）ので、layer 以外の応答（予想・結果・締切）の固定が要る。確定済みに使う `2026-10-08-01-01` は録画の時刻（2026-10-02）より後。どちらも直すときは acceptance-test-writer に直させる
- [x] T5-3（2026-10-18、[analysis/data-accuracy.md](./analysis/data-accuracy.md)。576通りで不一致0）データ精度の検証（`data-accuracy-verifier`）: 本番の数レースで、layer の行を Python で数えた件数（6型、分母・除いた件数）と画面の数字が一致すること、結果タブの決着の行が一致すること
- [x] T5-4（省略: 2026-10-18 オーケストレーター判断。オーナーが Preview を触って承認したため）ファン評価ループ（`.claude/rules/review-fix-cycle.md`。オーケストレーターが「ファン評価あり」と指定した場合）
- [x] T5-5（2026-10-18 コメント済み）Linear: BOA-627 の保存項目3（ユーザーの読みと発走前の時刻）を本機能で満たしたことをコメントする
- [x] T5-6（2026-10-18、全チェックボックスの実体（ファイル・コミット・実測）を確かめた）完了監査: このファイルの全チェックボックスと、コミット・実測を突き合わせる
