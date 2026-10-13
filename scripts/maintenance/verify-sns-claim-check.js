// 素材の数値の照合（sns-pdca-loop tasks 9、spec A3）と、送る直前の readCurrent の再現テスト。外部接続なし（fetch・DB はモック）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedEndpoint,
  checkClaims,
  createReadCurrent,
  deadlineIso,
  sameValue,
} from "../../api/_lib/snsClaimCheck.js";
import { createDeadlinePreflight } from "../../api/_lib/snsDeadlineQueue.js";

const RACE = "2026-10-16-11-12";
const facts = `/api/analogy/facts/${RACE}?stage=racecard`;
const similar = `/api/analogy/similar/${RACE}`;
const claim = (id, endpoint, path, value) => ({
  id,
  text: "主張",
  value,
  source: { endpoint, path },
});

function mockFetch(bodies, calls = []) {
  return async (url) => {
    calls.push(String(url));
    const path = String(url).replace("https://www.boat-ai.jp", "");
    if (!(path in bodies)) return new Response("{}", { status: 502 });
    return Response.json(bodies[path]);
  };
}

test("許可リスト: アナロジーの4本・同じレース・stage だけ", () => {
  assert.equal(allowedEndpoint(facts, RACE), true);
  assert.equal(allowedEndpoint(similar, RACE), true);
  for (const bad of [
    `/api/analogy/facts/2026-10-16-11-11?stage=racecard`, // 別のレース
    `/api/analogy/facts/${RACE}?stage=racecard&x=1`,
    `/api/analogy/contribution?race=${RACE}`,
    `/api/predictions/2026-10-16`,
    `https://evil.example/api/analogy/facts/${RACE}`,
    `/api/analogy/facts/${RACE}/../../admin`,
    undefined,
  ])
    assert.equal(allowedEndpoint(bad, RACE), false, bad);
});

test("値の比べ方: 数値は桁まで完全一致、文字列は正規化、型が違えば不一致", () => {
  assert.equal(sameValue(30, 30), true);
  assert.equal(sameValue(0.3, 0.30000000000000004), false);
  assert.equal(sameValue(30, "30"), false);
  assert.equal(sameValue("イン  逃げ", " イン 逃げ"), true);
  assert.equal(sameValue("ＡＢ", "AB"), true);
  assert.equal(sameValue([1, 2], [1, 2]), true);
  assert.equal(sameValue(null, undefined), false);
});

