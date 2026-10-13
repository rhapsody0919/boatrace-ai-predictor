# 引き継ぎ: BOA-635 過去に発生した割合を見る（v16 公開後の master に合わせて SDD をやり直す）

2026-10-13 のセッション「龍神ソナー（BOA-271）レーン」から次のセッションへ。同日、4節の書き直しは済んだ（spec・screens・plan・tasks・ADR-0081・受け入れ E2E）。報告・確認は SendMessage でオーケストレーター（「Orchestrate」）へ。マージは Orchestrate が行う。

作業ブランチ: `feature/boa635-sdd-v16`（origin/master から切った。このファイルを含む）。draft PR #1093（`feature/boa-635-past-rate`、旧 BOA-271 PR #1039 の上に積んでいて master より46コミット先）から、設計の6ファイルだけを持ってきた。中身は 2026-10-05 時点のままで、まだ書き直していない。#1093 はこのブランチの PR ができたら閉じる。

## 1. 決まっていること
- オーナー決定（2026-10-13、Linear BOA-635）: yes。確定済みのモック（v3）で SDD に入る
- 確定モック: https://claude.ai/artifact/RHjYWn3GWXYUetEHf6M7aq の Version 3。差分 D1〜D4 は `screens.md`「モックとの差分」（2026-10-02 オーケストレーター判断）
- AI の当たり外れは数えない。数えるのはユーザーの予想が過去にどれだけ起きたか。端末内保存（会員登録なし）

## 2. オーナー決定（2026-10-13、Orchestrate 経由）
- **母集団と呼び名**: v16 の layer（同じ条件の新しい順最大2,000件、`GET /api/analogy/layer/[raceId]`）のまま数える。呼び名は「類似レース」を使わず「同じ条件の過去レース」にして、龍神ソナー（近い順800件）・思考アシスト（近い順400件、ADR-0087）と分ける。ADR 0081 には、ADR-0087 が却下した「(B) 新しい順2,000件」をこの機能では採る理由を書く。問いが「過去にどれだけ起きたか」なので、全期間を新しい順に数えるのが合う
- **FR-6（思考アシストへの埋め込み）は今回外す**。出すのはレース詳細の AI予想タブ（発走前）と結果タブ（振り返り）だけ。部品の境界（props で絞れる形）は残してよいが、BOA-430 側の作業と検証は書かない
- 統計の前提（CLAUDE.md「UI/UX に要る統計検証」）: 定番／レアの線と、スリット7形の出現率の固定は T0 にある。見せ方を決める前に `data-scientist` で済ませ、結果を `docs/knowledge/stat-findings.md` に残す
- 言葉: 「類似レース」「似たレース」は使わない（「似たレース」は禁止語）。新しい文は `wording-editor` を通す

## 3. 今の master の事実（2026-10-13 調べ済み、origin/master b00db6e9e）
- layer API（`api/analogy/layer/[raceId].js`）: 応答は `{status, ...layerファイル}`。状態は `ok`／`not_saved`／`empty_layer`／`absent`。ok 以外は `rows` なし。Storage に layer が無いときも `not_saved`
  - `absent` は racecard の snapshot の状態ではない。展示後の段の snapshot が absent か、`race_entries`／`exhibition_data` の `is_absent`（`api/_lib/analogyV16.js` の `isAbsent`）
  - キャッシュは締切前 60秒・締切後 1日、`not_saved` は no-store（plan の「締切前 300」は古い）
- layer ファイル（`scripts/ml/analogy/v16_morning.py`）: `run_id`・`race_id`・`conditions`・`n_total`・`n_returned`・`pool_from`（2019-04-01）・`pool_cutoff`・`rows`。`MAX_LAYER_ROWS = 2_000`、新しい順。gzip 後の大きさは最大約50KB（analogy tasks T2-6）
  - `conditions` は `{b1_class, gap_band, top_boat, round: "yusho"|"junyu"|null, grade_g1plus: bool}`（`v16_similar.py`）
  - `n_total` は D-5 で除いた後の件数。ソナーの {n}（snapshot の `n_layer`）と一致しないことがある
  - 切り詰めの判定は `n_returned < n_total` が安全（上限を下げても壊れない）
- 行の列（`v16_pool.py` の `layer_row`）: `race_id`・`rank1`〜`rank3`・`winning_technique`・`course_by_boat`・`st_by_course`・`payout_3tan`。設計に要る列はすべてある
  - 同じコースに2艇いる行は `st_by_course` が null になる。1〜6 の範囲外のコースは `course_by_boat` が null になる。どちらも分母から除く
- 保持期間（BOA-807、PR #1485）: layer を含む龍神ソナーの表示用ファイルは2年（`SONAR_KEEP_DAYS`、`src/utils/analogyRetention.js`）で消える。端末保存の30日には影響しない。v16 の公開（10/6 ごろ）より前のレースと、締切後に作られたレースは `not_saved` で、振り返りは出ない
- 置き場所
  - 龍神ソナーは AI予想タブから独立したタブになった（`SONAR_RACE_TAB`、`PredictionPanel.jsx`、#1333）。AI予想タブに残っているのは、ソナーのタブへ移るボタンだけ
  - `RaceAiPredictionTab.jsx` の先頭コメントに「BOA-635 も同じ場所（PredictionBlocks の外）」とある（T9-1 は #1122 で済み）
  - `raceStartTime` は AI予想タブに渡っていない（オッズ一覧には渡っている）。結果タブの `RaceResult({prediction, raceId})` にも締切は無いので、props を足す
