#!/usr/bin/env node
/**
 * verify-eve-deadlines.js - 前夜の締切予定（eve_race_deadlines、BOA-1282、マイグレーション202）の回帰テスト。
 * DB・公式には接続しない（インメモリの Supabase・偽の fetch・PGlite）。
 *
 * 固定すること:
 *   - raceindex の解析: 行の R と締切を対にする（欠けた行で番号をずらさない）・日の札・並びの検査
 *   - 優勝戦の判定: 「優勝戦」「女子優勝戦」は true、「準優勝戦」「選抜戦Ａ」は false。12Rとは限らない（下関 2026-11-04 は11R）
 *   - 書く行: 値の変わる行だけ・毎回すべての列（照合の3列を除く）・締切の変更で deadline_changes＋1・取れなかった名前は前の値を残す
 *   - 取得: 1件ずつ間5秒・その晩の最初の起動だけ24場・最終日の会場だけ racelist 12・11・10R（2回目は取らない）・
 *     race_series の会場で 2xx でない・0行・並びの異常は失敗（書かない、incomplete）・21:20 より前の起動は incomplete・shadow は書かない・
 *     読み取りの失敗は例外
 *   - 照合: races_init の済む前は incomplete・食い違いと races に無い行の通知・2回目は書かない・行の全列を送る
 *   - 202 の形（PGlite）: race_id の CHECK・RLS・権限（anon 不可・service_role は DELETE 不可）・ジョブの行を live にする条件
 *   - registry の finalRunAfterJst の検査・vercel.json の cron と maxDuration
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  isFinalRaceName,
  parseRaceIndex,
  raceIndexProblems,
} from "../lib/raceIndexParser.js";
import {
  buildEveRows,
  buildReconcileRows,
  isFinalRound,
  raceIndexUrl,
  raceListUrl,
  runEveDeadlinesJob,
  runEveDeadlinesReconcileJob,
} from "../lib/eveDeadlinesJob.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { applyZeroRowGuard } from "../lib/scrapeJobs/outcomes.js";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), "utf8");
const LAST_DAY = read(
  "scripts/lib/__fixtures__/eveDeadlines/raceindex-19-20261104-last-day.html",
);
const DAY2 = read("scripts/lib/racesInit/__fixtures__/raceindex-01.html");
const EMPTY =
  "<html><body><div class='table1'><table><tbody></tbody></table></div></body></html>";
const racelistHtml = (name) =>
  `<html><body><h3 class="title16_titleDetail__add2020">\n\t\t${name}\u3000\u3000\u3000\n\t\t1800m\n\t</h3></body></html>`;

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- 解析 ----------

t("raceindex: 最終日の札と12Rの締切（下関 2026-11-04）", () => {
  const r = parseRaceIndex(LAST_DAY);
  assert.equal(r.dayLabel, "最終日");
  assert.equal(r.races.length, 12);
  assert.deepEqual(r.races[0], { raceNumber: 1, deadline: "17:41" });
  assert.deepEqual(r.races[10], { raceNumber: 11, deadline: "22:20" });
  assert.deepEqual(raceIndexProblems(r.races), []);
});

t("raceindex: ２日目の札（芦屋 2026-09-21 の写し）", () => {
  const r = parseRaceIndex(DAY2);
  assert.equal(r.dayLabel, "２日目");
  assert.equal(r.races.length, 12);
  assert.equal(r.races[11].deadline, "20:45");
});

t("raceindex: 行が欠けても R の番号をずらさない（並びの検査で落とす）", () => {
  const html = DAY2.replace(
    /<tr>(?:(?!<\/tr>)[\s\S])*?rno=3&amp;[\s\S]*?<\/tr>/,
    "",
  );
  const r = parseRaceIndex(html);
  assert.equal(r.races.length, 11);
  assert.equal(r.races[2].raceNumber, 4, "3R を飛ばした次の行は 4R のまま");
  assert.ok(
    raceIndexProblems(r.races).some((p) => /1R から続いていない/.test(p)),
  );
});

t("raceindex: 開催の無いページは行0・時刻が昇順でないと検査で落とす", () => {
  assert.deepEqual(parseRaceIndex(EMPTY).races, []);
  assert.deepEqual(raceIndexProblems([]), ["行が無い"]);
  const bad = [
    { raceNumber: 1, deadline: "15:00" },
    { raceNumber: 2, deadline: "14:59" },
  ];
  assert.ok(raceIndexProblems(bad).some((p) => /前の R/.test(p)));
  assert.ok(
    raceIndexProblems([{ raceNumber: 1, deadline: "05:59" }]).some((p) =>
      /06:00/.test(p),
    ),
  );
});

t("優勝戦の判定", () => {
  for (const s of ["優勝戦", "女子優勝戦", "男子優勝戦"])
    assert.equal(isFinalRaceName(s), true, s);
  for (const s of ["準優勝戦", "選抜戦Ａ", "予選", "優勝戦進出者決定戦", null])
    assert.equal(isFinalRaceName(s), false, String(s));
});

// ---------- 書く行 ----------

const D = "2026-11-05";
const NOW1 = "2026-11-04T11:40:05.000Z";
const NOW2 = "2026-11-04T12:00:05.000Z";
const v19 = { venueCode: 19, ...parseRaceIndex(LAST_DAY) };
const v4 = { venueCode: 4, ...parseRaceIndex(DAY2) };

t(
  "buildEveRows: 新しい行は全部・列の集合はそろう・最終日でない会場は is_final=false",
  () => {
    const names = new Map([
      [`${D}-19-12`, "選抜戦Ａ"],
      [`${D}-19-11`, "優勝戦"],
      [`${D}-19-10`, "一般戦"],
    ]);
    const { rows, changedIds } = buildEveRows({
      date: D,
      existing: [],
      venues: [v19, v4],
      names,
      nowIso: NOW1,
    });
    assert.deepEqual(changedIds, [], "新しい行は「変わった」に数えない");
    assert.equal(rows.length, 24);
    const keys = JSON.stringify(Object.keys(rows[0]).sort());
    assert.ok(
      rows.every((r) => JSON.stringify(Object.keys(r).sort()) === keys),
      "全行が同じ列",
    );
    assert.ok(
      !("day_mismatch" in rows[0]) && !("reconciled_at" in rows[0]),
      "照合の列は送らない",
    );
    const by = Object.fromEntries(rows.map((r) => [r.race_id, r]));
    assert.equal(by[`${D}-19-11`].is_final, true);
    assert.equal(by[`${D}-19-12`].is_final, false);
    assert.equal(
      by[`${D}-19-01`].is_final,
      false,
      "最終日でも候補（12・11・10R）でない R は false",
    );
    const noName = buildEveRows({
      date: D,
      existing: [],
      venues: [v19],
      names: new Map(),
      nowIso: NOW1,
    }).rows.find((r) => r.race_id === `${D}-19-12`);
    assert.equal(noName.is_final, null, "候補の名前が取れていなければ未確認");
    assert.equal(by[`${D}-04-12`].is_final, false);
    assert.equal(by[`${D}-19-11`].deadline, "22:20:00");
    assert.equal(by[`${D}-19-11`].first_fetched_at, NOW1);
  },
);

t(
  "buildEveRows: 変わらない行は書かない・締切の変更は数える・名前は前の値を残す",
  () => {
    const names = new Map([[`${D}-19-11`, "優勝戦"]]);
    const { rows: first } = buildEveRows({
      date: D,
      existing: [],
      venues: [v19],
      names,
      nowIso: NOW1,
    });
    // DB から読み戻した形（time は HH:MM:SS）
    const existing = first.map((r) => ({
      ...r,
      day_start_time: null,
      day_mismatch: null,
      reconciled_at: null,
    }));
    assert.deepEqual(
      buildEveRows({
        date: D,
        existing,
        venues: [v19],
        names: new Map(),
        nowIso: NOW2,
      }),
      { rows: [], changedIds: [] },
    );
    // 日の札が取れなかった回は前の値（優勝戦の判定を false で上書きしない）
    assert.deepEqual(
      buildEveRows({
        date: D,
        existing,
        venues: [{ ...v19, dayLabel: null }],
        names: new Map(),
        nowIso: NOW2,
      }).rows,
      [],
    );
    const moved = clone(v19);
    moved.races[10].deadline = "22:25";
    const { rows, changedIds } = buildEveRows({
      date: D,
      existing,
      venues: [moved],
      names: new Map(),
      nowIso: NOW2,
    });
    assert.deepEqual(changedIds, [`${D}-19-11`]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].deadline, "22:25:00");
    assert.equal(rows[0].deadline_changes, 1);
    assert.equal(rows[0].race_name, "優勝戦", "取らなかった回は前の名前を残す");
    assert.equal(rows[0].is_final, true);
    assert.equal(rows[0].first_fetched_at, NOW1);
    assert.equal(rows[0].updated_at, NOW2);
  },
);

// ---------- 取得のジョブ ----------

/** PostgREST のうち、このジョブが使う部分だけのインメモリのクライアント */
function fakeClient(tables, { failOn = null } = {}) {
  const data = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, clone(v)]),
  );
  const writes = [];
  const from = (table) => {
    const filters = [];
    let single = false;
    let op = "select";
    let payload = null;
    const b = {
      select: () => b,
      eq: (c, v) => (filters.push((r) => String(r[c]) === String(v)), b),
      lte: (c, v) => (filters.push((r) => r[c] <= v), b),
      gte: (c, v) => (filters.push((r) => r[c] >= v), b),
      maybeSingle: () => ((single = true), b),
      upsert: (rows, opts) => {
        op = "upsert";
        payload = { rows, opts };
        return b;
      },
      then: (res, rej) => {
        try {
          if (failOn === `${op}:${table}`)
            return res({
              data: null,
              error: { message: `偽の失敗 ${op} ${table}` },
            });
          if (op === "upsert") {
            writes.push({ table, ...clone(payload) });
            const list = (data[table] ??= []);
            for (const row of payload.rows) {
              const i = list.findIndex((r) => r.race_id === row.race_id);
              if (i >= 0) list[i] = { ...list[i], ...row };
              else
                list.push({
                  day_start_time: null,
                  day_mismatch: null,
                  reconciled_at: null,
                  ...row,
                });
            }
            return res({ data: null, error: null });
          }
          const rows = (data[table] ?? []).filter((r) =>
            filters.every((f) => f(r)),
          );
          return res({
            data: single ? (rows[0] ?? null) : clone(rows),
            error: null,
          });
        } catch (e) {
          return rej(e);
        }
      },
    };
    return b;
  };
  return { from, data, writes };
}

