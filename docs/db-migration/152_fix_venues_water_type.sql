-- 152: venues.water_type を BOAT RACE 公式の場データに合わせる
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する（db-apply ワークフローか SQL Editor）。
--
-- 背景:
--   001_schema.sql の初期データが7会場で公式と食い違っていた（唐津を海水とする等）。
--   正本: https://www.boatrace.jp/owpc/pc/data/stadium?jcd=01〜24 の「水質」（2026/06/30現在、2026-10-12 照合）。
--   画面は src/data/venueWaterProfiles.js（公式の写し）を使うようにしたので、この適用の前後で画面は変わらない。
--   DB の値も公式に揃え、今後 water_type を読むコードが誤った値を拾わないようにする。
--   water_type を読むのは、このマイグレーション時点ではフロントの getVenueCharacteristics だけだった（いまは読まない）。
--
-- 食い違い7件（干満差は列が無いので対象外。常滑は水質は合っていて干満差だけが違う）:
--   7 蒲郡 sea→brackish / 9 津 sea→brackish / 12 住之江 sea→fresh / 13 尼崎 sea→fresh
--   21 芦屋 sea→fresh / 22 福岡 sea→brackish / 23 唐津 sea→fresh
--
-- 書き込み: venues の7行の water_type だけ。updated_at は触らない（update_venue_stats の集計時刻のため）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT code, water_type FROM venues WHERE code IN (7, 9, 12, 13, 21, 22, 23) ORDER BY code;
--   → 7 brackish / 9 brackish / 12 fresh / 13 fresh / 21 fresh / 22 brackish / 23 fresh
--   SELECT water_type, count(*) FROM venues GROUP BY water_type ORDER BY water_type;
--   → brackish 5 / fresh 9 / sea 10
--
-- 元に戻す（初期データの誤った値に戻る）:
--   BEGIN;
--   UPDATE venues SET water_type = 'sea' WHERE code IN (7, 9, 12, 13, 21, 22, 23);
--   COMMIT;

BEGIN;

UPDATE venues AS v
SET water_type = x.water_type
FROM (VALUES
    (7, 'brackish'),
    (9, 'brackish'),
    (12, 'fresh'),
    (13, 'fresh'),
    (21, 'fresh'),
    (22, 'brackish'),
    (23, 'fresh')
) AS x(code, water_type)
WHERE v.code = x.code
  AND v.water_type IS DISTINCT FROM x.water_type;

COMMIT;
