# 思考アシスト tasks（BOA-430）

- 入力: [spec.md](./spec.md)（FR-1〜11・FR-3a、D-1〜D-38）、[screens.md](./screens.md)、[plan.md](./plan.md)、承認モック [mock/APPROVED.md](./mock/APPROVED.md)（v7。写しは [mock-v7/index.html](./mock-v7/index.html)）
- PR の単位: 下の「PR」ごとに feature ブランチを切り、master 向けに出す。各 PR は `npm run build`・`npm run verify:ci` が緑。画面を変える PR は E2E（smoke・layout）も緑
- 機能フラグ（`?assist=1`）の後ろで進める。公開（`THINKING_ASSIST_PUBLIC = true`）はこの tasks の範囲外（spec U-4・U-6、公開前にユーザー）
- 数字の出し方・文言はモック v7 に合わせる。モックと違う形にしたくなったら、実装せずオーケストレーター経由でユーザーに出す

## 事前（`/step4` の前）
- [x] T-pre1 （PR #1299）マイグレーション 134 のファイル（`134_venue_technique_period_stats.sql`・`134-runbook.md`・APPLIED.md の行）だけを docs の PR で先に master に入れる（本番は適用済み。番号の衝突を防ぐ。design-reviewer 指摘16）
- [x] T-pre2 （D-37・D-38 と screens「操作できる要素の名前」を書き足し、受け入れ E2E 94件・固定データ e2e/thinking-assist-fixture.js。Codex ③ の F05〜F11 を要件に書き直した）spec U-17・U-18 のユーザーの回答（D-37）を spec・screens に反映した後で、受け入れ E2E を書き直させる（acceptance-test-writer に spec・screens のパスだけを渡す）。あわせて固定データ `e2e/thinking-assist-fixture.js` を作る: 徳山10R（2026-10-06）の facts・similar（racecard）・scenario（NC・NCR・NA・VA:18）を本番から取り、「展示後の段が無い」状態も入れる（design-reviewer 指摘7・8）

## PR0 会場の決まり手の期間の表（ADR 0088、マイグレーション 134）
事前条件: 134 は本番に適用済み（2026-10-07、APPLIED.md）

- [x] T0-1 （PR #1301 マージ済み c904fdee7。/code-review 6件・Codex ④ 2件・data-accuracy-verifier 不一致0）`scripts/daily/update-winning-technique-stats.js` の既存の処理の後に、会場ごとの90日・365日の集計を足す
  - 365日のうち 2025-12-02 以前は `kb_archive_races`（has_result かつ technique あり）を読む。除外は既存と同じ（中止・不成立・1着なし・決まり手なし）
  - 24会場×2期間を必ず書き直す（その期間にレースが無い会場は行を消す）。90日と365日は会場ごとに1回の書き込みで入れる（片方だけ残るのを防ぐ）
  - 新しい部分の書き込みの失敗は投げて exit 1（既存の書き込み部分は `continue` で握りつぶしているが、新しい部分ではそうしない）
  - 2025-12-02 は新しい表にも12件（長期の表と重複）あるので、新しい表は 2025-12-03 以降だけを読む
  - 期間に 2025-12-02 以前が入るのに長期の表が0件なら失敗にする（モックの 2,196件の誤りの再発を防ぐ）
  - 想定外の決まり手（例: 新しい表の「逃げ抜き」1件）はそのまま行にする。画面で「その他」に寄せる
  - 集計の部分は純粋関数に分け、`scripts/maintenance/verify-venue-technique-period.js`（`verify-registry.json` に `ci`）で固定データを数えて確かめる
    - 長期の表と新しい表の境目
    - 総数＝決まり手の件数の合計
    - 90日 ⊂ 365日
    - 2025-12-02 の重複を数えない
  - 鮮度の検査: `last_updated` が2日より古い行があれば失敗にする検査を、既存の data-health か verify に足す
  - `data-accuracy-verifier` で実データと照合する（徳山 365日 2,592件・逃げ 1,516、90日 612件・逃げ 339（2026-10-05 時点）、全会場の総数）
