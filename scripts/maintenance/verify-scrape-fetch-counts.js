import assert from "node:assert/strict";
import { dailyFetchCounts } from "../lib/scrapeJobs/fetchCounts.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

const date = "2026-10-25";
const row = (job, attempts, outcome = "ok", status = "done") =>
  ({ job, attempts, outcome, status, target_date: date });
const rows = [row("odds", 3), row("odds_final", 2, "partial"),
  row("exhibition", 4, "error", "expired"), row("exhibition", 1, null, "running"),
  row("result", 2, "no_values", "pending"), row("race_info", 1),
  row("pcexpect", 1), row("pit_reports", 1), row("pseudo", 9),
  row("boatcast_oriten", 2), row("exhibition", 0),
  { ...row("exhibition", 100), target_date: "2026-10-24" }];
for (const outcome of ["skipped_have_data", "skipped_not_target", "skipped_other",
  "cancelled_race", "breaker_open", "budget_exhausted", "not_due"]) {
  rows.push(row("exhibition", 100, outcome));
}
// BOA-1153: 窓型ジョブの取得パスの正本は registry。
const expectedPaths = {
  odds: ["oddstf", "odds2tf", "oddsk", "odds3t", "odds3f"],
  odds_final: ["oddstf", "odds2tf", "oddsk", "odds3t", "odds3f"],
  exhibition: ["beforeinfo"], result: ["raceresult"], race_info: ["racelist"],
  pcexpect: ["pcexpect"], pit_reports: ["pitreport"],
  boatcast_oriten: ["/txt/{jo}/bc_oriten_{YYYYMMDD}_{jo}_{RR}.txt"], pseudo: [],
};
for (const [name, job] of Object.entries(SCRAPE_JOBS)) {
  if (job.kind !== "window") continue;
  assert.ok(Array.isArray(job.fetchPaths), `${name}: fetchPaths が必要`);
  const expected = expectedPaths[name].map((path) =>
    path.startsWith("/") ? path : `/owpc/pc/race/${path}`);
  assert.deepEqual(job.fetchPaths, expected);
}
const before = structuredClone(rows);
const counts = dailyFetchCounts(rows, SCRAPE_JOBS, date);
// 旧実装の出力を、ホスト・パス・件数・並び順を含めて固定する。
assert.deepEqual(counts, [
  ["race.boatcast.jp", "/txt/{jo}/bc_oriten_{YYYYMMDD}_{jo}_{RR}.txt", 2],
  ["www.boatrace.jp", "/owpc/pc/race/beforeinfo", 5],
  ["www.boatrace.jp", "/owpc/pc/race/odds2tf", 5],
  ["www.boatrace.jp", "/owpc/pc/race/odds3f", 5],
  ["www.boatrace.jp", "/owpc/pc/race/odds3t", 5],
  ["www.boatrace.jp", "/owpc/pc/race/oddsk", 5],
  ["www.boatrace.jp", "/owpc/pc/race/oddstf", 5],
  ["www.boatrace.jp", "/owpc/pc/race/pcexpect", 1],
  ["www.boatrace.jp", "/owpc/pc/race/pitreport", 1],
  ["www.boatrace.jp", "/owpc/pc/race/racelist", 1],
  ["www.boatrace.jp", "/owpc/pc/race/raceresult", 2],
].map(([host, path, n]) => ({ host, path, attempts: n, pages: n })));
const customRegistry = { new_window: { kind: "window", fetchPaths: ["/custom/path"] } };
assert.deepEqual(dailyFetchCounts([row("new_window", 3)], customRegistry, date), [
  { host: "www.boatrace.jp", path: "/custom/path", attempts: 3, pages: 3 },
]);
const missingPaths = { ...SCRAPE_JOBS, odds: { ...SCRAPE_JOBS.odds } };
delete missingPaths.odds.fetchPaths;
assert.throws(() => dailyFetchCounts([row("odds", 1)], missingPaths, date),
  /ページ数が未定義です: odds/);
