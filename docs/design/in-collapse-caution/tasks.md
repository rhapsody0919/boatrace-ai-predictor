# イン崩れ注意度の作り直し: タスク

[spec.md](./spec.md)・[screens.md](./screens.md)・[plan.md](./plan.md) の実装順（plan §7 の切り替えの順）。1タスク＝1コミット〜1PR。**オーナー**の印はユーザーが行う作業（Claude は本番に書かない。SQL はチャットにコピペ用で渡し、確認の SELECT は Claude が読み取りで行う）。**待ち**の印はユーザーの回答が要るもの。

画面の PR はすべて機能フラグ `isInCautionEnabled()` の false の側を今のまま残す（公開まで本番の見た目は変わらない）。内部確認は `?caution=1`。

## PR-1 夜の表とジョブ（155、plan §2）

#1461。task 1 は JSON の import をやめ、`src/constants/inCautionConfig.js`（JS の正）と `src/data/inCautionConfig.json`（Python 用）にした（Vercel 関数のバンドルで確かめる手段が無いため。一致は `verify-in-caution.js`）。進み具合は [handoff-step4-progress.md](./handoff-step4-progress.md)（PR-2）

- [x] **1. `src/data/inCautionConfig.json`** を作る（`def`・`thresholds`・`bandWidthCents`・`bandMin`・`bandMax`・`from`・`minTotalN`・`prelaunch`・`launchDate: null`）。`minTotalN` は 2019-04〜2026-10-10 の完全レースの数（round4 の件数）から決め、根拠を JSON の横の README か plan に書く。`import ... with { type: "json" }` が Node 22・Vite・Vercel 関数のバンドルで動くかを先に確かめ、動かなければ JS の定数の module を正にする（plan §1）
- [x] **2. `scripts/ml/analogy/in_caution_bands.py`**
  - `features.load_main`（full のときは `load_kb` も）＋ `add_labels` で完全レースの1号艇の行を作り、勝率差（1/100 の整数）・帯（clamp(floor(g/50), −8, 6)）・ラウンド（`round_from_stage` の junyu・yusho、ほかは other）を付け、日×ラウンド×帯で `n`・`non_win` を数える。勝率差が出せないレースは数えない
  - 書き方は「開始時刻を `computed_at` に入れて upsert → 窓の中の古い行を DELETE」（plan §2、M1）。窓は既定で直近14日、`--full` で全期間。JST 04:30〜23:00 は `--force` が無ければ書かずに終わる
  - 書き込みは `db.request`（PostgREST、service_role）。1000行ずつ
- [x] **3. pytest** `scripts/ml/analogy/tests/test_in_caution_bands.py`: 帯の境目（−350 は帯 −7、−351 は −8、300 は 6）、勝率 0.00 は勝率として数える（NULL だけ外す）、ラウンドの分け方、欠場のあるレースを数えない、F の1号艇は非1着、upsert の後に0件のセルが消える（db をモック）。固定の入力 `scripts/ml/analogy/tests/fixtures/in_caution_cases.json` は task 7 の JS の verify と共有する
- [x] **4. workflow `.github/workflows/in-caution-nightly.yml`**: `analogy-v16-morning.yml` と同じ形。14日のモードは `export_pool.js --daily races entries exhibition conditions results start_timings`（テーブル名の指定が `--daily` と同時に使えるかを確かめ、使えなければ export_pool.js を直す）、full は全テーブル。inputs `full`・`force`。`concurrency: in-caution-nightly`。失敗は Slack
- [x] **5. 起動**: `scripts/lib/analogyDispatch.js` の `DISPATCH_WORKFLOWS` に `in_caution_nightly`、`api/cron/in-caution-dispatch.js`、`vercel.json` の cron `30 17 * * *`、`scripts/lib/scrapeJobs/registry.js` に `in_caution_dispatch`（modeGated、`failureAlertAfter: 1`、mode は off で入れる）。`verify-analogy-dispatch.js` に1件足す
- [x] **6. オーナー: 155 を SQL Editor で適用**。事前: `to_regclass('public.in_caution_gap_band_daily')` が NULL。事後（Claude が読み取り）: `relrowsecurity = true`、anon の SELECT・EXECUTE が false、advisor の `rls_disabled_in_public` 0件。APPLIED.md を更新
- [x] **6b. オーナー: workflow_dispatch で `full=true`・`force=true` を1回実行**
  - 完了の定義（件数）: 年ごとの `sum(n)`（勝率差が出せないレースを除くので少し少なくてよい）が、統計検証の完全レースの数と1%以内で合う: 2019 40,359／2020 54,263／2021 54,362／2022 54,672／2023 54,605／2024 54,616／2025 54,504／2026（10-10まで）43,613（design-reviewer が races.pkl から出した値。合計 410,994）。`min(race_date)` が 2019-04-01、`max(race_date)` が前日。(other, −5) の 2019-04-01〜2026-10-10 の合計が 34,842件・非1着 22,634（64.96%）。実測の SQL と結果を PR コメントに貼る
  - 完了の定義（タイミング）: 確かめてから mode を live にし、翌日 JST 3:30 までに `max(race_date)` が前日になっている
  - 完了の定義（継続監視）: task 12 の `verify-in-caution-coverage.js --table`
  - 結果（2026-10-13、run 38348285812）: 年ごとの `sum(n)` は 2019〜2025 が上の値と完全一致、2026 の 10-10 までが 43,613（一致）。(other, −5) は 34,842件・22,634（一致）。表は 2019-04-01〜2026-10-12・49,801行・基準 45.19%。例のレースを本番の表と computeInCaution で出し直して pct 65・34,842件・帯 −5（plan の保存例と一致）。mode の live はオーナーの手順3

