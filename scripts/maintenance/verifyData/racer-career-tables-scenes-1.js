/**
 * verify-racer-career-tables.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-racer-career-tables.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNT_COLUMNS,
  mergeCareerResult,
  staleRowsOf,
  chunk,
  existingChunkSize,
} from "../../lib/racerCareerJob.js";
import { MAIN_TABLES_START, KB_LAST_DATE } from "../../lib/kbArchiveBoundary.js";
import { MAIN_TABLES_START as KB_BACKFILL_MAIN_START } from "../kb-backfill.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let SQL190, db, all;

// ---------------------------------------------------------------------------
// 書き手（偽の Supabase。RPC は PGlite）
// ---------------------------------------------------------------------------
function pgRpc(fn) {
  const sigs = {
    racer_career_inputs: [
      "SELECT racer_career_inputs($1, $2::date, $3::date, $4::date) AS r",
      (a) => [a.p_era, a.p_from, a.p_to, a.p_active_from],
    ],
    racer_career_special_races: [
      "SELECT racer_career_special_races($1, $2::text[]) AS r",
      (a) => [a.p_era, a.p_venue_days],
    ],
    compute_racer_career_counts: [
      "SELECT compute_racer_career_counts($1, $2::date, $3::date, $4::int[], $5::text[], $6::text[], $7::text[]) AS r",
      (a) => [
        a.p_era,
        a.p_from,
        a.p_to,
        a.p_racer_ids,
        a.p_final_stages,
        a.p_override_race_ids,
        a.p_override_grades,
      ],
    ],
  };
  const [sql, args] = sigs[fn];
  return async (a) => (await all(sql, args(a)))[0].r;
}

export async function fakeClient(existing = {}) {
  return createFakeSupabaseClient({
    tables: {
      kb_archive_venue_days: await all(
        "SELECT venue_day_id, to_char(race_date, 'YYYY-MM-DD') AS race_date FROM kb_archive_venue_days",
      ),
      kb_archive_races: await all("SELECT race_id FROM kb_archive_races"),
      ...existing,
    },
    rpcs: Object.fromEntries(
      [
        "racer_career_inputs",
        "racer_career_special_races",
        "compute_racer_career_counts",
      ].map((f) => [f, pgRpc(f)]),
    ),
  });
}

export const rowsOf = (client, table, pred = () => true) =>
  (client.data[table] ?? []).filter(pred);

function scene1() {
  test("足し合わせ: 件数の区分は同じキーを足し、優勝戦の行は重なれば止める", () => {
    const zero = Object.fromEntries(COUNT_COLUMNS.map((c) => [c, 0]));
    const res = (p1) => ({
      venue: [
        {
          racer_id: 1,
          venue_code: 2,
          race_grade: "ippan",
          is_final: false,
          ...zero,
          p1,
        },
      ],
      term: [],
      course: [],
      finals: [],
    });
    const acc = new Map();
    mergeCareerResult(acc, res(2), "kb");
    mergeCareerResult(acc, res(3), "kb");
    assert.equal([...acc.get("venue").values()][0].p1, 5);
    assert.equal([...acc.get("venue").values()][0].era, "kb");
    const fin = {
      venue: [],
      term: [],
      course: [],
      finals: [{ race_id: "x", racer_id: 1 }],
    };
    mergeCareerResult(acc, fin, "kb");
    assert.throws(() => mergeCareerResult(acc, fin, "kb"), /キーが重なった/);
    assert.throws(
      () => mergeCareerResult(new Map(), { venue: [] }, "kb"),
      /term の配列が無い/,
    );
    assert.deepEqual(
      staleRowsOf(
        [
          { a: 1, b: true },
          { a: 2, b: false },
        ],
        [{ a: 1, b: true }],
        ["a", "b"],
      ),
      [{ a: 2, b: false }],
    );
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    // 今ある行（消える前のセル）が新しい行より多ければ、そちらで決める（300＋132 → 2人ずつ）
    assert.equal(
      existingChunkSize(
        [{ racer_id: 9 }],
        132,
        Array.from({ length: 300 }, () => ({ racer_id: 9 })),
      ),
      2,
    );
    // 既存行の読みは2層とも返る。この層の1人100行＋もう一方の層の上限132行で232行 → 900行に収まる3人ずつ
    assert.equal(
      existingChunkSize(
        Array.from({ length: 100 }, () => ({ racer_id: 9 })),
        132,
      ),
      3,
    );
    assert.throws(
      () =>
        existingChunkSize(
          Array.from({ length: 800 }, () => ({ racer_id: 9 })),
          132,
        ),
      /1000行の上限で切れる/,
    );
  });
}

function scene2() {
  // ---------------------------------------------------------------------------
  // 定数・権限
  // ---------------------------------------------------------------------------
  test("境目の日: SQL の定数・kbArchiveBoundary・kb-backfill が同じ", () => {
    assert.equal(KB_BACKFILL_MAIN_START, MAIN_TABLES_START);
    const next = new Date(`${KB_LAST_DATE}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    assert.equal(next.toISOString().slice(0, 10), MAIN_TABLES_START);
    const kbDates = [...SQL190.matchAll(/<= DATE '(\d{4}-\d{2}-\d{2})'/g)].map(
      (m) => m[1],
    );
    const mainDates = [
      ...SQL190.matchAll(
        />= DATE '(\d{4}-\d{2}-\d{2})'|>= '(\d{4}-\d{2}-\d{2})'/g,
      ),
    ].map((m) => m[1] ?? m[2]);
    assert.ok(
      kbDates.length >= 4 && kbDates.every((d) => d === KB_LAST_DATE),
      `kb の日付 ${kbDates}`,
    );
    assert.ok(
      mainDates.length >= 4 && mainDates.every((d) => d === MAIN_TABLES_START),
      `本体の日付 ${mainDates}`,
    );
  });
  test("190: 5表は RLS 有効で匿名は読むだけ、3関数は service_role だけ・jsonb を返す", async () => {
    for (const t of [
      "racer_venue_stats",
      "racer_term_stats",
      "racer_course_stats",
      "racer_championships",
      "racer_career_meta",
    ]) {
      const [row] = await all(
        `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', $1, 'SELECT') AS anon_select,
              has_any_column_privilege('anon', $1, 'INSERT') AS anon_insert,
              has_any_column_privilege('authenticated', $1, 'UPDATE') AS auth_update,
              has_table_privilege('anon', $1, 'DELETE') AS anon_delete
         FROM pg_class c WHERE c.relname = $1`,
        [t],
      );
      assert.deepEqual(
        row,
        {
          rls: true,
          anon_select: true,
          anon_insert: false,
          auth_update: false,
          anon_delete: false,
        },
        t,
      );
    }
    for (const f of [
      "racer_career_inputs(text, date, date, date)",
      "racer_career_special_races(text, text[])",
      "compute_racer_career_counts(text, date, date, integer[], text[], text[], text[])",
    ]) {
      const [row] = await all(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1, 'EXECUTE') AS svc,
              pg_get_function_result($1::regprocedure) AS result,
              (SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure) AS definer`,
        [f],
      );
      assert.deepEqual(
        row,
        { anon: false, auth: false, svc: true, result: "jsonb", definer: false },
        f,
      );
    }
    await assert.rejects(
      db.query(
        "SELECT compute_racer_career_counts('main', '2025-12-03', '2026-01-01', NULL, '{}', '{}', '{}')",
      ),
      /p_racer_ids を渡す/,
    );
    await assert.rejects(
      db.query(
        "SELECT compute_racer_career_counts('kb', '2019-01-01', '2020-01-01', NULL, '{}', ARRAY['a'], '{}')",
      ),
      /長さが違う/,
    );
    await assert.rejects(
      db.query("SELECT racer_career_inputs('x', '2019-01-01', '2020-01-01')"),
      /kb か main/,
    );
  });
}

function scene3() {
  test("190: 期の始まりは5/1か11/1だけ（表の CHECK）", async () => {
    await assert.rejects(
      db.query(
        "INSERT INTO racer_term_stats(racer_id, term_start, era, race_grade, is_final) VALUES (1, '2024-01-01', 'kb', 'ippan', false)",
      ),
      /check/i,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（SQL190・db・all） */
export function runRacerCareerTablesScenes1(env) {
  ({ SQL190, db, all } = env);
  scene1();
  scene2();
  scene3();
}