const get = (path) => counts.find((r) => r.path === `/owpc/pc/race/${path}`);
for (const path of ["oddstf", "odds2tf", "oddsk", "odds3t", "odds3f"]) {
  assert.deepEqual(get(path), { host: "www.boatrace.jp", path: `/owpc/pc/race/${path}`, attempts: 5, pages: 5 });
}
assert.equal(get("beforeinfo").pages, 5);
assert.equal(get("raceresult").pages, 2);
assert.equal(get("racelist").pages, 1);
assert.equal(get("pcexpect").pages, 1);
assert.equal(get("pitreport").pages, 1);
assert.equal(counts.find((r) => r.host === "race.boatcast.jp").pages, 2);
assert.equal(counts.length, 11);
assert.deepEqual(rows, before);
assert.deepEqual(dailyFetchCounts([...rows].reverse(), SCRAPE_JOBS, date), counts);
assert.deepEqual(dailyFetchCounts([], SCRAPE_JOBS, date), []);
assert.equal(get("beforeinfo").attempts, 5); // status で試行を落とさない
assert.equal(dailyFetchCounts([row("odds", "3")], SCRAPE_JOBS, date)[0].pages, 3);
assert.throws(() => dailyFetchCounts([row("unknown", 1)], SCRAPE_JOBS, date));
assert.throws(() => dailyFetchCounts([row("odds", -1)], SCRAPE_JOBS, date));
assert.throws(() => dailyFetchCounts([row("odds", 1.5)], SCRAPE_JOBS, date));
assert.throws(() => dailyFetchCounts([row("odds", null)], SCRAPE_JOBS, date));
assert.throws(() => dailyFetchCounts([], SCRAPE_JOBS, "2026-02-30"));
assert.throws(() => dailyFetchCounts([row("new_window", 1)], { new_window: { kind: "window" } }, date));
console.log("verify-scrape-fetch-counts: OK");

const { PGlite } = await import("@electric-sql/pglite");
const { dailyCountsSql, readDailyCounts } = await import("../analysis/scraping-load-budget/daily-fetch-counts.js");
const db = new PGlite();
try {
  await db.exec(`CREATE TABLE scrape_slots(job text, status text, outcome text, race_date date, attempts integer);
    INSERT INTO scrape_slots SELECT 'exhibition', 'done', 'ok', '2026-10-25', 2 FROM generate_series(1, 9001);
    INSERT INTO scrape_slots VALUES ('exhibition', 'done', 'ok', '2026-10-24', 100);`);
  const result = await db.query(dailyCountsSql(date));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].attempts, "18002");
  assert.equal(dailyFetchCounts(result.rows, SCRAPE_JOBS, date)[0].pages, 18002);
  assert.throws(() => dailyCountsSql("2026-10-25'; SELECT 1"));
  const calls = [];
  const client = (fetched) => ({ query: async (sql) => {
    calls.push(sql);
    if (sql.startsWith("SELECT current_user")) return { rows: [{ role: "claude_ro", ro: "on" }] };
    if (sql.startsWith("FETCH")) return { rows: fetched };
    return { rows: [] };
  } });
  assert.equal((await readDailyCounts(client(result.rows), date))[0].pages, 18002);
  assert.ok(calls.includes("BEGIN TRANSACTION READ ONLY"));
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(calls.some((sql) => sql.includes("DECLARE ro_query_cursor") && sql.includes("GROUP BY")));
  await assert.rejects(readDailyCounts(client(Array(5001).fill(result.rows[0])), date), /上限/);
  await assert.rejects(readDailyCounts({ query: async () => { throw new Error("read failed"); } }, date), /read failed/);
} finally {
  await db.close();
}
console.log("verify-scrape-fetch-counts: SQL・9001行・読み取り失敗・上限検査 OK");

const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { spawnSync } = await import("node:child_process");
const dir = mkdtempSync(join(tmpdir(), "scrape-counts-"));
try {
  const file = join(dir, "slots.json");
  writeFileSync(file, JSON.stringify(rows));
  const cli = new URL("../analysis/scraping-load-budget/daily-fetch-counts.js", import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, date, "--input", file], { encoding: "utf8", env: {} });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.target_date, date);
  assert.equal(output.approximate, true);
  assert.deepEqual(output.counts, counts);
  for (const word of ["1ページ確認", "partial", "最終 outcome", "politeFetch", "開催日"]) {
    assert.ok(output.notes.join(" ").includes(word));
  }
  const invalid = spawnSync(process.execPath, [cli.pathname, "2026-02-30"], { encoding: "utf8", env: {} });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("verify-scrape-fetch-counts: CLI ローカル入力・注記・異常終了 OK");
