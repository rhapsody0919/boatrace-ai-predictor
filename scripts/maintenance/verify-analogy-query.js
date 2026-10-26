/** BOA-1125: 全 fetch を差し替え、DB・Storage に接続しない入口検査。 */
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "test-key";
process.env.VITE_SUPABASE_URL = "http://supabase.test";
process.env.VITE_SUPABASE_ANON_KEY = "test-key";
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return new Response("[]", { status: 200 });
};
const race = "2026-10-25-01-01";
const handlers = {};
for (const name of ["facts", "similar", "scenario", "layer", "contribution"])
  handlers[name] = (await import(`../../api/analogy/${name}${name === "contribution" ? "" : "/[raceId]"}.js`)).default;
const good = {
  facts: ["", "?stage=racecard", "?include=racers", "?stage=exhibition&include=racers", `?stage=racecard&raceId=${race}`],
  similar: ["?stage=exhibition"], layer: ["", "?stage=racecard"],
  scenario: ["?stage=racecard&boats=1", "?stage=racecard&scope=VC%3A01%3Aa", "?stage=racecard&races=1&scope=VC%3A01%3Aa&boat=3"],
  contribution: ["", "?venue=0&grade=all&round=all&target=1&stage=exhibition"],
};
const bad = {
  facts: ["?stage=racecard&x=1", "?include=racers&stage=racecard", "?st%61ge=racecard", "?stage=racecard&stage=racecard", "?stage=", "?stage=racecard&", "?stage=racecard&raceId=2026-10-25-01-02"],
  similar: ["?stage=exhibition&_=1"], layer: ["?foo=1"],
  scenario: ["?boats=1&stage=racecard", "?stage=racecard&scope=VC:01:a", "?stage=racecard&scope=VC%3a01%3aa", "?stage=racecard&boats=1&zz=1", "?scope=bogus", "?races=0", "?boats=2", "?boat=1", "?boat=7"],
  contribution: ["?stage=exhibition&target=1&round=all&grade=all&venue=0", "?venue=0&grade=all&round=all&target=1&stage=exhibition&x=1", "?venue=00&grade=all&round=all&target=1&stage=exhibition", "?venue=0&grade=&round=all&target=1&stage=exhibition", "?venue=0&gr%61de=all&round=all&target=1&stage=exhibition", "?venue=1.0", "?venue=+1", "?target=01", "?grade=all&grade=all"],
};
let failures = 0;
let checked = 0;
async function check(name, query, status, id = race) {
  calls = 0;
  const path = name === "contribution" ? name : `${name}/${id}`;
  const label = `${path}${query}`;
  try {
    const res = await handlers[name](new Request(`http://localhost/api/analogy/${path}${query}`));
    const body = await res.json();
    assert.equal(res.status, status, label);
    assert.equal(res.headers.get("Cache-Control"), "no-store", label);
    assert.ok(status === 400 ? calls === 0 : calls > 0, `${label}: fetch=${calls}`);
    if (status === 200) {
      if (name === "contribution") assert.deepEqual(body, { available: false });
      else assert.equal(body.status, "not_saved", label);
    }
  } catch (error) {
    failures += 1;
    console.error(`${error.message}; fetch=${calls}`);
  }
  checked += 1;
}
try {
  for (const [name, queries] of Object.entries(good))
    for (const query of queries) await check(name, query, 200);
  for (const [name, queries] of Object.entries(bad))
    for (const query of [...queries, "?stage=bogus"]) await check(name, query, 400);
  for (const name of ["facts", "similar", "scenario", "layer"]) {
    for (const id of ["2026-02-30-01-01", "2026-10-25-25-13", "2026%2D10-25-01-01", "2026-10-25-00-01", "2026-10-25-01-00", "2026-10-25-24-13", "2025-02-29-01-01"])
      await check(name, "?stage=racecard", 400, id);
    await check(name, `?raceId=${race}&raceId=${race}`, 400);
    await check(name, `?raceId=${race}&`, 400);
    await check(name, `?&raceId=${race}`, 400);
    await check(name, `?raceId=${race}&stage=exhibition`, 200);
    await check(name, "", 200, "2024-02-29-24-12");
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log(`${checked} cases, ${failures} failures`);
if (failures) process.exitCode = 1;
