/**
 * verify-past-rate-count.js の storage の検査（SUITES.storage）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */

export function storageSuite(m, check) {
  const { mem, NOW, DEADLINE, entry, s } = storageSuitePart1(m, check);
  storageSuitePart2(m, check, mem, NOW, DEADLINE, entry, s);
  storageSuitePart3(m, check, mem, NOW, DEADLINE, entry);
  storageSuitePart4(m, check, entry);
}

function storageSuitePart1(m, check) {
  const mem = () => {
    const d = new Map();
    return {
      getItem: (k) => (d.has(k) ? d.get(k) : null),
      setItem: (k, v) => d.set(k, String(v)),
      removeItem: (k) => d.delete(k),
      _d: d,
    };
  };
  const NOW = new Date("2026-10-14T03:00:00Z");
  const DEADLINE = new Date("2026-10-14T05:00:00Z");
  const entry = (over = {}) => ({
    raceId: "2026-10-14-01-01",
    type: "boat1",
    input: { outcome: "win" },
    savedAt: NOW.toISOString(),
    snapshot: { runId: "r1", poolCutoff: "2026-10-13", layerKey: "k1" },
    result: { n: 100, count: 50, excluded: [], label: null, truncated: true },
    ...over,
  });
  const s = mem();
  check(
    "保存できる",
    m.saveEntry(entry(), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: s,
    }),
    true,
  );
  check(
    "キーは boatai-user:past-rate-check:v1",
    [...s._d.keys()],
    ["boatai-user:past-rate-check:v1"],
  );
  m.saveEntry(entry({ input: { outcome: "out" } }), {
    deadline: DEADLINE,
    finished: false,
    now: NOW,
    storage: s,
  });
  check(
    "同じレース・同じ型は1件に置き換わる",
    m.loadEntries({ storage: s, now: NOW }).map((e) => e.input.outcome),
    ["out"],
  );
  m.saveEntry(entry({ type: "payout", input: { band: "high" } }), {
    deadline: DEADLINE,
    finished: false,
    now: NOW,
    storage: s,
  });
  check(
    "型が違えば両方残る",
    m.loadEntries({ storage: s, now: NOW }).length,
    2,
  );
  check(
    "締切以降は保存しない",
    m.saveEntry(
      entry({ type: "tenkai", input: { boat: 1, technique: "nige" } }),
      { deadline: DEADLINE, finished: false, now: DEADLINE, storage: s },
    ),
    false,
  );
  check(
    "締切不明で確定済みなら保存しない",
    m.saveEntry(entry({ type: "entry", input: { boat: 4, target: "waku" } }), {
      deadline: null,
      finished: true,
      now: NOW,
      storage: s,
    }),
    false,
  );
  check(
    "締切不明で未確定なら保存する",
    m.saveEntry(entry({ type: "entry", input: { boat: 4, target: "waku" } }), {
      deadline: null,
      finished: false,
      now: NOW,
      storage: s,
    }),
    true,
  );
  return { mem, NOW, DEADLINE, entry, s };
}

function storageSuitePart2(m, check, mem, NOW, DEADLINE, entry, s) {
  // 30日
  const later = new Date(NOW.getTime() + 31 * 86400000);
  check(
    "30日を過ぎた Entry は読み込みで消える",
    m.loadEntries({ storage: s, now: later }).length,
    0,
  );
  check(
    "消えたことが保存にも反映される",
    JSON.parse(s.getItem("boatai-user:past-rate-check:v1")).entries.length,
    0,
  );
  const d29 = new Date(NOW.getTime() + 29 * 86400000);
  const s2 = mem();
  m.saveEntry(entry(), {
    deadline: DEADLINE,
    finished: false,
    now: NOW,
    storage: s2,
  });
  check("29日なら残る", m.loadEntries({ storage: s2, now: d29 }).length, 1);
  // 上限1,000件（savedAt の古いものから消す）
  const s3 = mem();
  // raceId を変えて重ならない1,000件（boat1、savedAt は古い順）
  const big = Array.from({ length: 1000 }, (_, i) =>
    entry({
      raceId: `2026-10-${String((i % 28) + 1).padStart(2, "0")}-${String((Math.floor(i / 28) % 24) + 1).padStart(2, "0")}-${String(Math.floor(i / 672) + 1).padStart(2, "0")}`,
      savedAt: new Date(NOW.getTime() - (1000 - i) * 1000).toISOString(),
    }),
  );
  s3.setItem(
    "boatai-user:past-rate-check:v1",
    JSON.stringify({ v: 1, entries: big }),
  );
  m.saveEntry(entry({ raceId: "2026-10-14-24-12" }), {
    deadline: DEADLINE,
    finished: false,
    now: NOW,
    storage: s3,
  });
  const after = m.loadEntries({ storage: s3, now: NOW });
  check("上限1,000件", after.length, 1000);
  check(
    "いちばん古いものが消える",
    after.some((e) => e.savedAt === big[0].savedAt),
    false,
  );
  // 壊れた値
  const s4 = mem();
  s4.setItem("boatai-user:past-rate-check:v1", "{not json");
  check(
    "JSON でなければ空として扱う",
    m.loadEntries({ storage: s4, now: NOW }),
    [],
  );
  check(
    "壊れた値は作り直す",
    JSON.parse(s4.getItem("boatai-user:past-rate-check:v1")),
    { v: 1, entries: [] },
  );
  s4.setItem(
    "boatai-user:past-rate-check:v1",
    JSON.stringify({ v: 2, entries: [entry()] }),
  );
  check("v が違えば空", m.loadEntries({ storage: s4, now: NOW }), []);
  s4.setItem(
    "boatai-user:past-rate-check:v1",
    JSON.stringify({
      v: 1,
      entries: [
        entry(),
        entry({ type: "x" }),
        entry({ snapshot: { runId: 1, layerKey: "k1" } }),
        entry({ snapshot: { runId: "r1" } }),
        entry({ result: { n: 1, count: 0, excluded: [], label: null } }),
        entry({ savedAt: "きのう" }),
        entry({ type: "order", input: { outcome: "win" } }),
        entry({
          type: "slit",
          input: { mode: "pattern", patterns: ["zz"], level: 1 },
        }),
      ],
    }),
  );
  check(
    "形の違う Entry だけ捨てる",
    m.loadEntries({ storage: s4, now: NOW }).length,
    1,
  );
}

