-- K/Bファイル（公式ダウンロードデータ）の長期バックフィル用アーカイブ表（3表）を新設する
--
-- 設計: docs/design/kb-longterm-backfill/plan.md（保存設計の比較と推奨、容量見積り）
-- 対象: 2019-04〜2025-12-02のK/Bファイル由来の行（本体テーブルの範囲=2025-12-03以降とは重ならない）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。バックフィルのloadより先に適用する）:
--   Supabase Dashboard > SQL Editor で、次の全体を実行する。
--     BEGIN;
--     （このファイルの SET LOCAL・CREATE TABLE・REVOKE・ALTER TABLE・COMMENT）
--     COMMIT;
--   新規テーブルの作成のみで、既存テーブルには触れない（ロックは新規テーブルにしか掛からない）。
--
--   適用後の確認（読み取りのみ）:
--     SELECT table_name FROM information_schema.tables
--      WHERE table_schema = 'public' AND table_name LIKE 'kb_archive_%' ORDER BY 1;
--     → kb_archive_boats / kb_archive_races / kb_archive_venue_days の3行
--     SELECT relname, relrowsecurity FROM pg_class
--      WHERE relname LIKE 'kb_archive_%' AND relkind = 'r';
--     → 3行とも relrowsecurity = true（ポリシー無し=anon・authenticatedからは読めない）
--
--   ロールバック（データを入れる前なら安全。入れた後は全行が消える）:
--     DROP TABLE kb_archive_boats, kb_archive_races, kb_archive_venue_days;
--
-- 背景: BOA-271（アナロジー・ファインダー）の母数と、SG・G1の優勝戦・準優勝戦等の稀少セグメントの
-- nを増やすため、公式ダウンロードデータ（Kファイル=競走成績、Bファイル=番組表）を2019-04頃まで
-- 遡って取得する（ユーザー決定、2026-09-20）。本体テーブル（races・race_entries等）へ混ぜず、
-- 別の軽量な表に分ける理由:
--   1. 本体テーブルの値と定義が完全には一致しない（例: local_win_rateは本体=racelistページ、
--      アーカイブ=Bファイル。同じレースでも数値が異なる）。混ぜると既存の集計・画面が意図せず
--      過去分を拾い、値が変わる
--   2. 本体へ約35万レース×6艇を入れるとDBが約2.3GBになる見積り（アーカイブ表は約+0.5GB）。
--      Disk IO Budget枯渇の実績があるため、書き込み量・索引・WALを抑える
--   3. 本体の race_results には trg_update_predictions（INSERT/UPDATE毎に predictions を再UPDATE）が
--      あり、過去分の一括投入で連鎖UPDATEが発生する。アーカイブ表にはトリガー・外部キーを付けない
--
-- 設計上の決定:
--   - created_at はNULL可・DEFAULTなし。バックフィル行はNULL（取得時刻を偽らない。
--     .claude/rules/data-acquisition.md「バックフィル行の識別」）
--   - 外部キー・トリガーは付けない（投入コストを下げる。整合は kb-backfill.js の検証で担保）
--   - RLSを有効にしポリシーを作らない。anon・authenticatedは読めない（service_roleのみ。
--     公式データの再表示ポリシー ADR-0067 に照らし、アーカイブを公開APIへ出さない）
--   - 列名は曖昧さの無い名前にする（payout_3tan=3連単。本体 race_results は
--     payout_trio=3連単・payout_trifecta=3連複と逆転しているため、その癖を持ち込まない）
--   - race_grade（SG/G1/G2/G3/ippan）はK/Bに無いため、当面はNULL。race/index（boatrace.jp）の
--     過去日ページ（1日1リクエスト）で補完する（別ステップ。plan.md参照）

SET LOCAL lock_timeout = '10s';

-- 開催（会場×日）単位。タイトル・日目・グレード等、12レースに共通する情報を1行にする
CREATE TABLE IF NOT EXISTS kb_archive_venue_days (
  venue_day_id  text PRIMARY KEY,            -- 'YYYY-MM-DD-VV'（VVは会場コード2桁）
  race_date     date NOT NULL,
  venue_code    smallint NOT NULL,
  title         text,                        -- 開催タイトル（Kファイル本文の正式名称）
  title_short   text,                        -- 見出し行の20文字切り詰め版
  day_label     text,                        -- 第3日 / 最終日
  series_day    smallint,
  is_final_day  boolean NOT NULL DEFAULT false,
  has_k         boolean NOT NULL,            -- Kファイル（成績）に含まれていたか
  has_b         boolean NOT NULL,            -- Bファイル（番組表）に含まれていたか
  race_grade    text,                        -- SG/G1/G2/G3/ippan。K/Bには無く後から補完（NULL可）
  created_at    timestamptz                  -- バックフィル行はNULL
);

