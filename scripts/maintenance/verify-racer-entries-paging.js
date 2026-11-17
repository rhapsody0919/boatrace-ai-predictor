/**
 * verify-racer-entries-paging.js — 選手単位の730日窓の race_entries の取得が、1000行で黙って切れないことの回帰テスト（BOA-1051）。
 *
 * PostgREST は .range() の無いクエリを既定の上限（1000行）で黙って切る。getRacerScopedRaceStats・
 * getRacerVenueStats・getRacerRaceHistory（src/services/supabaseDataService.js）は、1選手の race_entries を
 * 730日の窓で1回のクエリで取っていたため、1000走を超えた選手は新しい走が欠ける（1日2走×730日で最大約1460走）。
 *
 * 確かめること:
 *   A. 関数の試験: 上限1000行の偽の PostgREST の上で、旧の取り方（.range() 無しの1回）は1000行で切れ、
 *      fetchAllPages（src/services/fetchAllPages.js）は全件を取る。ちょうど1000行・0行・失敗の伝わり方も見る
 *   A2. 続く fetchAllByIn の in() は、race_id が約850件を超えると URL が長すぎて落ちる（2026-10-25 の本番の実測:
 *      800件・約15.4KB は通り、850件・約16.3KB で fetch failed）。1000行の上限より先にここで落ちるので、
 *      fetchAllInChunks が値を分けて読み、つないだ結果が分けずに読んだときと同じ行・同じ並びになることを見る
 *   B. 振る舞いの試験: 上の3関数を偽の supabase の上で呼び、race_entries を窓の始点・主キー順・.range() のページで
 *      取り切る（1500走が1000行で切れない）。出走数が同じ会場は会場コード順
 *
 * 実 Supabase へは接続しない（tier=ci）。
 */
import assert from "node:assert/strict";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import {
  fetchAllInChunks,
  fetchAllPages,
} from "../../src/services/fetchAllPages.js";

registerFakeServiceSupabase();

const MAX_ROWS = 1000; // PostgREST の既定の上限

// 偽の PostgREST: .range() があれば [from, to] を、無ければ先頭から、どちらも上限1000行で返す
function fakeTable(rowCount) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    race_id: `2026-01-01-01-${String(i).padStart(4, "0")}`,
    boat_number: 1,
  }));
  return {
    rows,
    select: () => Promise.resolve({ data: rows.slice(0, MAX_ROWS) }),
    range: (from, to) =>
      Promise.resolve({
        data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)),
      }),
  };
}

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`✅ ${label}`);
  } catch (err) {
    failures++;
    console.error(`❌ ${label}\n   ${err.message}`);
  }
}

// --- A. 関数の試験 ---
await check(
  "1500行: 旧（.range() 無し）は1000行で切れ、新は1500行を全部取る",
  async () => {
    const table = fakeTable(1500);
    const { data: old } = await table.select();
    assert.equal(old.length, 1000);
    const all = await fetchAllPages(table.range);
    assert.equal(all.length, 1500);
    assert.deepEqual(all, table.rows);
  },
);

