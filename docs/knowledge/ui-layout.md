# 画面の決まり（サイトの UI/UX）

龍神レーダーのサイトの画面。デザインの正本は `docs/reference/design-system.md`・`.claude/rules/mobile-ui.md`・`.claude/rules/component-reuse.md`。オーナーが使って気づいたことは [user-insights.md](user-insights.md)。書き方は [README.md](README.md)。

## 幅・余白
- PC のタブの横幅は3段: 6艇を列に並べる表は全幅／図とリストは最大1200／文章と1行1項目は720。どの段も左端はタブの列（1440px で x=24、1920px で x=184）にそろえ、中央寄せにしない（2026-10-11、BOA-820、PR #1382、e2e/race-tab-width.spec.js）
- 余白はモバイル(480px以下)で margin・padding 0.75〜1rem、gap 0.5〜0.75rem。デスクトップは margin 2〜2.5rem、padding 1.5〜2.5rem、gap 1〜1.5rem（.claude/rules/mobile-ui.md）
- 内部タブの中身を包む要素にも区切りの余白を付ける。外側の gap は中まで届かない（2026-10-09、龍神ソナーの3タブ、docs/design/analogy-finder/sonar-tab/uiux-review-spacing.md、#1337）
- 横あふれは表示項目を削らずデザインで解く（ユーザー指摘、memory feedback_dont_remove_info_for_layout）
- 横あふれはまず真因を切り分ける。CSS Grid は子の min-width:auto のせいで、折り返せない中身があると列の指定を無視してはみ出す。子に min-width:0 を付ける（.venue-grid > *）（2026-08-29、memory venue_list_redesign_2026_08_28・feedback_dont_remove_info_for_layout）

## 押せる部品・選択の見た目
- 押せる部品はスマホで高さ44px以上。見た目を小さくしたい「?」等は見た目16px のまま押せる範囲を24×24に広げる（src/components/race/TermHintButton.css の ::before、e2e/race-tab-width.spec.js）
- 選んでいない項目が選ばれているように見える見た目にしない（塗り・太字・下線を選択中だけに使う）（2026-10-11、オーケストレーター依頼）
- 押せる1行を持つトーストは6秒・マウスを重ねている間は消さない・閉じるボタン付き。2秒では読んで押せない（2026-10-11、BOA-832、src/components/Toast.jsx）

## 色
- ページ背景に直接乗る文字は意味トークン（--text-primary 等）を使い、ダークモードでも確かめる（2026-08-25 の不可視見出し、.claude/rules/component-reuse.md）
- 級・グレードのバッジに AA（4.5:1）未満の組み合わせがあった: G3 #059669 に白文字 3.76、A1 #0284c7 に白文字 4.09（BOA-339。直ったかは要確認）。e2e の color-contrast はデータの読み込みの速さで結果が変わる（2026-09-19、memory technical_e2e_depends_on_live_supabase_flakiness_2026_09_19・technical_e2e_false_failures_supabase_incident_and_load）

## 情報の置き場所
- 結論を先に出す。表・図より上に一言の結論、詳しい数字は下か深掘りへ（2026-10-11、オーケストレーター依頼、思考アシスト・龍神ソナーの共通方針）
- 1つの場所に2つの問い（1着と2・3着）を混ぜない。選んだ艇と出る数字がずれて見える（2026-10-11、ユーザーの指摘、docs/design/thinking-assist/boa831/fan-panel-aite-v3.md）
- 流しを組む順は「軸（1着）→相手（2・3着）→買い目」。画面の並びもこの順にする（2026-10-12、docs/design/thinking-assist/boa831/fan-panel-aite-v3.md）
- 軸の艇を切り替える表は、全艇を同じ範囲（会場の全レース）にそろえる。艇ごとに範囲が違うと件数の桁が変わって比べにくい（2026-10-12、docs/design/thinking-assist/boa831/fan-panel-boa845.md、axis-any-mock/APPROVED.md）
- 段（3段の札など）を色で分けるときは明るさでも分ける。橙 #b5651d・灰 #64748b・緑 #0b7a55 は相対輝度 0.19／0.17／0.15 でほぼ同じなので、真ん中の段は塗らず枠線だけにする（2026-10-12、BOA-822 visual-designer、docs/design/in-collapse-caution/mock-reviews-v1.md）
- 割合の棒の目盛りの文字（基準の値・段の境目）は棒の上の位置に合わせて置く。space-between で並べると 45% の文字が中央に来て点線とずれ、375px で折れる（2026-10-12、同）
- 一覧の段のバッジは真ん中の段も控えめに（色なし・枠線だけ）出す。出さないと「値が無い」と同じ見た目になる（2026-10-12、同）
- レース詳細は確定前は基本情報、確定後は結果のタブで開く（PredictionPanel.jsx:250）。最初に見せたい要約は基本情報に置き、確定後に結果タブでどう出すかも決める（2026-10-12、同）
- 同じ部品は幅によって中身の並びを変えない。1440px でカードとカードの中のリンクを別の列に分けない（2026-10-12、同）
- 節の進み具合で意味が変わる表示（「今日の着順で得点率はこう動く」「準優の目安は18位」）は、最終日など意味が無くなる日に出さない。進み具合で出し分けるか撤去する（2026-09-27、memory race_detail_fan_review_loop_2026_09_27）
- 公式に見せ方がある数字は公式に合わせる。得点率は公式ガイド guide-7 と同じ「行＝艇・列＝1〜6着」の早見表にした（2026-09-27、memory race_detail_fan_review_loop_2026_09_27）
- グラフは凡例なしで軸の意味が分かるか確かめる。6艇の推移グラフの軸が読めないという指摘は「前走」等の列見出しと基準線で解いた（2026-09-27、memory race_detail_fan_review_loop_2026_09_27）
- 結果の振り返りは、当たった点だけでなく外れた点も同じ扱いで出す（後知恵の偏りを避ける）（2026-08-08 ユーザー合意、memory race_page_redesign_boa168、PR #184。今の結果タブで続いているかは要確認）
- 競合（ボートレース日和）の機能はそのまま写さない。着想・優先度の材料にし、龍神レーダーの部品で作り直す。見せ方は公式・日和に寄せ（ファンが慣れている）、分かりにくい所は龍神レーダー独自の図にする（2026-07-28・2026-09-14 オーナー、memory vup_feature_analysis_skill・project_goal_data_coverage_and_ryujin_ux）

## 画面づくりの目標
- ゴールは2つ。①公式サイト・24会場の公式サイト・ボートレース日和のデータを全部出す ②見せ方を良くしてファンの役に立てる。①は必要条件で、他との違いは②で決まる（2026-09-28 オーナーが明示、memory project_goal_data_coverage_and_ryujin_ux）
- まだ出していない項目は docs/proposal/competitor-kyoteibiyori/data-coverage-comparison-2026-09-14.md で、取得の充足率は docs/design/scraping-vercel-consolidation/data-catalog.md で確かめる。充足率が低い項目は出すと値を誤る（事故率は着欄の充足率4.4%で phase a から外した）（2026-09-28、memory project_goal_data_coverage_and_ryujin_ux）