/** URL → 本文（無ければ開催なしのページ）。status の上書きもできる */
function fakeFetch(pages, statuses = {}) {
  const calls = [];
  const politeFetch = async (url) => {
    calls.push(url);
    const status = statuses[url] ?? 200;
    return new Response(status === 200 ? (pages[url] ?? EMPTY) : "forbidden", {
      status,
    });
  };
  return { politeFetch, calls };
}

const PAGES = {
  [raceIndexUrl(D, 19)]: LAST_DAY,
  [raceIndexUrl(D, 4)]: DAY2,
  [raceListUrl(D, 19, 12)]: racelistHtml("選抜戦Ａ"),
  [raceListUrl(D, 19, 11)]: racelistHtml("優勝戦"),
  [raceListUrl(D, 19, 10)]: racelistHtml("一般戦"),
};
const SERIES = [
  { venue_code: 19, start_date: "2026-11-01", end_date: "2026-11-05" },
  { venue_code: 4, start_date: "2026-11-04", end_date: "2026-11-09" },
  { venue_code: 7, start_date: "2026-10-28", end_date: "2026-11-03" }, // 終わった節
];
const ctxOf = ({
  client,
  politeFetch,
  now,
  mode = "live",
  stopAfter = Infinity,
}) => {
  let checks = 0;
  return {
    job: "eve_deadlines",
    mode,
    now: () => new Date(now),
    targetDate: "2026-11-04",
    client,
    politeFetch,
    shouldStop: () => ++checks > stopAfter,
  };
};
const sleeps = [];
const deps = { sleep: async (ms) => sleeps.push(ms) };

