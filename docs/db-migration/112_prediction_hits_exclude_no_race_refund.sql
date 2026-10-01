-- 112: 的中判定のトリガー（update_prediction_results）で、不成立のレースと返還艇を含む勝式を判定対象外（NULL）にする（BOA-544）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 背景:
--   race_results の rank・払戻が書かれると、トリガー trg_update_predictions が predictions の的中フラグを計算する。
--   この関数は race_status・refund_boats（078）を見ていないため、次のようになっていた（本番 2026-10-01 の実測）:
--     * 不成立（race_status='no_race'）のレース: 予想25行に的中・外れが付いている（例: 2026-08-07-24-01）
--     * 返還艇（refund_boats）を本命にした予想: 約75行が「単勝外れ」、3連系では約160行が外れとして数えられている
--   アプリ側の判定（scripts/lib/hitCalculator.js の buildPredictionHitUpdate）を BOA-544 で直した。トリガーも同じ規則にする
--   （払戻の修正（raceResultFix.js）等、アプリの判定を通らずにトリガーだけが動く経路があるため）。
--
-- 規則（buildPredictionHitUpdate と同じ）:
--   * 判定できるレース: rank1 があり、race_status が 'no_race' でない（NULL＝078以前・未判定は今までどおり判定する）
--   * 単勝・複勝: 本命（top_pick）が返還艇なら NULL
--   * 3連複（is_hit_trifecta）・3連単（is_hit_trio）: top_3rd が無い（unified）か、上位3艇のどれかが返還艇なら NULL
--   * 展開予測（is_hit_turn）: このトリガーは計算しない（パターンは feature_contributions にあり、アプリが判定する）。
--     不成立のレースだけ NULL にする
--   * 配当: 的中は払戻額（NULL なら 0）、外れは 0、判定対象外は NULL。旧版は外れを NULL にしていたが、アプリ側
--     （判定のたびにトリガーの後で上書きする）は 0 だったので、アプリに揃える
--
-- 権限: CREATE OR REPLACE FUNCTION は既存の権限を保つ。113（適用済み）で匿名の EXECUTE を剥がした状態は、
--   112 を後から適用しても変わらない（REVOKE を足していないのは、この保たれる性質による。BOA-575）。
--
-- 発火条件: 097 の8列に race_status・refund_boats を足す。結果の確定の後で race_status だけが直される経路
--   （raceResultFix.js の applyFixPlan・audit-race-result-anomalies.js）でも、判定をやり直すため。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   関数の置き換えと、トリガーの作り直し（ACCESS EXCLUSIVE を一瞬取る。lock_timeout 10秒）だけで、既存の行は書き換えない。
--   既存の行の是正は、適用の後に scripts/maintenance/backfill-refund-hit-flags.js で行う（手順は
--   docs/issues/boa-544-refund-hit-flags-runbook.md）。開催時間帯（JST 8:00〜21:30頃）を避けて適用する。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_update_predictions';
--   → UPDATE OF rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio,
--     race_status, refund_boats を含む
--   SELECT position('race_status' in pg_get_functiondef('public.update_prediction_results()'::regprocedure)) > 0;
--   → true
--
-- 元に戻す（関数と発火条件を 097 の状態に戻す。データは戻らないが、次の結果の書き込みから旧規則で判定される）:
--   BEGIN;
--   SET LOCAL lock_timeout = '10s';
--   CREATE OR REPLACE FUNCTION update_prediction_results() RETURNS TRIGGER AS $$
--   BEGIN
--       UPDATE predictions p
--       SET
--           is_hit_win = (p.top_pick = NEW.rank1),
--           is_hit_place = (p.top_pick IN (NEW.rank1, NEW.rank2)),
--           is_hit_trifecta = (
--               ARRAY[p.top_pick, p.top_2nd, p.top_3rd]::SMALLINT[]
--               @> ARRAY[NEW.rank1, NEW.rank2, NEW.rank3]::SMALLINT[]
--           ),
--           is_hit_trio = (
--               p.top_pick = NEW.rank1
--               AND p.top_2nd = NEW.rank2
--               AND p.top_3rd = NEW.rank3
--           ),
--           payout_win = CASE WHEN p.top_pick = NEW.rank1 THEN NEW.payout_win ELSE NULL END,
--           payout_place = CASE
--               WHEN p.top_pick = NEW.rank1 THEN NEW.payout_place_1
--               WHEN p.top_pick = NEW.rank2 THEN NEW.payout_place_2
--               ELSE NULL
--           END,
--           payout_trifecta = CASE
--               WHEN ARRAY[p.top_pick, p.top_2nd, p.top_3rd]::SMALLINT[]
--                    @> ARRAY[NEW.rank1, NEW.rank2, NEW.rank3]::SMALLINT[]
--               THEN NEW.payout_trifecta
--               ELSE NULL
--           END,
--           payout_trio = CASE
--               WHEN p.top_pick = NEW.rank1 AND p.top_2nd = NEW.rank2 AND p.top_3rd = NEW.rank3
--               THEN NEW.payout_trio
--               ELSE NULL
--           END
--       WHERE p.race_id = NEW.race_id;
--
--       -- bet_recommendationsも更新
--       UPDATE bet_recommendations br
--       SET
--           actual_hit = (
--               SELECT is_hit_win FROM predictions p
--               WHERE p.race_id = br.race_id AND p.model_id = br.model_id AND p.is_shadow = FALSE
--               LIMIT 1
--           ),
--           actual_payout = (
--               SELECT payout_win FROM predictions p
--               WHERE p.race_id = br.race_id AND p.model_id = br.model_id AND p.is_shadow = FALSE
--               LIMIT 1
--           )
--       WHERE br.race_id = NEW.race_id;
--
--       RETURN NEW;
--   END;
--   $$ LANGUAGE plpgsql;
--   DROP TRIGGER IF EXISTS trg_update_predictions ON race_results;
--   CREATE TRIGGER trg_update_predictions
--     AFTER INSERT OR UPDATE OF
--       rank1, rank2, rank3,
--       payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio
--     ON race_results
--     FOR EACH ROW EXECUTE FUNCTION update_prediction_results();
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION update_prediction_results()
RETURNS TRIGGER AS $$
DECLARE
    -- 判定できるレース（rank1 があり、不成立でない。race_status が NULL は今までどおり判定する）
    judgeable boolean := NEW.rank1 IS NOT NULL
        AND NEW.race_status IS DISTINCT FROM 'no_race';
    refunded smallint[] := COALESCE(NEW.refund_boats, '{}'::smallint[]);
