# 数値の出典と母集団・公式データの仕様

公式の値の定義・桁・切り替わる時点と、サイトのどのテーブル・列に当たるか。効き目は [stat-findings.md](stat-findings.md)、言い方は [number-wording.md](number-wording.md)。書き方は [README.md](README.md)。

## 生データの所在
- 公開 API predictions の exhibitionData は展示タイムと展示ST だけ。チルト・調整重量・部品交換・プロペラ・体重・展示進入は DB の exhibition_data、一周・まわり足・直線は race_original_exhibition_values（kind 列）。今節の展示順位は race_entries（racer_id）と exhibition_data から作れる（2026-10-11、hq の data-scientist ノート）
- 選手ごとの「同じ枠番での実際の進入コース」は racer_aggregated_stats.course_entry_tendency（直近1年、全国と会場別）。サイトの画面には出ていない。例: 岩永雅人(4630) 6号艇29走すべて6コース（2026-10-11、本番 DB の読み取り）
- 本番 race_conditions の風速・波高は2025-12以降だけ。公式Kファイルの値と風速が同じなのは55.5%、5m以上の区分の一致は94.9%、波5cm以上の区分の一致は97.7%（2026-02〜09 の6日・888レース）。差の理由は未検証（2026-10-13、BOA-716、docs/reference/rough-water-trait-verification.md）

## モーター
- 新しいモーターの最初の開催では、公式の出走表のモーター2連率・3連率は全艇0。2節目の初日から入り、節の途中は固定。全会場で同じ（2026-10-11、BOA-830、常滑 2026-10-06 入れ替えで確認）
- 公式が0の間は艇ごとに自前の値で補う（0走→「まだ走っていません」、2着以内0回→「0%（N走）」、それ以外は自前の2連率に印）。6会場の2〜4節目で公式と自前の値はほぼ一致（2026-10-11、BOA-830 のユーザー決定）
- 会場サイトのモーター成績（venue_motor_stats）は stats_period_end が節の途中で止まる会場がある（びわこ・唐津・大村）。画面の注記の日付は取得日でなく stats_period_end を出す（2026-10-03、memory boa428_motor_strength_compare_handoff_2026_10_03、BOA-428、docs/design/motor-strength-compare/）

## 平均ST
- 定義は5つ。平均ST（公式）=racer_period_stats.avg_st・2桁／平均ST(30走)=v16 st_mean30・前日までの30走・F/L 除外・3走以上・3桁／平均ST（このコース・直近30走）=v16 course_st.course_filled・枠なりでその枠の直近30走・5走未満は直近30走で補う／平均ST（{会場}・直近30走）=v16 course_st.venue／選手ページの直近30走=racer_aggregated_stats.avg_st_last_30（v16 と同じ窓、当日を含むかだけ違う）（2026-10-10、docs/design/avg-st-definition/mock/APPROVED.md「名前と値の正本」）
- 公式の期は節の初日で決まり、節の途中で替わらない。節の初日が1〜6月なら (Y,1)=(Y-1)-05-01〜10-31、7〜12月なら (Y,2)=(Y-1)-11-01〜Y-04-30。レース日で決めると戸田 2026-07-01 8R で6艇中4艇が食い違った（2026-10-10、同 APPROVED.md「公式の期」、src/components/race/basicInfoStats.js の officialPeriodOf）
- 基本情報タブの「前期」（直前に終わった期）は5〜6月・11〜12月に公式の期と値が違う（2026-10-10、同 APPROVED.md）
- レース内のスタートの並びとの順位相関: 公式 0.223、直近30走 0.247、このコース 0.269〜0.272（2026-10-10、評価 2026-07-01〜10-08、同 APPROVED.md「根拠」）

## 率の桁
- 2連率・3連率は公式と同じ小数2桁で持つ。朝の初期化（generate-predictions）が1桁に丸めていたのを直した。過去の118レースは取り直さない（2026-10-11、BOA-829、PR #1388、オーケストレーター判断）
- 事故率は小数第2位で切り捨てて判定する。2025-2期に 40÷57=0.7018 の選手2人が B1 だった。ボートレース日和は四捨五入で出す（2026-10-11、src/utils/accidentRate.js、docs/design/racer-accident-rate/mock/APPROVED.md）

## 節・日目・得点率
- 公式の「N日目」は丸一日中止があると翌日に同じ日目を振り直し、最終日は total_days に飛ぶ。ページから読めた値が常に正で、start_date からの引き算は欠けた所を埋めるだけ（2026-09、memory boatrace_series_day_renumbering_on_cancellation、BOA-501 PR #911、scripts/lib/raceSeriesLookup.js）
- 得点率は予選終了で確定。着順点 10/8/6/4/2/1、特別戦は 12/10/9/7/6/5。予選は「種別が予選の最後のレース」で切る（2026-09、memory boatrace_series_points_official_rules、公式ガイド guide-7、src/components/race/seriesPoints.js）
- 必要得点 = ceil(ボーダー ×（今の走数＋残り走数）− 今の得点)。ボーダーは公式が出さないので自社推定（2026-09、src/components/race/seriesPoints.js）
- フライングは即日帰郷ではない。途中帰郷は「節の最終日に出走が無い」で判定できる（2026-09、memory boatrace_series_points_official_rules）
- 賞典除外・途中帰郷は racer_series_points.remarks に公式の備考がそのまま入る。penalty_points=99 や placements の「妨」は途中帰郷でも出るので区別に使えない。収録は一部の開催だけで、無い節はこの経路で判定できない（2026-09-27〜28、memory boatrace_series_points_official_rules・project_data_foundation_orchestration_2026_09_19、マイグレーション064。収録の範囲は要確認）
- 公式の得点率一覧（race/pointrank）は最終日に開いても予選終了の時点で止まる（2026-09-27、memory boatrace_series_points_official_rules）
- 特別戦の配点の判定は race_stage の名前の部分一致（「ドリーム」「選抜」）なので、「桐生ＤＲ戦女子」等の表記ゆれを拾えない（2026-09-27、memory boatrace_series_points_official_rules、BOA-458。修正済みかは要確認）
- 自社推定の準優ボーダーは若松G1（推定5.60）で実際と一致、桐生の一般戦では0.83差。一般戦は得点率の順以外の要因で準優が決まる（2026-09-27、memory boatrace_series_points_official_rules、scripts/verification/verify-series-points-border.mjs）

