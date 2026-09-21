-- 087: BOATCASTのオリジナル展示（一周/半周ラップ・まわり足・直線。N25）と、モーター使用開始日（N26）の保存先を新設する
--       race_original_exhibition（レース単位）・race_original_exhibition_values（艇×項目の縦持ち）・venue_motor_start_dates
--
-- 対応設計: docs/design/boatcast-original-exhibition/spec.md・plan.md（データ洗い出し data-catalog.md の N25・N26、
--   docs/issues/boatcast-original-exhibition-investigation.md（BOA-281）、docs/adr/0067 の追記）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でも良い。コードは、テーブルが現れてから約5分後
-- （判定のキャッシュ）に書き始める: scripts/lib/boatcast/oritenSchema.js）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   新規テーブルの作成のみ。既存テーブルには触れない（races への外部キーは参照側のみ。races へのロックは
--   外部キー作成時の短い SHARE ROW EXCLUSIVE のみ。races は約4.5万行）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('race_original_exhibition', 'race_original_exhibition_values', 'venue_motor_start_dates')
--       AND relkind = 'r';
--   → 3行、relrowsecurity = true
--   SELECT has_table_privilege('anon', 'public.race_original_exhibition', 'SELECT'),
--          has_table_privilege('anon', 'public.race_original_exhibition_values', 'SELECT'),
--          has_table_privilege('anon', 'public.venue_motor_start_dates', 'SELECT');
--   → false, false, false（匿名から読めない。公式コンテンツの再表示を含むため、画面に出す場合は別のマイグレーションと承認が要る）
--
-- ロールバック（データを書いた後は、全行が消える。他のテーブル・画面には影響しない）:
--   DROP TABLE IF EXISTS race_original_exhibition_values;
--   DROP TABLE IF EXISTS race_original_exhibition;
--   DROP TABLE IF EXISTS venue_motor_start_dates;
--
-- 背景:
--   * BOATCAST（race.boatcast.jp。BOATRACE振興会の公式Web映像サービス）は、レース単位のTSVテキストで、公式の展示タイムに加えて、
--     会場が独自に計測する一周（または半周ラップ）・まわり足・直線を出す（オリジナル展示データ）。boatrace.jp には無い項目で、
--     機力の新規シグナル（BOA-271・274・275）。取得は Vercel Cron（api/cron/boatcast-oriten.js）
--   * 会場により公開する項目が異なる（一周・まわり足・直線の3項目、住之江・尼崎・徳山は直線なし、桐生は一周ではなく半周ラップ）。
--     項目名は位置ではなくラベルで解釈し、縦持ち（レース×艇×項目）で保存する。項目の定義（計測区間）は会場ごとに異なるため、
--     会場を跨いだ比較には使えず、会場内の相対比較用のデータとして扱う
--   * モーター使用開始日（bc_mst）は、会場ごとに1つの日付（モーター交換で変わる）。同じ日付が続く間は行を書かず、新しい
--     （会場, 使用開始日）の組が現れたときだけ追記する（履歴になる）
--
-- 設計上の要点:
--   * race_original_exhibition: 1レース1行。ファイルの計測状態（1=計測あり / 2=計測不可。計測不可のレースは値の行が無い）・
--     項目名・内容のハッシュ・公開時刻を持つ。content_hash は「値の書き込みが完了した」目印で、書き込みの順序は
--     「艇×項目の行 → レース単位の行」（途中で失敗しても、次の取得が同じ内容を書き直す。値の行の外部キーは races にする）
--   * source_last_modified: 取得元の HTTP Last-Modified。ファイルが最初に現れた時刻（公開時刻）に当たる（当日に取得した場合。
--     過去日のファイルは毎晩00:10 JST頃に再生成されて時刻が変わるため、公開時刻としては使えない）。完了の定義B（公開の何分前に
--     現れたか）の計測に使う。created_at（初めて保存した時刻）との差が、公開から検知までの遅延
--   * race_original_exhibition_values.kind: 項目名（空白を除いた表記。一周・半周ラップ・まわり足・直線。未知の項目名もそのまま入り、
--     parse_anomaly として通知される）。value は秒。欠測（ファイルの `--.--`。津・三国の一周など）は NULL。
--     選手名は保存しない（race_entries と艇番で突合できる）
--   * created_at・updated_at: race_start_timings（071）と同じ運用。created_at は INSERT時の DEFAULT now()、updated_at は
--     書き込み側が、変更のある行（新規を含む）を書くときに設定する（トリガーは使わない。値の行は通常、更新されない）
--   * アクセス制御: RLSを有効にし、ポリシーを作らない。anon・authenticated の全権限を剥奪する（書き込み・読み取りとも service_role のみ。
--     公式サイトのコンテンツの再表示の方針は docs/adr/0067。匿名の読み取りは付けない）
--   * 容量: 対象は23会場の全レース（約12〜13会場×12R＝1日約150レース）。値の行は1レース最大18行（6艇×3項目）で、
--     1日約2,700行（1行約70バイト、主キーの索引を含めて約0.3MB/日、約100MB/年）。race_original_exhibition は1日約150行。
--     venue_motor_start_dates は24会場×モーター交換の回数（年1〜2回）で、数十行。書き込みは1日約2,900行（1日の取得時に1回ずつ。
--     変更の無い行は書かない）

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS race_original_exhibition (
  race_id              varchar(20) PRIMARY KEY REFERENCES races (race_id) ON DELETE CASCADE,
  measure_status       smallint    NOT NULL,
  item_count           smallint    NOT NULL,
  item_labels          text        NOT NULL,
  content_hash         text        NOT NULL,
  parser_version       text        NOT NULL,
  source_last_modified timestamptz,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz,
  CONSTRAINT chk_race_original_exhibition_status CHECK (measure_status IN (1, 2)),
  CONSTRAINT chk_race_original_exhibition_item_count CHECK (item_count BETWEEN 1 AND 6)
);

