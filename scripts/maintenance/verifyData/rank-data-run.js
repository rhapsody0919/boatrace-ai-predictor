/**
 * 龍神ボート番付の元データ（scripts/sns/rank-data.js、export の無い CLI）を、同じ process の中で偽の DB の上で回す道具。
 * verify ではない。DB・ネットには繋がない。
 *
 * - rank-data-db.js が使う @supabase/supabase-js の createClient を、渡した表（メモリ）を返す偽へ差し替える
 * - rank-data.js が import する src/utils/racerVenueBoatStats.js を、呼び出しの引数と戻り値を記録する写しへ差し替える
 *   （中身は本物を呼ぶ。画面の側の import は差し替えない）
 * - rank-data.js は import の時に main() を回すので、引数（process.argv）を入れ替え、URL の後ろに毎回違う ?run= を付けて
 *   読み直す。出力（console.log の JSON）・エラー（console.error）・終了の値（process.exitCode）を受け取る
 */
import { register } from "node:module";
import { createFakeSupabase } from "./fakeServiceSupabase.js";

const HOLDER = "__rankDataRun";
const CLI = new URL("../../sns/rank-data.js", import.meta.url);

const HOOKS = `
const HOLDER = ${JSON.stringify(HOLDER)};
const spyModule = (real) => [
  "import * as real from " + JSON.stringify(real) + ";",
  "const log = (name, args, out) => (globalThis[" + JSON.stringify(HOLDER) + "].spy.push({ name, args, out }), out);",
  "export const aggregateRacerVenueBoatStats = (...a) => log('aggregateRacerVenueBoatStats', a, real.aggregateRacerVenueBoatStats(...a));",
  "export const racerHistoryCutoff = (...a) => log('racerHistoryCutoff', a, real.racerHistoryCutoff(...a));",
  "export * from " + JSON.stringify(real) + ";",
].join("\\n");
export async function resolve(specifier, context, next) {
  const parent = context.parentURL ? new URL(context.parentURL).pathname : "";
  if (specifier === "@supabase/supabase-js" && parent.endsWith("/scripts/sns/rank-data-db.js")) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export const createClient = () => globalThis[" + JSON.stringify(HOLDER) + "].client;"),
      shortCircuit: true,
    };
  }
  const resolved = await next(specifier, context);
  if (parent.endsWith("/scripts/sns/rank-data.js") && resolved.url.endsWith("/src/utils/racerVenueBoatStats.js")) {
    return { url: "data:text/javascript," + encodeURIComponent(spyModule(resolved.url)), shortCircuit: true };
  }
  return resolved;
}
`;

let registered = false;
let runs = 0;

// rank-data-db.js は1度作ったクライアントを使い回すので、中継（今の偽へ渡す）を1つだけ置く
const relayClient = () => ({
  from(table) {
    const chain = globalThis[HOLDER].fake.from(table);
    // rank-data-db.js は .range(..).throwOnError() で読む。偽は失敗の表を await の例外にするので、同じ鎖を返す
    chain.throwOnError = () => chain;
    return chain;
  },
});

/**
 * rank-data.js を args（["--dataset=…", …]）で回す。tables は表名 → 行。
 * @returns {Promise<{ out: object|null, stderr: string, exitCode: number, calls: object[], spy: object[], startedAt: number, endedAt: number }>}
 */
export async function runRankData(args, tables = {}) {
  if (!registered) {
    register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
    registered = true;
  }
  const fake = createFakeSupabase(tables);
  globalThis[HOLDER] = { fake, client: relayClient(), spy: [] };
  const saved = {
    argv: process.argv,
    exitCode: process.exitCode,
    log: console.log,
    error: console.error,
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_ANON_KEY,
  };
  const logs = [];
  const errors = [];
  // db() は URL・匿名キーが無いと投げるので、偽の値を置く（偽のクライアントは値を使わない。.env は読まない）
  process.env.VITE_SUPABASE_URL = "http://fake.invalid";
  process.env.VITE_SUPABASE_ANON_KEY = "fake-anon-key";
  process.argv = [process.execPath, CLI.pathname, ...args];
  process.exitCode = undefined;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => errors.push(a.join(" "));
  const startedAt = Date.now();
  let exitCode;
  try {
    runs += 1;
    await import(`${CLI.href}?run=${runs}`);
    // main() は import の後に非同期で終わる。出力かエラーが出るまで（最長5秒）待つ
    for (let waited = 0; logs.length === 0 && errors.length === 0 && waited < 5000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    exitCode = process.exitCode ?? 0;
  } finally {
    process.argv = saved.argv;
    process.exitCode = saved.exitCode;
    console.log = saved.log;
    console.error = saved.error;
    for (const [k, v] of [["VITE_SUPABASE_URL", saved.url], ["VITE_SUPABASE_ANON_KEY", saved.key]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const { spy } = globalThis[HOLDER];
  delete globalThis[HOLDER];
  return {
    out: logs.length ? JSON.parse(logs.at(-1)) : null,
    stderr: errors.join("\n"),
    exitCode,
    calls: fake.calls,
    spy,
    startedAt,
    endedAt: Date.now(),
  };
}
