# オーナーが使って気づいたこと

オーナーがサイト・モックを実際に触って気づいたことと、その後の対応の台帳。1行に「日付・画面・気づいたこと（原文に近く）→ 対応（状態）・出典」。画面を変える前に読み、同じ指摘を繰り返させない。動画の評価は [fan-reactions.md](fan-reactions.md)・[video-composition.md](video-composition.md)。書き方は [README.md](README.md)。

## 本日のデータ一覧（/today）
- 2026-09-24 実装をローカルで見て「次のセクションに届くまでのスクロールが長い」「1枚が高い」→ カードを既定で要約だけにし、詳しい数字は ▼ で開く・一覧は上位6件＋「もっと見る」に改訂（済、docs/design/morning-data-digest/screens.md「実物を見ての改訂」）

## 龍神ソナー（類似レース）
- 2026-10-03「文言が分かりにくい」「『AIの見立て: 勝負を分けそうなのは？』が何を表すか分からない」「名前は『類似している過去レース』『類似している過去レースの傾向』に」→ Version 13（済、docs/design/analogy-finder/verification-round5.md）
- 2026-10-03「『AIの見立て: 6艇に差をつけた材料』は分かりにくい。知りたいのは枠ごとに1着／2着以内／3着以内になるには何が効くか（例: 5号艇で1着になるには）」「当初の v6 が一番わかりやすい」→ Version 14（済、docs/design/analogy-finder/verification-round6.md）
- 2026-10-09 差がつく材料の比べ方は「表というか七角形で比較できた方が、ぱっと見でわかりやすい」→ 七角形に（済、docs/design/analogy-finder/sonar-tab/fan-panel-heptagon.md）
- 2026-10-09「これはなんで全艇で重ねないの？重ねた方がどれが良いかぱっと見わかる」→ 6艇重ねを最初の表示に、主役＋2艇へ切り替え（済、#1340、docs/design/analogy-finder/sonar-tab/fan-panel-heptagon-all6.md）
- 2026-10-09「3つのタブすべてで、セクションごとの余白が無くて読みづらい」→ 内部タブの中身に余白と見出しの階層（済、#1337、docs/design/analogy-finder/sonar-tab/uiux-review-spacing.md）
- 2026-10-10 着順の流れの内訳に「集めたレースの全体の出目の中でどれくらいの割合か」が要るのでは → 内訳の行は全体の割合・件数、見出しに帯が全体の何%かを1回（済、BOA-816 #1348、docs/design/analogy-finder/sonar-tab/fan-panel-flow-trifecta.md）
- 2026-10-04 v10〜v15 に「楽しくない」「当初のモックから離れた」→ 予想のブラックボックスでなく過去データでどうだったかを見せる価値に合わせ、寄与度を補助に下げて過去の実績の値を主役にした v16 で承認（済、docs/design/analogy-finder/mock/APPROVED.md、memory boa271_mock_v16_approved_2026_10_04）
- 2026-10-09 公開後に4点（長押ししづらい・文字が多い・別タブ・言葉1つ）を直したが、4点とも承認したモック v16 の時点で同じ形だった。静止画のモックでは触った感じ・スクロールの長さが分からない → 画面が変わるものは Preview を実機で触ってもらってから公開する（済、memory feedback_release_after_user_touches_real_thing）

## 思考アシスト
- 2026-10-11 軸タブで3号艇・3着以内を選んだのに「1号艇が3着以内に来たのは」と1号艇の数字が出る。2着以内・3着以内は流しをどれにするかの判断に使いたい → 6艇の並びを出す案、さらに相手レンズを作った（済、docs/design/thinking-assist/boa831/fan-panel-nagashi.md）
- 2026-10-11「やはり軸タブとは別で分けた方が良い」→ 新しいレンズ「相手」（軸｜相手｜展開｜機力｜買い目）（済、docs/design/thinking-assist/boa831/fan-panel-aite-v3.md）
- 2026-10-12 2〜6号艇を軸にしたときの2着の案に「3着は出さなくても良いが、龍神ソナーの類似レースのサンキー図へのリンクがあった方が良い」「（最初の軸の艇は）ボートレースファンに議論させた？」→ 3着の列は外し、よく出た3連単と龍神ソナーへの導線。最初の軸はファン4人で議論し直した（承認済み・実装待ち、BOA-845、docs/design/thinking-assist/boa831/axis-any-mock/APPROVED.md・fan-panel-boa845-q2.md）
- 2026-10-12「数字の意味が分からないところがある」→ どの数字かを洗い出し中（未、オーケストレーターの会話 2026-10-12）

## 競合との比較
- 2026-09-14 日和との比較で小標本の注意印（n<30）を強める案に「どうでも良い」「日和は情報が多すぎて視認性が悪いし直感的にわからない。龍神レーダーでは適宜グラフ化している」→ 改善の順は ①数値の表をグラフにする ②一言の要約＋詳細を開く ③n・信頼区間などの厳密さは補助（方針、memory feedback_ui_visualization_over_statistical_rigor）

## 事業の方針
- 2026-07-28「予想モデルの精度で客を集め続けるのは難しい」→ 国内は判断材料を出す分析ツールサイトへ。予想精度を客寄せとして強める提案はしない（方針、memory boa_pv_plateau_diagnosis_2026_07）
- 2026-10-05 振興会には問い合わせず、取得量に上限を置き、生データを再配布しない前提で運用する（方針、memory ai_agent_era_strategy_2026_10_05、docs/proposal/ai-agent-era-strategy.md）
- 2026-10-05 Stripe は日本の規約でギャンブル予測のサービスを禁じているので課金に使えない（要確認、memory project_ai_multi_venture_ops_2026_10_05）
