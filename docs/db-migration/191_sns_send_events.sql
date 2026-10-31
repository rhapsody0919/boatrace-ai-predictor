-- 191: SNS の送信で送らなかった理由の表 sns_send_events（BOA-1201、2026-10-31 system-architect の推奨）
-- 送る側（cron sns_send、scripts/lib/snsSendRunner.js）が送らなかった理由は、今は report.alerts（Slack）にしか残らず、
-- hq の見張りは Slack を読めない。live の実行だけが、(job, 段, 理由) ごとに初出の1行を書く（shadow は DB を変えない）。
--   stage='precheck': runner の送る前の検査に落ちた（claim していない）
--   stage='send':     claim から begin_post までの送信の中で落ちた（YouTube の begin_post の前の失敗は job が held・
--                     error_code=youtube_preflight_failed のまま。原因は reason に holdReasonOf の code、detail に元の文言の先頭300字）。
--                     claim の DB の拒否（RAISE の文）は claim_daily_limit・claim_monthly_budget 等の code（runner の
--                     CLAIM_REJECTION_CODES）、写せない文言は db_rejected で detail に元の文言
--   stage='after_post': begin_post の後に落ちた（job は要照合。出たかもしれないので送らなかった理由と分ける）
-- 書き込みは PostgREST の POST sns_send_events?on_conflict=job_id,stage,reason と Prefer: resolution=ignore-duplicates。
-- 2分ごとの同じ理由の繰り返しは UNIQUE で止まり行を書かない（WAL を増やさない）。
-- 再承認（approve_sns_x_send、177 の ON CONFLICT(draft_id) DO UPDATE）は job の行を使い回す。再承認の後に同じ理由が出ても
-- 行は増えず、初出の時刻のまま残る。
-- 表を1つ足すだけで、関数・既存の表は変えない。コードは表が無くても動く（書き込みが 404・PGRST205 なら console に出すだけで
-- 送信は続ける）ので、コードのデプロイの後に当てる（db-apply）。
--
-- 適用の時刻: 送信の cron（sns_send）が止まっている JST 23:00〜7:59。外部キーを張る間、sns_x_send_jobs に
-- SHARE ROW EXCLUSIVE のロックが一瞬かかる（claim・遷移の UPDATE を待たせる）。lock_timeout は10秒。
--
-- 適用前の確認（期待値 NULL と uuid）:
--   SELECT to_regclass('public.sns_send_events') AS events,
--          (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
--            WHERE attrelid = 'public.sns_x_send_jobs'::regclass AND attname = 'id') AS job_id_type;
--
-- 適用後の確認（期待値 true・false・false・true・true・true）:
--   SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sns_send_events'::regclass) AS rls,
--          has_table_privilege('anon', 'public.sns_send_events', 'SELECT') AS anon_select,
--          has_table_privilege('authenticated', 'public.sns_send_events', 'INSERT') AS auth_insert,
--          has_table_privilege('service_role', 'public.sns_send_events', 'INSERT') AS service_insert,
--          has_table_privilege('service_role', 'public.sns_send_events', 'SELECT') AS service_select,
--          has_table_privilege('claude_ro', 'public.sns_send_events', 'SELECT') AS ro_select;
--
-- hq の読み方（直近1日。before_reapproval が true の行は、再承認より前の版のもの）:
--   SELECT e.at, e.stage, e.reason, e.detail, j.id AS job_id, j.channel, j.state, j.error_code,
--          j.approved_at, e.at < j.approved_at AS before_reapproval
--     FROM public.sns_send_events e
--     JOIN public.sns_x_send_jobs j ON j.id = e.job_id
--    WHERE e.at >= now() - interval '1 day'
--    ORDER BY e.at DESC;
--
-- 戻し方（コードは表が無くても動く。行は送らなかった理由の記録だけで、他の表から参照されない）:
--   DROP TABLE public.sns_send_events;
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE public.sns_send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.sns_x_send_jobs(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('precheck','send','after_post')),
  reason text NOT NULL CHECK (reason ~ '^[a-z_]{1,64}$'),
  detail text CHECK (char_length(detail) <= 300),
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, stage, reason)
);

-- 書くのは service_role（cron sns_send）・読むのは service_role と claude_ro（hq の見張り、166 の既定の権限）だけ
ALTER TABLE public.sns_send_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_send_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.sns_send_events TO service_role;

COMMIT;