## PR-2 値の生成（plan §1）

#1462（task 7〜12）。マージは 155 の適用と全期間の表を作った後。task 13 はマージの翌朝

- [x] **7. `src/utils/inCautionLevel.js`**: `pctOf(nonWin, n)`（`floor((200×nonWin + n) / (2n))`）、`levelOf(pct)`、`bandOf(gapCents)`、`bandLabel(band)`（−3.5未満／+3.0以上／範囲）。`src/utils/volatilityLevel.js` は消さない（掃除の PR で）。`verify-frontend-pure-functions.js` に suite を足し、task 3 の固定の入力 JSON を読んで Python と同じ答えになることを確かめる
- [x] **8. `scripts/lib/inCaution.js`** の `computeInCaution({entries, raceStage, rates})` → `{inCaution, skip}`。plan §1 の「出さないレース」の表のとおり（1号艇の欠場・勝率なし（NULL だけ。0.00 は勝率）、2艇以上の欠場、他の艇の勝率が全部なし、表の欠け、セルが無い・件数 100 未満）。最大が同点なら艇番の小さい方。ラウンドは `getRaceStageCategory`
- [x] **9. `generate-unified-predictions.js`** に組み込む: RPC を1回（3回まで再試行）、表の欠けのガード（`first_date`・`last_date`・合計の `n`）、`feature_contributions.inCaution`・`inCautionSkip` を書く。旧キーは書き続ける。失敗時は戻り値に `inCautionFailed: true`
- [x] **10. やり直し**: `findRacesMissingUnified` が `inCautionSkip = 'rates_unavailable'` の行も欠けとして数える。races-init の後始末（`scripts/lib/racesInit/job.js:138-152`）は `inCautionFailed` のとき `fin.unified` を記録せず、`cursor` の回数で5回まで。`verify-morning-init-jobs.js` に再現テスト「1回目は RPC が失敗し、2回目の起動で inCaution が入る」「5回で打ち切って失敗を記録する」
- [x] **11. `scripts/maintenance/verify-in-caution.js`**（ci、registry に登録）: `computeInCaution` の全分岐、境目（帯 −8・6、pct 34/35・54/55）、例のレース（2026-10-11 戸田4R: 4.81 と 6.93 → −212 → 帯 −5）
- [x] **12. 監視**: Vercel Cron `api/cron/in-caution-health.js`（JST 04:30 は表の鮮度・最初の日・合計の n、05:45 は今日の unified で inCaution がある割合・`inCautionSkip` の内訳・`through` の遅れ。`registry.js` に `failureAlertAfter: 1`、`vercel.json` に2行）。判定は純関数にして `scripts/maintenance/verify-in-caution-coverage.js`（manual、registry に登録）からも呼ぶ
- [x] **13. 翌朝の確認**: inCaution のある割合（中止・1号艇の欠場・`sparse_cell` を除いて 99% 以上が目安）、`inCautionSkip` の内訳、`through` が前日、例のレースの値を表から出し直して一致（`data-accuracy-verifier`）。準優・優勝戦の日に、05:0x の生成の時点で `race_stage` が入っているか（2026-10-06〜12 は空0件、`race_conditions` の行は 05:01 に作られる）
  - 結果（2026-10-16）: 10-14〜16 の unified 各156行の全部に inCaution（cancelled 0・skip 0、coverage 1）。準優・優勝戦は生成の時点で race_stage が入っていた（race_conditions の作成は生成より前）。data-accuracy-verifier が468件を出し直し、464件は全項目一致。4件は朝の後の欠場（absentBoats・1件は boat1_absent）で plan §1 の想定どおり。夜の表は 10/14・15・16 とも直近14日を書き直し、2019〜2025 の件数は不変。監視は表・当日とも成功

