# DB の列・テーブルの読み方と取得の時点

DB の列名・テーブルの読み違いと、公式ファイル・公式ページの取得の時点。公式データの仕様そのもの（得点率・中止・会場）は [data-definitions.md](data-definitions.md)、本番 DB の運用は [db-operations.md](db-operations.md)。主に official-data-spec・data-scientist・system-architect が読む。書き方は [README.md](README.md)。

## 列・テーブルの読み違い
- 払戻の列名は英語名と中身が逆。race_results.payout_trifecta が3連複、payout_trio が3連単。配当を扱う前に scripts/lib/payoutCalculator.js 冒頭のコメントを見る（2026-08-09、memory vup_feature_analysis_skill、payoutCalculator.js:5-7）
- winning_technique_stats.percentage は「その枠が1着だったときの決まり手の内訳」で、枠の1着率ではない。outcome_distribution.probability の分母は会場の全レース。「N号艇が1着の場合」の率にするなら winning_technique_stats.total_races を分母にする（約1.8倍ずれていた）（2026-08-31、memory race_detail_analysis_tool_integration_2026_08、PR #442）
- 選手マスタは racers ではなく racer_profiles（生年月日・支部・出身地・血液型・身長体重・登録期。scripts/maintenance/scrape-racer-profiles.js が boatrace.jp の選手検索から取る）。race_entries・race_conditions だけ見て「未取得」と判断しない（2026-09-14、memory feedback_verify_db_schema_before_ticketing_data_gaps・racer_fortune_and_news_features_2026_08_24、docs/db-migration/035_create_racer_profiles.sql）
- 級の表記は race_entries.grade が "A1"、racer_profiles.grade_at_scrape が "A1級"（取得時点の値）。級は 1/1・7/1 に替わり、審査期間（5/1〜10/31・11/1〜4/30）とは別。画面の級は race_entries の最新の出走の値を使う（2026-10-01、memory seo_keyword_strategy_2026_09_29）
- race_grade は SG/G1/G2/G3/ippan のレースのグレードで、選手の級別（A1/A2）ではない（2026-09-25、memory morning_data_digest_2026_09_25、BOA-402）
- predictions の時刻列は predicted_at（created_at は無い）。feature_contributions.turnPrediction.patterns は 2026-03-08 以降の行にだけある。展開予測は BOA-822 で廃止方向なので、新しく使う前に確かめる（memory technical_supabase_scraping_turnpred_notes・BOA-106_patterns_analysis_validated）
- 旧3モデル（standard/safeBet/upsetFocus）の予想は predictions に残るが、2026-08-13 に廃止され今の画面には出ない。DB にある値を題材にする前に、今の画面で見えるかを確かめる（2026-08-22、memory feedback_data_premise_must_match_live_ui）
- race_conditions.series_day は 2026-09-25 時点で99%埋まっている。「全件 null」とする古いコメント・資料（BOA-226 の時点）は信じない（2026-09-25、memory ui_ux_phase_a_progress_2026_09_25）
- 選手の F 数は race_entries.f_count に統一する（ユーザー承認）。is_flying を期間の窓で足した旧バッジは「今期のフライング」と合っていなかった（2026-09-25、memory ui_ux_phase_a_progress_2026_09_25。直ったかは要確認）
- race_entries.racer_id は 2025-12-02〜2026-02-11 に大量に NULL だったが、player_name と racer_profiles.name の一致で263,016件を復元済み（名前の重複なし）。races の最古日は 2025-12-03（2026-09-15、memory race_entries_racer_id_null_bug_2026_09_15、BOA-324・BOA-325。最古日は後の取り込みで変わりうる）
- race_entries の f_count・l_count・weight_kg・branch・hometown・is_absent は 2026-09-21 から取り始めた（9/20 までは空）。global_3rate は全期間ある（2026-09-28、memory project_data_foundation_orchestration_2026_09_19、要確認）
- 公開会場の枠番率は画面が件数から表示し、API に完成した割合が無いことがある。記事側で再計算せず画面表示を転記し、同じ閲覧で母数応答（outcome-distribution）と描画元の応答（決まり手内訳）を撮影と同時点に保存して出典を分ける。母数応答だけでは決まり手内訳の API 照合にならない（2026-10-13、2026-10-13-venue-20261013-05-edogawa.md・2026-10-13-venue-20261013-09-fukuoka.md）
- scenario の boats=1 応答は、1号艇条件用（scenario.cells…forms）と各艇の級別条件用（boats[b].data.attack）で母数・勝利件数が異なる。各艇の数字は各艇のキーで照合する（2026-10-14、2026-10-14-daily-shorts-2026-10-14-19-11.md）
- scenario の scope=VA は種類名で、要求は scope_keys.VA の実キー（例 VA:20）。hints.course.kado4.kado.hit/miss の分母は各条件群で scenario.n ではない（2026-10-14、2026-10-14-outside-conditions-verify.md）
- 勝者の決まり手しかない結果データから、勝たなかった艇の構え（差しに構えたか、最内へ差して3着か）は復元できない。ST 形を代理にする統計と行動の観測を分ける（2026-10-14、2026-10-14-outside-conditions-verify.md）
- レース気象は predictions.weather、ソナーの気象は保存した exhibition の値。結果後に weather が変わっても、ソナーは展示時点の値を保つ（2026-10-14、2026-10-14-ryujin-feature-catalog.md）
- getMotorWakuStats・getMotorRacerWakuStats は現行の実進入コース集計。actual_course が全列未取得の古い走だけ艇番で代用する（2026-10-14、2026-10-14-ryujin-feature-catalog.md）
- 全国の率だけを返す取得関数の実装定義と、保存表示値の実母数・実期間・更新時点の証明は別（2026-10-16、2026-10-16-generator-structure-progress.md）
- accuracy_cache の updated_at は保存時刻で評価期間ではない。unified_volatility_accuracy の現行集計に日付絞込みは無く、実績記事には固定した取得時刻と評価期間を別に残す（2026-10-13、2026-10-13-plan-review-20261013-07.md）
- boolean を some(x===true) で見ると、空配列・全 NULL が false になる。NULL が未判定の列では、読取成功・欠場 true なし・欠場なし確認済みを分け、確認済みにする取得源の false を契約に明示する（2026-10-13、2026-10-13-plan-review-20261013-32.md・2026-10-15-plan-review-20261015-09.md）
- morning_digest_rows.course は生成時に当日の boat_number と同値で保存するが、参照する統計は選手の過去の実進入コース別実績。「当日の2号艇」と「過去の2コース」を分け、当日の実進入確定値として扱わない（2026-10-15、2026-10-15-plan-review-20261015-11.md）
- 本番進入を表示する新カードは、統計用 actualCourse だけでなく既存の表示用 entryCourse の優先順位を引き継ぐ。当日の ST 進入が取れていても、K ファイル待ちの actualCourse は null（2026-10-16、2026-10-16-review-20261016-06.md）
- racer_profiles.sex は全行 NULL（083 の列はあるが sync-profiles が未実行）。性別を前提にした判定（レディースのレースの見分け等）にはまだ使えない（2026-10-31、本番の読み取り、GS00 案2）

