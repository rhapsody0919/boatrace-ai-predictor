-- 116: race_start_timings に公式の成績コード（official_finish_code）を足す（BOA-553）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 背景:
--   公式のモーター2連率は、選手責任外の失格（S0）・選手責任外の欠場（K0）を分母に入れない（BOA-549 の実測）。
--   結果ページ由来の finish_mark（転・落・欠・妨 等の文字）では、責任の有無（S0 と S1、K0 と K1）を区別できない。
--   区別できるのは公式の成績ファイル（Kファイル）の着順欄だけで、アーカイブ（kb_archive_boats.finish_raw）は
--   本体テーブルとの重複を避けて 2025-12-02 で打ち切っている（kb-backfill.js の MAIN_TABLES_START）。
--   そこで艇単位の表 race_start_timings に列を足して持つ（オーケストレーターの判断、案A）。
--
-- 値: Kファイルの着順欄の表記のまま（全角は正規化済み。kbFileParser の finish_raw）。01〜06・F・L0・L1・K0・K1・
--   S0・S1・S2 等。読み替えはしない。NULL＝未取得。
-- 書き込み: 日次は scripts/daily/scrape-results.js の syncOfficialFinishCodeFromKFile（進入・rank4〜6 と同じ K を共有）。
--   過去分は scripts/maintenance/backfill-kb-gaps.js --item=finish_code。どちらも既存の行の更新だけで、行の無い艇
--   （2026-09-21 より前の欠場艇など）は挿入しない（race_start_timings の読み手のうち7箇所が「行がある＝出走した」と
--   見るため。2026-09-29 の棚卸し）。
-- 権限: 新しいテーブルは作らない。列の追加なので、既存の race_start_timings の RLS・GRANT がそのまま効く。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   NULL 許可・既定値なしの列の追加は、PostgreSQL 11 以降は表の書き換えを伴わない（メタデータの変更だけで一瞬）。
--   ACCESS EXCLUSIVE を一瞬取るため lock_timeout を10秒にしてある（取れなければ失敗し、何も変わらない）。
--   コードは列が無い間は同期を飛ばす（status=column_missing）ので、コードのマージの前後どちらでも適用してよい。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'race_start_timings' AND column_name = 'official_finish_code';
--   → text / YES
--   SELECT count(*) FROM race_start_timings WHERE official_finish_code IS NOT NULL;
--   → 0（適用直後。翌日の結果の取得から日次の同期が書き始める）
--
-- 元に戻す（列と、そこに書いた値が消える。他の列・表には影響しない）:
--   BEGIN;
--   SET LOCAL lock_timeout = '10s';
--   ALTER TABLE race_start_timings DROP COLUMN IF EXISTS official_finish_code;
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE race_start_timings
  ADD COLUMN IF NOT EXISTS official_finish_code text;

COMMENT ON COLUMN race_start_timings.official_finish_code IS
  '公式の成績ファイル（Kファイル）の着順欄の表記のまま（01〜06・F・L0・L1・K0・K1・S0・S1・S2 等）。K0/S0 は選手責任外。NULL＝未取得（BOA-553）';

COMMIT;