## PR-3 RPC（157、plan §3）

#1492（task 14・15）。157 の適用前の md5 は 2026-10-13 に本番で一致を確認（5d0ff6d8…・a5c39f55…・8f6cf80c…）

- [x] **14. `verify-rpc-output-keys.js`** に `MIGRATION_157_IN_CAUTION_KEYS`（3関数のレースの `inCaution`）
- [x] **15. `transformEdgeResponse`・`transformTodayRaces`** で `inCaution` をレース直下に通す。`RaceDetailPage.jsx:81-85` で prediction に写す
- [x] **16. オーナー: 157 を適用**。事前（Claude が読み取り）: md5(prosrc) が `5d0ff6d8…`・`a5c39f55…`・`8f6cf80c…`。事後: `012ecc95…`・`2cd99677…`・`bada0caa…`、`verify-rpc-output-keys.js`、APPLIED.md。録画データ（`e2e/recordings/`）を取り直す
  - 結果: 2026-10-17 にユーザーが適用（APPLIED.md 157、md5 は期待値と一致）。録画は取り直さず、画面の試験は `page.route` で応答を差し替えて書いた（2026-11-24 に印を付けた）

## PR-4 画面（フラグの裏、plan §4。部品ごとに PR を分けてよい）

- [x] **17. 機能フラグ** `IN_CAUTION_PUBLIC = false`・`IN_CAUTION_PREVIEW_KEY`・`isInCautionEnabled()`（`src/config/featureFlags.js`、`?caution=1`）
- [x] **18. i18n の対訳を登録**（実装の前に）: `docs/reference/i18n-glossary.md` のドメイン用語に「イン崩れ注意度」「勝率差」「崩れやすい／中くらい／堅め」「段ごとの実績」「公開前の検証」。訳は `wording-editor` に当てる
  - 今の用語集は「イン崩れ指数」（120 行）・「イン崩れ注意（高）」（121 行）・「荒れ度」（141 行）だけで、「イン崩れ注意度」の行が無い（2026-10-13 Orchestrate の指摘）。新しい行を4言語で足し、既存の3行の補足に「BOA-822 の公開で画面からは外れる（旧指数）」を書く（plan §4 i18n）。公開の PR を待たずに PR-4 の最初に入れる
- [x] **19. 共通の部品**: `RateBar`（`RoughCard.jsx` の `MiniBar` を切り出し、`RoughCard` を置き換えても見た目が変わらないことを確かめる）、`InCautionBadge`（3段、意味トークン、真ん中は枠線だけ）、`TECHNIQUE_NAMES` を `src/constants/techniqueNames.js` へ移す
  - 途中（2026-10-16）: `TECHNIQUE_NAMES` は移した。`RateBar` は既存の `src/components/common/RateBar.jsx`（表のセルの2段の棒、BOA-428）と名前がぶつかり形も違うので、基準の点線つきの棒は `src/components/race/BaselineBar.jsx` にした（RoughCard を置き換え、layout の E2E で見た目が変わらないことを確認）。`InCautionBadge` は 2026-10-17 に作った（task 19 は完了）