## 中止・順延
- 中止・順延は races.cancellation_status（'confirmed'/'tentative'/NULL）で判定する。結果の有無から推定しない。判定は「confirmed かつ結果が無い」にする（confirmed なのに結果がある32本）（2026-09、BOA-512、memory technical_races_cancellation_status_marks_postponed_races）
- 過去日の開催場一覧（race/index）には中止・順延の会場が半年後も残り、その日の結果・出走表ページは「データがありません」になる。一覧に会場が無ければ順延ではなく開催が無かった（2026-09-28、memory project_data_foundation_orchestration_2026_09_19、BOA-468、scripts/maintenance/audit-missing-results.js）
- 順延の日は公式の締切時刻が仮の値になる（2026-09-21 戸田・江戸川7〜12R）。締切時刻を突き合わせるときは中止・順延の会場を外す（2026-09-21、memory project_data_foundation_orchestration_2026_09_19）
- cancellation_status を生の文字列で比べるコードは verify-race-cancellation-usage.js が CI で落とす（2026-09-28、memory feedback_run_verify_ci_last_and_dont_edit_during、BOA-418）

## 会場
- 会場の水質・干満差の正本は BOAT RACE 公式の場データ（boatrace.jp/owpc/pc/data/stadium?jcd=01〜24、「2026/06/30現在」、2026-10-12 照合）。写しは src/data/venueWaterProfiles.js、固定は verify-venue-water-profiles.js。venues.water_type の初期データは7会場で誤っていた（152で修正）。海水・汽水でも干満差なしの会場がある（蒲郡・常滑・津）ので、潮の有無を水質から推定しない（2026-10-12）
- ナイター開催は24場中7場（桐生・蒲郡・住之江・丸亀・下関・若松・大村）。Web 調査で作った会場ガイドは24場中4場で事実を誤った（ナイターの誤記・水質・数値）。会場の事実は公式の場データと照合する（2026-07-27、memory venue_guide_expansion_project）
- 会場ではクレジットカード・一般の電子マネーが使えず、会場ごとに投票専用のプリペイドカードがある。本場と隣の場外発売所で違う会場もある（平和島は本場が現金のみ、外向発売所でだけ専用カード）。会場ごとに公式サイトで確かめて書く（2026-08-10、memory feedback_venue_guide_quality_upgrade。時点が古いので要確認）

## 選手占い
- 四柱推命の日柱干支は (ユリウス日+49) mod 60 で、独立した2サイトの4日付で一致を確かめた。六星占術の12年周期の起点は情報源どうしが食い違い、運命星＋陰陽で代えた（2026-08-25、memory feedback_verify_domain_formulas_before_implementing、docs/adr/0021-rokusei-senjutsu-simplification.md）

## 点検での見落としを防ぐ知見
- 会場カードの枠番別割合と、風の画面の進入コース別割合は別指標として照合する。（2026-10-12、2026-10-12-task-39-venue-article.md）
- 過去レースが現在の公開画面・公開APIで確認できなくても、当時のレースの不存在や掲載結果の虚偽とは断定せず、現在の公開手段では確認不能と記録する。（2026-10-13、2026-10-13-audit-20261013-01.md）
- 売上全体の払戻配分の説明だけで券種別・期間・例外も検証済みとせず、平均配当を単一レースの確定払戻だけで反証しない。（2026-10-13、2026-10-13-audit-20261013-04.md）
- 本人枠別進入APIの保存件数と生履歴から作る画面表示は対応確認まで同値とせず、API使用承認・台本との一致・同時点UI照合を別の証拠として扱う。（2026-10-13、2026-10-13-plan152328-ximage.md）
- 未取得表示と括弧付き展示タイムが併存するときは当日の計測値と断定せず、括弧付き値の仕様が確認できるまで判定不能とする。（2026-10-13、2026-10-13-task-51-note-light-drafts.md）
- 会場サイトの取得停止・行削除と公式0の自前補完は別経路として点検し、非表示フラグ・既存ドリルダウン・キャッシュ更新を個別に確認する。（2026-10-13、2026-10-13-plan-review-motorstop-20261013-06.md）
- techprofile/returnrateのRPC対象IDはPOST本文p_race_idで確認し、RPC URLだけで対象レースの取得を判定しない。（2026-10-13、2026-10-13-task-70-check-codex-patches.md）
- 連続出走日から得た期間と公式節日程を区別し、丸一日中止・出走表欠落で起点が切れる方式を節初日〜最終日の保証として使わない。（2026-10-13、2026-10-13-task-72-check-codex-patches.md）
- 節初日計算の共通化は取得窓だけでなく開催日の基準（出走表か種別か）と種別空入力時のnull契約を確認する。（2026-10-13、2026-10-13-boa-856.md）