test("照合: 同じ endpoint は1回だけ読み、全部一致なら合格と版、値の順に依存しない", async () => {
  const calls = [];
  const fetchImpl = mockFetch(
    { [facts]: { count: 30, label: "イン逃げ" }, [similar]: { rate: 0.42 } },
    calls,
  );
  const claims = [
    claim("b", facts, ["count"], 30),
    claim("a", facts, ["label"], "イン逃げ"),
    claim("c", similar, ["rate"], 0.42),
  ];
  const result = await checkClaims({ claims, raceId: RACE, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(result.revision, /^[0-9a-f]{32}$/);
  const reversed = await checkClaims({
    claims: [...claims].reverse(),
    raceId: RACE,
    fetchImpl: mockFetch({
      [facts]: { count: 30, label: "イン逃げ" },
      [similar]: { rate: 0.42 },
    }),
  });
  assert.equal(reversed.revision, result.revision);
  // 値が変わると版が変わる（送る直前に source_changed で止まる）
  const changed = await checkClaims({
    claims: [claim("b", facts, ["count"], 30)],
    raceId: RACE,
    fetchImpl: mockFetch({ [facts]: { count: 30, extra: 1 } }),
  });
  assert.equal(changed.ok, true);
  assert.notEqual(changed.revision, result.revision);
});

test("照合: 値の不一致・path が無い・読めない・許可外・claims が空は不合格", async () => {
  const fetchImpl = mockFetch({ [facts]: { count: 31 } });
  const result = await checkClaims({
    claims: [
      claim("mismatch", facts, ["count"], 30),
      claim("missing", facts, ["nothing"], 1),
      claim("fetch", similar, ["rate"], 0.4),
      claim("other", "/api/predictions/2026-10-16", ["x"], 1),
    ],
    raceId: RACE,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.revision, null);
  assert.deepEqual(
    result.results.map((r) => [r.id, r.reason]),
    [
      ["mismatch", "value_mismatch"],
      ["missing", "path_missing"],
      ["fetch", "fetch_failed: HTTP 502"],
      ["other", "endpoint_not_allowed"],
    ],
  );
  assert.equal(
    (await checkClaims({ claims: [], raceId: RACE, fetchImpl })).ok,
    false,
  );
});

function fakeDb({
  schema = "ryujin-preview/1",
  race = {},
  absent = false,
} = {}) {
  return async (path) => {
    if (path.startsWith("sns_drafts"))
      return [
        {
          bundle_import_id: "b1",
          sns_bundle_imports: schema
            ? {
                schema_version: schema,
                bundle: {
                  race_id: RACE,
                  claims: [claim("c", facts, ["count"], 30)],
                },
              }
            : null,
        },
      ];
    if (path.startsWith("races"))
      return [
        {
          race_date: "2026-10-16",
          start_time: "15:30:00",
          cancellation_status: null,
          ...race,
        },
      ];
    if (path.startsWith("race_entries"))
      return [{ is_absent: absent }, { is_absent: false }];
    return [];
  };
}

test("readCurrent: 締切・中止・欠場・版を返し、v1 でない下書き・照合の不合格は投げる", async () => {
  const fetchImpl = mockFetch({ [facts]: { count: 30 } });
  const current = await createReadCurrent({ db: fakeDb(), fetchImpl })("d1");
  assert.deepEqual(
    { ...current, source_revision: typeof current.source_revision },
    {
      withdrawn: false,
      cancelled: false,
      deadline_at: "2026-10-16T06:30:00.000Z",
      source_revision: "string",
    },
  );
  assert.equal(
    deadlineIso({ race_date: "2026-10-16", start_time: "15:30:00" }),
    current.deadline_at,
  );
  assert.equal(
    (await createReadCurrent({ db: fakeDb({ absent: true }), fetchImpl })("d1"))
      .withdrawn,
    true,
  );
  assert.equal(
    (
      await createReadCurrent({
        db: fakeDb({ race: { cancellation_status: "tentative" } }),
        fetchImpl,
      })("d1")
    ).cancelled,
    true,
  );
  await assert.rejects(
    createReadCurrent({ db: fakeDb({ schema: null }), fetchImpl })("d1"),
    /source_check_unsupported/,
  );
  await assert.rejects(
    createReadCurrent({
      db: fakeDb(),
      fetchImpl: mockFetch({ [facts]: { count: 29 } }),
    })("d1"),
    /claim_mismatch/,
  );
});

test("preflight: 照合が通れば次のリンク先の表示の確認へ進み、版・締切が変わっていれば止める", async () => {
  const fetchImpl = mockFetch({ [facts]: { count: 30 } });
  const readCurrent = createReadCurrent({ db: fakeDb(), fetchImpl });
  const { source_revision } = await readCurrent("d1");
  const job = (queue) => ({
    channel: "youtube",
    draft_id: "d1",
    snapshot_text: JSON.stringify({
      queue: {
        expires_at: "2099-01-01T00:00:00Z",
        deadline_at: "2026-10-16T06:30:00.000Z",
        source_revision,
        ...queue,
      },
    }),
  });
  const preflight = createDeadlinePreflight({
    headless: null,
    markers: {},
    readCurrent,
  });
  // 照合は通り、ヘッドレス（tasks 10）が無いので次で止まる＝送らない
  await assert.rejects(preflight(job({})), /public_check_unconfigured/);
  await assert.rejects(
    preflight(job({ source_revision: "old" })),
    /source_changed/,
  );
  await assert.rejects(
    preflight(job({ deadline_at: "2026-10-16T06:35:00.000Z" })),
    /source_changed/,
  );
  const withdrawn = createDeadlinePreflight({
    headless: null,
    markers: {},
    readCurrent: createReadCurrent({ db: fakeDb({ absent: true }), fetchImpl }),
  });
  await assert.rejects(withdrawn(job({})), /race_unconfirmed_or_withdrawn/);
});
