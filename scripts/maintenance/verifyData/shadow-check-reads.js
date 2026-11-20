/**
 * shadow-check-reads.js - scripts/maintenance/check-pre-race-shadow.js（直に回したときだけ main が動く集計）を、偽の Supabase で
 * 1回回し、client に呼んだ method の一覧を返す（verify の部品）。本文の字は読まない。
 *
 * @supabase/supabase-js の import だけを supabase-read-fake.js へ差し替え（importProbe.js）、process.argv[1] をその本の場所にして
 * 「直に回した」ときの道を通す。scrape_slots には rows の slots を返し、shadow で完了した行の比べの読み（fetchByRaceIds）まで進める。
 * 本物の Supabase には繋がない。
 */
import { fileURLToPath } from "node:url";
import { fakeOf, probeImport } from "./importProbe.js";

const KEY = Symbol.for("verify.supabaseReads");
const CHECK = import.meta.resolve("../check-pre-race-shadow.js");
const SUPABASE = import.meta.resolve("@supabase/supabase-js");
const FAKE = import.meta.resolve("./supabase-read-fake.js");

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** job（race_info・exhibition）の集計を回し、{ calls, clients, exitCode, errors } を返す */
export async function shadowCheckCalls(job, slots) {
  const rec = { calls: [], clients: [], rows: { scrape_slots: slots } };
  globalThis[KEY] = rec;
  const saved = {
    argv: process.argv,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY,
    log: console.log,
    error: console.error,
    exit: process.exit,
  };
  const errors = [];
  let exitCode = null;
  process.argv = [
    saved.argv[0],
    fileURLToPath(CHECK),
    `--job=${job}`,
    "--date=2026-10-01",
  ];
  process.env.SUPABASE_URL = "https://fake.invalid";
  process.env.SUPABASE_SERVICE_KEY = "fake-key";
  console.log = () => {};
  console.error = (...a) => errors.push(a.map(String).join(" "));
  process.exit = (code) => {
    exitCode = code ?? 0;
  };
  try {
    await probeImport(CHECK, (n) => ({
      [SUPABASE]: fakeOf(FAKE, "client", n),
    }));
    for (let i = 0; i < 10; i += 1) await flush();
  } finally {
    process.argv = saved.argv;
    for (const [k, v] of [
      ["SUPABASE_URL", saved.url],
      ["SUPABASE_SERVICE_KEY", saved.key],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    Object.assign(console, { log: saved.log, error: saved.error });
    process.exit = saved.exit;
  }
  return { calls: rec.calls, clients: rec.clients, exitCode, errors };
}
