-- 093: race_special_notes の一意索引に選手名を含め、同日・同内容の別選手の通知が潰れないようにする
--
-- 対応チケット: BOA-371（race_special_notesの一意索引が、同日・同内容の別選手の通知を潰す）
-- 対応設計: scripts/daily/scrape-race-information.js（A5 レース特記事項）、検証: scripts/maintenance/verify-race-notices-job.js
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 事象（2026-09-20、WS4b race-noticesの子エージェントの検証で発見。BOA-371）:
--   現行の一意索引 uq_race_special_notes_dedup (venue_code, race_date, category, detail_text) は、
--   「同じ会場・日付・区分で、たまたま本文（detail_text）が一致する別選手」の通知を1行に潰す。
--   例（scripts/lib/__fixtures__/raceNotices/with-notices.html、2017-12-24 住之江の実例で再現）:
--     - 12/19 落水失格（選手責任） 減点5点: 岡崎　恭裕 と 魚谷　智之 の2件が同じdetail_text
--     - 12/24 待機行動違反 処置なし: 新田　雄史 と 峰　竜太 の2件が同じdetail_text
--   9件解析して7件しか保存されない（2件が消える）。race_special_notes は本マイグレーション適用時点で0件のため、
--   データ移行なしで索引を直せる（本番実測: SELECT count(*) FROM race_special_notes; → 0）。
--
-- 対応: 一意索引に racer_name（選手名。structured_data.racerName と同じ生の表記、常に取得できる）を加える。
--   racer_id ではなく racer_name にする理由: racer_id は同姓同名で一意に特定できない選手が NULL になり
--   （scripts/daily/scrape-race-information.js の buildRacerNameMap）、NULL同士は一意制約で衝突しないため、
--   racer_id を使うと「同姓同名の別人」「解決できなかった別人」のケースで従来と同じ問題が残る。racer_name は
--   欠場・帰郷／モーター・ボート変更／事故・内規違反の3区分すべてで必ず取得できる生の表記のため、これを使う。
--   PostgREST の upsert(onConflict=...) は列名のみを受け付け式（structured_data->>'racerName' 等）は使えないため、
--   別列として追加する（式インデックスでは対応できない）。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でも良い。列が無い間は旧実装と同じ4列のonConflictのまま、
-- 列が現れてから新しいonConflict（5列）で書く実装にする想定だが、race_special_notes は書き込みがshadow/live開始
-- 直後で行が極めて少ないため、コードと同時適用でよい）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   race_special_notes は本マイグレーション適用時点で0〜数行程度の見込みで、ACCESS EXCLUSIVE ロックは一瞬のみ。
--   SET LOCAL lock_timeout で待ち時間を制限してある。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'race_special_notes' AND column_name = 'racer_name';
--   → 1行（text）
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.race_special_notes'::regclass AND conname = 'uq_race_special_notes_dedup';
--   → UNIQUE (venue_code, race_date, category, detail_text, racer_name)
--
-- ロールバック（racer_name を含む索引を、旧来の4列に戻す。既存行のracer_nameの値は失われる）:
--   ALTER TABLE race_special_notes DROP CONSTRAINT IF EXISTS uq_race_special_notes_dedup;
--   ALTER TABLE race_special_notes
--     ADD CONSTRAINT uq_race_special_notes_dedup UNIQUE (venue_code, race_date, category, detail_text);
--   ALTER TABLE race_special_notes DROP COLUMN IF EXISTS racer_name;
--
-- 設計上の要点:
--   * racer_name は NULL 可・DEFAULTなし。093以前の行（あれば）は NULL のまま。当面 racer_id の解決可否に
--     関わらず、必ず生の選手名の表記を保存する（既存の structured_data.racerName と重複するが、一意制約に
--     使うため列として持つ。JSONBの式では onConflict に使えないため）
--   * RLS・ポリシー・GRANTは変更しない（076でRLS有効・anon権限なし。列の追加は影響しない）

SET LOCAL lock_timeout = '10s';

ALTER TABLE race_special_notes
  ADD COLUMN IF NOT EXISTS racer_name text;

ALTER TABLE race_special_notes
  DROP CONSTRAINT IF EXISTS uq_race_special_notes_dedup;

ALTER TABLE race_special_notes
  ADD CONSTRAINT uq_race_special_notes_dedup
  UNIQUE (venue_code, race_date, category, detail_text, racer_name);

COMMENT ON COLUMN race_special_notes.racer_name IS
  '通知本文中の選手名の生の表記（structured_data.racerNameと同じ値）。093で一意制約の差別化キーとして追加。093以前の行はNULL';
COMMENT ON CONSTRAINT uq_race_special_notes_dedup
  ON race_special_notes IS
  '同一会場・日付・区分・本文・選手名の重複挿入を防ぐ（10分間隔ポーリングで同じ通知を繰り返し取得するため）。093で選手名を追加し、同日・同内容の別選手の通知が1行に潰れる問題（BOA-371）を解消';