t("isFinalRound: 21:20 JST の起動から最後", () => {
  assert.equal(
    isFinalRound(new Date("2026-11-04T12:19:59Z"), "2026-11-04", "21:20"),
    false,
  );
  assert.equal(
    isFinalRound(new Date("2026-11-04T12:20:00Z"), "2026-11-04", "21:20"),
    true,
  );
});

let runClient;
t(
  "最初の起動: 24場を1件ずつ5秒おき・最終日の会場だけ racelist・書く・21:20 より前は incomplete",
  async () => {
    runClient = fakeClient({ race_series: SERIES, eve_race_deadlines: [] });
    const f = fakeFetch(PAGES);
    sleeps.length = 0;
    const out = await runEveDeadlinesJob(
      ctxOf({ client: runClient, politeFetch: f.politeFetch, now: NOW1 }),
      deps,
    );
    assert.equal(f.calls.length, 24 + 3);
    assert.equal(f.calls[0], raceIndexUrl(D, 4), "race_series の会場から");
    assert.equal(f.calls[1], raceIndexUrl(D, 19));
    assert.ok(
      f.calls.slice(24).every((u) => /racelist\?rno=1[012]&jcd=19/.test(u)),
      "racelist は raceindex の後",
    );
    assert.equal(sleeps.length, 26);
    assert.ok(sleeps.every((ms) => ms === 5000));
    assert.equal(out.incomplete, true, "20:40 の起動は済みにしない");
    assert.equal(out.rowsWritten, 24);
    assert.equal(out.rowsExpected, 2);
    assert.equal(out.rowsParsed, 24);
    assert.deepEqual(out.report.finals, [`${D}-19-11`]);
    assert.equal(runClient.writes.length, 1);
    assert.equal(runClient.writes[0].opts.onConflict, "race_id");
  },
);