- 既存の部品
  - 取得: `src/services/analogyService.js` の `getV16`、`src/hooks/useAnalogyV16.js` の `useAnalogyResource`。`getAnalogyLayer`／`useAnalogyLayer` はまだ無い
  - 部品: `BoatBadge`、`TECHNIQUE_NAMES`（`turnPrediction.js`）、`getDeadlineDate`（`raceDeadlineStatus.js`）、`InlineFetchError`
  - 層の説明文: `describeAnalogyLayer`（`src/utils/analogyLayer.js`、キーは `aiPredictionTab.analogy.layer.*`）
  - スリット: `src/utils/analogyScenario.js` の `SLIT_FORMS`（flat/wall/d2/d3/kado/d1/dash）・`stCent`・`slitForms` は BOA-635 と共用する前提で作ってある（1段目だけ、強さの2段目は無い）。絵は `SlitShapeIcon.jsx`／`SlitShapePicker.jsx`。plan の `src/utils/pastRate/patterns.js` を新しく作ると二重の実装になる
- 保存キー `boatai-user:past-rate-check:v1` は master の慣習どおり。BOA-665 が直り、更新ボタンとあふれ時の掃除は値がキャッシュの形（`{data, timestamp}`）のキーだけを消す（`supabaseDataService.js`）。spec FR-5 の理由の文と行番号は古い
- ADR の番号 0081 は master で空いている（0080 の次は 0082）。`verify-adr-numbers.js` が勧める次の番号は 0096。どちらでもよい

## 4. 書き直す箇所
- spec.md
  - 前提条件: 済んだものを「済み」にする
  - データ: API を確定させる。4つの状態、`conditions` のキー、`race_id`、null の理由、`describeAnalogyLayer` を書く
  - 「同じ画面の FR-2 の {n}」「下の節の操作」という前提を消す（ソナーは別タブになった）
  - FR-1 のスリット: `slitForms` と共用する
  - FR-4
    - `not_saved` では出さない
    - 「直近7日の作り直しで行の出入り」は D-6 と矛盾しているので消す
    - 結果タブに締切を渡す
  - FR-5 の理由を直す
  - FR-6 は外す（2）。spec の「位置づけ」「共通の数え方」の呼び名を「同じ条件の過去レース」にする
- screens.md
  - S-1: 「その下の BOA-271 の節はそのまま」を消す。出さない条件に `not_saved` を足す
  - S-2: 締切の props を足す
  - `SlitScene` はソナーの絵の部品と共用するか決める
  - `BoatBadge` は既存の部品
  - フックは `useAnalogyV16.js`
- plan.md
  - API を確定させる
  - キャッシュは 60秒
  - 大きさは約50KB
  - `patterns.js` は作らず `slitForms` を段の引数で広げる
  - `PredictionPanel.jsx` の行番号を直す
  - 別タブ化を反映する
  - `RaceResult` への締切の渡し方を書く
- tasks.md
  - 満たした着手条件を「済み」にする
  - マージ順の注意と BOA-665 の記述を更新する
  - T1-4（API を作る）は消す
  - T1-5 は `getV16`／`useAnalogyV16.js` にする
  - T2-1 の照合は runId だけにする（depth・poolCutoff・conditions・snapshotAt の記述を消す）
  - T4-2 の「`snapshot: false` でも出す」を消す
- ADR 0081
  - 「BOA-271 側が経路を決める」を消す
  - ADR-0087 が却下した (B) との関係を書く
  - BOA-430 への埋め込みを消す（2）
- `e2e/acceptance/past-rate-check.spec.js`: 実装者は書き換えられないので、`acceptance-test-writer` で作り直す
  - 全体が旧 RPC（`/rest/v1/rpc/get_analogy_similar_races`）前提になっている。止める先を `**/api/analogy/layer/**` にする
  - 応答
    - `status` を付ける
    - `run_id`・`race_id` を足す
    - `conditions` を実際の5キーにする
    - `snapshot`・`snapshot_at`・`depth` を消す
  - テスト
    - `not_saved`・`empty_layer`・`absent` で出さないテストを足す
    - Entry.snapshot を `{runId, poolCutoff}` にする
    - 照合を runId にする
    - 「snapshot: false でも出す」系を消す
    - `analogyReason.js` への言及を消す

## 5. 進め方
SDD は `.claude/rules/sdd-workflow.md` に従う。
1. 2 の決定と 3・4 の事実を spec・screens に反映する
2. spec・screens を直したら、`acceptance-test-writer` で受け入れE2Eを作り直す
3. plan・tasks を直す
4. `design-reviewer` を通す（省略不可）
5. docs だけの PR として Orchestrate へ渡す
6. 実装（`/step4`）は、PR がマージされた後に始める
