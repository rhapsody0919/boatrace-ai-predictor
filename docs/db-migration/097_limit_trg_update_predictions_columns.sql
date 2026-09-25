-- 097: trg_update_predictions の発火条件を、predictions/bet_recommendations の再計算に
--   実際に必要な列だけに限定する（BOA-409、WS8(c)-2。設計提案:
--   docs/design/scraping-vercel-consolidation/predictions-write-optimization.md 4節、PR #808）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する（BOA-405/BOA-409のスコープは
--   ドラフト作成・PR提出のみで、DDL適用は行わない）。
--
-- 背景（predictions-write-optimization.md 1.4節の実測に基づく）:
--   race_results 用トリガー関数 update_prediction_results()（001_schema.sql 定義、本番の
--   pg_get_functiondef と完全一致）が実際に参照する列は次の8列のみ:
--     rank1, rank2, rank3,
--     payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio
--   現状のトリガー定義は `AFTER INSERT OR UPDATE ON race_results`（列指定なし）のため、
--   上記8列以外（rank4〜6・course_*・actual_course_*・race_time_*・payout_exacta 等・
--   popularity_* 各種・winning_technique・is_cancelled・is_no_race・race_status・
--   refund_boats・remark・result_at・created_at）だけが変わるUPDATEでも、
--   predictions・bet_recommendations の該当レース全行を無条件に再UPDATEしてしまっている。
--
-- 適用後に発火しなくなる既知の書き込み経路（本チケットBOA-409で再確認済み。詳細はPR本文）:
--   * scripts/daily/scrape-results.js の syncActualCourseFromKFile()（actual_course_1〜6のみ更新）
--   * scripts/daily/scrape-results.js の syncRank456FromKFile()、
--     scripts/maintenance/backfill-rank456-from-kfile.js（rank4〜6のみ更新）
--   * scripts/maintenance/backfill-actual-course.js（actual_course_1〜6のみ更新）
--   * scripts/maintenance/backfill-start-timings.js の updateWinningTechnique()、
--     scripts/maintenance/backfill-race-data.js の updateRaceResult()（winning_technique のみ更新）
--   これらは predictions・bet_recommendations の計算に使われない列のみの変更であり、
--   トリガーを発火させない方が正しい（現状は誤って発火している）。
--
-- 適用しても挙動が変わらない主な書き込み経路（rank/payoutを含むため引き続き発火する）:
--   * scripts/daily/scrape-results.js の persistRaceResults()（upsertChangedRows経由、結果確定の主経路）
--   * scripts/lib/raceResultFix.js の applyFixPlan()（rank1〜3以外の払戻・rank4〜6等の混在修正。
--     払戻列が実際に変わる行だけ発火する）
--   * scripts/maintenance/migrate-to-supabase.js（過去の一括移行スクリプト、rank/payoutを含む全列upsert）
--
-- 関数本体（update_prediction_results()）は変更しない。発火条件（CREATE TRIGGER の列リスト）だけを
--   絞るため、関数のロジックとの不整合は生じない。bet_recommendations 側の actual_hit/actual_payout
--   更新も同じ関数内で行われるため、この発火条件の絞り込みで自動的に恩恵を受ける（関数自体は変更不要）。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   DROP TRIGGER → CREATE TRIGGER は ACCESS EXCLUSIVE ロックを一瞬取るため lock_timeout を設定してある
--   （10秒取れなければ失敗し、何も変更されない）。適用は、開催時間帯（JST 8:00〜21:30頃）を避けると、
--   ロック競合の可能性が下がる（078_race_results_status_refund.sql と同じ配慮）。
--
-- 適用前の確認事項（ユーザー適用時にも再確認を推奨）:
--   1. grep -rn '"race_results"' scripts/ api/ で、rank1〜3・payout_* 以外の列だけを更新している
--      経路が新たに増えていないか最終確認する（本チケットBOA-409時点の棚卸しはPR本文参照）
--   2. race_results への一括UPDATE（マイグレーション適用時のバックフィル等）は、開催時間帯を避けて実行する
--
-- 適用後の確認（読み取りのみ）:
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid = 'public.race_results'::regclass AND tgname = 'trg_update_predictions';
--   → UPDATE OF rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio
--     を含む定義になっていること
--
-- ロールバック（発火条件を元（列指定なし）に戻す。データの喪失は無い）:
--   BEGIN;
--   SET LOCAL lock_timeout = '10s';
--   DROP TRIGGER IF EXISTS trg_update_predictions ON race_results;
--   CREATE TRIGGER trg_update_predictions
--     AFTER INSERT OR UPDATE ON race_results
--     FOR EACH ROW EXECUTE FUNCTION update_prediction_results();
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS trg_update_predictions ON race_results;

CREATE TRIGGER trg_update_predictions
AFTER INSERT OR UPDATE OF
  rank1, rank2, rank3,
  payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio
ON race_results
FOR EACH ROW
EXECUTE FUNCTION update_prediction_results();

COMMIT;
