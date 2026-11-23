# site_feedback（ご意見ボックスの表）の案

**未審査の案。適用の根拠にしない。** 審査（system-architect）とオーナーの承認の後、番号を付けたマイグレーション（`docs/db-migration/`）にしてから db-apply で当てる。作り手はマイグレーションを作らず、本番にも接続しない（AGENTS.md 安全の2・3）。

画面（`src/components/siteFeedback/`）は、この表が本番に無い間は「送れませんでした。時間をおいてもう一度押してください」を出す。**画面の PR のマージより先に、この表を本番に当てる**（龍神ソナーの声 `143_analogy_feedback.sql` と同じ順）。

## 何を入れる表か

サイト全体のご意見ボックス（右下のボタン・フッターの入口）から送られた1件を1行で持つ。ログインなし・匿名。読むのは運営（service_role・`claude_ro`）だけで、公開しない。

| 列 | 中身 |
|---|---|
| `kind` | 内容の種類（任意）。`feature`（欲しい機能）・`usability`（使いにくいところ）・`data`（データの誤り）・`other`（その他）。選ばなければ NULL |
| `comment` | 自由記述。1〜500文字。原文のまま保存し、期限は置かない（龍神ソナーの声と同じ扱い。2026-10-08 のオーナー決定を引き継ぐ案） |
| `rating` | 満足度（任意）。1〜5。選ばなければ NULL |
| `page_type` | どの種類の画面から送ったか。`home`・`today`・`race`・`racer`・`venue`・`analysis`・`blog`・`guide`・`other`。URL（レース・選手の番号）は送らない |
| `lang` | 表示言語（`ja`・`en`・`zh-TW`・`ko`） |
| `client_key` | ブラウザごとの乱数（localStorage の `boatai-user:site-feedback-client`）。個人と結びつけない。連投の制限だけに使う |

列挙値と上限は `src/pure/siteFeedback.js` と1対1でそろえる（`scripts/maintenance/verify-site-feedback.js` が、この文書の SQL を PGlite に当てて画面の値が全部入ることを確かめる）。

## 権限と守り

- RLS 有効。anon・authenticated は INSERT のポリシーと INSERT 権限だけ（SELECT・UPDATE・DELETE なし）。フロントは返り値を求めない INSERT をする
- 同じ人が何件でも書けるので、UNIQUE は置かない（龍神ソナーの声は「レースごとに1回」だったが、こちらは回数の決まりが無い）
- 連投の制限（トリガー、SECURITY DEFINER で件数を出す）
  - 同じ `client_key` で直近24時間に10行まで
  - 全体で直近10分に30行まで（`187` で龍神ソナーの声に入れた値と同じ。`client_key` を毎回変える荒らしの入る量は1時間180行まで）
  - 件数を出す前に `pg_advisory_xact_lock` で INSERT を1本ずつにする（同時の INSERT が互いの行を見ずに上限を越えないように）
  - `created_at` はトリガーで `now()` に上書きする（過去の時刻を送って制限の窓を外すのを防ぐ）
- 弾いたときは `P0001` で、画面は「送れませんでした」になる

決めていない点（審査で決める）:

- 上限の値（24時間10行・10分30行）は龍神ソナーの声の実績（17日で14行）からの目安で、ご意見ボックスの実績はまだ無い
- `claude_ro` は新しい public の表を既定で読める（ADR 0096）。自由記述を読ませてよいか
- 自由記述の保存の期限（置かない案にしている）
- プライバシーポリシーに、この表に保存すること（内容・画面の種類・ブラウザごとの識別番号）を足す文

## SQL の案

```sql
-- site-feedback-draft-begin
BEGIN;

CREATE TABLE IF NOT EXISTS public.site_feedback (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text CHECK (kind IS NULL OR kind IN ('feature', 'usability', 'data', 'other')),
  comment     text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 500),
  rating      smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  page_type   text NOT NULL CHECK (page_type IN (
                'home', 'today', 'race', 'racer', 'venue', 'analysis', 'blog', 'guide', 'other')),
  lang        text NOT NULL CHECK (lang IN ('ja', 'en', 'zh-TW', 'ko')),
  client_key  uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS site_feedback_client_created
  ON public.site_feedback (client_key, created_at);
CREATE INDEX IF NOT EXISTS site_feedback_created
  ON public.site_feedback (created_at);

-- 連投の制限。anon は SELECT できないので、件数は表の持ち主の権限で出す
CREATE OR REPLACE FUNCTION public.site_feedback_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.created_at := now();
  -- 同時の INSERT が互いの行を見ずに上限を越えないよう、件数を出す前に1本ずつにする
  PERFORM pg_advisory_xact_lock(hashtext('public.site_feedback_guard'));
  IF (SELECT count(*) FROM public.site_feedback
      WHERE client_key = NEW.client_key
        AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'site_feedback: too many from this client' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.site_feedback
      WHERE created_at > now() - interval '10 minutes') >= 30 THEN
    RAISE EXCEPTION 'site_feedback: too many overall' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.site_feedback_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS site_feedback_guard ON public.site_feedback;
CREATE TRIGGER site_feedback_guard
  BEFORE INSERT ON public.site_feedback
  FOR EACH ROW EXECUTE FUNCTION public.site_feedback_guard();

ALTER TABLE public.site_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.site_feedback FROM anon, authenticated;
-- grant-exempt: ご意見は匿名の閲覧者が送るので、anon に INSERT だけを渡す（SELECT・UPDATE・DELETE は渡さない）。
--   悪用は CHECK（列挙値・500文字）とトリガーの連投制限で抑える
GRANT INSERT ON public.site_feedback TO anon, authenticated;

DROP POLICY IF EXISTS site_feedback_insert ON public.site_feedback;
CREATE POLICY site_feedback_insert ON public.site_feedback
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

COMMENT ON TABLE public.site_feedback IS
  'サイト全体のご意見ボックス。匿名・anon は INSERT のみ。docs/design/site-feedback-box/';

COMMIT;
-- site-feedback-draft-end
```

## 適用の後の確かめ（読み取りだけ）

```sql
SELECT relrowsecurity FROM pg_class WHERE relname = 'site_feedback' AND relkind = 'r';
-- → true
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'site_feedback';
-- → site_feedback_insert | INSERT | {anon,authenticated} の1行だけ
SELECT has_table_privilege('anon', 'public.site_feedback', 'SELECT'),
       has_table_privilege('anon', 'public.site_feedback', 'INSERT');
-- → false, true
```

## 戻し方（集めたご意見も消える）

```sql
-- site-feedback-rollback-begin
BEGIN;
DROP TABLE IF EXISTS public.site_feedback;
DROP FUNCTION IF EXISTS public.site_feedback_guard();
COMMIT;
-- site-feedback-rollback-end
```

新しい表を作るだけで、既存の表・関数・読み手には触れない。戻すときは、画面の PR を先に revert する（表だけ消すと、画面は「送れませんでした」を出す）。
