# 画面の決まり（サイトの UI/UX）

龍神レーダーのサイトの画面。デザインの正本は `docs/reference/design-system.md`・`.claude/rules/mobile-ui.md`・`.claude/rules/component-reuse.md`。オーナーが使って気づいたことは [user-insights.md](user-insights.md)。書き方は [README.md](README.md)。

## 幅・余白
- PC のタブの横幅は3段: 6艇を列に並べる表は全幅／図とリストは最大1200／文章と1行1項目は720。どの段も左端はタブの列（1440px で x=24、1920px で x=184）にそろえ、中央寄せにしない（2026-10-11、BOA-820、PR #1382、e2e/race-tab-width.spec.js）
- 余白はモバイル(480px以下)で margin・padding 0.75〜1rem、gap 0.5〜0.75rem。デスクトップは margin 2〜2.5rem、padding 1.5〜2.5rem、gap 1〜1.5rem（.claude/rules/mobile-ui.md）
- 内部タブの中身を包む要素にも区切りの余白を付ける。外側の gap は中まで届かない（2026-10-09、龍神ソナーの3タブ、docs/design/analogy-finder/sonar-tab/uiux-review-spacing.md、#1337）
- 横あふれは表示項目を削らずデザインで解く（ユーザー指摘、memory feedback_dont_remove_info_for_layout）

## 押せる部品・選択の見た目
- 押せる部品はスマホで高さ44px以上。見た目を小さくしたい「?」等は見た目16px のまま押せる範囲を24×24に広げる（src/components/race/TermHintButton.css の ::before、e2e/race-tab-width.spec.js）
- 選んでいない項目が選ばれているように見える見た目にしない（塗り・太字・下線を選択中だけに使う）（2026-10-11、オーケストレーター依頼）
- 押せる1行を持つトーストは6秒・マウスを重ねている間は消さない・閉じるボタン付き。2秒では読んで押せない（2026-10-11、BOA-832、src/components/Toast.jsx）

## 色
- ページ背景に直接乗る文字は意味トークン（--text-primary 等）を使い、ダークモードでも確かめる（2026-08-25 の不可視見出し、.claude/rules/component-reuse.md）

## 情報の置き場所
- 結論を先に出す。表・図より上に一言の結論、詳しい数字は下か深掘りへ（2026-10-11、オーケストレーター依頼、思考アシスト・龍神ソナーの共通方針）
- 1つの場所に2つの問い（1着と2・3着）を混ぜない。選んだ艇と出る数字がずれて見える（2026-10-11、ユーザーの指摘、docs/design/thinking-assist/boa831/fan-panel-aite-v3.md）
- 流しを組む順は「軸（1着）→相手（2・3着）→買い目」。画面の並びもこの順にする（2026-10-12、docs/design/thinking-assist/boa831/fan-panel-aite-v3.md）
- 軸の艇を切り替える表は、全艇を同じ範囲（会場の全レース）にそろえる。艇ごとに範囲が違うと件数の桁が変わって比べにくい（2026-10-12、docs/design/thinking-assist/boa831/fan-panel-boa845.md、axis-any-mock/APPROVED.md）
