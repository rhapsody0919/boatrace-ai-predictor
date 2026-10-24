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
 *   B. 静的な検査: 上の3関数が race_entries を fetchRacerEntriesSince で取り、その中が主キーで並べて
 *      fetchAllPages の .range() でページを読む
 *
 * 実 Supabase へは接続しない（tier=ci）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fetchAllInChunks,
  fetchAllPages,
} from "../../src/services/fetchAllPages.js";

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

// --- B. 静的な検査 ---
const source = readFileSync(
  new URL("../../src/services/supabaseDataService.js", import.meta.url),
  "utf8",
);

function methodBody(name) {
  const start = source.indexOf(`\n  ${name}(`);
  assert.ok(start >= 0, `${name} が見つからない`);
  const next = source.slice(start + 1).search(/\n {2}[a-zA-Z]+\([^)]*\) \{/);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

for (const name of [
  "getRacerScopedRaceStats",
  "getRacerVenueStats",
  "getRacerRaceHistory",
]) {
  await check(
    `${name}: race_entries を fetchRacerEntriesSince で取り切る（直の .from("race_entries") が無い）`,
    () => {
      const body = methodBody(name);
      assert.match(body, /await fetchRacerEntriesSince\(/);
      assert.doesNotMatch(body, /\.from\("race_entries"\)/);
    },
  );
}

await check(
  "fetchRacerEntriesSince: 窓を今日（JST）までにし、主キーで並べ、fetchAllPages の .range() でページを読む",
  () => {
    const m = /function fetchRacerEntriesSince\([^)]*\) \{([\s\S]*?)\n\}/.exec(
      source,
    );
    assert.ok(m, "fetchRacerEntriesSince が見つからない");
    assert.match(m[1], /return fetchAllPages\(\(from, to\) =>/);
    assert.match(m[1], /\.from\("race_entries"\)/);
    // E2E は時計を録画の時刻に止める。上限が無いと、素通しした取得に録画より後の走が混ざる
    assert.match(m[1], /const untilRaceId = `\$\{jstToday\(\)\}-99`;/);
    assert.match(m[1], /\.lte\("race_id", untilRaceId\)/);
    assert.match(
      m[1],
      /for \(const key of FETCH_ALL_BY_IN_ORDER\.race_entries\) \{\s*query = query\.order\(key\);/,
    );
    assert.match(m[1], /return query\.range\(from, to\);/);
  },
);

// 新の取り方は主キー順なので、同じ出走数の会場の並びが旧（並びなし）と入れ替わる（2026-10-25 の本番の実測で
// 上位7人中3人）。取り方の順に依らないよう、同数は会場コードで決める
await check(
  "getRacerVenueStats: 出走数が同じ会場は会場コードの順（取得の順に依らない）",
  () => {
    assert.match(
      methodBody("getRacerVenueStats"),
      /b\.total_races - a\.total_races \|\|\s*Number\(a\.venue_code\) - Number\(b\.venue_code\)/,
    );
  },
);

if (failures > 0) {
  console.error(`\n${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\nすべて通過");