CREATE TABLE IF NOT EXISTS race_original_exhibition_values (
  race_id     varchar(20)  NOT NULL REFERENCES races (race_id) ON DELETE CASCADE,
  boat_number smallint     NOT NULL,
  kind        text         NOT NULL,
  value       numeric(5,2),
  created_at  timestamptz  DEFAULT now(),
  updated_at  timestamptz,
  PRIMARY KEY (race_id, boat_number, kind),
  CONSTRAINT chk_race_original_exhibition_values_boat CHECK (boat_number BETWEEN 1 AND 6)
);

CREATE TABLE IF NOT EXISTS venue_motor_start_dates (
  venue_code smallint    NOT NULL,
  start_date date        NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (venue_code, start_date),
  CONSTRAINT chk_venue_motor_start_dates_venue CHECK (venue_code BETWEEN 1 AND 24)
);

REVOKE ALL ON race_original_exhibition FROM anon, authenticated;
REVOKE ALL ON race_original_exhibition_values FROM anon, authenticated;
REVOKE ALL ON venue_motor_start_dates FROM anon, authenticated;
ALTER TABLE race_original_exhibition ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_original_exhibition_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_motor_start_dates ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE race_original_exhibition IS 'BOATCASTのオリジナル展示（bc_oriten）のレース単位の状態。measure_status=1 計測あり、2 計測不可（値の行なし）。403（未公開・非公開）のレースは行なし。docs/design/boatcast-original-exhibition/。読み取りはservice_roleのみ';
COMMENT ON COLUMN race_original_exhibition.item_labels IS 'ファイルの項目名（空白を除いた表記）を | でつないだもの。例: 一周|まわり足|直線。会場により異なる';
COMMENT ON COLUMN race_original_exhibition.content_hash IS '解析した内容（計測状態・項目名・艇ごとの値。選手名は含まない）のハッシュ。同じなら再取得しても書かない。値の書き込み完了の目印';
COMMENT ON COLUMN race_original_exhibition.source_last_modified IS '取得元のHTTP Last-Modified。当日に取得した場合は、ファイルが最初に現れた時刻（公開時刻）。過去日のファイルは毎晩再生成されるため公開時刻ではない';
COMMENT ON COLUMN race_original_exhibition.created_at IS '初めてこのレースのオリジナル展示を保存した時刻（公開の検知時刻）。source_last_modified との差が、公開から検知までの遅延';
COMMENT ON COLUMN race_original_exhibition.updated_at IS '行の値が変わった時刻（新規の行は保存時刻）。書き込み側のコードが、変更のある行を書くときだけ設定する（トリガーは使わない）';
COMMENT ON TABLE race_original_exhibition_values IS 'BOATCASTのオリジナル展示の艇×項目の値（縦持ち）。会場により項目が異なり、項目の定義（計測区間）も会場ごとに違うため、会場内の相対比較用';
COMMENT ON COLUMN race_original_exhibition_values.kind IS '項目名（空白を除いた表記）。一周・半周ラップ・まわり足・直線。未知の項目名もそのまま入る（parse_anomalyとして通知）';
COMMENT ON COLUMN race_original_exhibition_values.value IS '秒。欠測（ファイルの --.--）は NULL';
COMMENT ON TABLE venue_motor_start_dates IS 'BOATCAST bc_mst のモーター使用開始日（会場ごと）。新しい（会場, 使用開始日）の組が現れたときだけ追記する履歴（モーターの世代の区切り）';
COMMENT ON COLUMN venue_motor_start_dates.created_at IS 'この（会場, 使用開始日）の組を初めて検知した時刻';
