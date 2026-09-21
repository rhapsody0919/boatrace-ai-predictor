-- 081: 出走表（racelist）の全項目化 — race_entries に選手の登録体重・支部・出身地・F数・L数・欠場を、
--      race_conditions にレースの距離・ラベルを追加する
--
-- 対応設計: docs/design/pre-race-full-fields/plan.md（全データ設計 docs/design/scraping-vercel-consolidation/
--   optimal-scraping-design.md §2.5・data-catalog.md の N13・N14・N17、ユーザー承認Q3）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。**コードのマージより先でも後でも良い**。コードは、列が無い間は旧実装と同じ列だけを
-- 書き、列が現れてから約5分後（判定のキャッシュ）に新しい列も書き始める: scripts/lib/preRaceSchema.js）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   ALTER TABLE ... ADD COLUMN（DEFAULTなし・NULL可）はメタデータのみの変更で、テーブルを書き換えない
--   （2026-09-21の推定行数: race_entries は約26万行・87MB、race_conditions は約3.3万行・8MB）。ACCESS EXCLUSIVE ロックを一瞬取るため、
--   SET LOCAL lock_timeout で待ち時間を制限してある（取得の書き込みと重なって10秒取れなければ失敗し、何も変更されない。
--   時間をおいて再実行）。制約は NOT VALID で追加してから VALIDATE する（VALIDATE は SHARE UPDATE EXCLUSIVE で、
--   書き込みを止めない）。適用は、開催時間帯（JST 8:00〜21:30頃）を避けると、ロック競合の可能性が下がる。
--   これらのテーブルにはトリガーが無い（2026-09-21に pg_trigger で確認）ため、列の追加・後日の更新で、
--   予測の再計算などは起きない。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND ((table_name = 'race_entries' AND column_name IN ('weight_kg','branch','hometown','f_count','l_count','is_absent'))
--        OR (table_name = 'race_conditions' AND column_name IN ('race_distance_m','race_labels')))
--    ORDER BY 1, 2;
--   → 8行（weight_kg=numeric, branch/hometown=text, f_count/l_count/race_distance_m=smallint, is_absent=boolean,
--     race_labels=ARRAY）
--
-- ロールバック（データを書いた後は、その8列の値が失われる。旧形式の読み手は、この列を読まない）:
--   ALTER TABLE race_entries
--     DROP CONSTRAINT IF EXISTS chk_re_f_count, DROP CONSTRAINT IF EXISTS chk_re_l_count,
--     DROP COLUMN IF EXISTS weight_kg, DROP COLUMN IF EXISTS branch, DROP COLUMN IF EXISTS hometown,
--     DROP COLUMN IF EXISTS f_count, DROP COLUMN IF EXISTS l_count, DROP COLUMN IF EXISTS is_absent;
--   ALTER TABLE race_conditions
--     DROP CONSTRAINT IF EXISTS chk_rc_race_distance_m,
--     DROP COLUMN IF EXISTS race_distance_m, DROP COLUMN IF EXISTS race_labels;
--
-- 背景（2026-09-21に実ページ12件・本番DBで確認: docs/design/pre-race-full-fields/plan.md）:
--   * 出走表には、F数・L数（今期）・登録体重・支部/出身地があるが、旧実装（update-race-info.js）は解析して捨てていた
--     （N13・N14）。F持ちの選手は攻めのSTを鈍らせる主要な選手状態。今期の累積は日々増えるため、
--     出走時点の値は後から取り直せない。レースごと（race_entries の行）に持つ（racer_profiles の期別値とは別）
--   * レースのラベル（「安定板使用」。水面が荒れる環境シグナル）を捨てていた（N17）
--   * 距離（1800m・1200m）を捨てていた。**1200m のレース（2周と推定）が存在する**（三国 2026-09-21 4R・宮島 2026-09-20 8R 等。
--     data-catalog.md は「全て1800m」と記していたが、誤り）。レース展開が変わるため、特徴量・分析で区別が要る
--   * 欠場艇は、出走表の tbody に is-miss が付く（唐津 2026-09-16 12R の1号艇）。結果ページの「欠」より前に分かる
--   * 平均ST は、前期の値で、fanファイル（期別成績）と一致する（別担当のN13）。ここでは保存しない
--   * モーター・ボートの変更の赤表示は、実ページで観測できなかった（児島 2026-09-21 7R: ボート30→42の変更でも赤なし）。
--     変更は、同じ選手・節の前回の値との比較で導出できるため、列を作らない（plan.md）
--
-- 設計上の要点:
--   * 新しい列は全て NULL 可・DEFAULTなし。既存の行は NULL のまま（過去分の充填は別途。F数・L数の過去分は、
--     Kファイルの累積からの導出を検討: plan.md「N19」）
--   * weight_kg は登録体重（出走表の「52.0kg」）。beforeinfo の当日体重は exhibition_data.today_weight（別）
--   * f_count・l_count は、出走表の「F0 / L0」の数（今期）。「-」等で読めなければ NULL
--   * is_absent は、NULL=未判定（081以前の行）、false=欠場の表示なし、true=欠場の表示あり
--   * race_labels は、NULL=未取得（081以前の行）、'{}'=ラベルなしを確認、それ以外=ラベルの表記そのまま
--     （例: {安定板使用}）。CHECKは付けない（未観測のラベル「進入固定」等が現れても書き込みを失敗させない）
--   * race_distance_m は、見出しの「1800m」の数値
--   * RLS・ポリシー・GRANTは変更しない（race_entries・race_conditions は076で SELECTポリシーが付いている。
--     列の追加は影響しない。追加する列は公式ページの再表示の範囲: ADR-0067）。既存の画面・RPCは列を明示して読むため、
--     payload は変わらない（select("*") で読む箇所は、これらのテーブルに無いことを確認済み）

