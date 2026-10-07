# 思考アシスト tasks（BOA-430）

- 入力: [spec.md](./spec.md)（FR-1〜11・FR-3a、D-1〜D-35）、[screens.md](./screens.md)、[plan.md](./plan.md)、承認モック [mock/APPROVED.md](./mock/APPROVED.md)（v7。写しは [mock-v7/index.html](./mock-v7/index.html)）
- PR の単位: 下の「PR」ごとに feature ブランチを切り、master 向けに出す。各 PR は `npm run build`・`npm run verify:ci` が緑。画面を変える PR は E2E（smoke・layout）も緑
- 機能フラグ（`?assist=1`）の後ろで進める。公開（`THINKING_ASSIST_PUBLIC = true`）はこの tasks の範囲外（spec U-4・U-6、公開前にユーザー）
- 数字の出し方・文言はモック v7 に合わせる。モックと違う形にしたくなったら、実装せずオーケストレーター経由でユーザーに出す

## PR0 会場の決まり手の期間の表（ADR 0088、マイグレーション 134）
事前条件: ユーザーが 134 を本番に適用済み（[134-runbook.md](../../db-migration/134-runbook.md) の手順1〜3）

- [ ] T0-1 `scripts/daily/update-winning-technique-stats.js` の既存の処理の後に、会場ごとの90日・365日の集計を足す
  - 365日のうち 2025-12-02 以前は `kb_archive_races`（has_result かつ technique あり）を読む。除外は既存と同じ（中止・不成立・1着なし・決まり手なし）
  - 会場ごとに delete→insert で書く。書き込みの失敗は握りつぶさず exit 1（既存の BOA-391 と同じ）
  - 集計の部分は純粋関数に分け、`scripts/maintenance/verify-venue-technique-period.js`（`verify-registry.json` に `ci`）で固定データを数えて確かめる
    - 長期の表と新しい表の境目
    - 総数＝決まり手の件数の合計
    - 90日 ⊂ 365日
- [ ] T0-2 マージ後に、ワークフローを1回手動で動かすようユーザーに依頼する。約290行と、徳山の365日の逃げ 1,516／2,592・90日の逃げ 339／612（2026-10-05 時点。動かした日で変わるので桁と比率で確かめる）を読み取りで確かめ、APPLIED.md の 134 を「適用済み」に直す

## PR1 下ごしらえ（既存の挙動は変えない）
- [ ] T1-1 `src/utils/oddsMath.js` を作り、`RaceOddsListTab.jsx` の `compositeOdds`・`formatOdds`・`latestSnapshotWith` を移して export する。`RaceOddsListTab` は import に変えるだけで、計算は変えない（Codex U03）。既存のオッズ一覧タブの E2E が変わらず通ること
- [ ] T1-2 `src/config/featureFlags.js` の `readPreviewFlag` を、クエリ名とキーを引数で受ける形にまとめる。`THINKING_ASSIST_PUBLIC = false`・`?assist=1`（`boatai-user:thinking-assist-preview`）・`isThinkingAssistEnabled()` を足す。アナロジー・ファインダーの挙動は変えない
- [ ] T1-3 ルート
  - `src/AppRouter.jsx` の `LocalizedRoutes` に `race/:raceId/assist` を、`lng === "ja"` のときだけ足す
  - `src/config/languages.js` の翻訳済みの判定から `/race/{id}/assist` を外す（ja 専用。hreflang・言語切り替えに出さない）
  - `raceUrlState.js` の `pageViewPath` に /assist を足す
  - 画面は「準備中」の空のページでよい（中身は PR2 以降）
- [ ] T1-4 `getVenueTechniquePeriodStats(venueCode)` を `supabaseDataService.js` に足す（`withCache`）。表が無い・空のときは空を返す（エラーにしない。PR0 の前でも画面が壊れない）

## PR2 データとモデル（画面はまだ出さない）
- [ ] T2-1 `src/hooks/useThinkingAssistData.js`: plan「全体の構成」の3段の取得
  - 1段目: `getPredictions` の対象レース・v16 facts（最新の段）・scenario（NC）・オッズのスナップショット
  - 2段目: similar・scenario（NA・VA）・展示・オリジナル展示・整備・体重・勝ち決まり手・前検・会場の特徴・会場の決まり手の期間
  - 3段目: 深掘りの艇の `getRacerScopedRaceStats`。6艇比較のときは6艇
  - 部分ごとに `{status, data}`。失敗は部分だけ（FR-11）
- [ ] T2-2 `src/utils/assistModel.js`（純粋関数）
  - レンズごとの図のモデル（数字は1艇2個まで、N-2）
  - 印（差がつく材料の一番・F・凹みの手がかり・攻め手）
  - 最良の Set（`bestOf`、spec FR-3a の向きと桁）
  - 級の並び（選んだ艇を固定、D-31）
  - 堅い？荒れる？の3段階（`wilsonInterval`、D-21）
  - 類似レースの集計（`neighbors` の先頭 min(400, `n_layer`) 件、`aggregateNeighbors`。万舟は `payout_3tan >= 10000`。D-35・ADR 0087）
  - 優勝戦・準優勝戦の日の今節の点の扱い（F03・D-34）
  - 展示前の文の出し分け（F04）
  - 会場の決まり手の「最近↑／↓」（ぶれ幅が重ならないときだけ、D-35）
  - 今節の各走の表（`buildMeetResults`・`SCORE_POINTS`。今日の走は点に入れない、D-29）
