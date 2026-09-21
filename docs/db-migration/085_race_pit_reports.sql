-- 085: ピットレポート（選手コメント）の保存先 race_pit_reports（ページ単位）・race_pit_comments（艇単位）を新設する
--
-- 対応設計: docs/design/pit-comments/spec.md・plan.md（Linear BOA-379、データ洗い出し data-catalog.md の N24）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でも良い。コードは、テーブルが現れてから約5分後
-- （判定のキャッシュ）に書き始める: scripts/lib/pitReportSchema.js）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   新規テーブルの作成のみ。既存テーブルには触れない（races への外部キーは参照側のみ。races へのロックは
--   外部キー作成時の短い SHARE ROW EXCLUSIVE のみ。races は約4.5万行）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('race_pit_reports', 'race_pit_comments') AND relkind = 'r';
--   → 2行、relrowsecurity = true
--   SELECT has_table_privilege('anon', 'public.race_pit_reports', 'SELECT'),
--          has_table_privilege('anon', 'public.race_pit_comments', 'SELECT');
--   → false, false（この時点では匿名から読めない。画面に出す準備ができたら 086 を適用する）
--
-- ロールバック（データを書いた後は、全行が消える。他のテーブル・画面には影響しない）:
--   DROP TABLE IF EXISTS race_pit_comments;
--   DROP TABLE IF EXISTS race_pit_reports;
--
-- 背景:
--   * 公式のピットレポート（boatrace.jp race/pitreport）は、SG・G1・G2の一部のレースで、レポーターが選手に取材した
--     コメント（自由記述）と、コメント自信度（★）を出す。ユーザー決定（2026-09-21）: AIでは言語化せず、レース詳細の
--     タブにそのまま表示する。そのため取得して保存する。公式サイトの再表示の扱いは docs/adr/0067
--   * 対象は、実測（2026-09-21）でSG（全レース）・G1・G2（多くの日は7R〜12R、最終日は12Rのみ）。G3・一般戦は対象外。
--     ページ自体が「対象レースではありません」と表示するため、その状態も race_pit_reports に残す（画面が
--     「対象外（非表示）」と「公開待ち」を区別できるように）
--
-- 設計上の要点:
--   * 2表構成。race_pit_reports は「レース単位のページの状態」（レポーター名・状態・元ページのハッシュ）、
--     race_pit_comments は「艇単位のコメント」。1レース1行・6艇6行。艇別の表にして、将来「選手ごとの過去のコメント」
--     を引けるようにする（registered racer_id）が、索引は今は作らない（YAGNI）
--   * race_pit_reports.status:
--       published   コメントが1件以上ある（comment_count >= 1）
--       not_target  公式ページが「表示対象ではありません」と表示した。target_from・target_to は、
--                   「7Rから12Rまで」「12Rが」の範囲（G3・一般戦のようにレース番号を示さない場合は NULL）
--     コメントが未公開（対象レースだがまだ無い）ときは、行を作らない（行が無い＝未公開または未取得）
--   * コメント本文 comment_text は、公式の表記をそのまま（全角記号・改行を含む）。末尾の「（コメント自信度・・★★☆）」だけ
--     confidence_stars（★の数。0〜3）へ分離する。自信度が付かないコメント（「【取材者寸評】」で始まるもの等）は NULL。
--     要約・改変はしない（画面が「そのまま」表示する要件）
--   * previous_race_number: 公式ページの「前走」の欄（その日の、その選手の直前のレース番号）。その日まだ
--     走っていない選手は NULL（リンクの中身が空）
--   * content_hash: 解析した内容（状態・レポーター・艇ごとの本文・自信度・前走）のハッシュ。再取得しても内容が
--     同じなら行を書かない（変更の無い行は書かない。WS8(b)）。公開後に内容が更新されたか（同じレースを時間をおいて
--     取得して比較）の実測結果は spec.md
--   * raw_storage_path: 取得した生のHTML（gzip）の、Supabase Storage上のパス。保管する場合のみ（NULL可）。
--     生データの保管方針は optimal-scraping-design.md Q1。パスには署名付きURLでなく生のパスを入れる
--   * created_at・updated_at: race_start_timings（071）と同じ運用。created_at は INSERT時の DEFAULT now()
--     （＝初めて公開を検知した時刻。公開時刻の計測に使う）、updated_at は書き込み側が、変更のある行（新規を含む）を書くときに設定する
--   * 外部キー: race_pit_reports → races、race_pit_comments → races（どちらも ON DELETE CASCADE）。
--     comments を reports への外部キーにしない理由: 書き込みの順序を「艇ごとのコメント → レース単位の行」にするため。
--     レース単位の行（content_hash）は「コメントの書き込みが完了した」ことの目印で、途中で失敗しても、次の取得が
--     同じ内容を書き直す（reports が先だと、reports だけ書けて comments を書けなかった状態で、次の取得が
--     「変更なし」と判断してコメントが欠けたままになる）。画面は reports の行があるレースだけ comments を読む
--   * 書き込みは1日数レース〜数十レース分で、外部キーの検査コストは無視できる
--   * アクセス制御: RLSを有効にし、ポリシーを作らない。anon・authenticated の全権限を剥奪する
--     （書き込みは service_role のみ）。匿名の読み取りは 086 で SELECT のみ許可する（画面に出す準備ができてから）
--   * 容量: 1レース約6コメント×約400文字。1日平均約7レース（SG・G1・G2の対象レース）で、日次の増加は約40行・約20KB。
--     過去分（2025-12〜）を充填しても数千行

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS race_pit_reports (
  race_id          varchar(20) PRIMARY KEY REFERENCES races (race_id) ON DELETE CASCADE,
  status           text        NOT NULL,
  target_from      smallint,
  target_to        smallint,
  reporter_name    text,
  comment_count    smallint    NOT NULL DEFAULT 0,
  content_hash     text        NOT NULL,
  parser_version   text        NOT NULL,
  raw_storage_path text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz,
  CONSTRAINT chk_race_pit_reports_status CHECK (status IN ('published', 'not_target')),
  CONSTRAINT chk_race_pit_reports_consistency CHECK (
    (status = 'published' AND comment_count >= 1)
    OR (status = 'not_target' AND comment_count = 0)
  ),
  CONSTRAINT chk_race_pit_reports_target_range CHECK (
    (target_from IS NULL AND target_to IS NULL)
    OR (target_from BETWEEN 1 AND 12 AND target_to BETWEEN 1 AND 12 AND target_from <= target_to)
  )
);