t(
  "2回目以降: race_series の会場だけ・名前は取り直さない・変わらなければ書かない・21:20 の起動で済み",
  async () => {
    const f = fakeFetch(PAGES);
    const out = await runEveDeadlinesJob(
      ctxOf({
        client: runClient,
        politeFetch: f.politeFetch,
        now: "2026-11-04T12:20:03Z",
      }),
      deps,
    );
    assert.deepEqual(f.calls, [raceIndexUrl(D, 4), raceIndexUrl(D, 19)]);
    assert.equal(out.rowsWritten, 0);
    assert.equal(runClient.writes.length, 1, "書き込みは増えない");
    assert.equal(out.incomplete, false);
    assert.equal(out.report.finalRound, true);
  },
);

t(
  "race_series の会場の 403・0行は失敗（書かない、incomplete、最後の起動は通知）",
  async () => {
    const client = fakeClient({
      race_series: SERIES,
      eve_race_deadlines: [{ race_id: `${D}-04-01`, race_date: D, venue_code: 4 }],
    });
    const f = fakeFetch(
      { ...PAGES, [raceIndexUrl(D, 4)]: EMPTY },
      { [raceIndexUrl(D, 19)]: 403 },
    );
    const out = await runEveDeadlinesJob(
      ctxOf({
        client,
        politeFetch: f.politeFetch,
        now: "2026-11-04T12:20:03Z",
      }),
      deps,
    );
    assert.deepEqual(
      out.report.venuesFailed.map((v) => v.venueCode).sort(),
      [19, 4].sort(),
    );
    assert.equal(
      out.report.venuesFailed.find((v) => v.venueCode === 19).reason,
      "http_403",
    );
    assert.equal(out.rowsParsed, 0);
    assert.equal(
      applyZeroRowGuard({ outcome: "ok", ...out }).outcome,
      "error",
      "0件は成功にしない",
    );
    assert.equal(out.incomplete, true);
    assert.ok(out.report.alerts.some((a) => a.key === `failed:${D}`));
    assert.equal(client.writes.length, 0);
  },
);

