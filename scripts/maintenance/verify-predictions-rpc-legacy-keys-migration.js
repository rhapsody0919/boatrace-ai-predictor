/**
 * verify-predictions-rpc-legacy-keys-migration.js - マイグレーション196（get_predictions_by_date(_light) の応答から
 * aiScore*・predictionOdds を外す、BOA-1126）の検証。
 * インメモリの Postgres（PGlite）に、本番のスキーマの写し（docs/reference/schema-snapshot.json）から2関数が読む表を作り、
 * 157 の2関数と 187 の search_path を当てた「本番と同じ状態」に 196 を当てて次を確かめる。本番 DB には接続しない。
 *
 *   (a) 157 のファイルの本文の md5(prosrc) が、196 の前提の検査に書いた本番の値と一致する（土台が本番と同じ）
 *   (b) 196 の後、応答の entries に aiScoreStandard・aiScoreSafeBet・aiScoreUpsetFocus が無く、レースに predictionOdds が無い
 *   (c) それ以外のキーは、レース直下・入れ子とも 196 の前と同じ（外した欄の他は消えていない）
 *   (d) search_path=public, pg_temp と anon の EXECUTE が保たれる
 *   (e) 本文が 157 と違う関数には当たらない（前提の検査で失敗し、何も変わらない）
 *   (f) もう一度当てても通る（適用後の本文も前提の検査で受け付ける）
 *   (g) 戻し方（157 の2関数＋187 の ALTER）で元の本文（md5）に戻る
 *
 * 実行: node scripts/maintenance/verify-predictions-rpc-legacy-keys-migration.js（@electric-sql/pglite は devDependency）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sql157 = read("docs/db-migration/157_rpc_in_caution.sql");
const sql196 = read(
  "docs/db-migration/196_drop_legacy_keys_from_predictions_rpc.sql",
);
const snapshot = JSON.parse(read("docs/reference/schema-snapshot.json"));

const FUNCS = ["get_predictions_by_date", "get_predictions_by_date_light"];
const TABLES = [
  "races",
  "race_conditions",
  "predictions",
  "race_entries",
  "exhibition_data",
  "prediction_odds",
  "race_results",
  "race_payouts",
];
const REMOVED_ENTRY_KEYS = [
  "aiScoreStandard",
  "aiScoreSafeBet",
  "aiScoreUpsetFocus",
];
const REMOVED_RACE_KEYS = ["predictionOdds"];

/** 157 から2関数の定義（CREATE OR REPLACE 〜 $$;）だけを取り出す。戻し方と同じ範囲 */
function extract157Functions() {
  const lines = sql157.split("\n");
  const start = lines.findIndex((l) =>
    l.startsWith("CREATE OR REPLACE FUNCTION public.get_predictions_by_date("),
  );
  const startLight = lines.findIndex((l) =>
    l.startsWith(
      "CREATE OR REPLACE FUNCTION public.get_predictions_by_date_light(",
    ),
  );
  const endLight = lines.findIndex((l, i) => i > startLight && l === "$$;");
  if (start < 0 || startLight < 0 || endLight < 0) {
    throw new Error("157 から2関数の定義を取り出せません");
  }
  return lines.slice(start, endLight + 1).join("\n");
}

/** 196 の前提の検査に書いた md5 の値（適用前・適用後） */
function expectedMd5s() {
  return [...sql196.matchAll(/md5\(p\.prosrc\) <> '([0-9a-f]{32})'/g)].map(
    (m) => m[1],
  );
}

function tableDdl(name) {
  const rel = snapshot.relations.find(
    (r) => r.name === name && r.kind === "table",
  );
  if (!rel) throw new Error(`スキーマの写しに表 ${name} がありません`);
  const cols = rel.columns
    .map((c) => `"${c.name}" ${c.type.replace(/^USER-DEFINED$/, "text")}`)
    .join(", ");
  return `CREATE TABLE public.${name} (${cols});`;
}

const RACE = "2026-11-01-01-01";
const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
${TABLES.map(tableDdl).join("\n")}
INSERT INTO public.races (race_id, race_date, venue_code, race_number) VALUES ('${RACE}', '2026-11-01', 1, 1);
INSERT INTO public.race_entries (race_id, boat_number, player_name, ai_score_standard, ai_score_safe_bet, ai_score_upset_focus)
  VALUES ('${RACE}', 1, 'A', 80, 70, 60), ('${RACE}', 2, 'B', 50, 40, 30);
INSERT INTO public.prediction_odds (race_id, trifecta_pred_standard, trifecta_odds_standard) VALUES ('${RACE}', '1-2-3', 12.3);
INSERT INTO public.predictions (race_id, model_id, top_pick, top_2nd, top_3rd, feature_contributions)
  VALUES ('${RACE}', 'unified', 1, 2, 3, '{"inCaution": {"level": "low"}}'),
         ('${RACE}', 'safeBet', 1, 2, 3, '{}');