- [ ] T0-2 （ユーザーに手動実行を依頼済み、オーケストレーター経由）マージ後に、ワークフローを1回手動で動かすようユーザーに依頼する。約290行と、徳山の365日の逃げ 1,516／2,592・90日の逃げ 339／612（2026-10-05 時点。動かした日で変わるので桁と比率で確かめる）を読み取りで確かめる（APPLIED.md の 134 は適用済みに直してある）

## PR1 下ごしらえ（既存の挙動は変えない）
- [x] T1-1 （PR #1305）`src/utils/oddsMath.js` を作り、`RaceOddsListTab.jsx` の `compositeOdds`・`formatOdds`・`latestSnapshotWith` を移して export する。`RaceOddsListTab` は import に変えるだけで、計算は変えない（Codex U03）。既存のオッズ一覧タブの E2E が変わらず通ること
- [x] T1-2 （PR #1305）`src/config/featureFlags.js` の `readPreviewFlag` を、クエリ名とキーを引数で受ける形にまとめる。`THINKING_ASSIST_PUBLIC = false`・`?assist=1`（`boatai-user:thinking-assist-preview`）・`isThinkingAssistEnabled()` を足す。アナロジー・ファインダーの挙動は変えない
- [x] T1-3 （PR #1305）ルート
  - `src/config/languages.js` の `isFullyTranslatedPath` に `/race/{id}/assist` の例外を足す（ja 専用。hreflang・言語切り替えに出さない）
  - `src/AppRouter.jsx` の `LocalizedRoutes` に `race/:raceId/assist` を、`/today` と同じく全言語に登録する（言語付きの URL は既存の仕組みで ja へ移る）
  - `pageViewPath` は変えない（/assist は元から別のパスとして数えられる）
  - 公開まで noindex（meta robots）
  - `docs/design/thinking-assist/content-index.json` に保留の印を置く（session-start-check の missingContentIndex を毎回出さないため。中身は T7-3）
  - 画面は「準備中」の空のページでよい（中身は PR2 以降）
- [x] T1-4 （PR #1305）`getVenueTechniquePeriodStats(venueCode)` を `supabaseDataService.js` に足す（`withCache`）。失敗（表が無い 42P01 を含む）は投げ、空（0行）とは区別する。空の結果はキャッシュに残さない。画面は空なら決まり手の節を出さず、失敗なら「表示できませんでした」

## PR2 データとモデル（画面はまだ出さない）
2026-10-07 分け直し: PR2 は純関数と検査だけ（T2-2 の一部・T2-3・T2-4）。データ取得のフック（T2-1）と文言・辞書（T2-5）は、使う画面と一緒に確かめられるよう PR3 に移す。T2-2 の残り（印、展示前の文の出し分け、今節の各走の表と今節より前の5走）は使う PR4・PR5 で足す
- [x] T2-1 （PR3 #1308）`src/hooks/useThinkingAssistData.js`: plan「全体の構成」の3段の取得
  - 1段目: `getPredictions` の対象レース（出走表・気象・`raceStage`）・オッズのスナップショット。これで図を描く（N-5）
  - 時点は DB の展示が6艇そろったかで決め、風速の区分は DB の風速から `windBand`。v16 の `status`・`exhibition.wind_band` は v16 の部分の出し分けだけに使う（D-36 (1)）
  - 1.5段目: v16 facts（出走表の段と展示後の段）。届いたら `today.scope_keys["1"]` の NC で、優勝戦・準優勝戦の日は NCR と NC の両方で scenario を取る（D-37）（API は `scope=NC` を受け付けない）
  - 2段目: similar・scenario（NA・VA）・展示・オリジナル展示・整備・体重・勝ち決まり手・前検・会場の特徴・会場の決まり手の期間
  - 3段目: 深掘りの艇の `getRacerScopedRaceStats`。6艇比較のときは6艇
  - 部分ごとに `{status, data}`。失敗は部分だけ（FR-11）