BEGIN
    UPDATE predictions p
    SET
        is_hit_win = CASE WHEN j.win THEN (p.top_pick = NEW.rank1) END,
        is_hit_place = CASE WHEN j.win THEN (p.top_pick IN (NEW.rank1, NEW.rank2)) END,
        -- ⚠️ trifecta=実態3連複（順不同）・trio=実態3連単（順序一致）。列名の逆転は 001 から
        is_hit_trifecta = CASE WHEN j.trio THEN (
            ARRAY[p.top_pick, p.top_2nd, p.top_3rd]::SMALLINT[]
            @> ARRAY[NEW.rank1, NEW.rank2, NEW.rank3]::SMALLINT[]
        ) END,
        is_hit_trio = CASE WHEN j.trio THEN (
            p.top_pick = NEW.rank1
            AND p.top_2nd = NEW.rank2
            AND p.top_3rd = NEW.rank3
        ) END,
        is_hit_turn = CASE WHEN NEW.race_status = 'no_race' THEN NULL ELSE p.is_hit_turn END,
        payout_win = CASE
            WHEN NOT j.win THEN NULL
            WHEN p.top_pick = NEW.rank1 THEN COALESCE(NEW.payout_win, 0)
            ELSE 0
        END,
        payout_place = CASE
            WHEN NOT j.win THEN NULL
            WHEN p.top_pick = NEW.rank1 THEN COALESCE(NEW.payout_place_1, 0)
            WHEN p.top_pick = NEW.rank2 THEN COALESCE(NEW.payout_place_2, 0)
            ELSE 0
        END,
        payout_trifecta = CASE
            WHEN NOT j.trio THEN NULL
            WHEN ARRAY[p.top_pick, p.top_2nd, p.top_3rd]::SMALLINT[]
                 @> ARRAY[NEW.rank1, NEW.rank2, NEW.rank3]::SMALLINT[]
            THEN COALESCE(NEW.payout_trifecta, 0)
            ELSE 0
        END,
        payout_trio = CASE
            WHEN NOT j.trio THEN NULL
            WHEN p.top_pick = NEW.rank1 AND p.top_2nd = NEW.rank2 AND p.top_3rd = NEW.rank3
            THEN COALESCE(NEW.payout_trio, 0)
            ELSE 0
        END
    FROM (
        SELECT q.prediction_id,
               judgeable AND NOT (q.top_pick = ANY (refunded)) AS win,
               judgeable AND q.top_3rd IS NOT NULL
                 AND NOT (ARRAY[q.top_pick, q.top_2nd, q.top_3rd]::smallint[] && refunded) AS trio
        FROM predictions q
        WHERE q.race_id = NEW.race_id
    ) j
    WHERE p.prediction_id = j.prediction_id;

    -- bet_recommendationsも更新（変更なし）
    UPDATE bet_recommendations br
    SET
        actual_hit = (
            SELECT is_hit_win FROM predictions p
            WHERE p.race_id = br.race_id AND p.model_id = br.model_id AND p.is_shadow = FALSE
            LIMIT 1
        ),
        actual_payout = (
            SELECT payout_win FROM predictions p
            WHERE p.race_id = br.race_id AND p.model_id = br.model_id AND p.is_shadow = FALSE
            LIMIT 1
        )
    WHERE br.race_id = NEW.race_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_predictions ON race_results;

CREATE TRIGGER trg_update_predictions
AFTER INSERT OR UPDATE OF
  rank1, rank2, rank3,
  payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio,
  race_status, refund_boats
ON race_results
FOR EACH ROW
EXECUTE FUNCTION update_prediction_results();

COMMIT;
