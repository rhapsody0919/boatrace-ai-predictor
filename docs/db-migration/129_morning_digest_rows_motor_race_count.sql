-- 129: morning_digest_rows に会場公式のモーター出走数 motor_race_count を足す（BOA-702 後半）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが実行する。手順・確認・戻し方は docs/issues/boa-702-digest-motor-race-count.md
--
-- 背景:
--   新モーターに切り替えた直後、一度も使われていないモーターは公式の累計実績が無く、出走表の2連率が 0.00 になる。
--   「本日のデータ一覧」（/today）のカードはこれを「モーター2連率 0.0%」と出しており、「2着以内0回」と読まれる。
--   データ出走表（PR #1241）は使用回数（src/utils/motorUsage.js）で「—（新モーター・実績なし）」に切り替えた。
--   /today は ADR-0070 で morning_digest_days・morning_digest_rows の2表だけを読むため、使用回数の材料をこの表に持たせる。
--
-- 値: venue_motor_stats.race_count のうち、対象日（digest_date）以前で最新のスナップショットの値
--   （会場公式サイトの、現行モーターの出走数）。NULL＝分からない（スナップショットが無い会場・モーター、取得失敗、
--   この列の追加前に生成した行）。motor_2rate が NULL の行（フライング・帰郷）も NULL。
-- 書き込み: scripts/daily/generate-morning-digest.js。列が無い DB では、この列だけを除いて書く（生成は止めない）。
-- 権限: 列の追加なので、098 の RLS ポリシーと表単位の GRANT SELECT（anon, authenticated）がそのまま効く。
--
-- 適用前でも後でもコードをマージしてよい（生成は列が無ければ除いて書き、画面は NULL を「分からない」として従来の表示にする）。

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE morning_digest_rows
  ADD COLUMN IF NOT EXISTS motor_race_count integer;

COMMENT ON COLUMN morning_digest_rows.motor_race_count IS
  '会場公式のモーター出走数（venue_motor_stats.race_count、digest_date 以前で最新）。0 かつ motor_2rate=0 なら未使用の新モーター（BOA-702）。NULL＝分からない';

COMMIT;