INSERT INTO public.exhibition_data (race_id, boat_number, exhibition_time) VALUES ('${RACE}', 1, 6.7);
INSERT INTO public.race_results (race_id, rank1, race_status) VALUES ('${RACE}', 1, 'normal');
`;

const PROD_STATE_SQL = `
${extract157Functions()}
ALTER FUNCTION public.get_predictions_by_date(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_predictions_by_date_light(date) SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_predictions_by_date(date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_predictions_by_date_light(date) TO anon;
`;

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

async function attemptExec(db, text) {
  try {
    await db.exec(text);
    return null;
  } catch (e) {
    // 196 は BEGIN〜COMMIT で包むので、途中の失敗ではトランザクションが開いたまま残る（db-apply では psql が接続を閉じて戻す）
    await db.exec("ROLLBACK");
    return e;
  }
}

const fnState = async (db) =>
  (
    await db.query(
      `SELECT p.proname, md5(p.prosrc) AS md5, p.proconfig,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`,
      [FUNCS],
    )
  ).rows;

/** 応答のキーの形（レース直下・入れ子のキーの集合）を取る */
async function keyShape(db, fn) {
  const { rows } = await db.query(
    `SELECT public.${fn}('2026-11-01'::date) AS j`,
  );
  const race = rows[0].j.races[0];
  const nested = (v) =>
    Array.isArray(v)
      ? Object.keys(v[0] ?? {}).sort()
      : v && typeof v === "object"
        ? Object.keys(v).sort()
        : null;
  return {
    race: Object.keys(race).sort(),
    entries: nested(race.entries),
    result: nested(race.result),
    exhibitionData: nested(race.exhibitionData),
  };
}

const minus = (a, b) => a.filter((k) => !b.includes(k));

async function main() {
  const db = new PGlite();
  await db.exec(FIXTURE_SQL);
  await db.exec(PROD_STATE_SQL);

  // (a) 土台が本番と同じ
  const before = await fnState(db);
  const md5s = expectedMd5s();
  check(
    "(a) 157 の本文の md5 が 196 の前提の検査の適用前の値と一致する",
    before.length === 2 &&
      before.every((r) => md5s.includes(r.md5)) &&
      md5s.includes("012ecc95edba6dee8757a763c65d7d04") &&
      md5s.includes("2cd99677b99cb450b85e92ecd6cf0351"),
    JSON.stringify(before.map((r) => [r.proname, r.md5])),
  );
  const shapeBefore = Object.fromEntries(
    await Promise.all(FUNCS.map(async (f) => [f, await keyShape(db, f)])),
  );
  check(
    "前提: 196 の前は aiScore*・predictionOdds が応答にある",
    FUNCS.every(
      (f) =>
        REMOVED_ENTRY_KEYS.every((k) => shapeBefore[f].entries.includes(k)) &&
        shapeBefore[f].race.includes("predictionOdds"),
    ),
  );

  // (e) 本文が違う関数には当たらない。別の DB で 157 の本文を1文字変えて当てる
  const drifted = new PGlite();
  await drifted.exec(FIXTURE_SQL);
  await drifted.exec(
    PROD_STATE_SQL.replace(
      "'venueCode', r.venue_code",
      "'venueCode',  r.venue_code",
    ),
  );
  const driftedBefore = await fnState(drifted);
  const driftErr = await attemptExec(drifted, sql196);
  const driftedAfter = await fnState(drifted);
  check(
    "(e) 本文が 157 と違うと前提の検査で失敗し、何も変わらない",
    driftErr != null &&
      /196 の前提の検査に失敗/.test(String(driftErr.message)) &&
      JSON.stringify(driftedBefore) === JSON.stringify(driftedAfter),
    String(driftErr?.message ?? "失敗しなかった"),
  );
  await drifted.close();

  // 196 を当てる
  const applyErr = await attemptExec(db, sql196);
  check(
    "196 が当たる（自己検査を含む）",
    applyErr == null,
    String(applyErr?.message ?? ""),
  );
  if (applyErr) {
    await db.close();
    process.exit(1);
  }

  // (b)(c)
  for (const f of FUNCS) {
    const after = await keyShape(db, f);
    const b = shapeBefore[f];
    check(
      `(b) ${f}: entries に aiScore* が無く、レースに predictionOdds が無い`,
      REMOVED_ENTRY_KEYS.every((k) => !after.entries.includes(k)) &&
        REMOVED_RACE_KEYS.every((k) => !after.race.includes(k)),
      JSON.stringify(after),
    );
    check(
      `(c) ${f}: 外した欄の他のキーは196の前と同じ`,
      JSON.stringify(minus(b.race, REMOVED_RACE_KEYS)) ===
        JSON.stringify(after.race) &&
        JSON.stringify(minus(b.entries, REMOVED_ENTRY_KEYS)) ===
          JSON.stringify(after.entries) &&
        JSON.stringify(b.result) === JSON.stringify(after.result) &&
        JSON.stringify(b.exhibitionData) ===
          JSON.stringify(after.exhibitionData),
      JSON.stringify({ before: b, after }),
    );
  }

  // (d)
  const applied = await fnState(db);
  check(
    "(d) search_path=public, pg_temp と anon の EXECUTE が保たれる",
    applied.length === 2 &&
      applied.every(
        (r) =>
          JSON.stringify(r.proconfig) ===
            JSON.stringify(["search_path=public, pg_temp"]) && r.anon_exec,
      ),
    JSON.stringify(applied),
  );
  check(
    "(f の前提) 適用後の本文の md5 が 196 の前提の検査に書いてある",
    applied.every((r) => md5s.includes(r.md5)),
    JSON.stringify(applied.map((r) => [r.proname, r.md5])),
  );

  // (f) 2回目
  const againErr = await attemptExec(db, sql196);
  check(
    "(f) もう一度当てても通る",
    againErr == null,
    String(againErr?.message ?? ""),
  );

  // (g) 戻し方
  await db.exec(
    `${extract157Functions()}
ALTER FUNCTION public.get_predictions_by_date(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_predictions_by_date_light(date) SET search_path = public, pg_temp;`,
  );
  const restored = await fnState(db);
  check(
    "(g) 戻し方で 157 の本文（md5）と search_path に戻る",
    JSON.stringify(restored) === JSON.stringify(before),
    JSON.stringify(restored),
  );

  await db.close();
  if (failures > 0) {
    console.error(`\nNG: ${failures} 件`);
    process.exit(1);
  }
  console.log("\nOK: 196 の検証はすべて合格");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