- [x] **20. `InCautionCard`** と AI予想タブ（案A）: 先頭にカード、展開予測・答え合わせ・イン崩れの振り返り・`VolatilityDisplay`・`ai-tab-sonar-link` をフラグ true の側で描かない。`OutcomePatternPreview` は残す。確定後の1行、値が無いときの空状態、1号艇が後から欠場したら（直前情報の `is_absent`）カードを出さない、注記（準優・優勝戦・欠場あり・件数少なめ）。4言語
  - 2026-10-17: `src/components/race/InCautionCard.jsx`・`InCautionBadge.jsx`、`RaceAiPredictionTab` のフラグ true の側。「類似レース◯件」はソナーの既定の件数（`analogyAggregate.js` の `DEFAULT_STEP` = 400）。カードの大きい棒は段の範囲の帯と両端のラベルが付くので、`BaselineBar` ではなくカードの中で描いた。1号艇の後からの欠場は `getRaceExhibitionBasics` で見る。過去の日付の `/api/predictions/{date}` は CDN に1日残るので、157 の適用前（〜2026-10-17）の日付は翌日まで inCaution が無い。受け入れ E2E の S-1 は補助関数が描画を待たずに `isVisible()` を見ていて、ライブのデータではカードの前に判定してスキップ・取り違えになる（報告済み）
- [x] **21. `RaceCard`** の札と割合、展開予測の的中/外れのバッジを外す
- [x] **22. ホーム `TodaysVolatilityHighlights`**（`volatilityHighlights.js` の入力を `{pct, level, closed}`）。行全体を押せる、44px
- [x] **23. 思考アシスト `RoughCard`・`RoughSheet`**: 1着のバー = `100 − pct`、行ごとの範囲の名前と件数、裏返しの説明の1行（ja のみ）
  - ファン評価（#1595 1周目 P2）: カードの「軸から考える」の先の思考アシストは、今は1号艇の1着が 36%（全国・級の並び）・30.5%（会場）で、カードの 100−71=29% と食い違う。このタスクで「1着のバー = 100 − pct」にそろえる。公開の前に必ず入れる
- [x] **24. `/accuracy`** の作り替え（`InCautionAccuracyChart`、公開後／公開前の検証の切り替え、Wilson の区間は純関数、30件未満は件数だけ）と `/winning-technique?tab=volatility` の中身の置き換え（タブのラベルは新しいキーをフラグで切り替える。`analysisPage.tabs.volatility` は上書きしない）。`getInCautionAccuracy()`（`accuracy_cache.in_caution_accuracy`）
  - 段ごとの実績の点線のラベルも、カードと同じく「全レース」にそろえる（2026-10-17 オーナー決定。受け入れ E2E の S-5 は「全国」の文字で探しているので合わせて直す）
  - ファン評価（#1595 1周目 P2）: カードの「段ごとの実績を見る」の先は、今は旧ラベルと展開予測の的中率のページ。公開の前に必ず入れる
- [x] **25. `/races`**: 展開予測の的中率を外し、meta description とページの説明を書き直す（フラグの側）
- [x] **26. 確定後のシェア文・AIコピー** の展開予測の節を外す（フラグの側）。AIコピーの「イン崩れ狙い」の選択肢は `inCaution.level === "high"`
  - AIコピーの分は #1595 で入れた（ファン評価1周目 P1）。「イン崩れ狙い」は段が崩れやすいときだけ、展開予測の節と言葉を外した（`promptInCautionTrifecta`）。確定後のシェア文は未着手
- [x] **27. 計測** `caution_visible`・`caution_click`（measurement.md）。送るかは純関数、`verify-frontend-pure-functions.js` と e2e に再現テスト
  - 2026-10-18（#1611）: `src/utils/cautionEvents.js`・`src/hooks/useVisibleOnce.js`。レース詳細・ホーム・会場の一覧・/accuracy（/winning-technique 共通）・思考アシストの枠。/today（surface `today`）は PR-6 の task 35 で入れる。GA4 のカスタムディメンション4件の登録は公開の前日まで（オーナー）
- [ ] **28. 確認**: Playwright で 375・768・1440px、ライト／ダーク（段の札の 3:1）、`?caution=1` の有無で旧・新が切り替わる。受け入れ E2E（`e2e/acceptance/in-collapse-caution.spec.js`）を通す。`wording-editor` で文言（禁止語・単位）

## PR-5 /accuracy の実績（plan §6）