-- レース単位
CREATE TABLE IF NOT EXISTS kb_archive_races (
  race_id          text PRIMARY KEY,         -- 'YYYY-MM-DD-VV-RR'（本体 races.race_id と同形式）
  venue_day_id     text NOT NULL,
  race_date        date NOT NULL,
  venue_code       smallint NOT NULL,
  race_number      smallint NOT NULL,
  stage            text,                     -- ステージ名の原文（K/Bで8文字程度に切り詰め）
  stage_kind       text,                     -- final / semifinal / qualifier / other（名称の部分一致による区分）
  distance_m       smallint,
  deadline_time    time,                     -- 電話投票締切予定時刻（Bファイル）
  weather          text,                     -- Kファイルの確定値（発走時点）
  wind_direction   text,
  wind_speed       smallint,
  wave_height      smallint,
  technique        text,                     -- 決まり手
  has_result       boolean NOT NULL,         -- Kファイルに結果があるか（false=中止・不成立等の可能性）
  dead_heat        boolean NOT NULL DEFAULT false,  -- 同着の有無（本体テーブルは同着を保持できない）
  payout_win       integer,
  payout_2tan      integer,
  payout_2fuku     integer,
  payout_3tan      integer,                  -- 3連単（同着で複数ある場合は先頭の1件）
  payout_3fuku     integer,                  -- 3連複
  combo_3tan       text,                     -- 3連単の組番（例: 1-4-6）
  popularity_3tan  smallint,
  created_at       timestamptz               -- バックフィル行はNULL
);

-- 艇単位（1レース6行）
CREATE TABLE IF NOT EXISTS kb_archive_boats (
  race_id            text NOT NULL,
  boat_number        smallint NOT NULL,
  racer_id           integer,
  class              text,                   -- A1/A2/B1/B2（Bファイル）
  age                smallint,
  branch             text,                   -- 支部
  weight             smallint,
  national_win_rate  numeric(4,2),
  national_2rate     numeric(5,2),
  local_win_rate     numeric(4,2),
  local_2rate        numeric(5,2),
  motor_number       smallint,
  motor_2rate        numeric(5,2),
  boat_id            smallint,               -- ボート番号（本体 race_entries.boat_number_id）
  boat_2rate         numeric(5,2),
  exhibition_time    numeric(4,2),           -- 展示タイム（Kファイル）
  course             smallint,               -- 実際の進入コース（Kファイル）
  start_timing       numeric(4,2),           -- ST。フライングは負値
  is_flying          boolean,
  is_late_start      boolean,
  finish_raw         text,                   -- 着の原文（01〜06 / F / L0 / S0 / K0 等）
  finish_rank        smallint,               -- 数値の着（同着は同じ値が複数艇に入る）
  race_seconds       numeric(5,1),
  created_at         timestamptz,            -- バックフィル行はNULL
  PRIMARY KEY (race_id, boat_number)
);

REVOKE ALL ON kb_archive_venue_days, kb_archive_races, kb_archive_boats FROM anon, authenticated;
ALTER TABLE kb_archive_venue_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_archive_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_archive_boats ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE kb_archive_venue_days IS 'K/Bファイル由来の開催（会場×日）アーカイブ。2019-04〜2025-12-02（設計: docs/design/kb-longterm-backfill/）。読み取りはservice_roleのみ';
COMMENT ON TABLE kb_archive_races IS 'K/Bファイル由来のレースアーカイブ。本体racesとは別表（値の定義が一致しない列があるため混ぜない）';
COMMENT ON TABLE kb_archive_boats IS 'K/Bファイル由来の艇アーカイブ（1レース6行）。BOA-271の学習・類似検索用';
COMMENT ON COLUMN kb_archive_races.payout_3tan IS '3連単の払戻。本体race_results.payout_trioに相当（本体は3連単・3連複の命名が逆転している）';
COMMENT ON COLUMN kb_archive_races.payout_3fuku IS '3連複の払戻。本体race_results.payout_trifectaに相当';