t("race_series に無い会場で行が出たら書いて通知する", async () => {
  const client = fakeClient({
    race_series: [SERIES[0]],
    eve_race_deadlines: [],
  });
  const f = fakeFetch(PAGES);
  const out = await runEveDeadlinesJob(
    ctxOf({ client, politeFetch: f.politeFetch, now: NOW1 }),
    deps,
  );
  assert.deepEqual(out.report.unexpectedVenues, [4]);
  assert.ok(out.report.alerts.some((a) => a.key === `unexpected:${D}`));
  assert.equal(out.rowsWritten, 24);
});

t(
  "打ち切り: 着手しなかった会場は incomplete、名前の取れない最終日も incomplete",
  async () => {
    const client = fakeClient({
      race_series: SERIES,
      eve_race_deadlines: [{ race_id: `${D}-04-01`, race_date: D, venue_code: 4 }],
    });
    const f = fakeFetch(PAGES);
    const out = await runEveDeadlinesJob(
      ctxOf({
        client,
        politeFetch: f.politeFetch,
        now: "2026-11-04T12:20:03Z",
        stopAfter: 2,
      }),
      deps,
    );
    assert.equal(f.calls.length, 2, "raceindex の2件で止まる");
    assert.equal(out.report.namesMissing.length, 3);
    assert.equal(out.incomplete, true);
  },
);

t("shadow は書かない", async () => {
  const client = fakeClient({ race_series: SERIES, eve_race_deadlines: [] });
  const f = fakeFetch(PAGES);
  const out = await runEveDeadlinesJob(
    ctxOf({ client, politeFetch: f.politeFetch, now: NOW1, mode: "shadow" }),
    deps,
  );
  assert.equal(client.writes.length, 0);
  assert.equal(out.rowsWritten, 0);
  assert.equal(out.rowsParsed, 24);
});

t("読み取りの失敗は例外（行なしに化けさせない）", async () => {
  for (const failOn of ["select:race_series", "select:eve_race_deadlines"]) {
    const client = fakeClient(
      { race_series: SERIES, eve_race_deadlines: [] },
      { failOn },
    );
    const f = fakeFetch(PAGES);
    await assert.rejects(
      runEveDeadlinesJob(
        ctxOf({ client, politeFetch: f.politeFetch, now: NOW1 }),
        deps,
      ),
      /読み取りに失敗/,
    );
    assert.equal(f.calls.length, 0);
  }
});

t("翌日の節が race_series に無く24場も空なら失敗", async () => {
  const client = fakeClient({ race_series: [], eve_race_deadlines: [] });
  const f = fakeFetch({});
  const out = await runEveDeadlinesJob(
    ctxOf({ client, politeFetch: f.politeFetch, now: NOW1 }),
    deps,
  );
  assert.equal(out.outcome, "error");
  assert.equal(f.calls.length, 24);
});

t("race_series が空の晩: 2回目以降も行のある会場を取り直し、error にしない", async () => {
  const client = fakeClient({ race_series: [], eve_race_deadlines: [] });
  const f1 = fakeFetch(PAGES);
  const first = await runEveDeadlinesJob(
    ctxOf({ client, politeFetch: f1.politeFetch, now: NOW1 }),
    deps,
  );
  assert.deepEqual(first.report.unexpectedVenues, [4, 19]);
  const f2 = fakeFetch({ ...PAGES, [raceIndexUrl(D, 4)]: DAY2.replace(">20:45<", ">20:50<") });
  const second = await runEveDeadlinesJob(
    ctxOf({ client, politeFetch: f2.politeFetch, now: "2026-11-04T12:20:03Z" }),
    deps,
  );
  assert.deepEqual(f2.calls, [raceIndexUrl(D, 4), raceIndexUrl(D, 19)]);
  assert.notEqual(second.outcome, "error");
  assert.equal(second.incomplete, false);
  assert.equal(second.rowsWritten, 1);
  assert.ok(second.report.alerts.some((a) => a.key === `changed:${D}-04-12`));
});

