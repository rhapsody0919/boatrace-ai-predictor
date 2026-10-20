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

## 公式ファイル・公式ページと取得の時点
- 公式の K/B ファイルは 2019-04 から全期間を取り込み済み（kb_archive_* テーブル、kb_archive_boats 約223万行）（2026-09-25、memory project_data_foundation_orchestration_2026_09_19、BOA-403・BOA-422）
- B ファイルの体重は登録体重（整数）、race_entries.weight_kg は当日の体重（小数）で別の値。player_name は表記、local_win_rate は取得の時点が違う。B ファイルで上書きする前に同じ値かを確かめる（2026-09-25、memory project_data_foundation_orchestration_2026_09_19、PR #840）
- K ファイルは開催日の夜〜翌日に公開され、kfile-sync は JST 07:00・12:00 に動く。前日の進入コース（race_results.actual_course_*）を使う集計は当日の昼より後にそろう（2026-09-25、memory morning_data_digest_2026_09_25、ADR-0066）
- 公式の直前情報（beforeinfo）と結果（raceresult）のページは HTML の作りが別。beforeinfo は .table1 の2番目→tbody 6つ→各4行で .table1_boatImage1 が無い。raceresult は .table1_boatImage1 で艇の情報を取れる（memory technical_supabase_scraping_turnpred_notes）
- 公式の過去ページは今のテンプレートで返るので、過去に HTML が一時的に変わったことによる取りこぼしは後から再現できない（2026-09-15、memory race_entries_racer_id_null_bug_2026_09_15、scripts/daily/update-race-info.js）
- 同じ節の別の日に、同じ6人が同じ枠で組まれることがある（2026-01-22 常滑6R、公式の B ファイルでも一致）。出走表が他のレースと1レースだけ一致しても複製と判定しない（2026-09-25、memory project_data_foundation_orchestration_2026_09_19、BOA-423）
- st_course_baseline・nige_second_by_course の window_end は、00:50 JST の集計の時点では前々日になる。材料の race_results.actual_course_* は Kファイルの同期（kfile_sync、07:00 JST）が翌朝に書くため。鮮度を見るなら前々日まで進んだかで見る（2026-10-20、data-accuracy-verifier、aggregate-course-baseline-stats の実行ログ26回）
- 夜の集計（GitHub の schedule）が 06:30 JST より後に終わる夜は、2026-08-21〜10-20 の60回で4回（約7%。起動遅れ）。06:30 の締めの鮮度の通知はその夜に出る（2026-10-20、data-accuracy-verifier）

## オッズ
- 公式は票が0の艇の単勝を「0.0」、複勝を「0.0-0.0」と出す。0 を欠損として扱うと単勝の解析が失敗扱いになり、解析済みの3連単も捨てる。scrape_slots.outcome="no_values" は「単勝の値が無い」だけを表し、「何も発売されていない」と区別できない（2026-09-28、memory feedback_verify_status_label_branch_before_using_as_evidence・project_data_foundation_orchestration_2026_09_19、BOA-486、scrape-odds.js の scrapeWinOdds。今も同じ実装かは要確認）
- 締切60分前の窓でオッズが取れないのは、公式がまだ発売していないため（1分ごとに17〜30回試みても値が無い）。取得の不具合ではない（2026-09-28、memory project_data_foundation_orchestration_2026_09_19、BOA-465）
