# レース詳細ページのスマホ幅・色分け統一 tasks

plan: [plan.md](./plan.md)。PR ごとに節を分ける。各 PR は画面が変わるので、Preview URL を添えてオーケストレーター経由でユーザー確認を取る。

## 引き継ぎ（2026-10-02、最初のレーンのセッションから）

### 今の状態
- PR2a（判定の共通化・共通クラス）#1135: マージ済み
- PR1（767px 以下の余白）#1148: マージ済み
- PR2b（基本情報）#1182: ユーザー確認待ち（CI は全部緑）。ユーザーの回答はオーケストレーターから新しいセッションへ渡される。指摘があれば #1182 のブランチ `feature/race-detail-ui-basic` で直す

### 次にやること
- PR3 今節・枠別情報、PR4 モータ情報・直前情報、PR5 AI予想・オッズ・結果（下の各節。範囲は spec の FR-4〜FR-6）
- PR ごとに新しいブランチを `origin/master` から切る。PR2b がまだマージされていなければ、PR2b のブランチから切って積む（PR2b の docs と `.ind-*` の使い方が前提になるため）

### 決まっていること（ユーザー承認済み。覆すときは確認を取る）
- グラフの棒・線は艇色のまま。良し悪しは値のラベルで示す（R4）
- 6艇を並べた値は最良にだけ金枠（`.ind-best`、判定は `src/utils/bestOf.js`）。同値で並んだ最良は全部光らせる。表示と同じ桁で比べる（`{ digits }`）
- 基準と比べた値は良い＝緑・悪い＝赤（`.ind-good` / `.ind-bad`）。↑↓・＋− を必ず付ける
- AI予想の展開予測の最も高い確率には金枠を付けない
- 調子の矢印は ↑緑・↓赤
- データ出走表の平均STは小数3桁
- 向きの無い値（進入・決まり手・チルト・体重・オッズ等）には色を付けない
- 決定の経緯は spec.md「色分けのルール」「決定事項」、モックは https://claude.ai/artifact/2hAMZrjFExR69EL11x4Mc5

### 注意点
- #1170（BOA-693）で `RaceWakuInfoTab.jsx` / `.css` が変わった。PR3 の枠別情報に入る前に master を取り込む
- 枠別情報の「全コース」の表（`.rwit-grid-hscroll`）は、カードの枠まで広げる対象から外してある。375px でほぼ収まり、切れが 4px 以下だと「›」が出ないため（`RaceDetailPage.css` のコメント、BOA-607 の e2e は 320px で確かめる）
- BOA-619 項目3 で、オッズ一覧レーンが `RaceDetailPage.css` の 1025px 以上のブロックを触る予定。PR5 で同じブロックに触るときは先に取り込む
- 決まり手7色（`RacerTechniqueProfileChart.jsx` の直書きの hex）のトークン化は PR5 で行う
- モータ情報の列の並び・行全体の金（`.best-motor`）の撤去は BOA-428 子1（モーターレーン）の範囲。重ねて直さない
- `.ind-*` は詳細度を上げてあり（クラス3重）、塗りは inset の box-shadow。各表の縞・文字色に負けない
- e2e のレイアウトの検査は CI（Linux のフォント）で文字幅が Mac と違う。文字幅で結果が変わる検査は、仕様の受入基準の幅に絞るか余裕を持たせる
- 開発サーバーは負荷が高いとデータが読めず、値が本番と食い違う。見た目の実測は Vercel の Preview で行う

### 新しいセッションの起点
- 読む順: `docs/design/race-detail-ui-unify/spec.md` → `plan.md` → この tasks.md
- ブランチ: PR2b がマージ済みなら `origin/master`。未マージなら `feature/race-detail-ui-basic`（#1182）を読む
- 棚卸し（全タブ×全セクションの 375px の余白・色分けの現状）: https://claude.ai/artifact/6GEzVYPNBY5oRV9FJmE3HQ

## PR2a 最良値の判定と共通クラス（先行）

