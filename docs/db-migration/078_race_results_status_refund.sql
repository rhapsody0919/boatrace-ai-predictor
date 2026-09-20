-- 078: race_results にレースの状態（通常・一部返還・不成立）・返還艇・備考を追加する
--
-- 対応設計: docs/design/race-result-full-fields/plan.md（全データ設計 optimal-scraping-design.md §2.5・
--   data-catalog.md の N2・E2・E3、ユーザー承認Q4）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でも良い。コードは、列が現れてから約5分後
-- （判定のキャッシュ）にこの3列を書き始める: scripts/lib/raceResultSchema.js）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   ALTER TABLE ... ADD COLUMN（DEFAULTなし・NULL可）はメタデータのみの変更で、テーブルを書き換えず、
--   **行のUPDATEを発生させない**（race_results の UPDATE は trg_update_predictions で predictions・
--   bet_recommendations の再UPDATEを連鎖させる。列の追加はトリガーを発火しない）。
--   ACCESS EXCLUSIVE ロックを一瞬取るため lock_timeout を設定してある（10秒取れなければ失敗し、何も変更されない）。
--   適用は、開催時間帯（JST 8:00〜21:30頃）を避けると、ロック競合の可能性が下がる。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'race_results'
--      AND column_name IN ('race_status','refund_boats','remark') ORDER BY 1;
--   → 3行（race_status=text, refund_boats=ARRAY, remark=text）
--
-- ロールバック（データを書いた後は、その3列の値が失われる）:
--   ALTER TABLE race_results DROP CONSTRAINT IF EXISTS chk_race_results_status,
--     DROP COLUMN IF EXISTS race_status, DROP COLUMN IF EXISTS refund_boats, DROP COLUMN IF EXISTS remark;
--
-- 背景（実測: data-catalog.md §5 E2・E3）:
--   * 返還・不成立のレースの払戻「¥100」が、払戻の列（payout_trifecta 等）に数値として保存され、回収率・期待値・
--     的中判定を汚している（フライング発生438レース（2026-04-01〜）のうち45レースで payout_trifecta=100）
--   * is_cancelled・is_no_race は全43,125行が false で機能していない（返還・不成立は別の設計に置き換える。
--     これらの列は、読み手の移行後に廃止する。本マイグレーションでは触れない）
--
-- 設計上の要点:
--   * race_status: 'normal'=返還も不成立も無い / 'partial_refund'=返還艇がある、または一部の勝式が不成立
--     （残りの勝式は通常どおり払われる。例: 欠場1艇、フライング4艇で単勝・2連単のみ成立）/
--     'no_race'=全勝式が不成立。中止・順延（結果ページ自体が無い）は races.cancellation_status の担当で、
--     race_results の行が無いため、ここには現れない
--   * **NULL=未判定**（078以前に書かれた行、または払戻表を読めなかった行）。DEFAULTを付けない理由:
--     DEFAULT 'normal' を付けると、過去の返還・不成立の行が、誤って「通常」に見えるため。
--     読み手は「race_status が 'no_race' でない」（IS DISTINCT FROM）で判定する。過去分の充填は、
--     返還・不成立のレースだけを更新する（plan.md「Q6の修正計画」。全行のUPDATEは trg_update_predictions を
--     全行で発火させるため行わない）
--   * refund_boats: 返還艇の枠番（昇順）。返還が無ければ空配列 '{}'。NULL=未判定。
--     返還されるのは F（フライング）・L（出遅れ）・欠（欠場）の艇で、落・転・沈・妨・エは返還されない
--     （実ページの返還表で確認）
--   * remark: 結果ページの備考（「【返還艇あり】」「【同着あり】」等）。空なら NULL
--   * 既存の rank1〜6・payout_*・popularity_* の列は変更しない。読み手の移行が済むまで、これらは旧形式で残す
--     （rank4〜6 は非完走艇を含まなくなり、返還・不成立の払戻は NULL になる。plan.md「互換」）

SET LOCAL lock_timeout = '10s';

ALTER TABLE race_results
  ADD COLUMN IF NOT EXISTS race_status  text,
  ADD COLUMN IF NOT EXISTS refund_boats smallint[],
  ADD COLUMN IF NOT EXISTS remark       text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_race_results_status') THEN
    ALTER TABLE race_results
      ADD CONSTRAINT chk_race_results_status
      CHECK (race_status IN ('normal', 'partial_refund', 'no_race')) NOT VALID;
  END IF;
END
$$;

ALTER TABLE race_results VALIDATE CONSTRAINT chk_race_results_status;

COMMENT ON COLUMN race_results.race_status IS 'レースの状態。normal=通常、partial_refund=返還艇あり・一部の勝式が不成立、no_race=全勝式が不成立。NULL=未判定（078以前の行）。読み手は IS DISTINCT FROM ''no_race'' で判定する';
COMMENT ON COLUMN race_results.refund_boats IS '返還艇の枠番（昇順）。返還なしは空配列、NULL=未判定。返還されるのはF・L・欠の艇';
COMMENT ON COLUMN race_results.remark IS '結果ページの備考（【返還艇あり】【同着あり】等）。空ならNULL';
