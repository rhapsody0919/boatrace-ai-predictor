# 展開レンズの作り直し（承認モック v2）の実装の引き継ぎ

承認: `mock/APPROVED.md`（2026-10-12）。spec D-47・「統計検証」の節は docs ブランチ `feature/boa-430-thinking-assist`（42dff7074）。この文書は実装に入るレーンのためのもの。

## 例のレースの値（本番 API、2026-10-06 徳山10R、展示後）
- 平均STの手がかり: d2_slow01 が当てはまる → 2コース凹み 13%（65/501）、当てはまらないとき 5%（全国 NA: 13.3% / 6.4%）
- 攻める艇 3号艇は展示4位（展示タイム 1号艇6.84・2号艇6.84・3号艇6.89・4号艇6.83・5号艇6.90・6号艇6.89 → min 順位 2,2,4,1,6,4）
- NC 範囲の 2コース凹み（枠なり161件）: 攻める艇の1着 by_exh top 14/61・mid 13/53・low 9/47。1号艇の逃げ b1_by_exh top 33/78・mid 15/40・low 15/43。決まり手 att_makuri_of_win 15/36・att_makurizashi_of_win 17/36・att_sashi_of_win 2/36
- 全国（NA）の 2コース凹み: 攻める艇の1着 top 2356/9753・mid 1639/9325・low 1013/7819。1号艇の逃げ top 8429/14191・mid 4097/8043・low 2163/4663
- オリジナル展示（徳山: 一周・まわり足）: 1号艇が両方とも6艇で一番（一周 37.31・まわり足 11.49）

## 今のコードの場所
- 図: `src/utils/assistModel.js` の `boardModel` の `lens === "flow"`（展示後は `exh_st`）。札は `src/pages/ThinkingAssistPage.jsx` の `marks`（`hintMark` に割合が入っている）
- 要約: `src/components/race/assist/LensSummary.jsx` の `FlowSummary`（形の箱・もし{形}・進入・類似レースの決まり手）
- 形・手がかり: `src/utils/assistSummary.js` の `hintSummary`・`formSummary`（`topExacta`・`topTrifecta`）・`entrySummary`
- 展示順位の区分: `src/utils/analogyScenario.js:307`（1〜2位 top・3〜4位 mid・5〜6位 low）。龍神ソナーは `src/components/race/analogy/AttackTable.jsx` で同じ値を出している
- オリジナル展示: ページは機力レンズ用に `data.original` を取っている（`PowerSummary`・`exhibitionTable`）
- 全国の値: `data.scenario.na`（NA 範囲の scenario）は取得済み

## PR の分け方（承認範囲の表のとおり）
- PR-1 図と結論: 展示後も平均ST、展示{r}位の札、手がかりの札から割合を外す、図の上の結論2行、展示ST の6艇比較の見出し「展示ST（本番のスタートとは別）」
- PR-2 中身: 決まり手の内訳、3連単を外し2連単の見出しに{形}、今日の展示を入れると（区分の割合・全国の値・30件未満は件数だけ）、進入の全国 93.3%（3,602/3,862）、オリジナル展示の周回・まわり足の印

## 守ること
- 1艇の数字は2個まで（図は点の上の値と展示{r}位）
- 中位（3〜4位）から強い意味を読ませない（全国の差の1行で「3〜4位はほかとの差が出にくい」）
- オリジナル展示は直線・秒数・形ごとの言い回しを出さない
- 言葉は `src/data/thinkingAssistCopy.js` の既存の型にそろえる（hintMark の「★平均STの手がかり（{形}）」、powerTheory.x1 の「1号艇は展示が速く出やすい」）。画面の文に日付を入れない
- UI/UX デザイナー役・言葉役のレビュー（v1 への指摘）はモック v2 に反映済み。実装後はモック比較とファン評価1周
