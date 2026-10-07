-- 140の後に適用。適用はオーナーのみ。本文・承認・送信設定は変更しない。
BEGIN;
CREATE TABLE public.sns_edit_inspections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id UUID NOT NULL REFERENCES public.sns_drafts(id), revision TEXT NOT NULL,
 engine TEXT NOT NULL, findings JSONB NOT NULL CHECK(jsonb_typeof(findings)='array'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(draft_id,revision,engine)
);
CREATE TABLE public.sns_edit_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 inspection_id UUID NOT NULL REFERENCES public.sns_edit_inspections(id),
 finding_id TEXT NOT NULL, approver_id UUID NOT NULL REFERENCES public.sns_approvers(id),
 decision TEXT NOT NULL CHECK(decision IN ('adopted','ignored')),
 decided_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sns_edit_decisions_latest ON public.sns_edit_decisions(inspection_id,finding_id,decided_at DESC,id DESC);
ALTER TABLE public.sns_edit_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_edit_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sns_edit_inspections,public.sns_edit_decisions FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.sns_edit_inspections,public.sns_edit_decisions TO service_role;
CREATE FUNCTION public.read_sns_edit_inspection(p_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT to_jsonb(i) || jsonb_build_object('decisions',coalesce((SELECT jsonb_object_agg(v.finding_id,v.decision) FROM
 (SELECT DISTINCT ON(finding_id) finding_id,decision FROM sns_edit_decisions WHERE inspection_id=i.id ORDER BY finding_id,decided_at DESC,id DESC) v),'{}'::jsonb))
 FROM sns_edit_inspections i WHERE i.id=p_id;
$$;
CREATE FUNCTION public.save_sns_edit_inspection(p_draft_id UUID,p_revision TEXT,p_engine TEXT,p_findings JSONB) RETURNS JSONB
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; inspection UUID;
BEGIN
 SELECT * INTO d FROM sns_drafts WHERE id=p_draft_id FOR UPDATE;
 IF d.id IS NULL OR sns_mobile_revision(d) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION '点検した版が変わりました'; END IF;
 IF jsonb_typeof(p_findings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_findings)>1000 THEN RAISE EXCEPTION '指摘が不正です'; END IF;
 INSERT INTO sns_edit_inspections(draft_id,revision,engine,findings) VALUES(d.id,p_revision,p_engine,p_findings)
 ON CONFLICT(draft_id,revision,engine) DO NOTHING;
 SELECT id INTO inspection FROM sns_edit_inspections WHERE draft_id=d.id AND revision=p_revision AND engine=p_engine;
 RETURN read_sns_edit_inspection(inspection);
END;
$$;
CREATE FUNCTION public.decide_sns_edit_finding(p_draft_id UUID,p_revision TEXT,p_inspection_id UUID,p_finding_id TEXT,p_approver_id UUID,p_decision TEXT) RETURNS JSONB
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; i public.sns_edit_inspections;
BEGIN
 SELECT * INTO d FROM sns_drafts WHERE id=p_draft_id FOR UPDATE;
 SELECT * INTO i FROM sns_edit_inspections WHERE id=p_inspection_id AND draft_id=p_draft_id AND revision=p_revision;
 IF d.id IS NULL OR i.id IS NULL OR sns_mobile_revision(d) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION '点検した版が変わりました'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sns_approvers WHERE id=p_approver_id AND display_name='本人') THEN RAISE EXCEPTION '本人の判断が必要です'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.findings) f WHERE f->>'id'=p_finding_id) THEN RAISE EXCEPTION '指摘がありません'; END IF;
 INSERT INTO sns_edit_decisions(inspection_id,finding_id,approver_id,decision) VALUES(i.id,p_finding_id,p_approver_id,p_decision);
 RETURN read_sns_edit_inspection(i.id);
END;
$$;
REVOKE ALL ON FUNCTION public.read_sns_edit_inspection(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_sns_edit_inspection(UUID,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_sns_edit_finding(UUID,TEXT,UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_sns_edit_inspection(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_sns_edit_inspection(UUID,TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_sns_edit_finding(UUID,TEXT,UUID,TEXT,UUID,TEXT) TO service_role;
COMMIT;
