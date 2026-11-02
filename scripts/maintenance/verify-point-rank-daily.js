#!/usr/bin/env node
/**
 * verify-point-rank-daily.js - 得点率の日ごとの写し（racer_series_points_daily、BOA-1210、マイグレーション192）の回帰テスト。
 * DB・公式には接続しない（インメモリの Supabase と偽の fetch）。
 *
 * 固定すること:
 *   - 取得の対象日（snapshot_date）と節の日目（series_day）をキーに足して、racer_series_points と同じ値を書く
 *   - 翌日の取得で前の日の行を上書きしない（racer_series_points は上書き、写しは日ごとに残る）
 *   - 同じ対象日の再取得（失敗後の補足の起動）では、値が変わった行だけ書く。PostgREST が NUMERIC を文字列で返しても
 *     「変更あり」にしない（unchangedRows.js の NUMERIC_SCALES）
 *   - 表が無い（192 の未適用）間は、写しを書かずに racer_series_points を書き続け、実行を失敗にしない
 *   - それ以外の写しの読み書きの失敗は、実行の失敗にする（runPointRankJob の outcome:"error"。補足の起動が再試行する）
 *   - マイグレーション192 の主キー・RLS・権限（anon は SELECT だけ、claude_ro に SELECT）
 */
import fs from "node:fs";
import { run, _internal } from "../daily/scrape-point-rank.js";
import { runPointRankJob } from "../lib/pointRankJob.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

const FIXTURES = new URL("../lib/__fixtures__/pointRank/", import.meta.url);
const G1_TABLE = fs.readFileSync(
  new URL("g1-day4-with-table.html", FIXTURES),
  "utf8",
);
/** 表の注記の日目だけを差し替えた写し（公式は「N日目12R終了時点」と書く。fixture は4日目） */
const G1_AS_OF = (day) =>
  G1_TABLE.replace(
    "４日目１２R終了時点",
    `${"０１２３４５６７８９"[day]}日目１２R終了時点`,
  );
const NO_TABLE = fs.readFileSync(new URL("g3-no-data.html", FIXTURES), "utf8");

