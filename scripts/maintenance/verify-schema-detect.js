/**
 * BOA-1075: schemaDetect のコメント/JSDoc が定める判定とキャッシュを固定する。
 * DB・ネットワーク・実時刻は使わない。期限ちょうどは仕様未定のため観測のみ。
 */
import assert from "node:assert/strict";
import {
  createSchemaDetector,
  DEFAULT_SCHEMA_CACHE_TTL_MS,
} from "../lib/schemaDetect.js";

const targets = {
  fields: { table: "race_entries", columns: ["weight_kg", "branch"], migration: "081" },
  table: { table: "race_conditions", columns: [], migration: "082" },
};
const KNOWN_GAPS = [];
let failures = 0;
let tests = 0;
async function test(name, run) {
  tests++;
  try {
    await run();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${name}: ${error.message}`);
  }
}

// table ごとの応答を差し替え、from/select/limit の順と引数も記録する。
function fakeClient(respond = () => ({ error: null }), throwAt) {
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      if (throwAt === "from") throw new Error("offline");
      return {
        select(columns) {
          calls.push(["select", columns]);
          if (throwAt === "select") throw new Error("offline");
          return {
            async limit(count) {
              calls.push(["limit", count]);
              return respond(table);
            },
          };
        },
      };
    },
  };
  return { client, calls };
}
function options(time = 1000, warnings = [], ttlMs = 100) {
  return { now: () => time, ttlMs, warn: (message) => warnings.push(message) };
}

await test("既定TTLは5分", () => {
  assert.equal(DEFAULT_SCHEMA_CACHE_TTL_MS, 300000);
});
await test("成功と照会引数（列の連結・空列・limit 0）", async () => {
  const { client, calls } = fakeClient();
  const warnings = [];
  const result = await createSchemaDetector(targets).detect(client, options(1000, warnings));
  assert.deepEqual(result, { fields: true, table: true });
  assert.deepEqual(calls, [
    ["from", "race_entries"], ["select", "weight_kg,branch"], ["limit", 0],
    ["from", "race_conditions"], ["select", "*"], ["limit", 0],
  ]);
  assert.deepEqual(warnings, []);
});

const definiteErrors = [
  ["table 42P01", { code: "42P01", message: 'relation "race_entries" missing' }],
  ["table PGRST205", { code: "PGRST205", message: "public.race_entries missing" }],
  ["table 文 Could not find", { message: "Could not find the table 'public.race_entries'" }],
  ["table 文 does not exist", { message: 'relation "race_entries" does not exist' }],
  ["column 42703", { code: "42703", message: "column race_entries.weight_kg does not exist" }],
  ["column PGRST204", { code: "PGRST204", message: "Could not find the 'branch' column" }],
];
for (const [label, error] of definiteErrors) {
  await test(`不在は確定falseでキャッシュ: ${label}`, async () => {
    const { client, calls } = fakeClient((table) => ({ error: table === "race_entries" ? error : null }));
    const detector = createSchemaDetector(targets);
    const warnings = [];
    const first = await detector.detect(client, options(1000, warnings));
    assert.deepEqual(first, { fields: false, table: true });
    assert.strictEqual(await detector.detect(client, options(1099, warnings)), first);
    assert.equal(calls.length, 6);
    assert.deepEqual(warnings, []);
  });
}

const uncertainErrors = [
  ["通信エラー", { code: "503", message: "offline" }],
  ["table 別名", { code: "42P01", message: "other_table does not exist" }],
  ["table 名前なし", { code: "PGRST205", message: "Could not find the table" }],
  ["table 接頭辞", { code: "42P01", message: "old_race_entries does not exist" }],
  ["table 接尾辞", { code: "PGRST205", message: "race_entries_backup does not exist" }],
  ["table 無関係なコードと文", { code: "503", message: "race_entries offline" }],
  ["column 別名", { code: "42703", message: "other_column missing" }],
  ["column 名前なし", { code: "PGRST204", message: "schema cache" }],
  ["column 接頭辞", { code: "42703", message: "old_weight_kg missing" }],
  ["column 接尾辞", { code: "PGRST204", message: "weight_kg_backup missing" }],
  ["column コードなし", { message: "Could not find the 'weight_kg' column" }],
];
for (const [label, error, throwAt] of [
  ...uncertainErrors,
  ["from例外", null, "from"],
  ["select例外", null, "select"],
]) {
  await test(`確認不能は警告して再試行: ${label}`, async () => {
    const { client, calls } = fakeClient(() => ({ error }), throwAt);
    const detector = createSchemaDetector({ fields: targets.fields });
    const warnings = [];
    const first = await detector.detect(client, options(1000, warnings));
    assert.deepEqual(first, { fields: false });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("081"));
    const count = calls.length;
    const next = await detector.detect(client, options(1001, warnings));
    assert.notStrictEqual(next, first);
    assert.deepEqual(next, { fields: false });
    assert.equal(calls.length, count * 2);
    assert.equal(warnings.length, 2);
    assert.ok(warnings[1].includes("081"));
  });
}

await test("一部の確認不能でも全体をキャッシュせず回復後は確定", async () => {
  let offline = true;
  const { client, calls } = fakeClient((table) => ({
    error: offline && table === "race_conditions" ? { message: "offline" } : null,
  }));
  const detector = createSchemaDetector(targets);
  const warnings = [];
  assert.deepEqual(await detector.detect(client, options(1000, warnings)), { fields: true, table: false });
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("082"));
  offline = false;
  const recovered = await detector.detect(client, options(1001, warnings));
  assert.deepEqual(recovered, { fields: true, table: true });
  assert.equal(calls.length, 12);
  assert.strictEqual(await detector.detect(client, options(1002, warnings)), recovered);
  assert.equal(calls.length, 12);
});
await test("TTL未満は同一オブジェクト、超過で再照会", async () => {
  let missing = false;
  const { client, calls } = fakeClient(() => ({
    error: missing ? { code: "42703", message: "weight_kg missing" } : null,
  }));
  const detector = createSchemaDetector({ fields: targets.fields });
  const first = await detector.detect(client, options());
  missing = true;
  assert.strictEqual(await detector.detect(client, options(1099)), first);
  assert.equal(calls.length, 3);
  const expired = await detector.detect(client, options(1101));
  assert.deepEqual(expired, { fields: false });
  assert.notStrictEqual(expired, first);
  assert.equal(calls.length, 6);
});
await test("キャッシュはclientと判定器ごと、clearは指定clientだけ", async () => {
  const a = fakeClient();
  const b = fakeClient(() => ({ error: { code: "42703", message: "branch missing" } }));
  const detector = createSchemaDetector({ fields: targets.fields });
  const firstA = await detector.detect(a.client, options());
  const firstB = await detector.detect(b.client, options());
  assert.deepEqual(firstB, { fields: false });
  assert.notStrictEqual(firstA, firstB);
  assert.strictEqual(await detector.detect(b.client, options()), firstB);
  await createSchemaDetector({ fields: targets.fields }).detect(a.client, options());
  assert.equal(a.calls.length, 6);
  detector.clear(a.client);
  assert.notStrictEqual(await detector.detect(a.client, options()), firstA);
  assert.equal(a.calls.length, 9);
  assert.strictEqual(await detector.detect(b.client, options()), firstB);
  assert.equal(b.calls.length, 3);
});

await test("KNOWN_GAPSの実行時観測", async () => {
  const { client, calls } = fakeClient();
  const detector = createSchemaDetector({ fields: targets.fields });
  const first = await detector.detect(client, options());
  const boundary = await detector.detect(client, options(1100));
  KNOWN_GAPS.push({
    input: { initialNow: 1000, now: 1100, ttlMs: 100 },
    specification: "未定（コメントに期限ちょうどの扱いはない）",
    observed: { sameObject: boundary === first, queries: calls.filter(([method]) => method === "from").length },
  });
});
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}\n${JSON.stringify(KNOWN_GAPS, null, 2)}`);
console.log(`${tests} tests, ${failures} failures`);
process.exitCode = failures ? 1 : 0;