- [x] **29. `in_caution_bands.py` に実績の集計を足す**: 公開前の検証（表だけで作る。full のとき・無いとき・`def` が違うときだけ）、公開後（`launchDate` 以降、同じ `def` の unified の行の `level` と完全レースの1号艇の1着の有無）。`accuracy_cache.in_caution_accuracy` に upsert。pytest に再現テスト
- [x] **30. 確認**: 公開前の検証の段ごとの率・件数が、ラウンドで分けた率で出した値 21,030・27.2%／32,178・43.4%／22,087・65.7%（design-reviewer が races.pkl で再現）と合うか。round4 の L（ラウンドで分けない、26.7／42.6／65.5%）との差も PR に書く。`sparse_cell` のレースを除くので件数は少し減る。`data-accuracy-verifier`
  - 結果（2026-11-24、窓口が本番の読み取り専用の SQL で照合）: 夜のジョブの値（accuracy_cache、def gapband-r-v1、11/23 17:32Z）と表から SQL で出し直した値が5つとも完全に一致。low 21,027件・27.2%、mid 32,169件・43.4%、high 22,071件・65.7%、sparse 28件、全体 75,295件・45.4%。design-reviewer の値との差は件数 −3・−9・−16（0.1%未満）で、率は3段とも一致。low < mid < high。SQL は窓口の共有ノート boa822-verify-30-34.sql.md

## PR-6 /today・SNS 企画（plan §5・§7 の 6）

- [x] **31. 前提: BOA-851 がマージ済み**（同じ `pickFeatured` を触る。#1455、2026-10-13）
- [x] **32. オーナー: 156 を適用**（JST 05:20〜05:40 と 06:30・08:00 の前後を避ける）。事後（Claude が読み取り）: 3列・CHECK・anon の SELECT
  - 結果（2026-11-24）: オーナーが db-apply で適用し、窓口が読み取りで確認した（3列 in_caution_level text・in_caution_n integer・in_caution_pct smallint、CHECK は validated、anon の SELECT は true）。APPLIED.md の 156 の行は別に直す
- [ ] **33. `generate-morning-digest.js`**: `fetchInCaution`、`in_caution_pct`・`in_caution_n`・`in_caution_level` を書く（`OPTIONAL_ROW_COLUMNS`）。`MORNING_DIGEST_IN_CAUTION = false` の間は注目レースと SNS のネタは旧の値のまま。`unchangedRows.js` の比較に3列を足す。inCaution が全レース null の日に注目レースが0件になること、06:30・08:00 の再実行で埋まるか（再実行の条件 `cronWrapper.js:468-474` が「注目レース0件」を不完全と見るか）を確かめる
  - 2026-11-24（#3325、マージ待ち）: `MORNING_DIGEST_IN_CAUTION = false` は `scripts/lib/morningDigestSummary.js`。156 が未適用でも、列が無いエラーのときはマイグレーションのグループごとに列を除いて書く（131 の `motor_race_count` は書き続ける）。全レースで値が無い日は、定数が true なら注目レースが0件になる（試験あり）。再実行では埋まらない。`incomplete` を返すのは完全性チェックだけ（`cronWrapperParts.js:366`）で、旧の指数でも同じ動き。直すかは公開の前に決める。`unchangedRows.js` は numeric の列だけを扱い、3列は smallint・integer・text なので足していない
- [ ] **34. 注目レースの選び方の比較**（2026-11-24: 30 と同じく、窓口が本番の読み取り専用の SQL で回す。SQL は保存した上位25件の逃げしか見えないので、26位以降の候補は dry-run でしか比べられない）: `MORNING_DIGEST_IN_CAUTION = true` で過去7日分を dry-run し、入れ替わる注目レースの件数と例を PR に書く。変わり方が大きければ Orchestrate に返す（2026-10-13 Orchestrate）
  - 結果（2026-11-24、窓口が SQL で照合）: 旧の選び方の再現は7日中7日で保存した注目レースと一致（SQL の作りは生成と合う）。注意度で選ぶと7日中4日が入れ替わる（11/17 は逃げ→逃げ、11/18・21・23 は逃げ→まくり）。1位は新がまくり4・逃げ3、旧は逃げ6・まくり1。注意度の欠けは 11/20 の1件だけ。まくりに寄るので、オーナーに返した（窓口の推奨: 公開は AI タブから、MORNING_DIGEST_IN_CAUTION は false のまま1週見てから別に決める）