CREATE TABLE IF NOT EXISTS race_pit_comments (
  race_id              varchar(20)  NOT NULL REFERENCES races (race_id) ON DELETE CASCADE,
  boat_number          smallint     NOT NULL,
  racer_id             integer,
  comment_text         text         NOT NULL,
  confidence_stars     smallint,
  previous_race_number smallint,
  created_at           timestamptz  DEFAULT now(),
  updated_at           timestamptz,
  PRIMARY KEY (race_id, boat_number),
  CONSTRAINT chk_race_pit_comments_boat CHECK (boat_number BETWEEN 1 AND 6),
  CONSTRAINT chk_race_pit_comments_stars CHECK (confidence_stars IS NULL OR confidence_stars BETWEEN 0 AND 3),
  CONSTRAINT chk_race_pit_comments_prev CHECK (previous_race_number IS NULL OR previous_race_number BETWEEN 1 AND 12)
);

REVOKE ALL ON race_pit_reports FROM anon, authenticated;
REVOKE ALL ON race_pit_comments FROM anon, authenticated;
ALTER TABLE race_pit_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_pit_comments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE race_pit_reports IS '公式ピットレポート（選手コメント）のレース単位の状態。published=コメントあり、not_target=公式ページが表示対象外と表示。未公開のときは行なし。docs/design/pit-comments/spec.md。読み取りはservice_roleのみ（匿名の読み取りは086で許可する）';
COMMENT ON COLUMN race_pit_reports.target_from IS 'not_target のとき、公式ページが示した表示対象のレース番号の範囲（「7Rから12Rまで」なら7〜12、最終日の「12Rが」なら12〜12）。範囲を示さない（G3・一般戦）ときは NULL';
COMMENT ON COLUMN race_pit_reports.content_hash IS '解析した内容（状態・レポーター・艇ごとの本文・自信度・前走）のハッシュ。同じなら再取得しても書かない';
COMMENT ON COLUMN race_pit_reports.raw_storage_path IS '取得した生HTML（gzip）のStorage上のパス（生のパス。署名付きURLは入れない）。保管しない場合はNULL';
COMMENT ON COLUMN race_pit_reports.created_at IS '初めてこのレースのピットレポートを保存した時刻（公開の検知時刻。公開時刻の計測に使う）';
COMMENT ON COLUMN race_pit_reports.updated_at IS '行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）。公開後の内容の更新は、created_at との差で分かる';
COMMENT ON TABLE race_pit_comments IS '公式ピットレポートの艇ごとのコメント（自由記述）。本文は公式の表記のまま（要約・改変しない）。1レース最大6行';
COMMENT ON COLUMN race_pit_comments.comment_text IS 'コメント本文。全角記号・改行を含め、公式の表記のまま。末尾の「（コメント自信度・・★★☆）」は含めない（confidence_stars に分離）';
COMMENT ON COLUMN race_pit_comments.confidence_stars IS 'コメント自信度の★の数（0〜3。公式は★＝塗り・☆＝空の3つ組）。自信度が付かないコメント（「【取材者寸評】」等）はNULL';
COMMENT ON COLUMN race_pit_comments.previous_race_number IS '公式ページの「前走」の欄。その日のその選手の直前のレース番号。その日まだ走っていない選手はNULL';
