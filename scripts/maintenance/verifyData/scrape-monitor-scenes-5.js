/**
 * verify-scrape-monitor.js の後半の場面（5/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { collectMonitorInput, evaluateRacesPresent } from "../../lib/scrapeJobs/monitor.js";

let check, show, DATE, at, iso, slot;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const now = at("09:40");
  const reads = [];
  const fakeClient = (tables) => ({
    from(table) {
      const q = {
        table,
        filters: [],
        from: 0,
        to: Infinity,
        head: false,
        desc: "",
      };
      const api = {
        select(_cols, opts) {
          q.head = Boolean(opts?.head);
          return api;
        },
        eq(col, v) {
          q.filters.push((r) => r[col] === v);
          q.desc += `${col}=${v};`;
          return api;
        },
        gte(col, v) {
          q.filters.push((r) => r[col] >= v);
          return api;
        },
        gt(col, v) {
          q.filters.push((r) => r[col] > v);
          q.desc += `${col}>${v};`;
          return api;
        },
        in(col, vs) {
          q.filters.push((r) => vs.includes(r[col]));
          return api;
        },
        order() {
          return api;
        },
        range(from, to) {
          q.from = from;
          q.to = to;
          return api;
        },
        then(resolve) {
          reads.push(`${table}:${q.desc}`);
          const rows = (tables[table] ?? []).filter((r) =>
            q.filters.every((f) => f(r)),
          );
          resolve(
            q.head
              ? { count: rows.length, data: null, error: null }
              : { data: rows.slice(q.from, q.to + 1), error: null },
          );
        },
      };
      return api;
    },
  });
  const R = `${DATE}-01-03`;
  const cand = slot("odds", -60, "expired", {
    race_id: R,
    attempts: 3,
    outcome: "no_values",
  });
  const sibDone = slot("odds", -30, "done", {
    race_id: R,
    outcome: "ok",
    done_at: iso(at("09:31")),
  });
  const jobs = [{ job: "odds", mode: "live" }];
  reads.length = 0;
  return { now, reads, fakeClient, R, cand, sibDone, jobs };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ now, reads, fakeClient, R, cand, sibDone, jobs }) {
  let inp = await collectMonitorInput(
    fakeClient({
      scrape_job_state: jobs,
      scrape_slots: [
        slot("odds", -60, "done", { race_id: R, done_at: iso(at("09:01")) }),
      ],
      races: [],
    }),
    now,
    "tick",
  );
  check(
    "collectMonitorInput: 候補（-60のno_values・未完了、または試行2回以上で完了）が無ければ、オッズの後続の窓のスロットを追加で読まない",
    inp.oddsSlots.length === 0 &&
      !reads.some((x) => x.includes("job=odds") && x.includes("offset_min>")) &&
      inp.firstRaceIds === undefined,
    show(reads),
  );
  reads.length = 0;
  inp = await collectMonitorInput(
    fakeClient({
      scrape_job_state: jobs,
      scrape_slots: [cand, sibDone],
      races: [],
    }),
    now,
    "tick",
  );
  check(
    "collectMonitorInput: 候補があれば、オッズの後続の窓（-60より後）のスロットだけを追加で読む（全レース。racesの一覧は読まない）",
    inp.oddsSlots.length === 1 &&
      inp.oddsSlots[0].offset_min === -30 &&
      inp.oddsSlots[0].status === "done" &&
      reads.some(
        (x) => x.includes("job=odds") && x.includes("offset_min>-60"),
      ) &&
      reads.filter((x) => x.startsWith("races:")).length === 1,
    show(reads),
  );
  // 延長で取得できた（試行2回以上で完了）も、候補になる（後続の窓を読む）
  reads.length = 0;
  inp = await collectMonitorInput(
    fakeClient({
      scrape_job_state: jobs,
      scrape_slots: [
        slot("odds", -60, "done", {
          race_id: R,
          attempts: 5,
          first_attempt_at: iso(at("09:00")),
          last_attempt_at: iso(at("09:04")),
          done_at: iso(at("09:04")),
        }),
        sibDone,
      ],
      races: [],
    }),
    now,
    "tick",
  );
  check(
    "collectMonitorInput: 延長で取得できた（試行2回以上で完了）-60も候補になり、後続の窓を読む",
    inp.oddsSlots.length === 1,
    show(reads),
  );
}

async function scene3() {
  {
    const s1 = scene1();
    await scene2(s1);
  }
  // 当日のracesが無い
  {
    const jobs = [{ job: "odds", mode: "live" }];
    const ev = (todayRaceCount, when, jobStates = jobs) =>
      evaluateRacesPresent({ jobStates, todayRaceCount, now: when });
    check(
      "当日のracesが0件（08:00以降・窓型ジョブが有効）: 通知。08:00前・racesあり・有効なジョブなしでは通知しない",
      ev(0, at("08:05")).length === 1 &&
        ev(0, at("08:05"))[0].key === "races_missing:2026-09-19" &&
        ev(0, at("07:30")).length === 0 &&
        ev(156, at("08:05")).length === 0 &&
        ev(0, at("08:05"), [{ job: "odds", mode: "off" }]).length === 0 &&
        ev(0, at("08:05"), [{ job: "point_rank", mode: "live" }]).length === 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・DATE・at・iso・slot） */
export async function runScrapeMonitorScenes5(env) {
  ({ check, show, DATE, at, iso, slot } = env);
  await scene3();
}
