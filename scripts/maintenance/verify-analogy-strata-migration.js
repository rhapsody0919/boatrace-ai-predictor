/**
 * verify-analogy-strata-migration.js - マイグレーション120（BOA-271 FR-2 類似レース・層別 S*）の検証。
 * インメモリの Postgres（PGlite）に、本番と同じ名前の元テーブルの縮約版とロールを作り、
 * docs/db-migration/120_analogy_strata.sql を実際に適用して、固定データで次を確認する。本番DBには接続しない。
 *
 * 確認すること:
 *   (a) 勝率差の帯: 1/100単位で比べ、境界ちょうどは上の帯。勝率が取れなければ「不明」帯（5）
 *   (b) 母集団に入るのは完全レースだけ（返還艇が1〜3着・欠場・不成立・中止のレースは入らない）
 *   (c) 条件の値: 勝率1位は同率なら小さい艇番、級別、勝率差。6分類以外の決まり手は NULL
 *   (d) 値の約束（BOA-635 R1〜R4）: 3連単は本体の payout_trio、返還艇の ST は NULL、実進入不明は NULL
 *   (e) refresh_analogy_pool: 2回目は書かない（変わった行だけ）。完全レースでなくなった行を消す
 *   (f) スナップショット: 締切前のレースに1行、2回目は作らない。自動の深さの分布を保存し、RPC はそれを返す
 *   (g) get_analogy_similar: 深さ1〜4の件数、深さの指定、スナップショット無しでも数えられる
 *   (h) 権限: 匿名は RPC と2表の SELECT だけ。refresh・スナップショット作成・書き込みはできない
 *   (i) 任意の条件（Q6）: ラウンドの分類が getRaceStageCategory（JS）と同じ、グレードの補い方、モーター順位帯、
 *       母集団の3列、RPC の絞り込み・「足すと N件」・値が不明な条件をオンにしたときの例外
 *
 * 実行: npm run verify:analogy-strata-migration（@electric-sql/pglite は devDependency）
 * 注意: 検証対象は縮約フィクスチャ。本番データとの照合は verify-analogy-pool.js（manual）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { getRaceStageCategory } from "../../src/constants/raceStageConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
  __dirname,
  "../../docs/db-migration/120_analogy_strata.sql",
);

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(
    `${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : ` — ${detail}`}`,
  );
  if (!ok) failures.push(label);
};

// 縮約した元テーブル（使う列だけ）
const SCHEMA = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE races (race_id varchar PRIMARY KEY, race_date date, venue_code smallint, race_number smallint,
  start_time time, cancellation_status text, race_grade varchar);
CREATE TABLE race_entries (race_id varchar, boat_number smallint, grade varchar, win_rate numeric, is_absent boolean,
  motor_2rate numeric, PRIMARY KEY (race_id, boat_number));
CREATE TABLE race_conditions (race_id varchar PRIMARY KEY, race_stage varchar);
CREATE TABLE race_series (venue_code smallint, start_date date, end_date date, grade text);
CREATE TABLE race_results (race_id varchar PRIMARY KEY, rank1 smallint, rank2 smallint, rank3 smallint, rank4 smallint,
  rank5 smallint, rank6 smallint, is_cancelled boolean, is_no_race boolean, race_status text, winning_technique text,
  payout_trio integer, payout_trifecta integer,
  actual_course_1 smallint, actual_course_2 smallint, actual_course_3 smallint,
  actual_course_4 smallint, actual_course_5 smallint, actual_course_6 smallint, refund_boats smallint[]);
CREATE TABLE race_start_timings (race_id varchar, boat_number smallint, start_timing numeric, is_flying boolean,
  is_late_start boolean, finish_mark text, PRIMARY KEY (race_id, boat_number));
CREATE TABLE exhibition_data (race_id varchar, boat_number smallint, is_absent boolean, PRIMARY KEY (race_id, boat_number));
CREATE TABLE kb_archive_races (race_id varchar PRIMARY KEY, race_date date, venue_code smallint, race_number smallint,
  technique text, payout_3tan integer, has_result boolean, stage_kind text, venue_day_id text);
CREATE TABLE kb_archive_venue_days (venue_day_id text PRIMARY KEY, race_grade text);
CREATE TABLE kb_archive_boats (race_id varchar, boat_number smallint, class text, national_win_rate numeric,
  course smallint, start_timing numeric, is_flying boolean, is_late_start boolean, finish_rank smallint, finish_raw text,
  motor_2rate numeric, PRIMARY KEY (race_id, boat_number));
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
`;

// 6艇の値を1行にまとめて書くための小道具
const kbRace = async (
  db,
  id,
  { tech = "逃げ", payout = 1230, has = true } = {},
  boats,
) => {
  const [d, , , v, r] = [
    id.slice(0, 10),
    0,
    0,
    Number(id.slice(11, 13)),
    Number(id.slice(14, 16)),
  ];
  await db.query("INSERT INTO kb_archive_races VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    id,
    d,
    v,
    r,
    tech,
    payout,
    has,
  ]);
  for (const b of boats) {
    await db.query(
      "INSERT INTO kb_archive_boats VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        b.n,
        b.cls ?? "B1",
        b.w,
        b.course === undefined ? b.n : b.course,
        b.st ?? 0.15,
        b.f ?? false,
        false,
        b.fin,
        b.raw ?? String(b.fin),
      ],
    );
  }
};
const mainRace = async (db, id, opt, boats) => {
  const d = id.slice(0, 10),
    v = Number(id.slice(11, 13)),
    r = Number(id.slice(14, 16));
  await db.query("INSERT INTO races VALUES ($1,$2,$3,$4,$5,$6)", [
    id,
    d,
    v,
    r,
    opt.start ?? "12:00",
    opt.cancel ?? null,
  ]);
  for (const b of boats) {
    await db.query("INSERT INTO race_entries VALUES ($1,$2,$3,$4,$5)", [
      id,
      b.n,
      b.cls ?? "B1",
      b.w,
      b.absent ?? false,
    ]);
    if (opt.noResult) continue;
    await db.query("INSERT INTO race_start_timings VALUES ($1,$2,$3,$4,$5)", [
      id,
      b.n,
      b.st ?? 0.15,
      b.f ?? false,
      false,
    ]);
  }
  if (opt.noResult) return;
  const order = [...boats].sort((a, b) => a.fin - b.fin).map((b) => b.n);
  const course = (n) => {
    const b = boats.find((x) => x.n === n);
    return b.course === undefined ? n : b.course;
  };
  await db.query(
    `INSERT INTO race_results VALUES ($1,$2,$3,$4,$5,$6,$7,false,false,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      id,
      ...order,
      opt.status ?? "normal",
      opt.tech ?? "逃げ",
      opt.trio ?? 5000,
      opt.trifecta ?? 999,
      course(1),
      course(2),
      course(3),
      course(4),
      course(5),
      course(6),
    ],
  );
};
const six = (ws, extra = {}) =>
  ws.map((w, i) => ({ n: i + 1, w, fin: i + 1, ...(extra[i + 1] ?? {}) }));

const jstDate = (offsetDays) => {
  const t = new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3);
  return t.toISOString().slice(0, 10);
};

async function main() {
  const db = new PGlite();
  await db.exec(SCHEMA);

  // ---- 長期分（kb） ----
  // kb1: 完全レース。勝率差 6.50−6.20=+0.30（帯4）、1号艇 A1、勝率1位は1号艇
  await kbRace(
    db,
    "2025-06-01-24-01",
    {},
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0], { 1: { cls: "A1" } }),
  );
  // kb2: 3号艇がフライングで2着 → 除外
  await kbRace(
    db,
    "2025-06-01-24-02",
    {},
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0], {
      1: { cls: "A1" },
      3: { f: true, fin: 2 },
      2: { fin: 3 },
    }),
  );
  // kb3: 5号艇が欠場（K0）→ 除外
  await kbRace(
    db,
    "2025-06-01-24-03",
    {},
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0], { 5: { raw: "K0" } }),
  );
  // kb4: 勝率差 4.00−5.14=−1.14 ちょうど（帯2）。2号艇と4号艇が同率1位 → 2。決まり手「逃げ抜き」→ NULL。
  //      6号艇の進入不明（0）、4号艇はフライングで6着（除外されないが ST は NULL）
  await kbRace(
    db,
    "2025-06-01-24-04",
    { tech: "逃げ抜き" },
    six([4.0, 5.14, 3.0, 5.14, 2.0, 1.0], { 6: { course: 0 }, 4: { f: true } }),
  );
  // kb5: has_result が false → 除外
  await kbRace(
    db,
    "2025-06-01-24-05",
    { has: false },
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0]),
  );

  // ---- 本体 ----
  // m1: 完全レース。3号艇が1着（まくり）、1号艇 A1、勝率差 +0.30。3連単は payout_trio
  await mainRace(
    db,
    "2026-01-10-24-01",
    { tech: "まくり", trio: 5000, trifecta: 999 },
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0], {
      1: { cls: "A1", fin: 2 },
      3: { fin: 1 },
      2: { fin: 3 },
    }),
  );
  // m2: 不成立 → 除外
  await mainRace(
    db,
    "2026-01-10-24-02",
    { status: "no_race" },
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0]),
  );
  // m3: 2号艇が欠場 → 除外
  await mainRace(
    db,
    "2026-01-10-24-03",
    {},
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0], { 2: { absent: true } }),
  );
  // m4: 中止 → 除外
  await mainRace(
    db,
    "2026-01-10-24-04",
    { cancel: "confirmed" },
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0]),
  );

  // m5: 2号艇が2着だが、フラグは立たず着の欄が F → 除外（BOA-635 の依頼）
  await mainRace(
    db,
    "2026-01-10-24-05",
    {},
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0]),
  );
  await db.query(
    "UPDATE race_start_timings SET finish_mark = 'F' WHERE race_id = '2026-01-10-24-05' AND boat_number = 2",
  );
  // m6: 3号艇が3着だが返還艇の一覧に入っている → 除外
  await mainRace(
    db,
    "2026-01-10-24-06",
    {},
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0]),
  );
  await db.query(
    "UPDATE race_results SET refund_boats = '{3}' WHERE race_id = '2026-01-10-24-06'",
  );

  // ---- 今日（検証では明日の日付）のレース: 1号艇 A1・勝率差 +0.30・大村(24)・勝率1位は1号艇 ----
  const tomorrow = jstDate(1);
  const T = `${tomorrow}-24-12`;
  await mainRace(
    db,
    T,
    { noResult: true, start: "20:45" },
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0], { 1: { cls: "A1" } }),
  );
  // 出走表が5艇しかないレース
  const T5 = `${tomorrow}-24-11`;
  await mainRace(db, T5, { noResult: true }, six([6.5, 6.2, 5.0, 4.0, 3.0]));

  // 任意の条件（Q6）の元の値
  // kb1: 予選・G1（開催日の値）・1号艇のモーター 40.0 は 45.0 に次ぐ2位（40.0 の同率は上の順位）→ 帯0
  // kb4: 優勝戦・開催日の行が無いので race_series で補う（重なる2節のうち開始日の早い G3。グレード NULL の節は使わない）
  //      ・1号艇のモーター不明 → 帯3
  // m1:  予選特賞 → 予選・ippan・1号艇のモーター 30.0 は5位 → 帯2
  // T:   全角の「ＭＤ予選」→ 予選・G1・1号艇のモーター 60.0 は1位 → 帯0
  // T2:  ステージ・グレード・モーターがどれも無い（任意の条件を足せない）
  await db.exec(`
    INSERT INTO kb_archive_venue_days VALUES ('vd1', 'G1');
    UPDATE kb_archive_races SET stage_kind = 'qualifier', venue_day_id = 'vd1' WHERE race_id = '2025-06-01-24-01';
    UPDATE kb_archive_races SET stage_kind = 'final', venue_day_id = 'vd-missing' WHERE race_id = '2025-06-01-24-04';
    INSERT INTO race_series VALUES (24, '2025-05-25', '2025-06-03', NULL), (24, '2025-05-30', '2025-06-04', 'ippan'),
                                   (24, '2025-05-28', '2025-06-02', 'G3');
    UPDATE kb_archive_boats SET motor_2rate = (ARRAY[40, 45, 40, 30, 20, 10])[boat_number]
      WHERE race_id = '2025-06-01-24-01';
    UPDATE kb_archive_boats SET motor_2rate = (ARRAY[NULL, 45, 40, 30, 20, 10])[boat_number]
      WHERE race_id = '2025-06-01-24-04';
    UPDATE races SET race_grade = 'ippan' WHERE race_id = '2026-01-10-24-01';
    INSERT INTO race_conditions VALUES ('2026-01-10-24-01', '予選特賞');
    UPDATE race_entries SET motor_2rate = (ARRAY[30, 50, 45, 40, 35, 20])[boat_number]
      WHERE race_id = '2026-01-10-24-01';
    UPDATE races SET race_grade = 'G1' WHERE race_id = '${T}';
    INSERT INTO race_conditions VALUES ('${T}', 'ＭＤ予選');
    UPDATE race_entries SET motor_2rate = (ARRAY[60, 50, 45, 40, 35, 20])[boat_number] WHERE race_id = '${T}';
  `);
  const T2 = `${tomorrow}-24-10`;
  await mainRace(
    db,
    T2,
    { noResult: true },
    six([6.5, 6.2, 5.0, 4.0, 3.0, 2.0], { 1: { cls: "A1" } }),
  );

  await db.exec(fs.readFileSync(MIGRATION, "utf8"));
  check("120 を適用できる", true);

  // (i) 分類の関数
  const STAGES = [
    "予選",
    "一般戦",
    "準優勝戦",
    "優勝戦",
    "準々優勝戦",
    "準優進出戦",
    "ツッキー優勝戦",
    "ＭＤ優勝戦",
    "ドリーム戦",
    "ペイペイDR",
    "ペイペイＤＲ",
    "予選特賞",
    "予選特選",
    "一般特選",
    "一般特賞",
    "選抜戦",
    "記者選抜戦",
    "特別選抜戦",
    "予選ドリーム戦",
    "予選選抜",
    "一般選抜",
    "朝からセンプル",
    "サンライズX戦",
    "カタメン１予選",
    "特選",
    "団体・優勝戦",
    "一般",
    "特別戦",
    "一般予選",
    "",
  ];
  const CATEGORY_TO_ROUND = {
    qualifier: "yosen",
    qualifierSpecial: "yosen",
    semifinal: "junyu",
    final: "yusho",
  };
  const expectedRounds = STAGES.map((st) => {
    const cat = getRaceStageCategory(st);
    if (!st) return null;
    return CATEGORY_TO_ROUND[cat?.key] ?? "other";
  });
  const sqlRounds = (
    await db.query(
      "SELECT array_agg(analogy_round_from_stage(x) ORDER BY i) AS r FROM unnest($1::text[]) WITH ORDINALITY AS t(x, i)",
      [STAGES],
    )
  ).rows[0].r;
  const roundDiff = STAGES.filter(
    (st, i) => sqlRounds[i] !== expectedRounds[i],
  ).map(
    (st, i) =>
      `${st}: SQL=${sqlRounds[STAGES.indexOf(st)]} JS=${expectedRounds[STAGES.indexOf(st)]}`,
  );
  check(
    `ラウンドの分類が getRaceStageCategory と同じ（${STAGES.length}通り）`,
    roundDiff.length === 0,
    roundDiff.join(" / "),
  );
  check(
    "ラウンド: ステージが NULL なら NULL",
    (await db.query("SELECT analogy_round_from_stage(NULL) AS r")).rows[0].r ===
      null,
  );
  const kinds = (
    await db.query(
      "SELECT array_agg(coalesce(analogy_round_from_kb_kind(x), '-') ORDER BY i) AS r FROM unnest(ARRAY['qualifier','semifinal','final','other','x',NULL]) WITH ORDINALITY AS t(x, i)",
    )
  ).rows[0].r;
  check(
    "長期の stage_kind → ラウンド",
    JSON.stringify(kinds) ===
      JSON.stringify(["yosen", "junyu", "yusho", "other", "-", "-"]),
    JSON.stringify(kinds),
  );
  const mb = (
    await db.query(
      "SELECT array_agg(analogy_motor_band(x) ORDER BY i) AS b FROM unnest(ARRAY[NULL,1,2,3,4,5,6]::int[]) WITH ORDINALITY AS t(x, i)",
    )
  ).rows[0].b;
  check(
    "モーター順位帯（不明3・1〜2位0・3〜4位1・5〜6位2）",
    JSON.stringify(mb) === "[3,0,0,1,1,2,2]",
    JSON.stringify(mb),
  );
  const gr = (
    await db.query(
      "SELECT analogy_grade_of('SG', 24::smallint, '2025-06-01') AS a, analogy_grade_of('x', 24::smallint, '2025-06-01') AS b, analogy_grade_of(NULL, 1::smallint, '2025-06-01') AS c",
    )
  ).rows[0];
  check(
    "グレード: レースの値を先に、無ければ重なる節のうち開始日の早いもの、どれも無ければ NULL",
    gr.a === "SG" && gr.b === "G3" && gr.c === null,
    JSON.stringify(gr),
  );

  // (a) 帯
  const bands = await db.query(
    "SELECT array_agg(analogy_gap_band(x) ORDER BY i) AS b FROM unnest(ARRAY[-1.92,-1.91,-1.14,-0.50,-0.49,0.18,0.19,NULL]::numeric[]) WITH ORDINALITY AS t(x, i)",
  );
  check(
    "勝率差の帯は境界ちょうどが上の帯・NULL は5",
    JSON.stringify(bands.rows[0].b) === "[0,1,2,2,3,3,4,5]",
    JSON.stringify(bands.rows[0].b),
  );

  // (b)〜(e)
  const r1 = (
    await db.query("SELECT refresh_analogy_pool('2019-04-01', $1) AS r", [
      jstDate(0),
    ])
  ).rows[0].r;
  check(
    "refresh: 完全レースの3件だけを書く",
    r1.source_rows === 3 && r1.upserted === 3,
    JSON.stringify(r1),
  );
  const pool = (
    await db.query("SELECT * FROM analogy_pool_outcomes ORDER BY race_id")
  ).rows;
  const ids = pool.map((p) => p.race_id);
  check(
    "母集団は kb1・kb4・m1",
    JSON.stringify(ids) ===
      JSON.stringify([
        "2025-06-01-24-01",
        "2025-06-01-24-04",
        "2026-01-10-24-01",
      ]),
    JSON.stringify(ids),
  );
  const kb4 = pool.find((p) => p.race_id === "2025-06-01-24-04");
  const m1 = pool.find((p) => p.race_id === "2026-01-10-24-01");
  const kb1 = pool.find((p) => p.race_id === "2025-06-01-24-01");
  check(
    "kb4: 勝率差 −1.14 は帯2",
    Number(kb4.b1_win_gap) === -1.14 && kb4.gap_band === 2,
    `${kb4.b1_win_gap} ${kb4.gap_band}`,
  );
  check("kb4: 同率の勝率1位は小さい艇番（2）", kb4.top_boat === 2);
  check("kb4: 6分類以外の決まり手は NULL", kb4.winning_technique === null);
  check("kb4: 進入不明の艇は NULL", kb4.course_by_boat[5] === null);
  check(
    "kb4: フライングの艇のコースの ST は NULL",
    kb4.st_by_course[3] === null && Number(kb4.st_by_course[0]) === 0.15,
    JSON.stringify(kb4.st_by_course),
  );
  check("kb4: 1号艇の級別が B1", kb4.b1_class === "B1");
  check(
    "kb1: 1号艇 A1・帯4・勝率1位1",
    kb1.b1_class === "A1" && kb1.gap_band === 4 && kb1.top_boat === 1,
  );
  check(
    "m1: 3連単は payout_trio（5000）",
    m1.payout_3tan === 5000,
    String(m1.payout_3tan),
  );
  check(
    "m1: 1着3号艇・2着1号艇・3着2号艇・まくり・1着の進入3",
    m1.rank1 === 3 &&
      m1.rank2 === 1 &&
      m1.rank3 === 2 &&
      m1.winning_technique === "まくり" &&
      m1.winner_course === 3,
  );

  check(
    "母集団の任意の3列（kb1: 予選・G1・帯0／kb4: 優勝戦・G3・帯3／m1: 予選・ippan・帯2）",
    kb1.round === "yosen" &&
      kb1.grade === "G1" &&
      kb1.b1_motor_band === 0 &&
      kb4.round === "yusho" &&
      kb4.grade === "G3" &&
      kb4.b1_motor_band === 3 &&
      m1.round === "yosen" &&
      m1.grade === "ippan" &&
      m1.b1_motor_band === 2,
    JSON.stringify(
      [kb1, kb4, m1].map((p) => [p.round, p.grade, p.b1_motor_band]),
    ),
  );

  const r2 = (
    await db.query("SELECT refresh_analogy_pool('2019-04-01', $1) AS r", [
      jstDate(0),
    ])
  ).rows[0].r;
  check(
    "refresh の2回目は書かない（変わった行だけ）",
    r2.upserted === 0 && r2.deleted === 0,
    JSON.stringify(r2),
  );
  await db.query(
    "UPDATE race_results SET actual_course_3 = 4, actual_course_4 = 3 WHERE race_id = '2026-01-10-24-01'",
  );
  const r3 = (
    await db.query(
      "SELECT refresh_analogy_pool('2026-01-10', '2026-01-10') AS r",
    )
  ).rows[0].r;
  check(
    "実進入が後から変わった行だけ書き直す",
    r3.upserted === 1,
    JSON.stringify(r3),
  );

  // (g) スナップショット無しの RPC
  const g0 = (await db.query("SELECT get_analogy_similar($1) AS g", [T]))
    .rows[0].g;
  check(
    "RPC: スナップショット無しでも数える",
    g0 && g0.snapshot === false && g0.from_snapshot === false,
  );
  check(
    "RPC: 深さごとの件数 [2,2,2,2]・自動の深さ1",
    JSON.stringify(g0.n_by_depth) === "[2,2,2,2]" && g0.auto_depth === 1,
    JSON.stringify(g0.n_by_depth),
  );
  check(
    "RPC: 分布（逃げ1・まくり1、1着艇 1と3）",
    g0.n === 2 &&
      g0.technique["逃げ"] === 1 &&
      g0.technique["まくり"] === 1 &&
      g0.winner_boat["1"] === 1 &&
      g0.winner_boat["3"] === 1,
    JSON.stringify(g0.technique),
  );
  check(
    "RPC: 3連単の組み合わせ（1-2-3・3-1-2）",
    g0.trifecta["1-2-3"] === 1 && g0.trifecta["3-1-2"] === 1,
    JSON.stringify(g0.trifecta),
  );
  check(
    "RPC: 1着の進入は書き直し後の4",
    g0.winner_course["4"] === 1,
    JSON.stringify(g0.winner_course),
  );
  check(
    "RPC: 新しい順の一覧",
    g0.recent.length === 2 && g0.recent[0].race_id === "2026-01-10-24-01",
  );
  check(
    "RPC: 出走表が6艇そろわないレースは NULL",
    (await db.query("SELECT get_analogy_similar($1) AS g", [T5])).rows[0].g ===
      null,
  );
  let depthErr = false;
  try {
    await db.query("SELECT get_analogy_similar($1, 0::smallint)", [T]);
  } catch {
    depthErr = true;
  }
  check("RPC: 深さ0は例外", depthErr);

  // (i) 任意の条件（層は kb1・m1 の2件。T は予選・G1・帯0）
  check(
    "RPC: 今日のレースの任意の条件の値と、足すと N件（ラウンド2・グレード1・モーター1）",
    g0.extras.round === "yosen" &&
      g0.extras.grade === "G1" &&
      g0.extras.b1_motor_band === 0 &&
      JSON.stringify(g0.n_if_added) ===
        JSON.stringify({ grade: 1, motor: 1, round: 2 }) &&
      g0.filters.round === false &&
      g0.filters.grade === false &&
      g0.filters.motor === false,
    JSON.stringify({ extras: g0.extras, n_if_added: g0.n_if_added }),
  );
  const gG = (
    await db.query(
      "SELECT get_analogy_similar($1, NULL, false, true, false) AS g",
      [T],
    )
  ).rows[0].g;
  check(
    "RPC: グレードで絞ると kb1 の1件だけ（分布・一覧とも）",
    gG.n === 1 &&
      gG.filters.grade === true &&
      gG.recent.length === 1 &&
      gG.recent[0].race_id === "2025-06-01-24-01" &&
      gG.depth === 1,
    JSON.stringify({ n: gG.n, recent: gG.recent.map((r) => r.race_id) }),
  );
  check(
    "RPC: 絞った後の足すと N件は、今の層に重ねた件数（ラウンド1・グレード1・モーター1）",
    JSON.stringify(gG.n_if_added) ===
      JSON.stringify({ grade: 1, motor: 1, round: 1 }),
    JSON.stringify(gG.n_if_added),
  );
  const gRM = (
    await db.query(
      "SELECT get_analogy_similar($1, NULL, true, false, true) AS g",
      [T],
    )
  ).rows[0].g;
  check(
    "RPC: ラウンドとモーターを重ねる（kb1 の1件）",
    gRM.n === 1 && gRM.filters.round === true && gRM.filters.motor === true,
    JSON.stringify({ n: gRM.n, filters: gRM.filters }),
  );
  const g2 = (await db.query("SELECT get_analogy_similar($1) AS g", [T2]))
    .rows[0].g;
  check(
    "RPC: 値が分からない任意の条件は足せない（n_if_added が null、モーターの帯は3）",
    g2 &&
      g2.extras.round === null &&
      g2.extras.grade === null &&
      g2.extras.b1_motor_band === 3 &&
      g2.n_if_added.round === null &&
      g2.n_if_added.grade === null &&
      g2.n_if_added.motor === null,
    JSON.stringify(g2 && { extras: g2.extras, n_if_added: g2.n_if_added }),
  );
  for (const [label, args] of [
    ["ラウンド", "true, false, false"],
    ["グレード", "false, true, false"],
    ["モーター", "false, false, true"],
  ]) {
    let err = "";
    try {
      await db.query(`SELECT get_analogy_similar($1, NULL, ${args})`, [T2]);
    } catch (e) {
      err = e.message;
    }
    check(
      `RPC: 値が分からない${label}をオンにすると例外`,
      err.includes("絞れません"),
      err,
    );
  }

  // (g2) BOA-635 の RPC: 自動の深さの層の行
  const br = (await db.query("SELECT get_analogy_similar_races($1) AS g", [T]))
    .rows[0].g;
  check(
    "BOA-635 RPC: 層の総件数・返した件数・深さ",
    br &&
      br.n_total === 2 &&
      br.n_returned === 2 &&
      br.depth === 1 &&
      br.snapshot === false,
    JSON.stringify(
      br && { n_total: br.n_total, n_returned: br.n_returned, depth: br.depth },
    ),
  );
  const keys = br ? Object.keys(br.rows[0]).sort().join(",") : "";
  check(
    "BOA-635 RPC: 行の列は合意した8列（race_id を含まない）",
    keys ===
      "course_by_boat,payout_3tan,race_date,rank1,rank2,rank3,st_by_course,winning_technique",
    keys,
  );
  check("BOA-635 RPC: 新しい順", br && br.rows[0].race_date === "2026-01-10");

  // (f) スナップショット
  const s1 = (
    await db.query("SELECT create_analogy_snapshots($1) AS n", [tomorrow])
  ).rows[0].n;
  check(
    "スナップショットを締切前の2レースに作る（6艇そろわないレースは作らない）",
    s1 === 2,
    String(s1),
  );
  const s2 = (
    await db.query("SELECT create_analogy_snapshots($1) AS n", [tomorrow])
  ).rows[0].n;
  check("スナップショットの2回目は作らない", s2 === 0, String(s2));
  // 保存した後に母集団が変わっても、自動の深さは保存した分布を返す
  await db.query(
    "UPDATE analogy_pool_outcomes SET winning_technique = '差し' WHERE race_id = '2025-06-01-24-01'",
  );
  const g1 = (await db.query("SELECT get_analogy_similar($1) AS g", [T]))
    .rows[0].g;
  check(
    "RPC: 自動の深さはスナップショットの分布を返す",
    g1.snapshot === true &&
      g1.from_snapshot === true &&
      g1.technique["逃げ"] === 1,
    JSON.stringify(g1.technique),
  );
  const g4 = (
    await db.query("SELECT get_analogy_similar($1, 4::smallint) AS g", [T])
  ).rows[0].g;
  const gSnapG = (
    await db.query(
      "SELECT get_analogy_similar($1, NULL, false, true, false) AS g",
      [T],
    )
  ).rows[0].g;
  check(
    "RPC: 任意の条件を足したら、スナップショットがあっても数え直す",
    gSnapG.from_snapshot === false &&
      gSnapG.snapshot === true &&
      gSnapG.technique["差し"] === 1,
    JSON.stringify(gSnapG.technique),
  );
  check(
    "RPC: 深さを変えたら数え直す",
    g4.from_snapshot === false && g4.depth === 4 && g4.technique["差し"] === 1,
    JSON.stringify(g4.technique),
  );
  const past = (
    await db.query("SELECT create_analogy_snapshots('2026-01-10') AS n")
  ).rows[0].n;
  check(
    "締切を過ぎたレースのスナップショットは作らない",
    past === 0,
    String(past),
  );

  // (e) 完全レースでなくなった行を消す
  await db.query(
    "UPDATE races SET cancellation_status = 'confirmed' WHERE race_id = '2026-01-10-24-01'",
  );
  const r4 = (
    await db.query(
      "SELECT refresh_analogy_pool('2026-01-10', '2026-01-10') AS r",
    )
  ).rows[0].r;
  check("中止になった行を母集団から消す", r4.deleted === 1, JSON.stringify(r4));

  // (h) 権限
  await db.exec("SET ROLE anon");
  const ga = (await db.query("SELECT get_analogy_similar($1) AS g", [T]))
    .rows[0].g;
  check("匿名: RPC を呼べる", ga !== null);
  check(
    "匿名: BOA-635 の RPC を呼べる",
    (await db.query("SELECT get_analogy_similar_races($1) AS g", [T])).rows[0]
      .g !== null,
  );
  check(
    "匿名: 2表を SELECT できる",
    (await db.query("SELECT count(*)::int AS n FROM analogy_snapshots")).rows[0]
      .n === 2,
  );
  const denied = async (sql) => {
    try {
      await db.query(sql);
      return false;
    } catch (e) {
      return /permission denied/.test(e.message);
    }
  };
  check(
    "匿名: refresh_analogy_pool を呼べない",
    await denied("SELECT refresh_analogy_pool('2026-01-01', '2026-01-02')"),
  );
  check(
    "匿名: create_analogy_snapshots を呼べない",
    await denied(`SELECT create_analogy_snapshots('${tomorrow}')`),
  );
  check(
    "匿名: 母集団に書き込めない",
    await denied("DELETE FROM analogy_pool_outcomes"),
  );
  check(
    "匿名: スナップショットに書き込めない",
    await denied("DELETE FROM analogy_snapshots"),
  );
  await db.exec("RESET ROLE");

  // 冪等: 2回目の適用
  let reapply = true;
  try {
    await db.exec(fs.readFileSync(MIGRATION, "utf8"));
  } catch (e) {
    reapply = false;
    console.log(e.message);
  }
  check("2回適用しても失敗しない", reapply);

  await db.close();
  if (failures.length) {
    console.error(`\n❌ ${failures.length}件失敗`);
    process.exit(1);
  }
  console.log("\n✅ すべて通過");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