## 公式ファイル・公式ページと取得の時点
- 公式の K/B ファイルは kb_archive_* に 2019-04-01〜2025-12-02 を取り込み済み（kb_archive_boats 約221万行）。2025-12-03 以降は race_entries・race_results 等にあり、kb は作りの上で止めている（kb-backfill.js の MAIN_TABLES_START、書き手の cron なし）。kb_archive は匿名で読めず、racer_id の索引も無い（2026-10-28、system-architect・本番の読み取り。元は 2026-09-25、BOA-403・BOA-422）
- 公式の fan ファイルに現役の選手が載らないことがある。fan2604 には 4650 が無いが、公式の選手ページには 2026年後期（41走）がある。直近2週に出走した 1,407人のうち欠けはこの1人。画面で「それより後は未公開」と言い切らない（2026-10-28、data-accuracy-verifier、PR #2051）
- B ファイルの体重は登録体重（整数）、race_entries.weight_kg は当日の体重（小数）で別の値。player_name は表記、local_win_rate は取得の時点が違う。B ファイルで上書きする前に同じ値かを確かめる（2026-09-25、memory project_data_foundation_orchestration_2026_09_19、PR #840）
- K ファイルは開催日の夜〜翌日に公開され、kfile-sync は JST 07:00・12:00 に動く。前日の進入コース（race_results.actual_course_*）を使う集計は当日の昼より後にそろう（2026-09-25、memory morning_data_digest_2026_09_25、ADR-0066）
- 公式の直前情報（beforeinfo）と結果（raceresult）のページは HTML の作りが別。beforeinfo は .table1 の2番目→tbody 6つ→各4行で .table1_boatImage1 が無い。raceresult は .table1_boatImage1 で艇の情報を取れる（memory technical_supabase_scraping_turnpred_notes）
- 公式の過去ページは今のテンプレートで返るので、過去に HTML が一時的に変わったことによる取りこぼしは後から再現できない（2026-09-15、memory race_entries_racer_id_null_bug_2026_09_15、scripts/daily/update-race-info.js）
- 同じ節の別の日に、同じ6人が同じ枠で組まれることがある（2026-01-22 常滑6R、公式の B ファイルでも一致）。出走表が他のレースと1レースだけ一致しても複製と判定しない（2026-09-25、memory project_data_foundation_orchestration_2026_09_19、BOA-423）
- st_course_baseline・nige_second_by_course の window_end は、00:50 JST の集計の時点では前々日になる。材料の race_results.actual_course_* は Kファイルの同期（kfile_sync、07:00 JST）が翌朝に書くため。鮮度を見るなら前々日まで進んだかで見る（2026-10-20、data-accuracy-verifier、aggregate-course-baseline-stats の実行ログ26回）
- 夜の集計（GitHub の schedule）が 06:30 JST より後に終わる夜は、2026-08-21〜10-20 の60回で4回（約7%。起動遅れ）。06:30 の締めの鮮度の通知はその夜に出る（2026-10-20、data-accuracy-verifier）
- 現行の気象取得は33〜7分前の展示窓で、展示タイム未公開でも気象を先に反映する。60分前の体重用窓は updateWeather=false。表示条件（思考アシストは展示後）と取得時点を分ける（2026-10-14、2026-10-14-ryujin-feature-catalog.md）