- [ ] **35. `DigestRaceCard`・`FeaturedRaceCard`** の表示（フラグの側。`in_caution_*` が無い過去の行は欄を出さない）
  - 2026-11-24（#3329、マージ待ち）: 注目レースは「イン崩れ注意度 N%」＋段の札＋件数、カードのフッターは「イン崩れ注意度 ［札 N%］（全国の過去レースN件）」。準優・優勝戦でも件数をラウンドで分けたと書けない（行にラウンドの列が無い。ファン評価 P2、公開の前に決める）。/today の計測（surface `today`、task 27 の残り）も入れた（`src/hooks/useTodayCaution.js`、`e2e/today-in-caution.spec.js`）
- [x] **36. SNS 企画** `findQualifyingRaces`: 点区切りの metric、`inCaution.*` の条件は unified の行で判定。`create-campaign.js` の既定値 0.985 を外して必須に。再現テスト（standard が新しいレースでも unified で判定される）
  - 対象が無くなった: `snsCampaigns.js`・`create-campaign.js` は #1813（hq SH01 R2、使われていない作成・承認の口を消す）で消えた（2026-11-24 確認）

## PR-6b AIタブを注意度の場所にする（2026-11-24 オーナー決定）

オーナーの決定（2026-11-24、窓口の会話で直接）: 「AIタブの展開予想は本当はやめたい。龍神レーダーは分析サイトの位置付け。AIタブはイン崩れ注意度のみで良い」。続けて (1) 出現パターン（`OutcomePatternPreview`）と過去に発生した割合（`PastRateChecker`）は残す、(2) タブの名前を「AI予想」から「イン崩れ」に変える。外れの札に「展開」の主語を付ける #3305 は要らなくなる

| やること | 今 | 入れる所 |
|---|---|---|
| AIタブで展開予測・答え合わせ・旧指数を描かない | フラグの側で済み（task 20、`RaceAiPredictionTab.jsx` の `renderInCautionTab`）。中身は注意度のカード・出現パターン・過去に発生した割合 | 39（公開で本番に出る） |
| AIコピーで展開予測に触れない | フラグの側で済み（#1595、`aiCopyPrompts.js`） | 39 |
| タブの表示名「イン崩れ」 | 未 | 45（公開前、フラグの側で表示名を切り替える） |
| 本文の「「AI予想」タブ」 | `inCaution.where`（4言語）・`About.jsx` の「AI予想」タブの説明 | 45（`inCaution.where` はフラグの側でだけ出る）・38（About） |
| e2e のタブ名の期待（`AI予想`） | フラグの外の試験が名前で探している（例 `boat-vs-course-labels.spec.js`・`assist-sonar-link.spec.js`） | 39（公開でタブ名が替わる） |
| 旧の分岐と部品（`TurnPatternList`・`PredictionCard` の turn・`VolatilityDisplay`・`RaceMoodEffect`） | 残っている | 42 |
| 使っていないモデルの説明（「展開パターンに基づく」、ja common.json の safeBet・standard・upset） | 残っている | 42 |
| 生成の `turnPrediction` の計算 | plan §8 で「的中の記録として残す」 | 変えない（やめるなら新しい票） |

- [ ] **45. タブの名前**: `raceTabs.aiPrediction` の表示を、フラグの側で「イン崩れ」に替える（新しいキーを足し、フラグで切り替える。`analysisPage.tabs.volatility` と同じ形）。タブの id と URL の `?tab=aiPrediction`・GA の値は変えない（共有リンク・e2e・計測が使う）。訳は用語集 124 行の「イン崩れ」から取る: en `Lane-1 Upset`・ko `1코스 이변`・zh-TW `1號位失守`（wording-editor 2026-11-24、禁止語・誇大・保証・射幸心とも問題なし）。用語集に行を足す。タブの中の先頭の見出しは「イン崩れ注意度」と略さずに書く。375px のタブの幅は `e2e/race-tab-width.spec.js` で確かめる。`inCaution.where`（4言語）の「「AI予想」タブ」も替える
  - `About.jsx` の「各レースの詳細ページ「AI予想」タブで、毎回の的中/不的中を確認できます」は 38 で書き直す（2026-11-24 オーナー）

### 「AI予想」という言葉をやめる（2026-11-24 オーナー決定）

