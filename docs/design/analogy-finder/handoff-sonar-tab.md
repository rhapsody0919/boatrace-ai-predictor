# 引き継ぎ: 龍神ソナーの別タブ化・文の構造化・点の押しやすさ（公開後の修正4点）

2026-10-08 のセッション「BOA-271 v16 (d) 画面を実装する」から次のセッションへ。龍神ソナー（BOA-271 v16）は #1312 で公開済み（`ANALOGY_FINDER_PUBLIC = true`）。報告・確認は SendMessage でオーケストレーター（「Orchestrate」）へ。BOA-271 は代理判定・自動マージなし、見せ方はユーザーが決める（案＋推奨で Orchestrate 経由）。

作業ブランチ: `feature/sonar-deep-link`（PR #1324、このファイルを含む）。この PR は下の 3 に合わせて作り直す（今の形ではマージしない、Orchestrate 決定）。

## 1. ユーザーの修正依頼（2026-10-08、Orchestrate 経由）
1. 類似レースのソナー（図）の点が押しづらく、長押ししづらい
2. 文字が多くて読みづらい。BOA-430 でやったように、詳細度は変えずに「絵・イメージ・構造化した文章（箇条書き・表・短い見出し＋折りたたみ等、適切なもの）」で表せる所は表す
3. 龍神ソナーを別のタブにする。位置は「基本情報」と「AI予想」の間
4. 「ふつう」という稚拙な表現を使わない（BOA-430 でも指摘済み。BOA-430 は「全国の全レース」のように、何と比べたかが分かる言い方に統一した）

## 2. Orchestrate が指定した進め方
- 画面全体の文を洗い出し（場所・今の文・置き換え案）、ファン4人（`discussion-panel`、設計に関わっていないサブエージェント）に、締切前のスマホで読む前提で優先度と「ふつう」の言い換えの候補を出させる。BOA-430 の進め方を参考にする: `origin/feature/boa-430-thinking-assist` の `docs/design/thinking-assist/fan-panel-mock-v1.md`〜`v6`
- 1 は、当たり判定の大きさ・長押しの代わりの操作（タップで固定など）の案を出す
- 3 は URL・既存の `?tab=aiPrediction` の扱い、#1312 の計測イベント、レース詳細の他のタブとの関係、4言語を整理する
- 見た目が大きく変わるので、モック（Artifact）をユーザーに見せて承認を取ってから実装する（承認画像は `docs/design/analogy-finder/mock/` に、`APPROVED.md` も）
- タブの追加はルーティング・共通部品の変更なので段階2（マージはユーザー確認）

## 3. 今のコードの事実（調べ済み）
- 節: `src/components/race/analogy/AnalogyFinderSection.jsx`。置き場所は `src/components/race/RaceAiPredictionTab.jsx`（AI予想タブの既存ブロックの下）。機能フラグ `isAnalogyFinderEnabled`（`src/config/featureFlags.js`）は残す方針
- レース詳細のタブ: `src/components/race/PredictionPanel.jsx` の `RaceTabs` の `tabs` 配列（`basic` → `aiPrediction` → …）。`?tab=` は `RACE_TAB_PARAM`、既定タブ（確定前 basic／確定後 result）ではクエリを付けない。`?boat=` も同じ仕組み。`setRaceParam` は `window.location.search` を土台に replace で書き戻す
- `RaceTabs` は非アクティブなタブの中身をアンマウントする（戻ると作り直し）
- 計測（#1312）: `analogy_section_view {race_id, analogy_stage}`（レースごとに1回、facts が出たとき）、`analogy_tab_select {race_id, analogy_tab}`（内部タブを押したとき）。GA4 の予約語（source・medium・campaign・term・content・id）をパラメータ名にしない。別タブ化で「節の表示」をタブの表示に寄せるかは要整理（既存の race_tab_select との重複）
- 点の操作: `src/components/race/analogy/SimilarSonar.jsx` 132〜163 行。点の半径は `hl ? 6 : n > 300 ? 2.4 : n > 100 ? 3.2 : 4.2`（SVG 単位）、タッチは 450ms の長押しでツールチップ、クリックで `onPick`（一覧の該当行へ）。当たり判定は円そのもの
- 「ふつう」: `src/locales/ja/common.json` の `aiPredictionTab.analogy` 配下で直書きは `analogy.scenario.hintSrcFoot` の1か所。ただし `usual` を名前に持つキー（`facts.compareLine`・`stripCap` の `usual`、`af-strip-usual` の線など）の画面上の言い方も含めて洗い出すこと
- 4言語: `src/locales/{ja,en,zh-TW,ko}/common.json`。`npm run verify:i18n`（zh・ko に「・」を使わない、ko は「N번 보트」）
- 説明・注記は `NoteList`（見出し＋1文ずつの箇条書き、12px 以上）で出している。e2e で固定済み

## 4. PR #1324（D3）の中身と、作り直すときの扱い
Orchestrate 承認済みの D3 の最小案（投稿から内部のタブへ直接来られる URL）:
- 節に固定の `id="ryujin-sonar"`
- `?sonar=facts|similar|scenario` を開いたときに1回だけ読み、そのタブで開いて節まで移動（固定ヘッダー `.app-header` の高さだけずらす）。読むだけで、押しても URL は書き換えない。レースごとに1回だけ効かせる（モジュールの `linkUsedRaces`。AI予想タブに戻るたびに飛ばないため）。直接来たときは `analogy_tab_select` を送らない
- e2e（`e2e/analogy-contribution.spec.js`）: 4言語 × `?tab=aiPrediction&sonar=similar`、不正値、戻ったとき
- 別タブ化したら、入口は `?tab=<ソナーのタブ id>&sonar=similar` の形になるはず。節まで移動する処理はタブの先頭に来るなら不要になる可能性が高い。集客レーンは当面 `?tab=aiPrediction` を投稿のリンク先にしている（hq に記録済み）ので、別タブ化後も `?tab=aiPrediction&sonar=…` で来た人をソナーのタブへ送るかを決める

## 5. 関連する状況
- 公開後の点検（10/8）: 11:30・12:25 の2回とも異常なし（API 54/54 が 200、Vercel のエラー0、GA4 に analogy_section_view が届いている。analogy_tab_select はまだ0件）。夕方にもう1回、analogy_tab_select が届くかを見る予定だった → 次のセッションで引き継ぐ。戻す条件は 502 の継続・数値の誤り・画面が壊れる。戻す PR は Orchestrate がマージする
- D4: Shorts の題材は 10/6 以降だけ（hq 確認済み）。ソナーのデータ（`analogy_v16_snapshots`）も 10/6 以降。/races の月の並びの不具合は PR #1323（CI 緑、段階0 E で Orchestrate がマージ）
- 公開後に残っている別件: BOA-798、BOA-785、BOA-787、旧 FR-1 部品の削除 PR（`isAnalogyFinderEnabled` とフラグの仕組みは残す）、コンテンツ展開（content-index を作るときに not_applicable を false に戻す）
- 手元のマシンは負荷が高い（load 200 超）と e2e が page.goto でタイムアウトする。`--workers=1` で流すか CI で判断する