t("race_series に無い会場の並びの異常は失敗に数えず通知だけ", async () => {
  const bad = DAY2.replace(">16:22<", ">15:00<");
  const client = fakeClient({ race_series: [SERIES[0]], eve_race_deadlines: [] });
  const f = fakeFetch({ ...PAGES, [raceIndexUrl(D, 4)]: bad });
  const out = await runEveDeadlinesJob(
    ctxOf({ client, politeFetch: f.politeFetch, now: "2026-11-04T12:20:03Z" }),
    deps,
  );
  assert.deepEqual(out.report.venuesFailed, []);
  assert.equal(out.report.unexpectedAnomalies[0].venueCode, 4);
  assert.equal(out.incomplete, false);
  assert.ok(!client.data.eve_race_deadlines.some((r) => r.venue_code === 4), "書かない");
});

// ---------- 照合 ----------

const reconcileCtx = (client, now = "2026-11-04T21:30:05Z") => ({
  job: "eve_deadlines_reconcile",
  mode: "live",
  now: () => new Date(now),
  targetDate: D,
  client,
});

t("照合: races_init が済む前は比べない（incomplete）", async () => {
  const client = fakeClient({
    scrape_job_state: [{ job: "races_init", last_target_date: "2026-11-04" }],
    eve_race_deadlines: clone(runClient.data.eve_race_deadlines),
    races: [],
  });
  const out = await runEveDeadlinesReconcileJob(reconcileCtx(client));
  assert.equal(out.incomplete, true);
  assert.equal(client.writes.length, 0);
});

t(
  "照合: 食い違い・races に無い行を通知し、全列で書く。2回目は書かない",
  async () => {
    const eve = clone(runClient.data.eve_race_deadlines);
    const races = eve
      .filter((e) => e.race_id !== `${D}-04-12`)
      .map((e) => ({
        race_id: e.race_id,
        race_date: D,
        start_time: e.race_id === `${D}-19-11` ? "22:25:00" : e.deadline,
      }));
    const client = fakeClient({
      scrape_job_state: [{ job: "races_init", last_target_date: D }],
      eve_race_deadlines: eve,
      races,
    });
    const out = await runEveDeadlinesReconcileJob(reconcileCtx(client));
    assert.deepEqual(out.report.mismatches, [`${D}-19-11`]);
    assert.deepEqual(out.report.missing, [`${D}-04-12`]);
    assert.equal(out.rowsWritten, 24);
    const row = client.writes[0].rows.find((r) => r.race_id === `${D}-19-11`);
    assert.equal(row.day_mismatch, true);
    assert.equal(row.day_start_time, "22:25:00");
    assert.equal(row.deadline, "22:20:00", "前夜の値は直さない");
    assert.ok(row.first_fetched_at && row.race_date, "NOT NULL の列も送る");
    const miss = client.writes[0].rows.find((r) => r.race_id === `${D}-04-12`);
    assert.equal(miss.day_mismatch, null);
    assert.ok(
      out.report.alerts.some(
        (a) =>
          a.key === `mismatch:${D}-19-11` &&
          a.until === "2026-11-05T03:00:00.000Z",
      ),
    );
    assert.ok(out.report.alerts.some((a) => a.key === `missing:${D}`));
    const noStart = buildReconcileRows({
      eveRows: [eve[0]],
      races: [{ race_id: eve[0].race_id, start_time: null }],
      nowIso: "x",
    });
    assert.deepEqual(noStart.missing, [], "races の行があれば中止の疑いにしない");
    assert.equal(noStart.noStartTime.length, 1);
    const again = buildReconcileRows({
      eveRows: client.data.eve_race_deadlines,
      races,
      nowIso: "x",
    });
    assert.equal(again.rows.length, 0, "変わらなければ書かない");
  },
);

// ---------- registry・vercel.json ----------

t("registry: finalRunAfterJst の検査と2つのジョブ", () => {
  assert.deepEqual(validateRegistry(), []);
  assert.equal(SCRAPE_JOBS.eve_deadlines.finalRunAfterJst, "21:20");
  const bad = {
    x: { ...SCRAPE_JOBS.eve_deadlines, finalRunAfterJst: "20:00" },
  };
  assert.ok(validateRegistry(bad).some((p) => /finalRunAfterJst/.test(p)));
});