/** PostgREST のうち、この検証で使う部分だけのインメモリのクライアント */
function createFakeClient(tables, { failOn = {} } = {}) {
  const data = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map(clone)]),
  );
  const writes = [];
  const likeRe = (p) =>
    new RegExp(
      `^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
    );
  function from(table) {
    const q = { op: "select", filters: [], orders: [], limitN: null };
    const b = {
      select() {
        return b;
      },
      in(c, vs) {
        q.filters.push((r) => vs.includes(r[c]));
        return b;
      },
      like(c, p) {
        const re = likeRe(p);
        q.filters.push((r) => re.test(String(r[c])));
        return b;
      },
      not(c, op, v) {
        if (op !== "is" || v !== null) throw new Error("fake: not 未対応");
        q.filters.push((r) => r[c] != null);
        return b;
      },
      order(c) {
        q.orders.push(c);
        return b;
      },
      limit(n) {
        q.limitN = n;
        return b;
      },
      upsert(rows, opts) {
        q.op = "upsert";
        q.payload = rows;
        q.opts = opts ?? {};
        return b;
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    function exec() {
      const failure = failOn[`${table}:${q.op}`];
      if (failure) return { data: null, error: failure };
      const rows = (data[table] ??= []);
      if (q.op === "select") {
        let found = rows.filter((r) => q.filters.every((f) => f(r)));
        for (const c of q.orders)
          found = [...found].sort((x, y) => (x[c] < y[c] ? -1 : 1));
        if (q.limitN !== null) found = found.slice(0, q.limitN);
        return { data: found.map(clone), error: null };
      }
      const keys = String(q.opts.onConflict).split(",");
      for (const r of q.payload) {
        const hit = rows.find((e) => keys.every((k) => e[k] === r[k]));
        if (hit) Object.assign(hit, clone(r));
        else rows.push(clone(r));
      }
      writes.push({ table, count: q.payload.length });
      return { data: null, error: null };
    }
    return b;
  }
  return {
    from,
    data,
    writtenTo: (table) =>
      writes.filter((w) => w.table === table).reduce((n, w) => n + w.count, 0),
  };
}

/** 多摩川（05）が G1・その日の日目、ほかの1会場は一般戦（表なし） */
const tablesFor = (date, seriesDay) => ({
  races: [
    { race_id: `${date}-05-01`, race_grade: "G1" },
    { race_id: `${date}-04-01`, race_grade: "ippan" },
  ],
  race_conditions: [{ race_id: `${date}-05-01`, series_day: seriesDay }],
});
/** jcd=05 は、ページの注記がその日の日目（day）の表を返す */
const fetchFor =
  (day, html = G1_AS_OF(day)) =>
  async (url) =>
    new Response(
      new URL(url).searchParams.get("jcd") === "05" ? html : NO_TABLE,
    );
const fakeFetch = fetchFor(3);
const opts = (client, fetchImpl = fakeFetch) => ({
  client,
  fetchImpl,
  attempts: 1,
  venueDelayMs: 0,
});
const DAILY = "racer_series_points_daily";

// --- 予選3日目の夜: 写しを書く -------------------------------------------------
const client = createFakeClient(tablesFor("2026-09-18", 3));
const day3 = await run("2026-09-18", opts(client));
const daily3 = client.data[DAILY] ?? [];
check(
  "3日目: racer_series_points と同じ52行を、snapshot_date=対象日・series_day=3・meet_start_date=09-16 で写しに書く",
  day3.failures.length === 0 &&
    day3.count === 52 &&
    daily3.length === 52 &&
    daily3.every(
      (r) =>
        r.snapshot_date === "2026-09-18" &&
        r.series_day === 3 &&
        r.meet_start_date === "2026-09-16" &&
        r.venue_code === 5 &&
        r.as_of_race === 12,
    ) &&
    day3.daily?.written === 52,
  show({ failures: day3.failures, count: day3.count, daily: day3.daily }),
);
const sample = client.data.racer_series_points.find(
  (r) => r.racer_id === daily3[0].racer_id,
);
check(
  "3日目: 写しの値（順位・得点率・着順・得点・減点・早見）は racer_series_points と同じ",
  [
    "rank",
    "score_rate",
    "placements",
    "total_points",
    "penalty_points",
    "player_name",
    "next_race_1",
    "next_series_day",
  ].every((c) => (sample[c] ?? null) === (daily3[0][c] ?? null)),
  show({ sample, daily: daily3[0] }),
);

// PostgREST は NUMERIC を文字列で返す。その形にして再取得し、変更なしと判定されるかを見る
for (const r of client.data[DAILY])
  if (r.score_rate != null) r.score_rate = Number(r.score_rate).toFixed(2);

// --- 同じ対象日の再取得（失敗後の補足の起動）: 変更のある行だけ書く ----------------
const beforeRetry = client.writtenTo(DAILY);
const retry = await run("2026-09-18", opts(client));
check(
  "再取得: 値が同じなら写しに1行も書かない（NUMERIC の文字列表記でも変更なし）",
  retry.failures.length === 0 &&
    client.writtenTo(DAILY) === beforeRetry &&
    retry.daily?.written === 0 &&
    retry.daily?.unchanged === 52,
  show(retry.daily),
);
const changed = client.data[DAILY].find((r) => r.rank != null);
const changedId = changed.racer_id;
changed.rank = 99;
const retry2 = await run("2026-09-18", opts(client));
check(
  "再取得: 値が変わった1行だけ書き直す",
  retry2.daily?.written === 1 &&
    client.data[DAILY].find((r) => r.racer_id === changedId).rank !== 99,
  show(retry2.daily),
);

// --- 翌日（4日目）: 前の日の行を上書きしない --------------------------------------
Object.assign(client.data, clone(tablesFor("2026-09-19", 4)));
const day4 = await run("2026-09-19", opts(client, fetchFor(4)));
const all = client.data[DAILY];
check(
  "4日目: 写しは日ごとに残る（3日目52行＋4日目52行）。racer_series_points は上書きで52行のまま",
  day4.failures.length === 0 &&
    all.length === 104 &&
    all.filter((r) => r.snapshot_date === "2026-09-18").length === 52 &&
    all.filter((r) => r.snapshot_date === "2026-09-19" && r.series_day === 4)
      .length === 52 &&
    client.data.racer_series_points.length === 52,
  show({ n: all.length, failures: day4.failures }),
);

// --- 192 の未適用: 写しを飛ばし、racer_series_points は書く。実行は成功 ------------
{
  const c = createFakeClient(tablesFor("2026-09-18", 3), {
    failOn: {
      [`${DAILY}:select`]: {
        code: "PGRST205",
        message: `Could not find the table 'public.${DAILY}' in the schema cache`,
      },
    },
  });
  const res = await runPointRankJob({
    targetDate: "2026-09-18",
    client: c,
    politeFetch: fakeFetch,
    mode: "live",
    shouldStop: () => false,
  });
  check(
    "192 未適用: 写しを書かず report.daily.tableMissing=true、racer_series_points は52行書き、実行は失敗にしない",
    res.outcome !== "error" &&
      res.rowsWritten === 52 &&
      res.report.daily?.tableMissing === true &&
      (c.data[DAILY] ?? []).length === 0,
    show({ outcome: res.outcome, report: res.report.daily, error: res.error }),
  );
}

// --- 写しの読み取りの失敗（表はある）: 実行の失敗にする -----------------------------
{
  const c = createFakeClient(tablesFor("2026-09-18", 3), {
    failOn: {
      [`${DAILY}:select`]: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    },
  });
  const res = await runPointRankJob({
    targetDate: "2026-09-18",
    client: c,
    politeFetch: fakeFetch,
    mode: "live",
    shouldStop: () => false,
  });
  check(
    "写しの既存行が読めない: 書かずに outcome=error（対象日を処理済みにせず、補足の起動が再試行する）",
    res.outcome === "error" &&
      /racer_series_points_daily/.test(res.error) &&
      (c.data[DAILY] ?? []).length === 0,
    show({ outcome: res.outcome, error: res.error }),
  );
}

// --- 別の表が無いエラーは「未適用」と取り違えない ------------------------------------
{
  const c = createFakeClient(tablesFor("2026-09-18", 3), {
    failOn: {
      [`${DAILY}:upsert`]: {
        code: "PGRST205",
        message:
          "Could not find the table 'public.other_table' in the schema cache",
      },
    },
  });
  const res = await run("2026-09-18", opts(c));
  check(
    "写しの書き込みで別の表の不在エラー: 未適用と取り違えず、失敗にする",
    res.failures.some((f) => f.includes(DAILY)) &&
      res.daily?.tableMissing === false,
    show({ failures: res.failures, daily: res.daily }),
  );
}

// --- 5日目: 公式の表は「４日目１２R終了時点」で止まる。その日の値ではないので写しに書かない --------
{
  const c = createFakeClient(tablesFor("2026-09-20", 5));
  const res = await run("2026-09-20", opts(c, fetchFor(4)));
  check(
    "5日目に4日目の時点の表: racer_series_points は書き、写しには書かず skippedVenues に出す。実行は成功",
    res.failures.length === 0 &&
      res.count === 52 &&
      (c.data[DAILY] ?? []).length === 0 &&
      res.daily?.skippedVenues?.[0]?.asOfSeriesDay === 4 &&
      res.daily?.skippedVenues?.[0]?.seriesDay === 5,
    show(res.daily),
  );
}

// --- 過去の日付で取った（3日目の対象日なのに4日目の時点の表）: 写しに書かない ---------------
{
  const c = createFakeClient(tablesFor("2026-09-18", 3));
  const res = await run("2026-09-18", opts(c, fetchFor(4)));
  check(
    "3日目の対象日に4日目の時点の表（後から取った）: 3日目の行として書かない",
    (c.data[DAILY] ?? []).length === 0 &&
      res.daily?.skippedVenues?.length === 1,
    show(res.daily),
  );
}

// --- 注記を読めない表: 写しを書かず、実行の失敗にする（racer_series_points は書く） ----------
{
  const c = createFakeClient(tablesFor("2026-09-18", 3));
  const html = G1_TABLE.replace("４日目１２R終了時点", "");
  const res = await run("2026-09-18", opts(c, fetchFor(3, html)));
  check(
    "注記「N日目NR終了時点」を読めない: 写しを書かず failure にする。racer_series_points は52行書く",
    res.failures.some((f) => /終了時点/.test(f)) &&
      (c.data[DAILY] ?? []).length === 0 &&
      (c.data.racer_series_points ?? []).length === 52,
    show(res.failures),
  );
}

// --- 純粋関数: 書く会場が無ければ0行 ---------------------------------------------
check(
  "buildDailyRows: 会場が無ければ0行",
  _internal.buildDailyRows("2026-09-18", [], "x").length === 0,
);

// --- マイグレーション192 ---------------------------------------------------------
{
  const sql = fs.readFileSync(
    new URL(
      "../../docs/db-migration/192_racer_series_points_daily.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const body = sql.replace(/--.*$/gm, "");
  check(
    "192: 主キーは (snapshot_date, venue_code, racer_id)（書き手の onConflict と同じ）",
    /PRIMARY KEY \(snapshot_date, venue_code, racer_id\)/.test(body),
  );
  check(
    "192: RLS 有効・anon と authenticated は SELECT のポリシーと GRANT SELECT だけ・claude_ro に SELECT",
    /ENABLE ROW LEVEL SECURITY/.test(body) &&
      /FOR SELECT TO anon, authenticated USING \(true\)/.test(body) &&
      /GRANT SELECT ON public\.racer_series_points_daily TO anon, authenticated;/.test(
        body,
      ) &&
      /GRANT SELECT ON public\.racer_series_points_daily TO claude_ro;/.test(
        body,
      ) &&
      !/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*TO[^;]*(anon|authenticated)/i.test(
        body,
      ),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件失敗`);
  process.exit(1);
}
console.log("\n✅ verify-point-rank-daily: すべて通過");
