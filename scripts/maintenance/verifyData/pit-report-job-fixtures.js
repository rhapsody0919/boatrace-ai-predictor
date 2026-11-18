/**
 * verify-pit-report-job.js の入力（実ページの写し・偽クライアント）。大きさの関所のため、本文を字のまま移した（ROOT だけこの場所から数え直した）。verify ではない。
 */
import { clearPitReportSchemaCache } from "../../lib/pitReportSchema.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const show = (v) => JSON.stringify(v);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/pitreport");
export const readFixture = (name) =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8");
export const R12 = readFixture("comments-g1-r12-day3.html");
export const R10 = readFixture("comments-g1-r10-mixed.html");
export const NOT_TARGET_RACE = readFixture("not-target-race-g1-r1.html");
export const FINAL_DAY = readFixture("not-target-race-g1-final-day-r7.html");
export const G3 = readFixture("not-target-g3-r12.html");
export const IPPAN = readFixture("not-target-ippan-r9.html");
export const NO_DATA = readFixture("no-data.html");
// 未公開（対象レース。2026-09-21 11:30 JST、多摩川G1最終日の12R・発走16:30の5時間前に取得した実ページ）: 艇ごとの表とレポーター名は
// あるが、コメント欄が空（&nbsp;）・前走のリンクの中身も空。「対象外」のメッセージは出ない
export const PENDING_REAL = readFixture("pending-g1-r12-final-day.html");
// 表そのものが無い場合（構造の別の形。フォールバックの検証用の加工版）: 実ページの表（艇ごとの行）を取り除いた形
export const PENDING = R12.replace(
  /<tbody>\s*<tr>\s*<td class="is-boatColor[\s\S]*?<\/tbody>/g,
  "",
);

// ---------------------------------------------------------------------------
// 偽クライアント（PostgREST の最小限）
// ---------------------------------------------------------------------------
export function createFakeClient({
  tables = {},
  missingTables = [],
  failOps = {},
  storageError = null,
} = {}) {
  const { state, calls, uploads, execute } = createFakeClientPart1(tables, missingTables, failOps);
  return createFakeClientPart2(storageError, state, calls, uploads, execute);
}

export function createFakeClientPart1(tables, missingTables, failOps) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
  );
  const calls = [];
  const uploads = [];
  const matches = (row, filters) =>
    filters.every(([kind, column, a, b]) => {
      if (kind === "eq") return row[column] === a;
      if (kind === "in") return a.includes(row[column]);
      if (kind === "not") {
        if (a === "in") {
          const list = String(b).replace(/[()]/g, "").split(",").map(Number);
          return !list.includes(row[column]);
        }
        if (a === "is")
          return row[column] !== null && row[column] !== undefined;
      }
      return true;
    });
  const execute = (q) => {
    calls.push({
      table: q.table,
      op: q.op,
      rows: q.payload,
      opts: q.opts,
      filters: q.filters,
    });
    if (missingTables.includes(q.table)) {
      return {
        data: null,
        error: {
          code: "PGRST205",
          message: `Could not find the table 'public.${q.table}' in the schema cache`,
        },
      };
    }
    const failure = failOps[`${q.table}:${q.op}`];
    if (failure) return { data: null, error: { message: failure } };
    const rows = (state[q.table] ??= []);
    if (q.op === "select") {
      if (q.limit === 0) return { data: [], error: null };
      const found = rows
        .filter((r) => matches(r, q.filters))
        .map((r) => ({ ...r }));
      return { data: q.single ? (found[0] ?? null) : found, error: null };
    }
    if (q.op === "delete") {
      state[q.table] = rows.filter((r) => !matches(r, q.filters));
      return { data: null, error: null };
    }
    const keys = (q.opts?.onConflict ?? "").split(",").filter(Boolean);
    for (const row of q.payload) {
      const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) {
        if (!q.opts?.ignoreDuplicates) Object.assign(existing, row);
      } else {
        rows.push({ ...row });
      }
    }
    return {
      data: q.returning ? q.payload.map((r) => ({ race_id: r.race_id })) : null,
      error: null,
    };
  };
  return { state, calls, uploads, execute };
}

export function createFakeClientPart2(storageError, state, calls, uploads, execute) {
  const from = (table) => {
    const q = {
      table,
      op: "select",
      filters: [],
      payload: null,
      opts: null,
      limit: null,
      single: false,
      returning: false,
    };
    const b = {
      select: () => {
        if (q.op === "upsert") q.returning = true;
        return b;
      },
      eq: (c, v) => (q.filters.push(["eq", c, v]), b),
      in: (c, v) => (q.filters.push(["in", c, v]), b),
      not: (c, op, v) => (q.filters.push(["not", c, op, v]), b),
      limit: (n) => ((q.limit = n), b),
      maybeSingle: () => ((q.single = true), b),
      upsert: (rows, opts) => (
        (q.op = "upsert"),
        (q.payload = rows),
        (q.opts = opts),
        b
      ),
      delete: () => ((q.op = "delete"), b),
      then: (resolve, reject) =>
        Promise.resolve(execute(q)).then(resolve, reject),
    };
    return b;
  };
  const storage = {
    from: (bucket) => ({
      upload: async (p, body, opts) => {
        if (storageError)
          return { data: null, error: { message: storageError } };
        uploads.push({ bucket, path: p, bytes: body.length, opts });
        return { data: { path: p }, error: null };
      },
    }),
  };
  return { from, storage, state, calls, uploads };
}
export const writes = (client) =>
  client.calls.filter((c) => c.op === "upsert" || c.op === "delete");
export const RACE_ID = "2026-09-18-05-12";
export const ENTRIES = [
  { race_id: RACE_ID, boat_number: 1, racer_id: 4371 },
  { race_id: RACE_ID, boat_number: 2, racer_id: 4335 },
  { race_id: RACE_ID, boat_number: 3, racer_id: 4573 },
  { race_id: RACE_ID, boat_number: 4, racer_id: 4264 },
  { race_id: RACE_ID, boat_number: 5, racer_id: 4095 },
  { race_id: RACE_ID, boat_number: 6, racer_id: 4500 },
];
export const G1_RACE = { race_grade: "G1", race_number: 12 };
// 1号艇だけコメントがある版（2〜6号艇の本文を空にする。公開直後の状態。BOA-611）
export const ONE_BOAT = (() => {
  let seen = 0;
  return R12.replace(
    /(<td class="is-alignL is-p0-10">)([^<]*)(<\/td>)/g,
    (all, open, _text, close) => (seen++ === 0 ? all : `${open}${close}`),
  );
})();
export const freshClient = (opts = {}) => {
  const c = createFakeClient({
    tables: {
      race_entries: ENTRIES,
      race_pit_reports: [],
      race_pit_comments: [],
    },
    ...opts,
  });
  clearPitReportSchemaCache(c);
  return c;
};