- [x] T1 `src/utils/bestOf.js` を作り、集合を返す `bestOf` を export する。`raceIndicators.jsx` はこれを import する
- [x] T2 `DataRaceTable` / `RaceBeforeInfoTab` / `RaceCardDataTable` の `cellClass` を `best?.has(boat)` に変える
- [x] T3 別実装5つ＋モーター表の rankClassFor（MotorConditionChart・RacerFormChart・StPredictabilityChart・ExhibitionTimeTrendChart・RacerBoatReturnRateChart）を `bestOf` に置き換える（行の `.best-motor` は残す）
- [x] T4 `src/styles/indicators.css` に `.ind-best` `.ind-good` `.ind-bad`、`design-tokens.css` に `--ind-best-bg` `--ind-best-ring`。`.drt-best` をトークン参照に
- [x] T5 `.motor-ranking-table td.rate` と `.usage-history-rate` の一律の緑を外す。機力指数の緑・赤と小標本の黄が残ることを確認
- [x] T6 `scripts/maintenance/verify-best-of.js` と `verify-registry.json` 登録
- [x] T7 build・smoke（`td.drt-best`）・ライト/ダークのスクショ確認、PR 作成

## PR1 余白

- [x] 767px 以下のページ・セクション・カードの余白、表の広げ、`--rdp-bleed` の再計算（#1127 マージ済み。320px の再定義は削除）、短縮ラベル
- [x] `e2e/layout.spec.js` の展示情報カードの検査を 320 / 375 / 390 / 520 / 600 / 700px にし、表の横スクロールなし・ほかのカードの外側 8px を足す

## PR2b 基本情報

- [x] データ出走表の調子 ↑緑・↓赤。調子の最良は Δ>0 の艇だけ（plan §5）
- [x] データ出走表の平均STを小数3桁に（2026-10-02 ユーザー承認。2桁では5艇が同率で光った）
- [x] 6艇の横棒の最良ラベル、前期の差、得意会場の背景
- [ ] ~~条件別の列ごとの最良~~ → やらない。1艇の条件ごとの比較で、母数が違う行は「他行と比べない」と注記している（RaceBasicInfoTab の注記）。最良の金枠はその注記と矛盾する（spec「6艇比較が無いセクションは自然な基準がある値だけ」）
- [x] 埋め込み分析: 行全体の強調をセルの強調へ、Δ矢印、回収率100%、1号艇見出しの直書き、超展開データの凡例（攻めを青に）
- [ ] 選手別決まり手傾向の決まり手の色（直書きの hex 7色）のトークン化 → PR5 に回す（カテゴリの色で良し悪しは無い。ダーク用の値を決める必要がある）

## PR3 今節・枠別情報

- [x] 今節: 得点率・節内順位・前検の最良、得点率早見の rgba、STの判定文、日別の走りの着順、推移の線色（plan §6）
- [x] 枠別情報: ST考察は金枠なし（平均との差の緑・赤で示す。plan §6）、抜出の差
- [ ] ~~コース別成績・全コースの最良~~ → やらない（1艇の表。plan §6）
- [x] 受け入れE2E の FR-4 を有効化。行見出し付きの表・低いほど良い指標の「＋赤」・着順の列を扱えるよう検査を直した
- [x] ファン評価1周目の P1・P2 を修正（ST考察の金枠を外す、⚠の値に金枠を付けない、STの判定文の色の条件、金枠の注記）。前からある P2 1件と P3 は BOA-711
- [x] ファン評価2周目の P2 を修正（ST考察の差の色を ⚠ の艇に付けない、選択中の行の金枠、色の条件の注記）。前からある P2（目安内の金の左罫線）と P3 は BOA-711 に追記

## PR4 モータ情報・直前情報

- [ ] 直前情報: 展示タイムの最速印（同値は全部）、展示情報の未判定行
- [ ] モータ情報: 展示推移の縦軸。列の並びは BOA-428 子1

## PR5 AI予想・オッズ・結果

- [ ] イン崩れ注意度の直書き、確定後の検証の的中/不的中、オッズの濃淡、結果の rgba、BOA-619 の残り
