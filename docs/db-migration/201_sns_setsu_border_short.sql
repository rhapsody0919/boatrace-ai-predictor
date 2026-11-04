-- 201: YouTube Shorts「準優に残れるか」（節の機力の型の border、予選最終日の朝 08:00）と、同じ日 21:30 の節の機力の Shorts（border 以外の型）を
-- 同じ日に両方受けられるようにする（BOA-1249、hq BR02、オーナー 2026-10-31「SG/G1 の予選最終日だけ1日2本（機力＋B）」）。
-- 193 の一意の索引 sns_auto_send_items_setsu_day（channel, left(race_id,16)）が、setsu_kiryoku_short を全会場で1日1本にしているため、
-- border を朝に送ると 21:30 の節の機力が「既にある」で落ちる。
-- 形: item の variant で分ける。border の束は item の variant='border'、それ以外（motor_gap・motor_up・final_gap）は今どおり 'main'
--   （api/_lib/snsSetsuKiryokuShort.js の setsuItemVariantOf）。race_id の形（setsu:{日}:{会場コード}）は変えない。
--   1日1本は「同じ日・同じ channel・同じ variant に1つ」になる: border 1本＋border 以外 1本まで。border の2本目・border 以外の2本目は今どおり拒む。
--   同じ会場で両方出す日も、153 の sns_auto_send_items_race_channel（race_id, channel, variant）は variant が違うので通る。
-- 変えるもの（sns_auto_send_items だけ。関数・sns_auto_send_control は変えない）:
--   1. variant の CHECK（sns_auto_send_items_variant_check、189）に border を足す
--   2. variant_scope（189）に「border は setsu_kiryoku_short の youtube だけ」の枝を足す
--   3. sns_auto_send_items_setsu_id（193）: variant は main か border
--   4. sns_auto_send_items_setsu_day（193）を同じ名前で (channel, left(race_id,16), variant) に作り直す
-- 送り手の関数（transition_sns_send_139・transition_sns_x_send）は1日1本を見ていない（本数は日の上限 daily_limit_youtube で数える。
--   item の variant を読む public の関数は無い。2026-11-04 に本番を読み取りで確認）ので置き換えない。
--   1日1本の読み直しはコードの側: push-setsu-kiryoku-short.js の liveOf と snsClaimCheck.js の setsu_already_sent_today を同じ variant だけで数える。
-- 日の上限（daily_limit_youtube、今の本番 11）: このマイグレーションは変えない。border の日は YouTube が1本増える。
--   予定の最大は 全貌 4（完全版）＋4（Shorts）＋節の機力 1＋人気薄の1着 1＝10 で、border で 11（上限ちょうど。やり直し（held の後の再 claim）の余りが無い）。
--   border は朝 08:00 に先に枠を取るので、足りない日に落ちるのは後の束（21:30 の節の機力が push の日の上限の検査で拒否、exit 1）。
--   余りを持たせるなら、オーナーが border の旗（hq の config/shorts-border.json の send）を on にする日の前に 11→12 を当てる（PR の本文の SQL）。
--   クォータ（104 units×12＝1,248 ＜ general_limit 10,000、upload 12 ＜ 100）は足りる。X の取り置き（sns_x_kind_reserves）は X だけなので影響なし
-- 検証: scripts/maintenance/verify-sns-setsu-kiryoku-short.js（PGlite、外部接続なし。193 の後にこの 201 を当てて通す）
-- 適用の順: 193 の後ならいつでも（前提の DO が今の索引と3つの CHECK の定義を確かめ、違えば全体を戻す）。
--   コード（push-setsu-kiryoku-short.js・snsClaimCheck.js・snsSetsuKiryokuShort.js）とはどちらが先でも送らない側に倒れる:
--   コードが先なら border の item（variant='border'）を CHECK が拒み、push は下書きを公開保留にして落ちる（exit 6）。
--   マイグレーションが先なら、今のコードは border も variant='main' で入れるので今と同じ（1日1本）。db-apply は master の HEAD の SQL を当てる
-- 当てる時刻: 23:00〜04:59 JST（送り手の cron sns-send（JST 7:00〜22:58）と、item を書く sns-auto-plan（JST 5:00〜8:58・22:00〜22:55）の
--   どちらも止まっている間。sns_auto_send_items に ACCESS EXCLUSIVE を取る）。10秒取れなければ失敗し何も変わらない
-- ロック: sns_auto_send_items だけ（sns_auto_send_control は触らない。1つの表だけなので、control → items の順に読む runner と輪にならない）
--
-- 適用前の確認（読み取り）:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'sns_auto_send_items_setsu_day';
--   期待: CREATE UNIQUE INDEX sns_auto_send_items_setsu_day ON public.sns_auto_send_items USING btree (channel, "left"(race_id, 16)) WHERE ((kind = 'setsu_kiryoku_short'::text) AND (state <> ALL (ARRAY['stopped'::text, 'held_manual'::text])))
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN ('sns_auto_send_items_variant_check','sns_auto_send_items_variant_scope','sns_auto_send_items_setsu_id');
--   期待: 下の DO の3つの文字列（2026-11-04 に本番を読み取りで確認）
--   SELECT count(*) FROM public.sns_auto_send_items WHERE variant = 'border';  期待: 0
--
-- 適用後の確認（読み取り）:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'sns_auto_send_items_setsu_day';  期待: (channel, "left"(race_id, 16), variant)
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN ('sns_auto_send_items_variant_check','sns_auto_send_items_variant_scope','sns_auto_send_items_setsu_id');
--   期待: variant_check に border、variant_scope に border の枝、setsu_id に variant IN (main, border)
--   SELECT md5(prosrc) FROM pg_proc WHERE proname = 'transition_sns_send_139';  期待: a9cec5284463f5d6b450578f0a12772e（200 のまま。201 は触らない）
--
-- 戻し方（DDL は戻さない。border の item を新しく作らなければ、この索引と CHECK は 193 と同じ意味になる）:
--   1. hq の config/shorts-border.json を send=false にする（border の束を出さない）
--   2. 生きている border の item を止める:
--      UPDATE public.sns_auto_send_items SET state = 'stopped', stopped_at = now(), stopped_via = 'superseded' WHERE variant = 'border' AND state NOT IN ('stopped','held_manual','sent');
--   3. 1日1本に戻したいだけならコードを戻す（push が border も variant='main' で入れ、193 と同じく1日1本になる）
--   193 の定義に DDL で戻すのは、border の行（stopped・sent も）が1行も無いときだけできる（variant_check・setsu_id が既存の行を拒むため）
BEGIN;