オーナーの決定（2026-11-24、窓口の会話で直接）: サービス名としての「AI予想」もやめる（龍神レーダーは分析サイト）。言い換えは wording-editor、title・meta は seo-marketer が判定した。
- 言い換えの軸: 画面の中の呼び名・CTA は「データ分析」「レースの分析」、タブは「イン崩れ」、中身が注意度の所は「イン崩れ注意度」。「AI分析」「AI予測」は使わない
- 場所の一覧と before/after は、窓口の共有ノートの `boa822-ai-yosou-wording-2026-11-24.md`
- (1) title・meta・OGP は「予想」を残し、「AI」だけを外す。(2) 利用規約は今は変えない。(3) ブログは本文を触らず、共通の導線（CTA）だけ直す

| 場所 | 入れる所 |
|---|---|
| タブ・タブへの案内・タブの中の空状態 | 45 |
| About・FAQ・HowToUse の文（「展開予測の的中率は約79%」とその統計カードは、展開予測の廃止に合わせて文ごと削除） | 38（フラグの側） |
| ホームの見出し・FAQ（ボット向け HTML も読む）、本日のレースの CTA、ハッシュタグ、共有の定型 | 39（フラグで隠せない物） |
| 旧モデルの説明（「新AI予想モデル」） | 42 |
| title・meta・OGP・manifest・llms.txt・記事の共通の CTA | 46 |
| 利用規約 | 47（保留） |

- [ ] **46. title・meta から「AI」を外す**（「予想」は残す。2026-11-24 オーナー、seo-marketer の推奨どおり）。BOA-822 の公開とは別の PR にし、2回に分ける。
  - 1回目（公開の後）: 会場・レース詳細の title・description、`VenueGridPage`・`RaceHistory`。案は、会場「{{venue}}競艇の予想・出走表｜本日の全レースのデータ - 龍神レーダー」、レース詳細「{{venue}}競艇 {{race}}R 出走表・直前情報・展示・イン崩れ（{{date}}）」
  - 2回目（1〜2週あけて）: トップの title・og・twitter・manifest・`useSocialMeta`・llms.txt（生成物なので生成元を直す）。案は「ボートレースの予想に使えるデータ分析が無料｜競艇 龍神レーダー」。長さで検索結果に切れないかは、出す前に確かめる
  - 出す前: GSC のページ×クエリを人が取る（ページごとの流入の数字はリポジトリに無い）。`seo-measures.json` に投入日の1行を足す。戻す基準を先に決める（目安、根拠なし）
  - 記事の共通の導線（`BlogPost.jsx` の CTA、`ContentHubCtaSection.jsx`）もここで直す。「勝率アップを目指しましょう」は外す
- [ ] **47. 利用規約（保留）**: `TermsSectionsA.jsx` の「ボートレースAI予想サービス」「予想情報」は今は変えない（2026-11-24 オーナー）。変えるなら法務の確認の後に別に。第2条の「ボートレースレース」は誤字

## PR-7 公開（plan §7 の 7・8）

- [ ] **37. 待ち: 公開の日をユーザーが決める**（計測の基準 10/11〜 を7日以上、できれば14日。GA4 の4ディメンションの登録が済んでいること）
- [ ] **38. 説明の書き直し**: About・FAQ・HowToUse・HomeAiIntro（フラグの側）、ブログ上位2記事（rough-race-signals・first-mark-prediction-guide）と翻訳版、`morningDigestCopy.js`（用語集・説明）。`content-qa`・`wording-editor`・`seo-marketer`
  - レース詳細の title（「AI予想・展開予測」）・meta も、展開予測を外す公開の PR で書き直す（#1595 ファン評価2周目 P3）
  - 2026-11-24 に足す: サイトの meta（ja common.json の site description「1マークの展開予測とイン崩れ指数を公開」）・会場の meta（「1マークの展開予測」）・ホームの帯 `IntroBanner`（`home.introBannerText`「展開予測・イン崩れ指数」）。4言語
  - rough-race-signals（GSC の入口記事。表示・クリックの実数は hq、2026-10-13 Orchestrate）: 直すのは表示名「イン崩れ指数」→「イン崩れ注意度」（63・148・152・154・156・162・210・211・218 行の現在の画面を案内する箇所。192 行の当時の実践例の名前は変えない）と、トップへの案内文の短文3つ（見出し・現行の案内文・本文末の CTA）だけ。案内文は公開後の中身（勝率差の帯の全国実績の割合、3段）で書く。過去の実践例・率・倍率は触らない（BOA-617）。修正案と照合表: `~/ryujin-marketing/out/reports/2026-10-13-audit-20261013-01.md`・`~/ryujin-marketing/out/text-audit/20261013-01/comparison.md`（「本日のイン崩れ注意度ハイライト」「同じ会場のレースと比べた相対値」は今の画面の説明なので、そのままは使わない）
  - 同記事の実践例のリンク `/race/2025-12-15-04-10` は今「レースが見つかりませんでした」。リンクを外し、日付・会場・レース番号の文字だけ残す（推奨。注記で「今の画面では開けない」と書くより短い）。同じ PR で
  - 名前が変わらないので先行もできるが、案内文の中身が公開で変わるため公開の PR で一緒に直す（2026-10-13 判断、二度書き直さないため）
  - volatility-index-fukuoka-0913（#1511、イン崩れ指数100%の実例、9/13 福岡3R。2026-10-13 Orchestrate）: rough-race-signals と同じく、公開の PR で名称（イン崩れ指数→イン崩れ注意度）と今の画面への案内文だけを直す。中身の不一致4件はブログのレーンが先に直す。当時の値（100%）や実例の記述は当時の指数として残し、今の画面の値と混ぜない。src/data/blog-posts/volatility-index-fukuoka-0913.json の title・description も確かめる
