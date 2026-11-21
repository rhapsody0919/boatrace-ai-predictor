/**
 * verify-analogy-v16-api.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-v16-api.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  summarizeDay,
  datesToClean,
  CLEANUP,
  SONAR_KINDS,
  datesToMeasure,
  pruneLedger,
  usageLine,
  sizeOf,
  SIZE_PARALLEL,
  cleanup,
} from "../verify-analogy-v16.js";
import { SONAR_KEEP_DAYS, sonarKeepFrom, sonarExpired } from "../../../src/utils/analogyRetention.js";

let check;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const r = (id, start, cancel = null) => ({
    race_id: id,
    race_date: "2026-10-05",
    start_time: start,
    cancellation_status: cancel,
  });
  const at = (hhmm) => `2026-10-05T${hhmm}:00+09:00`;
  const races = [
    r("p", "10:00:00"),
    r("q", "11:00:00"),
    r("x", "12:00:00", "confirmed"),
    r("y", "13:00:00"),
  ];
  const snaps = [
    { race_id: "p", stage: "racecard", computed_at: at("07:20"), exact: null },
    {
      race_id: "p",
      stage: "exhibition",
      computed_at: at("09:55"),
      exact: true,
    },
    { race_id: "q", stage: "racecard", computed_at: at("11:05"), exact: null }, // 締切後
  ];
  const six = (id) =>
    [1, 2, 3, 4, 5, 6].map((b) => ({
      race_id: id,
      boat_number: b,
      exhibition_time: 6.8,
      is_absent: false,
    }));
  const s = summarizeDay(
    races,
    snaps,
    [...six("p"), ...six("q")],
    [{ race_id: "y", is_absent: true }],
  );
  check("夜の確認: 中止・欠場を分母から除く", s.eligible, 2);
  check("夜の確認: 出走表の段", [s.racecard, s.racecardOnTime], [2, 1]);
  check(
    "夜の確認: 展示後の段",
    [s.exhEligible, s.exhibition, s.exhibitionOnTime, s.exact],
    [2, 1, 1, 1],
  );
  check(
    "夜の確認: 欠け",
    [s.missingRacecard, s.missingExhibition],
    [[], ["q"]],
  );
  check(
    "similar/ を消す日付（7日より前）",
    datesToClean(["2026-09-27", "2026-09-28", "2026-10-04", "x"], "2026-10-05"),
    ["2026-09-27"],
  );
  const displayKeep = CLEANUP.find(([k]) => k === "similar-display")[1];
  check(
    "similar-display/ を消す日付（前日より前）",
    datesToClean(
      ["2026-10-03", "2026-10-04", "2026-10-05"],
      "2026-10-05",
      displayKeep,
    ),
    ["2026-10-03"],
  );
  check(
    "pool/（母集団の展示の値）も前日より前を消す",
    CLEANUP.find(([k]) => k === "pool")?.[1],
    1,
  );
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2() {
  check(
    "龍神ソナーの表示用と STEP4 の元のレースの一覧は2年（730日）より前を消す（BOA-807）",
    [
      SONAR_KEEP_DAYS,
      SONAR_KINDS.map((k) => CLEANUP.find(([x]) => x === k)?.[1]),
    ],
    [730, SONAR_KINDS.map(() => 730)],
  );
  check(
    "朝のバッチ・API が書く13種類は全部、夜の掃除の対象にある（BOA-807）",
    [
      "facts",
      "layer",
      "pool",
      "scenario",
      "scenario-boat",
      "scenario-boat-races",
      "scenario-races",
      "similar",
      "similar-display",
      "similar-exhibition",
      "similar-racecard",
      "today",
      "today-exhibition",
    ].filter((k) => !CLEANUP.some(([x]) => x === k)),
    [],
  );
  check(
    "消すのは残す日数の境目から30日前まで（消し終えた古い日を毎晩見直さない）",
    datesToClean(
      ["2024-08-13", "2024-09-12", "2024-09-13", "2024-10-12", "2024-10-13"],
      "2026-10-13",
      730,
    ),
    ["2024-09-13", "2024-10-12"],
  );
  check(
    "容量の控え: 控えに無い日と新しい9日だけ数え直す",
    datesToMeasure(
      { "2026-09-01": 1, "2026-10-03": 1, "2026-10-04": 1 },
      ["2026-09-01", "2026-09-02", "2026-10-03", "2026-10-04", "_usage"],
      "2026-10-13",
    ),
    ["2026-09-02", "2026-10-04"],
  );
  check(
    "容量の控え: もう無い日を外す",
    pruneLedger({ "2024-01-01": 5, "2026-10-12": 3 }, ["2026-10-12"]),
    { "2026-10-12": 3 },
  );
  check(
    "容量の1行: 大きい順に並べ、80GB 以下は警告しない",
    usageLine({ a: 1e9, "analogy-v16": 2.5e9 }),
    {
      line: "💾 Storage 合計 3.50GB（analogy-v16 2.50GB・a 1.00GB）",
      warn: null,
    },
  );
  check(
    "容量の1行: 80GB を超えたら警告する",
    usageLine({ "analogy-v16": 80.01e9 }).warn !== null,
    true,
  );
  const keepFrom = sonarKeepFrom(Date.parse("2026-10-13T00:00:00+09:00"));
  check(
    "画面の「もう無い」は夜の掃除と同じ境目（JST の今日から730日前より前）",
    [
      keepFrom,
      sonarExpired("2024-10-12-01-01", keepFrom),
      sonarExpired("2024-10-13-01-01", keepFrom),
    ],
    ["2024-10-13", true, false],
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene3() {
  const day = (n) => new Date(Date.UTC(2026, 9, 26 + n)).toISOString().slice(0, 10);
  const folders = [-730, -731, -732, ...Array.from({ length: 40 }, (_, i) => -i)].map(day);
  const initial = folders.flatMap((d) => ["r1", "r2"].flatMap((r) =>
    CLEANUP.map(([k]) => `${d}/${r}/${k}/a.json.gz`)));
  initial.push(...Array.from({ length: 1001 }, (_, i) => `${day(-3)}/r1/pool/${i}.json.gz`));
  const fake = () => {
    const files = new Set(initial), calls = [], deleted = [], batches = [];
    let ledger = null, failPrefix = null, failRemove = false, failWrite = false;
    const io = {
      list: async (prefix) => {
        calls.push(prefix);
        if (prefix === failPrefix) throw new Error("list failed");
        const rows = new Map();
        for (const path of files) {
          if (!path.startsWith(prefix)) continue;
          const tail = path.slice(prefix.length), name = tail.split("/")[0];
          rows.set(name, { name, id: tail.includes("/") ? null : "file" });
        }
        return [...rows.values()];
      },
      remove: async (paths) => {
        if (failRemove) throw new Error("delete failed");
        batches.push(paths.length);
        for (const path of paths) { deleted.push(path); files.delete(path); }
      },
      read: async (path) => {
        check("掃除の控えは容量の控えと別のパス", path, "_usage/cleanup-days.json.gz");
        return structuredClone(ledger);
      },
      write: async (path, value, opts) => {
        check("掃除の控えの保存先", path, "_usage/cleanup-days.json.gz");
        if (failWrite) throw new Error("write failed");
        check("掃除の控えは上書き", opts, { upsert: true });
        ledger = structuredClone(value);
      },
    };
    return { io, calls, deleted, batches, files,
      get ledger() { return ledger; },
      failList: (p) => { failPrefix = p; },
      failDelete: (v) => { failRemove = v; },
      failSave: (v) => { failWrite = v; },
    };
  };
  // 旧ループの削除集合を独立した日数判定で求める。
  const expected = (paths, today) => paths.filter((p) => {
    const [date, , kind] = p.split("/");
    const keep = CLEANUP.find(([k]) => k === kind)[1];
    const age = (Date.parse(today) - Date.parse(date)) / 86400000;
    return age > keep && age <= keep + 30;
  }).sort();
  const f = fake();
  const count = await cleanup(day(0), f.io);
  check("初夜の削除集合は旧実装と同じ", [...f.deleted].sort(), expected(initial, day(0)));
  check("初夜の件数", count, f.deleted.length);
  const dateCalls = () => f.calls.filter((p) => /^\d{4}-\d{2}-\d{2}\/$/.test(p));
  check("同じ日の一覧は1回だけ", new Set(dateCalls()).size, dateCalls().length);
  check("削除は500件までの一括要求", [Math.max(...f.batches), f.batches.includes(1)], [500, true]);
  const firstLists = f.calls.length;
  const remaining = [...f.files];
  f.calls.length = 0;
   f.deleted.length = 0;
  await cleanup(day(1), f.io);
  check("翌夜の削除集合も旧実装と同じ", [...f.deleted].sort(), expected(remaining, day(1)));
  check("翌夜に見るのは新しく境目を越えた3日だけ", dateCalls().sort(),
    [-730, -7, -1].map((n) => `${day(n)}/`).sort());
  check("完了済みの種類を再び一覧しない", f.calls.includes(`${day(-3)}/r1/pool/`), false);
  check("新しい種類だけを消し、同日に完了済みの種類は見ない",
    f.calls.includes(`${day(-7)}/r1/similar-display/`), false);
  return { day, fake, expected, f, firstLists };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4({ day, fake, expected, f, firstLists }) {
  console.log(`掃除の一覧要求（偽Storage）: 初夜 ${firstLists} → 翌夜 ${f.calls.length}`);
  const beforeGap = [...f.files];
   f.deleted.length = 0;
  await cleanup(day(4), f.io);
  check("休んだ夜の削除対象も拾う", [...f.deleted].sort(), expected(beforeGap, day(4)));
  for (const failure of ["list", "delete", "write"]) {
    const g = fake();
    if (failure === "list") g.failList(`${day(-2)}/r2/pool/`);
    if (failure === "delete") g.failDelete(true);
    if (failure === "write") g.failSave(true);
    let failed = false;
    try { await cleanup(day(0), g.io); } catch { failed = true; }
    check(`${failure} 失敗は呼び出し元に返す`, failed, true);
    if (failure === "list") check("途中失敗した日は完了として保存しない",
      g.ledger?.[day(-2)] === undefined, true);
    if (failure === "write") check("保存失敗では完了の控えが残らない", g.ledger, null);
    g.failList(null); g.failDelete(false); g.failSave(false);
    g.calls.length = 0;
    const left = [...g.files], deletedBefore = g.deleted.length;
    await cleanup(day(1), g.io);
    check(`${failure} 失敗の翌夜は残りを全て削除`,
      g.deleted.slice(deletedBefore).sort(), expected(left, day(1)));
    if (failure === "list") check("途中失敗した日は翌夜に一覧し直す",
      g.calls.includes(`${day(-2)}/r2/pool/`), true);
  }
}

async function scene5() {
  {
    scene1();
    scene2();
  }
  // ---- 6b. 容量を数えるとき、同時に潜るフォルダは SIZE_PARALLEL 個まで（429 を避ける）。size が無ければ例外（BOA-807）
  {
    process.env.SUPABASE_URL = "https://example.invalid";
    process.env.SUPABASE_SERVICE_KEY = "test";
    const realFetch = globalThis.fetch;
    let inFlight = 0;
    let maxInFlight = 0;
    let noSize = false;
    globalThis.fetch = async (_url, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      const { prefix } = JSON.parse(init.body);
      // 根は30個のフォルダ、各フォルダは 10 バイトのファイル1つ
      const body =
        prefix === ""
          ? Array.from({ length: 30 }, (_, i) => ({ id: null, name: `d${i}` }))
          : [
              {
                id: "f",
                name: "a.json.gz",
                metadata: noSize ? {} : { size: 10 },
              },
            ];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    try {
      check(
        "容量: 30フォルダを数え、同時に潜るのは SIZE_PARALLEL 個まで",
        [await sizeOf("", "x"), maxInFlight <= SIZE_PARALLEL],
        [300, true],
      );
      noSize = true;
      let err = null;
      await sizeOf("", "x").catch((e) => (err = e.message));
      check(
        "容量: metadata.size が無いファイルは0と数えず例外にする",
        /metadata\.size/.test(err ?? ""),
        true,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  {
    const s1 = await scene3();
    await scene4(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export async function runAnalogyV16ApiScenes2(env) {
  ({ check } = env);
  await scene5();
}