await check("2500行: ページの境目で重複・欠落が無い（3ページ）", async () => {
  const table = fakeTable(2500);
  const calls = [];
  const all = await fetchAllPages((from, to) => {
    calls.push([from, to]);
    return table.range(from, to);
  });
  assert.deepEqual(all, table.rows);
  assert.equal(new Set(all.map((r) => r.race_id)).size, 2500);
  assert.deepEqual(calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

await check(
  "ちょうど1000行: 2ページ目（空）を読んで止まり、1000行を返す",
  async () => {
    const table = fakeTable(1000);
    let calls = 0;
    const all = await fetchAllPages((from, to) => {
      calls++;
      return table.range(from, to);
    });
    assert.equal(all.length, 1000);
    assert.equal(calls, 2);
  },
);

await check(
  "290行（2026-10-25 の本番の最大）: 1ページで止まり、旧と同じ行を返す",
  async () => {
    const table = fakeTable(290);
    const { data: old } = await table.select();
    const all = await fetchAllPages(table.range);
    assert.deepEqual(all, old);
  },
);

await check("0行・data が null: 空配列を返す", async () => {
  assert.deepEqual(await fetchAllPages(fakeTable(0).range), []);
  assert.deepEqual(
    await fetchAllPages(() => Promise.resolve({ data: null })),
    [],
  );
});

await check("2ページ目の失敗: 途中までの結果を返さず例外を伝える", async () => {
  const table = fakeTable(1500);
  await assert.rejects(
    fetchAllPages((from, to) =>
      from === 0 ? table.range(from, to) : Promise.reject(new Error("boom")),
    ),
    /boom/,
  );
});

// --- A2. in() の値を分けて読む ---
const URL_MAX_VALUES = 800; // 本番の実測で通った最大（850件で落ちた）
// 偽の in(): race_id ごとに6艇の行。並びは (race_id, boat_number)。値が多すぎると URL の長さで落ちる
function fakeInTable(raceCount) {
  const raceIds = Array.from(
    { length: raceCount },
    (_, i) => `2026-01-01-01-${String(i).padStart(4, "0")}`,
  );
  const rows = raceIds.flatMap((race_id) =>
    [1, 2, 3, 4, 5, 6].map((boat_number) => ({ race_id, boat_number })),
  );
  const query = (values, from, to) => {
    if (values.length > URL_MAX_VALUES) {
      return Promise.reject(new TypeError("fetch failed"));
    }
    const set = new Set(values);
    const hit = rows.filter((r) => set.has(r.race_id));
    return Promise.resolve({
      data: hit.slice(from, Math.min(to + 1, from + MAX_ROWS)),
    });
  };
  return { raceIds, rows, query };
}

await check(
  "race_id 1460件: 旧（分けない in()）は URL の長さで落ち、新は 8760行を全部・同じ並びで取る",
  async () => {
    const table = fakeInTable(1460);
    await assert.rejects(
      fetchAllPages((from, to) => table.query(table.raceIds, from, to)),
      /fetch failed/,
    );
    // 呼び出し側の値は並んでいない・重複がある
    const shuffled = [...table.raceIds]
      .reverse()
      .concat(table.raceIds.slice(0, 5));
    const sizes = [];
    const all = await fetchAllInChunks(shuffled, 300, (chunk, from, to) => {
      sizes.push(chunk.length);
      return table.query(chunk, from, to);
    });
    assert.equal(all.length, 8760);
    assert.deepEqual(all, table.rows);
    assert.ok(sizes.every((n) => n <= 300));
  },
);

await check(
  "race_id 290件（今の本番の最大）: 1回で読み、分けないときと同じ行",
  async () => {
    const table = fakeInTable(290);
    const old = await fetchAllPages((from, to) =>
      table.query(table.raceIds, from, to),
    );
    let chunks = 0;
    const all = await fetchAllInChunks(
      table.raceIds,
      300,
      (chunk, from, to) => {
        chunks++;
        return table.query(chunk, from, to);
      },
    );
    assert.deepEqual(all, old);
    assert.equal(chunks, 2); // 1740行 = 1000 + 740 の2ページ、in() は1つ
  },
);

await check("値が無い: 要求を送らず空配列", async () => {
  let calls = 0;
  const all = await fetchAllInChunks([], 300, () => {
    calls++;
    return Promise.resolve({ data: [] });
  });
  assert.deepEqual(all, []);
  assert.equal(calls, 0);
});

// --- B. 振る舞いの試験（サービス層を偽の supabase の上で呼ぶ。本文の正規表現から置き換え） ---
// supabaseClient.js の supabase は import の時に決まるので、先に中継役を置き、試験ごとに中の偽を替える
const racerQueries = await import("../../src/services/racerQueries.js");
const racerQueries2 = await import("../../src/services/racerQueries2.js");
const { clearCache } = await import("../../src/services/core.js");
const { racerHistoryCutoff } =
  await import("../../src/utils/racerVenueBoatStats.js");
const { fetchRacerEntriesSince } = racerQueries;
const { getRacerScopedRaceStats, getRacerVenueStats, getRacerRaceHistory } =
  racerQueries2;

const RACER = 5001;
const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);
const rid = (date, venue, no) =>
  `${date}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;

// 1選手の走を count 本（全部 boat 1 が1着の確定した走。会場は venueOf(i)）
function buildTables(count, venueOf = () => 10) {
  const raceIds = Array.from({ length: count }, (_, i) =>
    rid(addDays(today, -1 - Math.floor(i / 12)), venueOf(i), (i % 12) + 1),
  );
  assert.equal(new Set(raceIds).size, count);
  return {
    race_entries: raceIds.map((race_id) => ({
      racer_id: RACER,
      race_id,
      boat_number: 1,
      grade: "A1",
      f_count: 0,
    })),
    races: raceIds.map((race_id) => ({
      race_id,
      race_date: race_id.slice(0, 10),
      venue_code: Number(race_id.slice(11, 13)),
      race_grade: "ippan",
    })),
    race_results: raceIds.map((race_id) => ({
      race_id,
      rank1: 1,
      rank2: 2,
      rank3: 3,
      rank4: 4,
      rank5: 5,
      rank6: 6,
      race_status: null,
    })),
  };
}

installLocalStorage();
const install = (tables) => {
  clearCache();
  // .range() の無い問い合わせも、あっても 1 回に 1000 行で切る。order() は記録だけで並べ替えない
  // （返す順は表の順。取り方の順に依らない並びを見るため）
  return setFakeSupabase(
    createFakeSupabase(tables, { maxRows: MAX_ROWS, sortByOrder: false }),
  );
};
const entryQueries = (fake) =>
  fake.calls.filter((q) => q.table === "race_entries");

await check(
  "fetchRacerEntriesSince: その選手・since 以降の race_entries を、主キー（race_id, boat_number）で並べ .range() のページで1500行全部取る",
  async () => {
    const tables = buildTables(1500);
    const fake = install(tables);
    const since = rid(addDays(today, -200), 1, 1);
    const rows = await fetchRacerEntriesSince(
      RACER,
      "race_id, boat_number",
      since,
    );
    assert.deepEqual(
      rows.map((r) => r.race_id),
      tables.race_entries.map((r) => r.race_id),
    );
    const qs = entryQueries(fake);
    assert.deepEqual(
      qs.map((q) => q.range),
      [
        [0, 999],
        [1000, 1999],
      ],
    );
    for (const q of qs) {
      assert.equal(q.select, "race_id, boat_number");
      assert.deepEqual(q.orders, ["race_id", "boat_number"]);
      assert.deepEqual(q.filters, [
        ["eq", "racer_id", RACER],
        ["gte", "race_id", since],
      ]);
    }
  },
);

const EXPECTED_SELECT = {
  getRacerScopedRaceStats: "race_id, boat_number, grade, f_count",
  getRacerVenueStats: "race_id, boat_number",
  getRacerRaceHistory: "race_id, boat_number",
};
const lengthOf = {
  getRacerScopedRaceStats: (r) => r.length,
  getRacerVenueStats: (r) => r[0]?.total_races,
  getRacerRaceHistory: (r) => r.length,
};
for (const [name, fn] of [
  ["getRacerScopedRaceStats", getRacerScopedRaceStats],
  ["getRacerVenueStats", getRacerVenueStats],
  ["getRacerRaceHistory", getRacerRaceHistory],
]) {
  await check(
    `${name}: 1500走の選手を、race_entries を直の1回でなく窓の始点（racerHistoryCutoff）・主キー順・.range() のページで取り切る`,
    async () => {
      const fake = install(buildTables(1500));
      const result = await fn(RACER);
      assert.equal(lengthOf[name](result), 1500); // 1000行で切れていない
      const qs = entryQueries(fake);
      assert.deepEqual(
        qs.map((q) => q.range),
        [
          [0, 999],
          [1000, 1999],
        ],
      );
      for (const q of qs) {
        assert.equal(q.select, EXPECTED_SELECT[name]);
        assert.deepEqual(q.orders, ["race_id", "boat_number"]);
        assert.deepEqual(q.filters, [
          ["eq", "racer_id", RACER],
          ["gte", "race_id", racerHistoryCutoff()],
        ]);
      }
    },
  );
}

await check(
  "getRacerVenueStats: 出走数が同じ会場は会場コードの順（表の並びが逆でも同じ）",
  async () => {
    // 会場 9 と 3 が6走ずつ、会場 10 が7走。表の先頭は会場 9 → DB の返す順で決めると 9 が先になる
    const venueOf = (i) => (i < 7 ? 10 : i < 13 ? 9 : 3);
    const tables = buildTables(19, venueOf);
    const venues = async (t) => {
      install(t);
      return (await getRacerVenueStats(RACER)).map((r) => [
        r.venue_code,
        r.total_races,
      ]);
    };
    const expected = [
      [10, 7],
      [3, 6],
      [9, 6],
    ];
    assert.deepEqual(await venues(tables), expected);
    assert.deepEqual(
      await venues({
        ...tables,
        race_entries: [...tables.race_entries].reverse(),
      }),
      expected,
    );
  },
);

if (failures > 0) {
  console.error(`\n${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\nすべて通過");