- [ ] **38b. Orchestrate に Preview の URL（`?caution=1`）と見るところを渡す**（公開の1行 PR はユーザーの判断。2026-10-13 Orchestrate）
- [ ] **39. 公開の PR**: `IN_CAUTION_PUBLIC = true`、`MORNING_DIGEST_IN_CAUTION = true`、`inCautionConfig.json` の `launchDate`、`/hit-races` の 307（`vercel.json` の `permanent: false`・`AppRouter.jsx`）・ナビ・`App.jsx`・リンク・sitemap、`verify-hit-verification-guidance.js` ほか既存の verify と e2e の期待を新しい画面に（plan §9 の一覧）、ブログ・`morningDigestCopy.js`
  - 前提（2026-10-17、#1595 のファン評価で2周続けて出た指摘の原因分析）: カードだけを先にフラグの裏に入れたので、カードの導線の先（/accuracy＝task 24、思考アシスト＝task 23）と、一覧・ホームの札（task 21・22）が旧指数のまま食い違う。公開の PR は tasks 21〜24 がすべてマージされてからにする。ファン評価・mock-diff-checker はそろった状態の Preview で回し直す
- [ ] **40. ファン評価ループ**（`.claude/rules/review-fix-cycle.md`、Preview で `?caution=1`）と `mock-diff-checker`（承認したモックとの差）を公開の PR の前に通す
- [ ] **41a. ロールバックの手順を PR に書く**: 公開の PR の revert（フラグの1行だけ戻さない）
- [ ] **41. 公開の後**: 翌々日に GA4 の4ディメンション、/accuracy の公開後の件数、`verify-in-caution-coverage.js --today`

## PR-8 掃除と旧キーの停止（plan §7 の 9・10）

- [ ] **42. 掃除**: `/hit-races` の転送を `permanent: true`（308）に、`analysisPage.tabs.volatility` の古いキーを消す。 フラグの分岐と旧部品（`VolatilityDisplay`・`VolatilityPercentileBar`・`RaceMoodEffect`・`TurnPatternList`・`PredictionCard` の turn・`HitRaces.jsx`・`hits/*`・`VolatilityAccuracyChart`・`VolatilityAccuracySection`）、`src/utils/turnPrediction.js`・`volatilityLevel.js`、使わない i18n キー（4言語）、`calculate-unified-volatility-accuracy.js`（`calculate-accuracy.yml` の手順）、`todays-volatility-digest.js`、`verify-volatility-accuracy-heading.js`・`suiteVolatilityLevel`・`suiteTurnPrediction`
- [ ] **43. 旧キーの停止**: 生成の `calculateVolatilityComposite` と90日の分布の読み込みを外す。digest の `fetchVolatility`・`volatility_percentile`、`verify-morning-digest-sns-topic.js`、`find-video-worthy-race.js`・`AnswerCheckHookCM.jsx` を `inCaution` に。grep（`volatilityPercentile`・`volatilityComposite`・`volatilityReasons`・`volatility_percentile`）で読み手が残っていないことを確かめてから
- [ ] **44. ADR-0095 を採用にし、ADR-0012 の状態に「一部置き換え済み（ADR-0095）」を書き足す**
