-- 079: 払戻明細テーブル race_payouts を新設する（勝式ごとの組番・払戻・人気、同着の複数口、特払・不成立）
--
-- 対応設計: docs/design/race-result-full-fields/plan.md（全データ設計 optimal-scraping-design.md §2.5・
--   data-catalog.md の N2・N3・E2・E6、ユーザー承認Q3・Q4）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でも良い。コードは、テーブルが現れてから約5分後
-- （判定のキャッシュ）に書き始める: scripts/lib/raceResultSchema.js）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   新規テーブルの作成のみ。既存テーブルには触れない（races への外部キーは、参照側のみ。races への
--   ロックは、外部キー作成時の短い SHARE ROW EXCLUSIVE のみ。races は約2.5万行）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'race_payouts' AND relkind = 'r';
--   → 1行、relrowsecurity = true
--   SELECT has_table_privilege('anon', 'public.race_payouts', 'SELECT');
--   → false（読み手が無い間は、匿名から読めない。画面で読むときにSELECTポリシーとGRANTを追加する）
--
-- ロールバック（データを書いた後は、全行が消える。旧形式の payout_* 列は残っているため、画面は壊れない）:
--   DROP TABLE IF EXISTS race_payouts;
--
-- 背景:
--   * race_results は払戻を「勝式ごとに1列（payout_win・payout_trifecta 等の15列）」で持つため、
--     (a) 同着の複数口（同じ勝式の行が増える）は2口目以降を捨てる、(b) 不成立・特払の区別が付かず「¥100」が
--     払戻として入る、(c) 3連単と3連複の列名が逆（payout_trifecta=3連複、payout_trio=3連単）
--   * 行として持てば、これらが解消する。1レース約8〜14行
--
-- 設計上の要点:
--   * 主キー (race_id, bet_type, seq)。seq は同じ勝式の中の行順（結果ページの並び。1から）。
--     組番を主キーに含めないのは、特払・不成立の行は組番が無い（NULL）ため
--   * bet_type: win=単勝, place=複勝, 2tan=2連単, 2fuku=2連複, wide=拡連複, 3tan=3連単, 3fuku=3連複
--     （kb_archive_races の payout_3tan・payout_3fuku と同じ命名。race_results の逆転を持ち込まない）
--   * payout_status:
--       paid       通常の払戻（組番あり）。payout=払戻金（100円あたり）
--       special    特払。payout=70（実際に払われる額）。組番はNULL（結果ページでは組番の位置に「特払」と出る）
--       no_amount  組番はあるが払戻金が空欄（特払の勝者の複勝）。payout=NULL
--       no_race    不成立。payout=NULL（結果ページの「¥100」は返還額で、払戻ではない）。組番はNULL
--   * combination は、旧 race_results の組番と同じ表記（「1-2-5」。区切りは、順序ありも順不同も「-」）。
--     順不同の勝式（2連複・拡連複・3連複）の組番は、結果ページの表示どおり（昇順）
--   * popularity: 人気順位（単勝・複勝は結果ページに表示が無いためNULL）
--   * 外部キー（races、ON DELETE CASCADE）: race_results・race_start_timings と同じ。書き込みは1日約150レース分で、
--     外部キーの検査コストは無視できる
--   * アクセス制御: RLSを有効にし、ポリシーを作らない。anon・authenticated の全権限を剥奪する
--     （書き込みは service_role のみ。現時点では読み手が無い）。画面が読むようになったら、そのPRで
--     CREATE POLICY ... FOR SELECT TO anon, authenticated USING (true) と GRANT SELECT を追加する
--     （公式データの再表示の範囲は ADR-0067）
--   * created_at・updated_at: race_start_timings（071）と同じ運用。created_at は INSERT時の DEFAULT now()、
--     updated_at は書き込み側が、変更のある行を書くときに設定する（変更の無い行は書かない: WS8(b)）
--   * 容量の見積り: 1レース約10行 × 約4.3万レース（過去分を充填した場合）≒ 43万行、約40MB＋主キー索引約25MB。
--     日次の増加は約1,500行

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS race_payouts (
  race_id       varchar(20) NOT NULL REFERENCES races (race_id) ON DELETE CASCADE,
  bet_type      text        NOT NULL,
  seq           smallint    NOT NULL,
  combination   text,
  payout        integer,
  payout_status text        NOT NULL,
  popularity    smallint,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz,
  PRIMARY KEY (race_id, bet_type, seq),
  CONSTRAINT chk_race_payouts_bet_type
    CHECK (bet_type IN ('win', 'place', '2tan', '2fuku', 'wide', '3tan', '3fuku')),
  CONSTRAINT chk_race_payouts_seq CHECK (seq >= 1),
  CONSTRAINT chk_race_payouts_status
    CHECK (payout_status IN ('paid', 'special', 'no_amount', 'no_race')),
  -- 状態と値の整合: 不成立・金額なしは払戻なし、通常・特払は払戻あり、通常は組番あり
  CONSTRAINT chk_race_payouts_consistency CHECK (
    (payout_status = 'paid' AND payout IS NOT NULL AND combination IS NOT NULL)
    OR (payout_status = 'special' AND payout IS NOT NULL)
    OR (payout_status = 'no_amount' AND payout IS NULL AND combination IS NOT NULL)
    OR (payout_status = 'no_race' AND payout IS NULL AND combination IS NULL)
  )
);

REVOKE ALL ON race_payouts FROM anon, authenticated;
ALTER TABLE race_payouts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE race_payouts IS '払戻明細（結果ページの払戻表を1行ずつ）。同着の複数口・特払・不成立を持つ。race_results の payout_* 15列（同着の2口目以降を捨てる・不成立の¥100が入る・3連単と3連複の列名が逆）の代わり。docs/design/race-result-full-fields/plan.md。読み取りはservice_roleのみ（画面が読むときにSELECTポリシーを追加する）';
COMMENT ON COLUMN race_payouts.bet_type IS 'win=単勝, place=複勝, 2tan=2連単, 2fuku=2連複, wide=拡連複, 3tan=3連単, 3fuku=3連複（race_results の payout_trio=3連単・payout_trifecta=3連複 の逆転を持ち込まない）';
COMMENT ON COLUMN race_payouts.seq IS '同じ勝式の中の行順（1から。結果ページの並び）。複勝2口・拡連複3口・同着の複数口';
COMMENT ON COLUMN race_payouts.payout_status IS 'paid=通常、special=特払（payout=70）、no_amount=組番はあるが払戻金が空欄、no_race=不成立（結果ページの¥100は返還額で払戻ではない）';
