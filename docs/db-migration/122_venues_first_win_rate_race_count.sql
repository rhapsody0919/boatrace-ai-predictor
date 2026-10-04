-- 122: venues に1号艇勝率の母数 avg_first_win_rate_race_count を足す（BOA-303）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 背景:
--   分析ツールの「1号艇勝率ランキング」（getVenueFirstWinRateRanking、BOA-267）は、races×race_results の直近90日
--   約4万行を画面から毎回スキャンして集計していた。同じ値を日次バッチ scripts/maintenance/update-venue-stats.js が
--   venues.avg_first_win_rate に保存しているが、ランキングの表に要る消化レース数（母数）を保存していなかったため
--   読み替えられなかった。母数の列を足し、画面は venues を読むだけにする。
--
-- 値: 直近90日（JST）に1着が確定したレース数（不成立 race_status='no_race' と rank1 が NULL の行を除く）。
--   avg_first_win_rate の分母と同じ。NULL＝未集計。
-- 書き込み: scripts/maintenance/update-venue-stats.js（aggregate-stats.yml、毎日 23:00 JST）。
-- 権限: 列の追加なので、既存の venues の RLS・GRANT（匿名の SELECT）がそのまま効く。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   NULL 許可・既定値なしの列の追加はメタデータの変更だけで一瞬。venues は24行。
--   **コードのマージより先に適用する**（マージ後の画面とバッチがこの列を読み書きするため）。
--   適用とマージの後、aggregate-stats.yml を手動実行するか 23:00 の定期実行を待つまで、ランキングは空になる。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'venues' AND column_name = 'avg_first_win_rate_race_count';
--   → integer / YES
--   SELECT has_column_privilege('anon', 'public.venues', 'avg_first_win_rate_race_count', 'SELECT');
--   → true
--
-- 元に戻す（列と、そこに書いた値が消える。他の列・表には影響しない）:
--   BEGIN;
--   SET LOCAL lock_timeout = '10s';
--   ALTER TABLE venues DROP COLUMN IF EXISTS avg_first_win_rate_race_count;
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS avg_first_win_rate_race_count integer;

COMMENT ON COLUMN venues.avg_first_win_rate_race_count IS
  'avg_first_win_rate の母数（直近90日に1着が確定したレース数。不成立と rank1 NULL を除く）。update-venue-stats.js が毎日更新（BOA-303）';

COMMIT;
