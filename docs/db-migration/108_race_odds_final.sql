-- 108: 締切時オッズ（公式）を保存するテーブル race_odds_final（BOA-496）
--
-- 背景: race_odds（発走60/30/15/10/5/0分前のスナップショット）は「取得した時点の公式表示」で、公式のオッズ更新は
--   数分遅れる。0分窓の行でも、勝った艇の単勝が確定払戻と±50%以上ずれる、または null だったのが 1,039件中181件（約17%）
--   あった（BOA-486 の調査）。締切の後に公式のページ（「締切時オッズ」表示）を1回取り直して保存し、オッズ一覧タブの
--   締切後の表と、推移の最後の点に使う。
--
-- race_odds に窓（window_min=1 等）を足さず、別テーブルにした理由:
--   * race_odds を「レースごとの最新の行（captured_at の降順の先頭）」で読む読み手が多い。scripts/lib/latestByRaceId.js、
--     予測・Moriarty の日次生成、バックテスト・学習、画面の複勝バッジ（getRacePlaceOdds）、オッズ一覧タブのスナップショット。
--     締切後の行を同じテーブルに入れると、これらが黙って締切後の値を読むようになる（発売中に買える値ではない）
--   * 票0（公式の「0.0」）を 0 のまま残す（keepZero）。race_odds は 0.0 を null にして保存しており、1/オッズ を計算する
--     読み手が 0 を想定していない
--   * race_odds の窓内取得率（監視・data_health）は window_min と captured_at で数えるため、発走後の行が混ざると分母・分子が崩れる
--
-- 列の形（jsonb。race_odds の *_all 列と同じキー形式。ADR-0054）:
--   win_all      {"1": 3.2, ...}                        単勝。票0は 0。欠場艇はキーなし
--   place_all    {"1": {"low": 1.3, "high": 2.0}, ...}  複勝。票0は {"low": 0, "high": 0}
--   trifecta_all {"1-2-3": 11.5, ...}                   3連単（120通り）
--   trio_all     {"1-2-3": 4.1, ...}                    3連複（昇順キー）
--   exacta_all   {"1-2": 4.1, ...}                      2連単
--   quinella_all {"1-2": 3.0, ...}                      2連複（昇順キー）
--   wide_all     {"1-2": {"low": 1.2, "high": 1.5}}     拡連複（昇順キー）
--   券種（ページ）ごとに取得の成否が分かれるため、取れなかった券種の列は NULL（画面はその券種だけ従来の表示に戻る）。
--   captured_at は最後に書いた時刻（再試行で取れなかった券種を後から足した場合は、その時刻）。
--
-- 書き込みは Vercel Cron（api/cron/odds-final.js、scrape_job_state の job='odds_final'）の service_role のみ。
-- 1レース1行（主キー race_id）。1日約150行×1行約5KB（jsonbの合計）≒ 約0.75MB/日、書き込みは1レース1〜数回
-- （取れなかった券種の再試行）。Disk IO への影響は無視できる。
--
-- 適用手順: Supabase Dashboard > SQL Editor で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   コードのマージの前後どちらに適用してもよい（画面は、テーブルが無い間は締切時オッズなしとして従来の表示のまま。
--   Cron は scrape_job_state の行が無い・off の間は何もしない）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT has_table_privilege('anon','public.race_odds_final','SELECT'),
--          has_table_privilege('anon','public.race_odds_final','INSERT');   → true, false
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'race_odds_final';  → true
--
-- 取得を始める（適用とデプロイの後に、別に実行する。まず shadow で数レース確かめてから live にしてもよい）:
--   INSERT INTO scrape_job_state (job, mode) VALUES ('odds_final', 'live')
--     ON CONFLICT (job) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now();
--   その日の予定表は、次の起動（5分以内）で作られる（ensure_scrape_slots）。取れているかの確認:
--   SELECT race_id, captured_at,
--          win_all IS NOT NULL AS win, trifecta_all IS NOT NULL AS t3, trio_all IS NOT NULL AS f3,
--          exacta_all IS NOT NULL AS t2, quinella_all IS NOT NULL AS f2, wide_all IS NOT NULL AS wide
--     FROM race_odds_final ORDER BY captured_at DESC LIMIT 20;
--   SELECT outcome, count(*) FROM scrape_slots WHERE job = 'odds_final' AND race_date = CURRENT_DATE GROUP BY 1;
--
-- 止める: UPDATE scrape_job_state SET mode = 'off', updated_at = now() WHERE job = 'odds_final';
-- ロールバック: DROP TABLE IF EXISTS public.race_odds_final;（画面は従来の表示に戻る。キャッシュは本日分3分・過去分は最大7日）

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS race_odds_final (
  race_id      VARCHAR(20) PRIMARY KEY REFERENCES races(race_id) ON DELETE CASCADE,
  win_all      JSONB,
  place_all    JSONB,
  trifecta_all JSONB,
  trio_all     JSONB,
  exacta_all   JSONB,
  quinella_all JSONB,
  wide_all     JSONB,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE race_odds_final IS
  '締切時オッズ（公式）。締切の後に公式のオッズページ（「締切時オッズ」表示）を取り直した値。1レース1行。票0は0のまま。取れなかった券種の列はNULL。race_odds（発売中のスナップショット）とは別物。BOA-496';
COMMENT ON COLUMN race_odds_final.captured_at IS
  '最後に書いた時刻（取れなかった券種を再試行で足した場合はその時刻）';

-- 画面（匿名）が読むため SELECT のみ。書き込みは service_role（RLS迂回）だけ（BOA-370 のRLS規律。076以降は既定権限が無い）
ALTER TABLE race_odds_final ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS race_odds_final_public_read ON public.race_odds_final;
CREATE POLICY race_odds_final_public_read ON public.race_odds_final
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.race_odds_final TO anon, authenticated;