SET LOCAL lock_timeout = '10s';
LOCK TABLE public.sns_auto_send_items IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  -- 前提: 193 の索引と、189・193 の CHECK のまま（別の変更が先に入っていれば全体を戻す）
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sns_auto_send_items_setsu_day')
     IS DISTINCT FROM 'CREATE UNIQUE INDEX sns_auto_send_items_setsu_day ON public.sns_auto_send_items USING btree (channel, "left"(race_id, 16)) WHERE ((kind = ''setsu_kiryoku_short''::text) AND (state <> ALL (ARRAY[''stopped''::text, ''held_manual''::text])))' THEN
    RAISE EXCEPTION '201: sns_auto_send_items_setsu_day が 193 の定義でない';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.sns_auto_send_items'::regclass AND conname = 'sns_auto_send_items_variant_check')
     IS DISTINCT FROM 'CHECK ((variant = ANY (ARRAY[''main''::text, ''shorts''::text, ''finals''::text, ''finals_poll''::text, ''finals_reply''::text, ''thinking''::text, ''thinking_poll''::text, ''thinking_reply''::text])))' THEN
    RAISE EXCEPTION '201: sns_auto_send_items_variant_check が 189 の定義でない';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.sns_auto_send_items'::regclass AND conname = 'sns_auto_send_items_variant_scope')
     IS DISTINCT FROM 'CHECK ((((variant = ''main''::text) AND (kind <> ALL (ARRAY[''finals_image''::text, ''today_thinking''::text]))) OR ((variant = ''shorts''::text) AND (kind = ''full_picture''::text) AND (channel = ''youtube''::text)) OR ((variant = ANY (ARRAY[''finals''::text, ''finals_poll''::text, ''finals_reply''::text])) AND (kind = ''finals_image''::text) AND (channel = ''x''::text)) OR ((variant = ANY (ARRAY[''thinking''::text, ''thinking_poll''::text, ''thinking_reply''::text])) AND (kind = ''today_thinking''::text) AND (channel = ''x''::text))))' THEN
    RAISE EXCEPTION '201: sns_auto_send_items_variant_scope が 189 の定義でない';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.sns_auto_send_items'::regclass AND conname = 'sns_auto_send_items_setsu_id')
     IS DISTINCT FROM 'CHECK (((kind <> ''setsu_kiryoku_short''::text) OR ((race_id ~ ''^setsu:[0-9]{4}-[0-9]{2}-[0-9]{2}:(0[1-9]|1[0-9]|2[0-4])$''::text) AND (variant = ''main''::text))))' THEN
    RAISE EXCEPTION '201: sns_auto_send_items_setsu_id が 193 の定義でない';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sns_auto_send_items WHERE variant = 'border') THEN
    RAISE EXCEPTION '201: 既存の item に variant=border の行がある';
  END IF;
END $$;

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_variant_check;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_variant_check
  CHECK (variant IN ('main', 'shorts', 'finals', 'finals_poll', 'finals_reply', 'thinking', 'thinking_poll', 'thinking_reply', 'border'));

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_variant_scope;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_variant_scope CHECK (
  (variant = 'main' AND kind NOT IN ('finals_image', 'today_thinking'))
  OR (variant = 'shorts' AND kind = 'full_picture' AND channel = 'youtube')
  OR (variant IN ('finals', 'finals_poll', 'finals_reply') AND kind = 'finals_image' AND channel = 'x')
  OR (variant IN ('thinking', 'thinking_poll', 'thinking_reply') AND kind = 'today_thinking' AND channel = 'x')
  OR (variant = 'border' AND kind = 'setsu_kiryoku_short' AND channel = 'youtube'));

-- setsu_kiryoku_short の版は main（border 以外の型）か border（準優に残れるか）
ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_setsu_id;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_setsu_id CHECK (
  kind <> 'setsu_kiryoku_short'
  OR (race_id ~ '^setsu:[0-9]{4}-[0-9]{2}-[0-9]{2}:(0[1-9]|1[0-9]|2[0-4])$' AND variant IN ('main', 'border')));

-- 1日1本を版ごとに（同じ JST の日に生きている・送った setsu_kiryoku_short は、border と border 以外で1つずつ）。
-- 直した版を入れ直すときは前の item を stopped（superseded）にしてから作る（193 と同じ）
DROP INDEX public.sns_auto_send_items_setsu_day;
CREATE UNIQUE INDEX sns_auto_send_items_setsu_day ON public.sns_auto_send_items (channel, left(race_id, 16), variant)
  WHERE kind = 'setsu_kiryoku_short' AND state NOT IN ('stopped', 'held_manual');

COMMIT;
