-- 153: SNS の自動送信（送信モード・事前通知・止める操作・v1 素材の公開保留の解除）
-- 設計: docs/design/sns-pdca-loop/plan.md §1〜§4、ADR 0090・0092
-- 前提: 135・137・139・140・146・148（いずれも本番適用済み）。適用はオーナーのみ。
-- 状態: 案（/step2）。下の「置き換える既存の関数」は /step4 で最新定義を土台に書き、PGlite で検証してから確定する。
BEGIN;

-- チャネルごとの送信モード。初期は個別承認・試運転。
CREATE TABLE public.sns_auto_send_control (
  channel TEXT PRIMARY KEY CHECK (channel IN ('x', 'youtube')),
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  dry_run BOOLEAN NOT NULL DEFAULT true,
  live_started_on DATE,             -- 実送信の初日（JST）。L2 の「7日」の起点
  stop_tested_at TIMESTAMPTZ,       -- 止める操作を本番で試した日時（L3 の条件）
  switched_at TIMESTAMPTZ,
  switched_by UUID REFERENCES public.sns_approvers(id),
  auto_approver_id UUID REFERENCES public.sns_approvers(id),  -- 自動送信の承認者（分岐は表示名ではなくこの ID で行う）
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.sns_auto_send_control(channel) VALUES ('x'), ('youtube');

-- 1レース×1チャネルの自動送信の単位（X はスレッド全体で1件）。
CREATE TABLE public.sns_auto_send_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_import_id UUID NOT NULL REFERENCES public.sns_bundle_imports(id),
  channel TEXT NOT NULL CHECK (channel IN ('x', 'youtube')),
  race_id TEXT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,         -- 公式締切（bundle の値ではなく races から計算）
  notify_by TIMESTAMPTZ NOT NULL,           -- 締切の3時間前
  veto_until TIMESTAMPTZ NOT NULL,          -- 締切の60分前（止められる期限＝送る時刻）
  state TEXT NOT NULL DEFAULT 'checking'
    CHECK (state IN ('checking', 'held_manual', 'manual', 'notifying', 'notified', 'stopped', 'sent')),
  checks JSONB NOT NULL DEFAULT '{}'::jsonb, -- {risk, claims, display, mobile_gate, new_format, dry_run, checked_at}
  held_reason TEXT,
  notified_at TIMESTAMPTZ,
  stop_token_hash TEXT UNIQUE,              -- 止めるリンクの token の SHA-256（hex）
  stopped_at TIMESTAMPTZ,
  stopped_via TEXT CHECK (stopped_via IN ('link', 'admin', 'mode_off')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bundle_import_id, channel),
  CHECK (notify_by < veto_until AND veto_until < deadline_at),
  CHECK (state NOT IN ('notifying', 'notified') OR stop_token_hash IS NOT NULL),
  CHECK (state <> 'notified' OR notified_at IS NOT NULL),
  CHECK (state <> 'stopped' OR stopped_at IS NOT NULL)
);
CREATE INDEX sns_auto_send_items_veto ON public.sns_auto_send_items (veto_until) WHERE state = 'notified';

-- 誤投稿の記録（L3 の条件・L2 へ戻す条件）。オーナーが管理画面から記録する。
CREATE TABLE public.sns_auto_send_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES public.sns_auto_send_items(id),
  channel TEXT NOT NULL CHECK (channel IN ('x', 'youtube')),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- job と item の結びつき（item は下書きの配列を持たず、job 側から FK で指す）。
ALTER TABLE public.sns_x_send_jobs ADD COLUMN auto_item_id UUID REFERENCES public.sns_auto_send_items(id);
CREATE INDEX sns_x_send_jobs_auto_item ON public.sns_x_send_jobs (auto_item_id) WHERE auto_item_id IS NOT NULL;

-- X スレッド: 1バンドルに X の下書きを複数作れるよう、スレッドの順番を一意索引に含める。
ALTER TABLE public.sns_drafts ADD COLUMN thread_index SMALLINT NOT NULL DEFAULT 0 CHECK (thread_index BETWEEN 0 AND 5);
DROP INDEX public.sns_drafts_bundle_version_channel_language;
CREATE UNIQUE INDEX sns_drafts_bundle_version_channel_language
  ON public.sns_drafts (bundle_version_hash, platform, language, thread_index)
  WHERE bundle_version_hash IS NOT NULL;

-- v1 を受け付ける（v0 の公開保留は関数側で今のまま）。
ALTER TABLE public.sns_bundle_imports DROP CONSTRAINT sns_bundle_imports_schema_version_check; -- 名前は本番の pg_constraint で確認済み（2026-10-12）
ALTER TABLE public.sns_bundle_imports ADD CONSTRAINT sns_bundle_imports_schema_version_check
  CHECK (schema_version IN ('ryujin-preview/0', 'ryujin-preview/1'));