function storageSuitePart3(m, check, mem, NOW, DEADLINE, entry) {
  // 例外
  const throwing = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {},
  };
  check(
    "getItem が投げても空",
    m.loadEntries({ storage: throwing, now: NOW }),
    [],
  );
  check(
    "setItem が投げたら保存しない（例外を外へ出さない）",
    m.saveEntry(entry(), {
      deadline: DEADLINE,
      finished: false,
      now: NOW,
      storage: throwing,
    }),
    false,
  );
  // データキャッシュの全削除の後も残る（boatai: で始めない・値がキャッシュの形でない）
  const s5 = mem();
  m.saveEntry(entry(), {
    deadline: DEADLINE,
    finished: false,
    now: NOW,
    storage: s5,
  });
  const key = [...s5._d.keys()][0];
  const parsed = JSON.parse(s5.getItem(key));
  check(
    "clearCache の対象外（接頭辞と値の形）",
    [key.startsWith("boatai:"), "timestamp" in parsed && "data" in parsed],
    [false, false],
  );
  // 振り返り
  const s6 = mem();
  m.saveEntry(entry({ type: "payout", input: { band: "high" } }), {
    deadline: DEADLINE,
    finished: false,
    now: NOW,
    storage: s6,
  });
  m.saveEntry(
    entry({
      type: "order",
      input: { first: 1, second: [2], third: [3], nagashi: false },
    }),
    { deadline: DEADLINE, finished: false, now: NOW, storage: s6 },
  );
  m.saveEntry(entry({ raceId: "2026-10-14-01-02" }), {
    deadline: DEADLINE,
    finished: false,
    now: NOW,
    storage: s6,
  });
  check(
    "振り返りはそのレースだけ、型の順",
    m
      .entriesForRace("2026-10-14-01-01", {
        deadline: DEADLINE,
        storage: s6,
        now: NOW,
      })
      .map((e) => e.type),
    ["order", "payout"],
  );
  const late = mem();
  late.setItem(
    "boatai-user:past-rate-check:v1",
    JSON.stringify({
      v: 1,
      entries: [entry({ savedAt: DEADLINE.toISOString() })],
    }),
  );
  check(
    "savedAt が締切以降の Entry は振り返りに出さない",
    m.entriesForRace("2026-10-14-01-01", {
      deadline: DEADLINE,
      storage: late,
      now: NOW,
    }),
    [],
  );
}

function storageSuitePart4(m, check, entry) {
  check(
    "layer の印の照合（どれか1つでも違えば変わった、run_id は見ない）",
    [
      m.layerChanged([entry()], "k1"),
      m.layerChanged(
        [
          entry(),
          entry({ snapshot: { runId: "r1", poolCutoff: "x", layerKey: "k0" } }),
        ],
        "k1",
      ),
      // run_id が違っても中身の印が同じなら「変わった」にしない（締切前の作り直し、T0-3）
      m.layerChanged(
        [entry({ snapshot: { runId: "r2", poolCutoff: "x", layerKey: "k1" } })],
        "k1",
      ),
    ],
    [false, true, false],
  );
}
