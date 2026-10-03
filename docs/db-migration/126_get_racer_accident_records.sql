-- 126: 選手の今期の事故率（目安）に使う、選手ごとの出走回数と事故の走を返す RPC（BOA-327）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 背景:
--   レース詳細の基本情報タブに、6選手の今期の事故率（事故点÷出走回数、公式の配点）と B2 ライン（0.70）までの
--   残り点を出す（2026-10-03 ユーザー承認、docs/design/racer-accident-rate/）。画面から6人分の着欄
--   （race_start_timings、今期だけで1人約100〜150走×6艇）を毎回読むと重く、PostgREST の1,000行の上限にも近い。
--   この関数は選手ごとに1行（出走回数と、事故の走の一覧だけ）を返す。点数の計算は画面側の純関数
--   （src/utils/accidentRate.js）で行う（配点の規則を1か所に置き、検証スクリプトで固定するため）。
--
-- 定義（一次情報で確定。docs/design/racer-accident-rate/APPROVED.md）:
--   着欄コード = race_start_timings.official_finish_code（公式の成績ファイル K の生コード。116）
--   出走回数   = 01〜06・F・L1・K1・S1・S2 の件数（選手責任外の S0・L0・K0、00 は数えない。
--               2026-1期で公式の期別成績 fan の出走回数と1,625人全員一致）
--   事故の走   = F・L1・K1・S1・S2 の走（race_id・コード・レース種別。優勝戦かどうかは画面側で種別から判定する）
--   期間       = p_from 以上 p_to 未満の race_id（YYYY-MM-DD-会場-R の文字列比較。p_to は表示中のレースの日）
--
-- 権限: SECURITY INVOKER（呼び出し側の権限で読む）。読む3表（race_entries・race_start_timings・race_conditions）は、
--   既に匿名の SELECT が公開されている。113 の方針どおり、EXECUTE は anon・authenticated に明示して付ける。
-- 負荷: race_entries の (racer_id, race_id) 索引（055）で6人分を引き、主キーで race_start_timings・race_conditions を結ぶ。
--   1回の呼び出しで最大約900行を集約して6行を返す。
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   関数の作成と権限の付与のみで、表・データには触れない。開催時間帯に適用してよい。
--   コードのマージより先でも後でもよい（未適用の間、画面は事故率の目印と欄を出さない）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT has_function_privilege('anon', 'public.get_racer_accident_records(integer[], text, text)', 'EXECUTE');
--   → true
--   SELECT racer_id, starts, jsonb_array_length(incidents)
--     FROM get_racer_accident_records(ARRAY[5242, 5430, 3300], '2026-05-01', '2026-10-03');
--   → 5242: 64 / 3、5430: 38 / 2、3300: 99 / 1（2026-10-03 の実測。補完の状況で多少変わる）
--
-- 元に戻す:
--   DROP FUNCTION IF EXISTS public.get_racer_accident_records(integer[], text, text);

BEGIN;

CREATE OR REPLACE FUNCTION public.get_racer_accident_records(
  p_racer_ids integer[],
  p_from text,
  p_to text
)
RETURNS TABLE (racer_id integer, starts integer, incidents jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    re.racer_id,
    (count(*) FILTER (
      WHERE rst.official_finish_code IN ('01', '02', '03', '04', '05', '06', 'F', 'L1', 'K1', 'S1', 'S2')
    ))::integer AS starts,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'race_id', rst.race_id,
          'code', rst.official_finish_code,
          'stage', rc.race_stage
        )
        ORDER BY rst.race_id
      ) FILTER (WHERE rst.official_finish_code IN ('F', 'L1', 'K1', 'S1', 'S2')),
      '[]'::jsonb
    ) AS incidents
  FROM race_entries re
  JOIN race_start_timings rst
    ON rst.race_id = re.race_id AND rst.boat_number = re.boat_number
  LEFT JOIN race_conditions rc
    ON rc.race_id = re.race_id
  WHERE re.racer_id = ANY (p_racer_ids)
    AND re.race_id >= p_from
    AND re.race_id < p_to
  GROUP BY re.racer_id
$$;

REVOKE ALL ON FUNCTION public.get_racer_accident_records(integer[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_racer_accident_records(integer[], text, text) TO anon, authenticated;

COMMIT;