t(
  "vercel.json の cron（JST 20:40・21:00・21:10・21:20、06:30・08:00）と maxDuration",
  () => {
    const crons = JSON.parse(read("vercel.json")).crons;
    const of = (p) => crons.filter((c) => c.path === p).map((c) => c.schedule);
    assert.deepEqual(of("/api/cron/eve-deadlines"), [
      "40 11 * * *",
      "0,10,20 12 * * *",
    ]);
    assert.deepEqual(of("/api/cron/eve-deadlines-reconcile"), [
      "30 21 * * *",
      "0 23 * * *",
    ]);
    for (const [file, job] of [
      ["api/cron/eve-deadlines.js", "eve_deadlines"],
      ["api/cron/eve-deadlines-reconcile.js", "eve_deadlines_reconcile"],
    ]) {
      const m = /maxDuration:\s*(\d+)/.exec(read(file));
      assert.equal(Number(m[1]), SCRAPE_JOBS[job].maxDurationSec, file);
    }
  },
);

// ---------- 202（PGlite） ----------

t("202: race_id の CHECK・RLS・権限・ジョブの行", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE claude_ro BYPASSRLS;
    CREATE TABLE scrape_job_state (job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off',
      last_success_at TIMESTAMPTZ, last_tick_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT now());
    INSERT INTO scrape_job_state (job, mode) VALUES ('eve_deadlines', 'off');
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role, anon, authenticated;
  `);
  const sql = read("docs/db-migration/202_eve_race_deadlines.sql");
  await db.exec(sql);
  await db.exec(sql); // 2回当てても失敗しない
  const modes = (
    await db.query("SELECT job, mode FROM scrape_job_state ORDER BY job")
  ).rows;
  assert.deepEqual(modes, [
    { job: "eve_deadlines", mode: "live" },
    { job: "eve_deadlines_reconcile", mode: "live" },
  ]);
  // 手で off にして動いた後の行は上書きしない
  await db.exec(
    "UPDATE scrape_job_state SET mode='off', last_tick_at=now() WHERE job='eve_deadlines'",
  );
  await db.exec(sql);
  assert.equal(
    (
      await db.query(
        "SELECT mode FROM scrape_job_state WHERE job='eve_deadlines'",
      )
    ).rows[0].mode,
    "off",
  );

  const ins = (id, date, v, r) =>
    db.query(
      `INSERT INTO eve_race_deadlines (race_id, race_date, venue_code, race_number, deadline, first_fetched_at, updated_at)
       VALUES ($1, $2, $3, $4, '15:45:00', now(), now())`,
      [id, date, v, r],
    );
  await ins("2026-11-05-04-01", "2026-11-05", 4, 1);
  await assert.rejects(
    ins("2026-11-05-4-01", "2026-11-05", 4, 1),
    /race_id_shape/,
  );
  await assert.rejects(
    ins("2026-11-05-04-02", "2026-11-05", 4, 1),
    /race_id_shape/,
  );
  await assert.rejects(
    db.query(
      `UPDATE eve_race_deadlines SET day_mismatch = true WHERE race_id = '2026-11-05-04-01'`,
    ),
    /reconciled_pair/,
  );
  const priv = (
    await db.query(`SELECT
      has_table_privilege('anon', 'eve_race_deadlines', 'SELECT') AS anon_select,
      has_table_privilege('authenticated', 'eve_race_deadlines', 'SELECT') AS auth_select,
      has_table_privilege('claude_ro', 'eve_race_deadlines', 'SELECT') AS ro_select,
      has_table_privilege('claude_ro', 'eve_race_deadlines', 'UPDATE') AS ro_update,
      has_table_privilege('service_role', 'eve_race_deadlines', 'UPDATE') AS sr_update,
      has_table_privilege('service_role', 'eve_race_deadlines', 'DELETE') AS sr_delete,
      (SELECT relrowsecurity FROM pg_class WHERE relname = 'eve_race_deadlines') AS rls`)
  ).rows[0];
  assert.deepEqual(priv, {
    anon_select: false,
    auth_select: false,
    ro_select: true,
    ro_update: false,
    sr_update: true,
    sr_delete: false,
    rls: true,
  });
  await db.close();
});

for (const [name, fn] of tests) {
  try {
    await fn();
    n += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`not ok - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}
console.log(`${n}/${tests.length} 件`);