- [x] T2-2 （PR2 #1307・PR3 #1308）`src/utils/assistModel.js`（純粋関数）
  - レンズごとの図のモデル（数字は1艇2個まで、N-2）
  - 印（差がつく材料の一番・F・凹みの手がかり・攻め手）
  - 最良の Set（`bestOf`、spec FR-3a の向きと桁）
  - 級の並び（選んだ艇を固定、D-31）
  - 堅い？荒れる？の3段階（`wilsonInterval`、D-21）
  - 類似レースの集計（`neighbors` の先頭 min(400, `n_layer`) 件、`aggregateNeighbors`。万舟は `payout_3tan >= 10000`。D-35・ADR 0087）。表示する件数は `aggregateNeighbors` の n（着順が無効の件を除く）、万舟の分母は `payout_3tan` が null でない件（D-36 (3)）
  - 優勝戦・準優勝戦の日の今節の点の扱い（F03・D-34）。判定は v16 の `today.round`、無ければ出走表の `raceStage`（D-36 (4)）
  - 展示前の文の出し分け（F04）
  - 会場の決まり手の「最近↑／↓」（直近90日 対 365日−90日のぶれ幅が重ならないときだけ。印の行の2つの割合も返す。D-35・D-37）
  - 優勝戦・準優勝戦の日の範囲の選択（NCR、30件未満・キー無しは NC に戻して矢印なし・「件数少なめ」。D-37）
  - 今節の各走の表（`buildMeetResults`・`SCORE_POINTS`。今日の走は点に入れない、D-29）
- [x] T2-3 （PR2 #1307）`oddsMath.js` に足す: 3連単の人気順（120通りの昇順）・点数（同じ艇の重複を除く）・均等／均等払戻の配分（100円単位の切り捨て）・余り・最低額の判定（予算 < 100円×点数なら配分を出さない、F05）・丸めた後の倍率の幅（F06）
- [x] T2-4 （PR2 #1307）再現テスト
  - `scripts/maintenance/verify-odds-math.js`（T1-1・T2-3。手計算の固定の値）
  - `scripts/maintenance/verify-thinking-assist-model.js`（T2-2）
  - どちらも `verify-registry.json` に `ci` で登録する
  - 類似レースの固定データに、着順が無効の件・払戻 null の件・層 > 400 の件を入れる（D-36 (3)）
  - 今節より前の5走の固定データに、今節の走・表示中のレースより後の走・艇番と進入コースが違う走を入れる（D-36 (10)(11)）
  - v16 が無い準優勝戦（`raceStage` だけで判定）の例を入れる（D-36 (4)）
  - 固定データはモックの徳山10R（2026-10-06）の値。v16 の今節の平均着順点 8.57＝60点÷7走、全国・級の並びが同じ 3,276件・1,074・713 との一致を含む
- [x] T2-5 （PR3 #1308・PR5 #1343）`src/data/thinkingAssistCopy.js`（ja 専用の文言・用語の「?」。表・絵で出すもの（類似レース・全国・級の並びが同じ・全国の全レース・今節の平均着順点・平均ST）は構造化データで持つ）と、`src/data/theoryCatalog.js`（セオリーカードの辞書。screens「セオリーカードの最初の組」、TC-T4 は「F持ちの選手」D-34）

## PR3 画面の骨格（軸レンズで1レースを描けるところまで）
- [x] T3-1 （PR3 #1308）共通の部品（`src/components/race/assist/`）
  - `BottomSheet`: role="dialog"、Esc・背景で閉じる、開いた要素にフォーカスを戻す
  - `BaseBar`: 基準つきバーと普通のバー。数字は押すと開く（D-32）
  - `ScopeTable`: 「数え方は2つ」の条件の表を畳んだもの
  - `ClassLineup`: 級の並びの絵
  - `ThinkingAssist.css`: トークンだけ、`!important` 禁止
- [x] T3-2 （PR3 #1308）`AssistHeader`（会場・R・ラウンドと「傾向 ›」・気象・水温・観測時刻・潮の「傾向 ›」・時点・オッズの時刻・龍神ソナーへ）と `RoughCard`（小さいバー2本＋級の並び＋件数）
- [x] T3-3 （PR3 #1308）`LensBar`（レンズ・問い・使い方の1行・ガイドの切り替え。上に固定）と `RaceLaneBoard`（案②レーン。苗字・級・横軸・良い方の札・数字2個・印・何着の候補・最良の金枠。6艇比較の2段目と「× 図を戻す」）
- [x] T3-4 （PR3 #1308）`BetFooter`（固定フッター。点数・合成オッズ（理論値）の「?」）と `MarkSheet`（1着/2着/3着×1〜6）
- [x] T3-5 （PR3 #1308）`ThinkingAssistPage`
  - `useReducer`（plan「状態」）
  - v16 の状態の文言（FR-11）
  - 免責文
  - 1段目のデータで図を出す（N-5）
  - `e2e/smoke.spec.js` に「フラグ無しでもページが開く・図が出る」を1本
  - `e2e/layout.spec.js` の `PAGES` に足す