- [ ] T2-3 `oddsMath.js` に足す: 3連単の人気順（120通りの昇順）・点数（同じ艇の重複を除く）・均等／均等払戻の配分（100円単位の切り捨て）・余り・最低額の判定（予算 < 100円×点数なら配分を出さない、F05）・丸めた後の倍率の幅（F06）
- [ ] T2-4 再現テスト
  - `scripts/maintenance/verify-odds-math.js`（T1-1・T2-3。手計算の固定の値）
  - `scripts/maintenance/verify-thinking-assist-model.js`（T2-2）
  - どちらも `verify-registry.json` に `ci` で登録する
  - 固定データはモックの徳山10R（2026-10-06）の値。v16 の今節の平均着順点 8.57＝60点÷7走、全国・級の並びが同じ 3,276件・1,074・713 との一致を含む
- [ ] T2-5 `src/data/thinkingAssistCopy.js`（ja 専用の文言・用語の「?」。表・絵で出すもの（類似レース・全国・級の並びが同じ・全国の全レース・今節の平均着順点・平均ST）は構造化データで持つ）と、`src/data/theoryCatalog.js`（セオリーカードの辞書。screens「セオリーカードの最初の組」、TC-T4 は「F持ちの選手」D-34）

## PR3 画面の骨格（軸レンズで1レースを描けるところまで）
- [ ] T3-1 共通の部品（`src/components/race/assist/`）
  - `BottomSheet`: role="dialog"、Esc・背景で閉じる、開いた要素にフォーカスを戻す
  - `BaseBar`: 基準つきバーと普通のバー。数字は押すと開く（D-32）
  - `ScopeTable`: 「数え方は2つ」の条件の表を畳んだもの
  - `ClassLineup`: 級の並びの絵
  - `ThinkingAssist.css`: トークンだけ、`!important` 禁止
- [ ] T3-2 `AssistHeader`（会場・R・ラウンドと「傾向 ›」・気象・水温・観測時刻・潮の「傾向 ›」・時点・オッズの時刻・龍神ソナーへ）と `RoughCard`（小さいバー2本＋級の並び＋件数）
- [ ] T3-3 `LensBar`（レンズ・問い・使い方の1行・ガイドの切り替え。上に固定）と `RaceLaneBoard`（案②レーン。苗字・級・横軸・良い方の札・数字2個・印・何着の候補・最良の金枠。6艇比較の2段目と「× 図を戻す」）
- [ ] T3-4 `BetFooter`（固定フッター。点数・合成オッズ（理論値）の「?」）と `MarkSheet`（1着/2着/3着×1〜6）
- [ ] T3-5 `ThinkingAssistPage`
  - `useReducer`（plan「状態」）
  - v16 の状態の文言（FR-11）
  - 免責文
  - 1段目のデータで図を出す（N-5）
  - `e2e/smoke.spec.js` に「フラグ無しでもページが開く・図が出る」を1本
  - `e2e/layout.spec.js` の `PAGES` に足す

## PR4 レンズの要約と深掘り
- [ ] T4-1 `LensSummary`
  - 軸: 1号艇の1着・級の並び・件数が違う理由・差がつく材料の札
  - 展開: 本番のスタートの形・もし2コース凹みになったら・進入・類似レースの決まり手
  - 機力: 展示の表（金枠・凡例・札）・モーター2連率の棒
  - 買い目: `BetSummary`（配分・最下行・注意）・万舟・類似レースでよく出た3連単の上位3組と件数
- [ ] T4-2 `BoatDeepDive`（数えた値の札・選手の値・平均ST の札・今節の平均着順点と着順の並び・差がつく材料と級の並び）と `RunsTable`（今節の各走: 日・R・進入・ST・展示・着・点、今節より前の5走、着順の色、今節タブへの導線）。3段目の取得は開いたときに

## PR5 シートとガイド
- [ ] T5-1 `TheorySheet`（条件・起きやすいこと・今日当てはまる／当てはまらない／展示の後に分かる・過去レースの傾向（実測 or 準備中）・判定の札）、`GlossarySheet`（表・絵・箇条書き）、`VenueSheet`（水質・型・1号艇の1着・決まり手の直近1年＋直近90日と「最近↑／↓」・会場ページへ）
- [ ] T5-2 `GuideOverlay`（5段・光らせ・吹き出しは重ならない側・⑤以外でフッターを隠す・閉じる/戻る/次へ。各段1文、展示前は④を出し分け）

## PR6 上部の切り替え（D-22）
- [ ] T6-1 `AssistViewSwitch` を思考アシストと `RaceDetailPage`（`page-header` の直後、タブの外）に置く
  - フラグがあるときだけ出す
  - 選んだ方を `boatai-user:race-view` に残す（try/catch）
  - "assist" ならレース詳細を開いたときに思考アシストへ移る
  - RaceDetailPage は翻訳対象なので、切り替えの文言は4言語のキー（`raceDetail.assistSwitch.*`）を同じ PR で足す
  - ほかの言語では切り替えを出さない（思考アシストは ja 専用）

## 検証と完了
- [ ] T7-1 受け入れ E2E（`e2e/acceptance/thinking-assist.spec.js`、acceptance-test-writer が spec・screens から書いたもの）をローカルで実行して全部通す。対応表（FR-9）の22行を、実装の上で3タップ以内か確かめる（N-3）
- [ ] T7-2 `/code-review`、`mock-diff-checker`（承認モックとの差。PR の CI が緑の後）、ファン評価ループ（新しいページなので「ファン評価あり」。`.claude/rules/review-fix-cycle.md`、上限3周）。修正した指摘は再現テストで固定する
- [ ] T7-3 `docs/design/thinking-assist/content-index.json` を作る（新機能。`.claude/rules/content-ops.md` フローA-2）。公開前なので、展開は公開の判断の後
- [ ] T7-4 完了監査: この tasks の全チェックボックスと、コミット・本番の実測（会場の決まり手の表の行数、例のレースの画面の値）を突き合わせる
