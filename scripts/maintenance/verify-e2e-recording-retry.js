#!/usr/bin/env node
/**
 * e2e-recording.js の録画の取得（fetchWithRetry）が、一時の失敗（504 等・ネットワークの例外）だけ再試行し、
 * 恒久の失敗（404 等）は再試行せずに返すことを、固定の偽の fetch で検査する（BOA-1397）。ネットワーク・実時間には触らない。
 */

import { fetchWithRetry } from "./e2e-recording.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

/** 順に返す（数なら status、"throw" なら例外）偽の fetch と、待ちの記録 */
function fake(seq) {
  const calls = [];
  const waits = [];
  return {
    calls,
    waits,
    opts: {
      fetchImpl: async (url) => {
        calls.push(url);
        const next = seq[calls.length - 1];
        if (next === "throw") throw new Error("socket hang up");
        return { ok: next >= 200 && next < 300, status: next };
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
      delays: [2000, 5000],
      log: () => {},
    },
  };
}

async function run(seq) {
  const f = fake(seq);
  try {
    const r = await fetchWithRetry("https://example.invalid/a.zip", f.opts);
    return { status: r.status, calls: f.calls.length, waits: f.waits };
  } catch (e) {
    return { threw: e.message, calls: f.calls.length, waits: f.waits };
  }
}

check("1回目で成功: 再試行しない", await run([200]), { status: 200, calls: 1, waits: [] });
check("504 の後に成功: 1回待って成功を返す", await run([504, 200]), { status: 200, calls: 2, waits: [2000] });
check("502・503 の後に成功: 2回待つ", await run([502, 503, 200]), { status: 200, calls: 3, waits: [2000, 5000] });
check("504 が続く: 回数を使い切って最後の 504 を返す（呼び出し側が落とす）", await run([504, 504, 504, 200]), {
  status: 504,
  calls: 3,
  waits: [2000, 5000],
});
check("404: 再試行せずそのまま返す", await run([404, 200]), { status: 404, calls: 1, waits: [] });
check("403: 再試行しない", await run([403]), { status: 403, calls: 1, waits: [] });
check("ネットワークの例外の後に成功: 再試行する", await run(["throw", 200]), { status: 200, calls: 2, waits: [2000] });
check("例外が続く: 最後の例外を投げる", await run(["throw", "throw", "throw"]), {
  threw: "socket hang up",
  calls: 3,
  waits: [2000, 5000],
});
check("429: 一時の失敗として再試行する", await run([429, 200]), { status: 200, calls: 2, waits: [2000] });

if (failures.length > 0) {
  console.error(`NG: ${failures.length}/${checked}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: ${checked} 件（録画の取得の再試行）`);