-- 自動送信の承認者（既存の「自動承認（品質チェック合格）」とは別に、履歴で区別する）。
INSERT INTO public.sns_approvers (display_name, active) VALUES ('自動送信（止められなかった）', false)
  ON CONFLICT (display_name) DO NOTHING;
UPDATE public.sns_auto_send_control SET auto_approver_id =
  (SELECT id FROM public.sns_approvers WHERE display_name = '自動送信（止められなかった）');

-- 止める: item を stopped にする（これで送信の関数の許可のリストが外れ、次の外部呼び出しの前に止まる）。
-- job の後片付け（queued・held の cancel、YouTube の非公開の retain、下書きを pending_review に戻す）は /step4 で
-- transition_sns_x_send を job ごとに呼ぶ形で書く。sending・reconcile・posted の job には触らない（148 のガードで RAISE するため）。
CREATE OR REPLACE FUNCTION public.stop_sns_auto_item(p_item_id UUID, p_via TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_state TEXT;
  v_started INTEGER;
BEGIN
  SELECT state INTO v_state FROM public.sns_auto_send_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF v_state = 'stopped' THEN RETURN jsonb_build_object('state', 'stopped', 'already', true); END IF;
  IF v_state = 'sent' THEN RETURN jsonb_build_object('state', 'sent', 'already_started', 1); END IF;
  SELECT count(*) INTO v_started FROM public.sns_x_send_jobs
    WHERE auto_item_id = p_item_id AND state IN ('sending', 'reconcile', 'posted');
  UPDATE public.sns_auto_send_items
    SET state = 'stopped', stopped_at = now(), stopped_via = p_via, updated_at = now()
    WHERE id = p_item_id;
  RETURN jsonb_build_object('state', 'stopped', 'already_started', v_started);
END $$;

-- 月の切り替え（オーナーが本番 SQL で実行）。予約額は戻らないので、請求期間ごとに0から数え直す。
CREATE OR REPLACE FUNCTION public.renew_sns_x_send_period(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_end <= p_start THEN RAISE EXCEPTION 'invalid_period'; END IF;
  UPDATE public.sns_x_send_control
    SET period_start = p_start, period_end = p_end, reserved_microusd = 0
    WHERE id = true AND (period_end IS NULL OR (period_end <= p_start AND now() >= period_end));
  IF NOT FOUND THEN RAISE EXCEPTION 'period_overlaps_current'; END IF;
END $$;

-- 置き換える既存の関数（/step4 で、本番の pg_get_functiondef を土台に CREATE OR REPLACE を書き、PGlite で検証してから確定する。
-- 置き換える前の定義は戻し方の正本として runbook に保存する。transition_sns_x_send は SECURITY DEFINER を維持する）:
-- 1. import_sns_preview_bundle（135）: v1 を受け付け、x_thread の本数分の X 下書きを thread_index つきで作る
-- 2. guard_sns_preview_bundle_draft（135）: v1 は item の検査（risk・claims・display・mobile_gate）が合格した下書きだけ
--    publish_blocked=false・publication_hold_reasons=[] にでき、approved・posted に進める。v0 は今のまま
-- 3. approve_sns_x_send（146 の最新）: 承認者が control.auto_approver_id のときは、mode='auto'・dry_run=false・
--    item.state='notified' のときだけ通し、job.auto_item_id を入れる。v1 で検査合格なら bundle_import_id があっても通す
-- 4. transition_sns_send_139（139・146）: v1 で検査合格なら bundle_import_id の拒否を外す
-- 5. transition_sns_x_send のラッパ（146）と youtube_call_guard（146）: auto_item_id がある job は、
--    claim・check・begin_post・youtube_publish_begin のたびに item.state='notified'・mode='auto'・dry_run=false を確かめ、
--    外れたら hold('auto_stopped')。X の claim と YouTube の youtube_publish_begin は now() >= veto_until も確かめる
-- 6. 送信が posted になったら item を 'sent' にする（スレッドは全部 posted のとき）

ALTER TABLE public.sns_auto_send_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_auto_send_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_auto_send_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_auto_send_control, public.sns_auto_send_items, public.sns_auto_send_incidents
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sns_auto_send_control, public.sns_auto_send_items, public.sns_auto_send_incidents
  TO service_role;
REVOKE ALL ON FUNCTION public.stop_sns_auto_item(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_sns_auto_item(UUID, TEXT) TO service_role;
-- 月の切り替えはオーナーが SQL Editor で実行するので、service_role にも渡さない
REVOKE ALL ON FUNCTION public.renew_sns_x_send_period(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
