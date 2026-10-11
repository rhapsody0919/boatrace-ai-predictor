# 龍神レーダー 公式データの仕様の知見ノート（公式データ仕様役が最初に読む）
1行1知見、出典つき。公式データ仕様役（.claude/agents/official-data-spec.md）が最初に読み、答えの最後に出した「足す行」を依頼元が書き足す。古くなった行は消さずに「（廃止 日付 理由）」を付ける

## モーター
- 新しいモーターの最初の開催では、公式の出走表のモーター2連率・3連率は全艇0。2節目の初日から入り、節の途中は固定。全会場で同じ（BOA-830、常滑 2026-10-06 入れ替えで確認、オーケストレーターの調査 2026-10-11）
- 公式が0の間は艇ごとに自前の値で補う（0走→「まだ走っていません」、2着以内0回→「0%（N走）」、それ以外は自前の2連率に印）。6会場の2〜4節目で公式と自前の値はほぼ一致（BOA-830 のユーザー決定 2026-10-11）

## 平均ST
- 平均ST は期間を名前に付けて出す。名前だけの「平均ST」と「蓄積した全期間」は出さない（docs/design/avg-st-definition/mock/APPROVED.md、BOA-815 2026-10-10 承認）
- 定義は5つ。平均ST（公式）=racer_period_stats.avg_st・2桁／平均ST(30走)=v16 st_mean30・前日までの30走・F/L 除外・3走以上・3桁／平均ST（このコース・直近30走）=v16 course_st.course_filled・枠なりでその枠の直近30走・5走未満は直近30走で補う／平均ST（{会場}・直近30走）=v16 course_st.venue／選手ページの直近30走=racer_aggregated_stats.avg_st_last_30（v16 と同じ窓、当日を含むかだけ違う）（同 APPROVED.md「名前と値の正本」）
- 公式の期は節の初日で決まり、節の途中で替わらない。節の初日が1〜6月なら (Y,1)=(Y-1)-05-01〜10-31、7〜12月なら (Y,2)=(Y-1)-11-01〜Y-04-30。レース日で決めると戸田 2026-07-01 8R で6艇中4艇が食い違った（同 APPROVED.md「公式の期」、src/components/race/basicInfoStats.js の officialPeriodOf）
- 基本情報タブの「前期」（直前に終わった期）は5〜6月・11〜12月に公式の期と値が違う（同 APPROVED.md）
- レース内のスタートの並びとの順位相関: 公式 0.223、直近30走 0.247、このコース 0.269〜0.272（評価 2026-07-01〜10-08、同 APPROVED.md「根拠」）
- 展示ST と本番ST の相関は艇ごと0.08（平均ST は0.28）。展示ST を判断材料の主役にしない（docs/design/analogy-finder/slit-hint/slitpred.md）

## 率の桁
- 2連率・3連率は公式と同じ小数2桁で持つ。朝の初期化（generate-predictions）が1桁に丸めていたのを直した。過去の118レースは取り直さない（BOA-829、PR #1388、オーケストレーター判断 2026-10-11）
- 事故率は小数第2位で切り捨てて判定する。2025-2期に 40÷57=0.7018 の選手2人が B1 だった（src/utils/accidentRate.js、docs/design/racer-accident-rate/mock/APPROVED.md）。ボートレース日和は四捨五入で出す（Orchestrate 2026-10-11 依頼）

## 節・日目・得点率
- 公式の「N日目」は丸一日中止があると翌日に同じ日目を振り直し、最終日は total_days に飛ぶ。ページから読めた値が常に正で、start_date からの引き算は欠けた所を埋めるだけ（memory boatrace_series_day_renumbering_on_cancellation、BOA-501 PR #911、scripts/lib/raceSeriesLookup.js）
- 得点率は予選終了で確定。着順点 10/8/6/4/2/1、特別戦は 12/10/9/7/6/5。予選は「種別が予選の最後のレース」で切る（memory boatrace_series_points_official_rules、公式ガイド guide-7、src/components/race/seriesPoints.js）
- 必要得点 = ceil(ボーダー ×（今の走数＋残り走数）− 今の得点)。ボーダーは公式が出さないので自社推定（同 memory）
- フライングは即日帰郷ではない。途中帰郷は「節の最終日に出走が無い」で判定できる（同 memory）

## 中止・順延
- 中止・順延は races.cancellation_status（'confirmed'/'tentative'/NULL）で判定する。結果の有無から推定しない。判定は「confirmed かつ結果が無い」にする（confirmed なのに結果がある32本、BOA-512）（memory technical_races_cancellation_status_marks_postponed_races）