## PR4 レンズの要約と深掘り
- [x] T4-1 （PR4 #1335）`LensSummary`
  - 軸: 1号艇の1着・級の並び・件数が違う理由・差がつく材料の札
  - 展開: 本番のスタートの形・もし2コース凹みになったら・進入・類似レースの決まり手
  - 機力: 展示の表（金枠・凡例・札）・モーター2連率の棒
  - 買い目: `BetSummary`（配分・最下行・注意）・万舟・類似レースでよく出た3連単の上位3組と件数
- [x] T4-2 （PR4 #1335）`BoatDeepDive`（数えた値の札・選手の値・平均ST の札・今節の平均着順点と着順の並び・差がつく材料と級の並び）と `RunsTable`（「{n}コースで走ったとき」は進入コースで数える（D-36 (11)）。今節より前の5走は、今節の走と表示中のレースより後の走を除いてから5走（D-36 (10)）。今節の各走: 日・R・進入・ST・展示・着・点、今節より前の5走、着順の色、今節タブへの導線）。3段目の取得は開いたときに

## PR5 シートとガイド
- [x] T5-1 （PR5 #1343）`TheorySheet`（条件・起きやすいこと・今日当てはまる／当てはまらない／展示の後に分かる・過去レースの傾向（実測 or 準備中）・判定の札）、`GlossarySheet`（表・絵・箇条書き）、`VenueSheet`（水質・型・1号艇の1着・決まり手の直近1年＋直近90日と「最近↑／↓」・会場ページへ）
- [x] T5-2 （PR5 #1343・#1346）`GuideOverlay`（5段・光らせ・吹き出しは重ならない側・⑤以外でフッターを隠す・閉じる/戻る/次へ。各段1文、展示前は④を出し分け）

## PR6 上部の切り替え（D-22）
- [x] T6-1 （PR6 #1345）`AssistViewSwitch` を思考アシストと `RaceDetailPage`（`page-header` の直後、タブの外）に置く
  - フラグがあるときだけ出す
  - 選んだ方を `boatai-user:race-view` に残す（try/catch）
  - "assist" ならレース詳細を開いたときに思考アシストへ移る。移すのは ja で、URL に tab・boat のクエリが無いときだけ。`navigate(…, {replace: true})` で履歴を置き換え、RaceDetailPage がデータを取り始める前に判定する（D-36 (6)）
  - 受け入れ: 保存値 assist で tab・boat 付きの URL を開くとレース詳細のまま／ブラウザの戻るで切り替え前のレース詳細に戻らない（置き換え）／非 ja では移らない
  - RaceDetailPage は翻訳対象なので、切り替えの文言は4言語のキー（`raceDetail.assistSwitch.*`）を同じ PR で足す
  - ほかの言語では切り替えを出さない（思考アシストは ja 専用）

## 検証と完了
- [ ] T7-1 受け入れ E2E（`e2e/acceptance/thinking-assist.spec.js`、acceptance-test-writer が spec・screens から書いたもの）をローカルで実行して全部通す。対応表（FR-9）の22行を、実装の上で3タップ以内か確かめる（N-3）
- [ ] T7-2 `/code-review`、`mock-diff-checker`（承認モックとの差。PR の CI が緑の後）、ファン評価ループ（新しいページなので「ファン評価あり」。`.claude/rules/review-fix-cycle.md`、上限3周）。修正した指摘は再現テストで固定する
- [x] T7-3 （#1347）`docs/design/thinking-assist/content-index.json` を作る（新機能。`.claude/rules/content-ops.md` フローA-2）。公開前なので、展開は公開の判断の後
- [ ] T7-4 完了監査: この tasks の全チェックボックスと、コミット・本番の実測（会場の決まり手の表の行数、例のレースの画面の値）を突き合わせる