SET LOCAL lock_timeout = '10s';

ALTER TABLE race_entries
  ADD COLUMN IF NOT EXISTS weight_kg numeric(4,1),
  ADD COLUMN IF NOT EXISTS branch    text,
  ADD COLUMN IF NOT EXISTS hometown  text,
  ADD COLUMN IF NOT EXISTS f_count   smallint,
  ADD COLUMN IF NOT EXISTS l_count   smallint,
  ADD COLUMN IF NOT EXISTS is_absent boolean;

ALTER TABLE race_conditions
  ADD COLUMN IF NOT EXISTS race_distance_m smallint,
  ADD COLUMN IF NOT EXISTS race_labels     text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_re_f_count') THEN
    ALTER TABLE race_entries
      ADD CONSTRAINT chk_re_f_count CHECK (f_count >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_re_l_count') THEN
    ALTER TABLE race_entries
      ADD CONSTRAINT chk_re_l_count CHECK (l_count >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rc_race_distance_m') THEN
    ALTER TABLE race_conditions
      ADD CONSTRAINT chk_rc_race_distance_m CHECK (race_distance_m > 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE race_entries VALIDATE CONSTRAINT chk_re_f_count;
ALTER TABLE race_entries VALIDATE CONSTRAINT chk_re_l_count;
ALTER TABLE race_conditions VALIDATE CONSTRAINT chk_rc_race_distance_m;

COMMENT ON COLUMN race_entries.weight_kg IS '出走表の選手の登録体重（kg）。beforeinfo の当日体重は exhibition_data.today_weight。081以前の行はNULL';
COMMENT ON COLUMN race_entries.branch IS '出走表の支部（例: 福岡）。081以前の行はNULL';
COMMENT ON COLUMN race_entries.hometown IS '出走表の出身地（例: 北海道）。081以前の行はNULL';
COMMENT ON COLUMN race_entries.f_count IS '出走表のF数（今期のフライング回数）。取得時点の値。読めなければNULL';
COMMENT ON COLUMN race_entries.l_count IS '出走表のL数（今期の出遅れ回数）。取得時点の値。読めなければNULL';
COMMENT ON COLUMN race_entries.is_absent IS '出走表で欠場の表示（tbody の is-miss）があるか。NULL=未判定（081以前の行）、false=表示なし、true=欠場の表示あり';
COMMENT ON COLUMN race_conditions.race_distance_m IS 'レースの距離（m。見出しの「1800m」）。1200mのレースがある';
COMMENT ON COLUMN race_conditions.race_labels IS 'レースのラベル（表記そのまま。例: {安定板使用}）。NULL=未取得、{}=ラベルなしを確認。未観測のラベルも書けるよう、CHECKは付けない';