## オッズ
- 公式は票が0の艇の単勝を「0.0」、複勝を「0.0-0.0」と出す。0 を欠損として扱うと単勝の解析が失敗扱いになり、解析済みの3連単も捨てる。scrape_slots.outcome="no_values" は「単勝の値が無い」だけを表し、「何も発売されていない」と区別できない（2026-09-28、memory feedback_verify_status_label_branch_before_using_as_evidence・project_data_foundation_orchestration_2026_09_19、BOA-486、scrape-odds.js の scrapeWinOdds。2026-10-28 に今も同じ実装と確認。race_odds は票0を null、race_odds_final は 0 で残す）
- 発売中の単勝（race_odds.odds_win_N）の 1.0・null は公式のページの値そのまま（取得・解析の誤りではない）。公式の発売中の単勝は票が少なく、1番人気の艇が下限の 1.0 に張り付き、票0の艇は「0.0」（保存は null）になる。2026-10-28 児島5R の締切10分前に公式を1回取得し、1.0・0.0・15.5・15.5・23.2・23.2 で、12秒後の race_odds の -10 の行と一致。締切時の race_odds_final.win_all は 2026-10-26 桐生1R で公式の締切時オッズと6艇とも一致（2026-10-28、BOA-1174、scripts/analysis/check-win-odds-vs-final.js）
- 10/20〜10/27 の race_odds で、6艇とも単勝があるのは -60 で 147/1333・-10 で 513/1321・0 で 998/1317、1号艇が 1.0 は -10 で 508・0 で 293。締切時（race_odds_final 1316 行）は 6艇そろうのが 1227、1号艇 1.0 は 154。発売中の単勝の1番人気が締切時の単勝の1番人気と同じなのは -10 で 835/1295・-5 で 890/1295、3連単の合成の1着人気は -10 で 1054/1295・-5 で 1074/1295。締切前に1着人気を出すなら、発売中の単勝より3連単の合成のほうが締切時の単勝に近い（2026-10-28、BOA-1174、scripts/analysis/check-win-odds-vs-final.js）
- 締切60分前の窓でオッズが取れないのは、公式がまだ発売していないため（1分ごとに17〜30回試みても値が無い）。取得の不具合ではない（2026-09-28、memory project_data_foundation_orchestration_2026_09_19、BOA-465）
- race_results.remark の「同着あり」は2着以下の同着も含む（12か月で18件のうち1着の同着は1件）。1着の同着は race_start_timings.finish_rank=1 が2艇以上かで判定する（2026-10-20、data-accuracy-verifier、docs/reference/venue-course-win-rate.md）
- race_start_timings.entry_course は 2025-12-06 以降の約9,400レースにだけ入っていて、その範囲では race_results.actual_course_* と1着艇の進入コースが 9,386/9,386 で一致（2026-10-20、同）
- CSVの抽出完了報告だけで受領済みと扱わず、分析前に指定パスの実ファイル・列定義・対象期間・取得時刻を確認する。未配置なら母数や時点を検証できないため、再配置を依頼してから分析する（2026-10-21、BOA-991、data-scientist のCSV受領点検）
- 記事の6艇比較表は、全国勝率・2連率・当地勝率・モーター2連率・級を日付つきの同じ出走表の写しからそろえる。一部の列しかない画面を別日時の資料で継ぎ足さない。public/data/races.jsonを使う場合も対象日を確認し、含まれない開催名は別の根拠を残す（2026-10-20、BOA-922、seo-human、public/data/races.json）
- weather-in-escape.jsonのwind.venues.*.bins.*.techniquesは、その区分の全レースを分母とする勝者の決まり手内訳。逃げ件数は1コース1着数ではなく、1コースの抜き・恵まれ等もあるため「1コースが負けたとき」の内訳へ変換しない。決まり手合計は各binのn、風5区分のnの和は会場のall.nに対応する（2026-10-20、seo-human、data/analysis/weather-in-escape.json）
