-- 143: 龍神ソナー（BOA-271）の「画面の中の声」を受け取る表 analogy_feedback を新設する
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが行う。
--
-- 背景:
--   龍神ソナーの公開（#1312、2026-10-08）後の反応を測る（ユーザー承認 10/7、モック承認 10/8）。
--   節の一番下で「龍神ソナーは予想の材料になりましたか？」に「なった／物足りない」で答え、
--   任意で理由（物足りないときの選択肢）と一言を送る。匿名。読むのは運営（hq の週1回のまとめ）だけ。
--   設計: docs/design/analogy-reaction-measurement/events.md、モック: docs/design/analogy-reaction-measurement/mock/
--
-- 1回の回答は最大2行:
--   kind='vote'   1段目を押した時点で保存（2段目を送らない人も押下率に入れるため）
--   kind='detail' 2段目の「送る」で保存。verdict は送った時点のもの（1段目から選び直していればこちらが正）
--   anon は INSERT しかできず UPDATE できないので、1行を後から書き換える形にはしない。
--
-- 列:
--   race_id        races の race_id（外部キー）
--   verdict        'useful'（なった）| 'lacking'（物足りない）
--   reasons        lacking の detail だけ。few_races／no_filter／hard_to_read／how_to_use／other の部分集合
--   comment        detail だけ。1〜200文字（空ならクライアントが NULL で送る）。原文のまま保存し期限なし
--                  （2026-10-08 ユーザー決定。個人情報は hq のまとめで伏せる）
--   analogy_stage  送った時点の時点（racecard／exhibition）
--   analogy_tab    送った時点のタブ（facts／similar／scenario）
--   lang           表示言語（ja／en／zh-TW／ko）
--   client_key     ブラウザごとの乱数（localStorage）。個人と結びつけない。重複除外と連投の制限だけに使う
--
-- 権限: RLS 有効。anon・authenticated は INSERT のポリシーと INSERT 権限だけ（SELECT・UPDATE・DELETE なし）。
--   読むのは service_role。フロントは return=minimal で INSERT する（SELECT 権限が無いので返り値を求めない）。
-- 重複: UNIQUE (client_key, race_id, kind)。同じブラウザ・同じレースで vote・detail 各1行まで。
-- 連投の制限（トリガー、SECURITY DEFINER で件数を数える）:
--   同じ client_key で直近24時間に40行、全体で直近1時間に300行を超えたら拒否する。
--   created_at はトリガーで now() に上書きする（過去の時刻を送って制限の窓を外すのを防ぐ）。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   新規テーブルの作成のみで、既存の表・読み手には触れない。画面の PR のマージより先に適用する
--   （未適用のまま画面が出ると、押しても「送れませんでした」になる）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'analogy_feedback' AND relkind = 'r';
--   → true
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'analogy_feedback';
--   → analogy_feedback_insert | INSERT | {anon,authenticated} の1行だけ
--   SELECT has_table_privilege('anon', 'public.analogy_feedback', 'SELECT'),
--          has_table_privilege('anon', 'public.analogy_feedback', 'INSERT');
--   → false, true
--
-- 検証: node scripts/maintenance/verify-analogy-feedback-migration.js（PGlite、本番には接続しない）

BEGIN;

CREATE TABLE IF NOT EXISTS public.analogy_feedback (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL CHECK (kind IN ('vote', 'detail')),
  race_id       varchar NOT NULL REFERENCES public.races (race_id),
  verdict       text NOT NULL CHECK (verdict IN ('useful', 'lacking')),
  reasons       text[],
  comment       text CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 200),
  analogy_stage text NOT NULL CHECK (analogy_stage IN ('racecard', 'exhibition')),
  analogy_tab   text NOT NULL CHECK (analogy_tab IN ('facts', 'similar', 'scenario')),
  lang          text NOT NULL CHECK (lang IN ('ja', 'en', 'zh-TW', 'ko')),
  client_key    uuid NOT NULL,
  CONSTRAINT analogy_feedback_once UNIQUE (client_key, race_id, kind),
  -- 理由は「物足りない」の detail だけ。決まった5つの部分集合で、空配列は NULL で送る
  CONSTRAINT analogy_feedback_reasons CHECK (
    reasons IS NULL OR (
      kind = 'detail' AND verdict = 'lacking'
      AND cardinality(reasons) BETWEEN 1 AND 5
      AND reasons <@ ARRAY['few_races', 'no_filter', 'hard_to_read', 'how_to_use', 'other']::text[]
    )
  ),
  -- 一言は detail だけ（vote は押しただけ）
  CONSTRAINT analogy_feedback_vote_bare CHECK (kind = 'detail' OR comment IS NULL)
);

CREATE INDEX IF NOT EXISTS analogy_feedback_client_created
  ON public.analogy_feedback (client_key, created_at);
CREATE INDEX IF NOT EXISTS analogy_feedback_created
  ON public.analogy_feedback (created_at);

-- 連投の制限。anon は SELECT できないので、件数は表の持ち主の権限で数える
CREATE OR REPLACE FUNCTION public.analogy_feedback_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.created_at := now();
  IF (SELECT count(*) FROM public.analogy_feedback
      WHERE client_key = NEW.client_key
        AND created_at > now() - interval '24 hours') >= 40 THEN
    RAISE EXCEPTION 'analogy_feedback: too many from this client' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.analogy_feedback
      WHERE created_at > now() - interval '1 hour') >= 300 THEN
    RAISE EXCEPTION 'analogy_feedback: too many overall' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.analogy_feedback_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS analogy_feedback_guard ON public.analogy_feedback;
CREATE TRIGGER analogy_feedback_guard
  BEFORE INSERT ON public.analogy_feedback
  FOR EACH ROW EXECUTE FUNCTION public.analogy_feedback_guard();

ALTER TABLE public.analogy_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.analogy_feedback FROM anon, authenticated;
GRANT INSERT ON public.analogy_feedback TO anon, authenticated;

DROP POLICY IF EXISTS analogy_feedback_insert ON public.analogy_feedback;
CREATE POLICY analogy_feedback_insert ON public.analogy_feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

COMMENT ON TABLE public.analogy_feedback IS
  '龍神ソナー（BOA-271）の画面の中の声。匿名・anon は INSERT のみ。vote=1段目、detail=2段目。docs/db-migration/143_analogy_feedback.sql';

COMMIT;

-- 戻し方（ユーザーが実行する。集めた声も消える）:
-- ROLLBACK-BEGIN
-- BEGIN;
-- DROP TABLE IF EXISTS public.analogy_feedback;
-- DROP FUNCTION IF EXISTS public.analogy_feedback_guard();
-- COMMIT;
-- ROLLBACK-END
