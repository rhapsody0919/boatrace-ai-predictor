/**
 * verify-analogy-v16-api.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-v16-api.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { objectPath } from "../../../api/_lib/analogyV16.js";
import { buildLiveFeatures } from "../../../src/utils/analogyRaceFeatures.js";
import zlib from "zlib";
import factsHandler from "../../../api/analogy/facts/[raceId].js";
import scenarioHandler, { boatScopes } from "../../../api/analogy/scenario/[raceId].js";
import { runAnalogyV16Exhibition, todayExhibition } from "../../lib/analogyV16Exhibition.js";

let check;

async function scene1() {
  // ---- 7. 展示後の段は、関数の上限の手前（shouldStop）で止まる -----------------------------
  {
    process.env.SUPABASE_URL = "https://example.invalid";
    process.env.SUPABASE_SERVICE_KEY = "test";
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      const u = String(url);
      const body = u.includes("analogy_v16_snapshots")
        ? [
            {
              race_id: "2026-10-05-20-01",
              stage: "racecard",
              status: "ok",
              run_id: "r",
              n_layer: 5,
              pool_cutoff: "2026-10-04",
            },
          ]
        : u.includes("/races?")
          ? [
              {
                race_id: "2026-10-05-20-01",
                race_date: "2026-10-05",
                start_time: "23:00:00",
              },
            ]
          : u.includes("exhibition_data")
            ? [1, 2, 3, 4, 5, 6].map((b) => ({
                race_id: "2026-10-05-20-01",
                boat_number: b,
                exhibition_time: 6.8,
                is_absent: false,
              }))
            : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    try {
      const r = await runAnalogyV16Exhibition({
        mode: "live",
        now: () => new Date("2026-10-05T10:00:00+09:00"),
        shouldStop: () => true,
      });
      check(
        "展示後の段: shouldStop なら1レースも処理せず止まる",
        [r.report.targets, r.report.written, r.report.stopped],
        [1, 0, true],
      );
      check(
        "展示後の段: 止まったら Storage を読まない",
        calls.some((c) => c.includes("/storage/")),
        false,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }
}

async function scene2() {
  // ---- 8. 公開前点検 F02: 締切は snapshot を書く直前に確かめ直す ---------------------------
  // 欠場の経路（Storage を読まずに行が決まる）で動かす。締切の確認は、どの経路でも行を決めた後・書く直前の1か所
  {
    process.env.SUPABASE_URL = "https://example.invalid";
    process.env.SUPABASE_SERVICE_KEY = "test";
    const RACES = [
      ["2026-10-05-20-01", "10:00:00"],
      ["2026-10-05-20-02", "10:30:00"],
    ];
    const runAt = async (times) => {
      const posts = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (init?.method === "POST") posts.push(JSON.parse(init.body)[0]);
        const body = u.includes("analogy_v16_snapshots")
          ? RACES.map(([race_id]) => ({
              race_id,
              stage: "racecard",
              status: "ok",
              run_id: "r",
              n_layer: 5,
              pool_cutoff: "2026-10-04",
            }))
          : u.includes("/races?")
            ? RACES.map(([race_id, start_time]) => ({
                race_id,
                race_date: "2026-10-05",
                start_time,
              }))
            : u.includes("exhibition_data")
              ? RACES.flatMap(([race_id]) =>
                  [1, 2, 3, 4, 5, 6].map((b) => ({
                    race_id,
                    boat_number: b,
                    exhibition_time: 6.8,
                    is_absent: b === 6,
                  })),
                )
              : [];
        return new Response(JSON.stringify(body), { status: 200 });
      };
      const queue = times.map((t) => new Date(`2026-10-05T${t}+09:00`));
      try {
        const r = await runAnalogyV16Exhibition({
          mode: "live",
          now: () => queue.shift(),
        });
        return { report: r.report, posts };
      } finally {
        globalThis.fetch = realFetch;
      }
    };
    // 時計: 起動時、1件目を書く直前、2件目を書く直前
    const a = await runAt(["09:59:30", "10:00:30", "10:00:40"]);
    check(
      "展示後の段: 処理中に締切を越えたレースは書かず、後ろの締切前のレースは書く",
      [a.report.written, a.report.late, a.posts.map((p) => p.race_id)],
      [1, ["2026-10-05-20-01"], ["2026-10-05-20-02"]],
    );
    check(
      "展示後の段: computed_at は書く直前の時刻",
      a.posts[0]?.computed_at,
      "2026-10-05T01:00:40.000Z",
    );
    const b = await runAt(["09:59:30", "09:59:50", "10:30:00"]);
    check(
      "展示後の段: 締切と同時刻は書かない（締切前だけ書く）",
      [b.report.written, b.report.late, b.posts.map((p) => p.race_id)],
      [1, ["2026-10-05-20-02"], ["2026-10-05-20-01"]],
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export async function runAnalogyV16ApiScenes3(env) {
  ({ check } = env);
  await scene1();
  await scene2();
}

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene3() {
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_KEY = "test";
  const id = "2026-10-05-20-01";
  const rc = { race_id: id, stage: "racecard", status: "empty_layer",
    run_id: "morning", n_layer: 0, pool_cutoff: "2026-10-04" };
  const today = { wind_offset_deg: 0, scope_keys: { 1: { VA: "VA:20" } } };
  const rows = [1, 2, 3, 4, 5, 6].map((b) => ({ race_id: id,
    boat_number: b, exhibition_time: 6.7 + b / 100, exhibition_course: b,
    start_timing: b === 4 ? 0.05 : 0.15, start_flag: null, is_absent: false }));
  const cond = { weather: "晴", wind_direction: "北", wind_speed: 3, wave_height: 2 };
  return { id, rc, today, rows, cond };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4({ id, rc, today, rows, cond }) {
  const run = async ({ absent = false, late = false, mode = "live" } = {}) => {
    const storage = new Map([[objectPath(id, rc.run_id, "today", id), today]]);
    const snapshots = [rc], writes = [], reads = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(url);
      const post = init?.method === "POST";
      if (u.origin !== "https://example.invalid") throw new Error("外部接続は禁止");
      if (u.pathname.includes("/storage/v1/object/")) {
        const path = u.pathname.split("/analogy-v16/")[1];
        if (post) {
          storage.set(path, JSON.parse(zlib.gunzipSync(Buffer.from(init.body))));
          writes.push(path);
          return new Response("{}");
        }
        reads.push(path);
        return storage.has(path)
          ? new Response(zlib.gzipSync(Buffer.from(JSON.stringify(storage.get(path)))))
          : new Response("not found", { status: 404 });
      }
      let body;
      if (u.pathname.endsWith("/analogy_v16_snapshots")) {
        if (post) {
          check("層0件: snapshotより先に今日の展示を保存", storage.has(
            objectPath(id, JSON.parse(init.body)[0].run_id, "today-exhibition", id)), !absent);
          snapshots.push(...JSON.parse(init.body));
          return new Response(null, { status: 201 });
        }
        body = snapshots;
      } else if (u.pathname.endsWith("/races")) {
        body = [{ race_id: id, race_date: "2026-10-05", start_time: "10:00:00" }];
      } else if (u.pathname.endsWith("/exhibition_data")) {
        body = rows.map((r) => ({ ...r, is_absent: absent && r.boat_number === 6 }));
      } else if (u.pathname.endsWith("/race_conditions")) body = [cond];
      else if (u.pathname.endsWith("/race_entries")) body = [];
      else throw new Error(`未定義のREST: ${u.pathname}`);
      return new Response(JSON.stringify(body));
    };
    let tick = 0;
    try {
      const result = await runAnalogyV16Exhibition({ mode,
        now: () => new Date(`2026-10-05T${tick++ === 0 ? "09:59:30" : late ? "10:00:00" : "09:59:50"}+09:00`) });
      const path = objectPath(id, "exh-20261005005930", "today-exhibition", id);
      const expected = todayExhibition(rows, buildLiveFeatures({
        boatNumbers: [1, 2, 3, 4, 5, 6], exhibition: rows,
        conditions: cond, windOffset: today.wind_offset_deg,
      }), cond);
      if (!absent && mode === "live") {
        const value = storage.get(path);
        check("層0件: today-exhibitionを書いた", value !== undefined, true);
        check("層0件: okと同じtodayExhibitionの形と値", value, expected);
        if (value) {
          check("層0件: 展示タイム6艇", value.exh_time.map((v) => Number(v.toFixed(2))),
            rows.map((r) => Number(r.exhibition_time.toFixed(2))));
          check("層0件: 展示タイム順位", value.exh_time_rank, [1, 2, 3, 4, 5, 6]);
          check("層0件: 風・波・進入・ST・形", [value.wind_speed, value.wave_height,
            value.course_by_boat, value.st_by_course, value.entry_type, value.forms],
            [3, 2, [1, 2, 3, 4, 5, 6], [0.15, 0.15, 0.15, 0.05, 0.15, 0.15], "waku", ["wall", "kado"]]);
        }
      }
      check("層0件: 類似レース関連を読まない", reads.some((p) => /\/(similar|similar-display|pool)\//.test(p)), false);
      check("層0件: similar-exhibitionを作らない", writes.some((p) => p.includes("/similar-exhibition/")), false);
      if (absent || mode !== "live") check("欠場・shadowはStorageに書かない", writes, []);
      check("層0件: snapshotの状態・late", [snapshots.slice(1).map((s) => [s.status, s.exact]), result.report.late],
        [late || mode !== "live" ? [] : [[absent ? "absent" : "empty_layer", absent ? null : true]], late ? [id] : []]);
      if (!late && mode === "live") {
        for (const [name, handler] of [["facts", factsHandler], ["scenario", scenarioHandler]]) {
          for (const stage of ["exhibition", "racecard"]) {
            const res = await handler(new Request(`https://example.invalid/api/analogy/${name}/${id}?stage=${stage}`));
            const body = await res.json();
            check(`${name}: 応答200`, res.status, 200);
            check(`${name}: ${stage}の展示値`, body.exhibition ?? null,
              stage === "exhibition" && !absent ? storage.get(path) ?? "missing" : null);
          }
        }
      }
    } finally { globalThis.fetch = realFetch; }
  };
  await run();
  await run({ absent: true });
  await run({ late: true });
  await run({ mode: "shadow" });
}

async function scene5() {
  {
    const s1 = scene3();
    await scene4(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export async function runAnalogyV16ApiScenes4(env) {
  ({ check } = env);
  await scene5();
}

async function scene6() {
  // ---- 7. 展開シナリオの艇ごとの範囲（BOA-806） ------------------------------------
  {
    const keysOf = (b, cls) => ({
      VC: `VC:20:1-3-2-0:${b}${cls}`,
      NC: `NC:1-3-2-0:${b}${cls}`,
      VA: "VA:20",
      NA: "NA",
    });
    const allKeys = {
      1: keysOf(1, "A1"),
      2: keysOf(2, "A2"),
      3: keysOf(3, "A2"),
      4: keysOf(4, "B1"),
      5: keysOf(5, "A2"),
      6: keysOf(6, "B1"),
    };
    const files = new Map(
      [2, 3, 4, 5, 6].flatMap((b) =>
        ["VC", "NC"].map((k) => [
          allKeys[b][k],
          { boat: b, kind: k, attack: { kado: k } },
        ]),
      ),
    );
    files.delete(allKeys[6].VC); // 6号艇の VC だけ作れなかった
    const read = async (key) => files.get(key) ?? null;
    const vc = await boatScopes(read, allKeys, "VC");
    check(
      "艇ごとの範囲: VC なら各艇の VC と、比べる相手は NC",
      [2, 3, 4, 5].map((b) => [
        vc[b].scope,
        vc[b].data.kind,
        vc[b].reference.scope,
        vc[b].reference.attack,
      ]),
      [2, 3, 4, 5].map((b) => [
        allKeys[b].VC,
        "VC",
        allKeys[b].NC,
        { kado: "NC" },
      ]),
    );
    check("艇ごとの範囲: ファイルの無い艇は null", vc["6"], null);
    const nc = await boatScopes(read, allKeys, "NC");
    check(
      "艇ごとの範囲: 1号艇が NC（VC から替えた）なら全艇 NC、比べる相手は無し",
      [2, 3, 4, 5, 6].map((b) => [nc[b].scope, nc[b].reference]),
      [2, 3, 4, 5, 6].map((b) => [allKeys[b].NC, null]),
    );
    for (const kind of ["VA", "VG", "NA"])
      check(
        `艇ごとの範囲: ${kind} は級によらないので null`,
        await boatScopes(read, allKeys, kind),
        null,
      );
    check(
      "艇ごとの範囲: scope_keys に艇が無くても落ちない",
      await boatScopes(read, { 1: allKeys[1] }, "VC"),
      { 2: null, 3: null, 4: null, 5: null, 6: null },
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export async function runAnalogyV16ApiScenes5(env) {
  ({ check } = env);
  await scene6();
}
