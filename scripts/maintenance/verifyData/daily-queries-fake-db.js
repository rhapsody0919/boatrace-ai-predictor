/**
 * daily-queries-fake-db.js - 日次の集計 CLI（scripts/daily/*.js の6本）を、本文の字でなく「偽の DB に何を問い合わせたか」で見るための部品
 * （verify-race-outcome-filters.js の (d)）。
 *
 * 6本が import する scripts/lib/supabaseClient.js だけを写し aggregate-racer-stats-fake-supabase.js へ差し替える（module.register の
 * resolve hook。場面と記録は aggregate-racer-stats-fake-db.js の fakeDb と同じ）。DB・鍵には繋がない。製品は変えない。
 * CLI の入口が3つの形に分かれるので、それぞれの形で1回だけ回す（読み込みは1つの process で1回）:
 *   export  … run 関数を export する物（isDirectRun の CLI）: その関数を呼ぶ
 *   argv    … `node <path>` の時だけ main を回し、main を export しない物: 読み込む間だけ process.argv[1] をその本にする
 *   import  … 読み込むと main を回す物
 * argv・import の main は待てないので、読み込んだ後に macrotask を数回空けて終わりを待つ（偽の client は Promise だけで、時計を使わない）。
 * その間の process.exit は記録だけにする（失敗で verify ごと落ちず、終了の値として返す）。
 */
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { quietly } from "./aggregate-racer-stats-fake-db.js";

export const DAILY = {
  exhibitionTimeTop: new URL(
    "../../daily/update-exhibition-time-top-stats.js",
    import.meta.url,
  ).href,
  losingTechnique: new URL(
    "../../daily/update-losing-technique-stats.js",
    import.meta.url,
  ).href,
  nigeOutcome: new URL(
    "../../daily/update-nige-outcome-distribution.js",
    import.meta.url,
  ).href,
  outcome: new URL(
    "../../daily/update-outcome-distribution.js",
    import.meta.url,
  ).href,
  topStart: new URL("../../daily/update-top-start-stats.js", import.meta.url)
    .href,
  winningTechnique: new URL(
    "../../daily/update-winning-technique-stats.js",
    import.meta.url,
  ).href,
};
const REAL = new URL("../../lib/supabaseClient.js", import.meta.url).href;
const FAKE = new URL(
  "./aggregate-racer-stats-fake-supabase.js",
  import.meta.url,
).href;
const HOOKS = `
const PRODUCTS = new Set(${JSON.stringify(Object.values(DAILY))});
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return PRODUCTS.has(context.parentURL) && resolved.url === ${JSON.stringify(REAL)}
    ? { url: ${JSON.stringify(FAKE)}, shortCircuit: true }
    : resolved;
}
`;

let registered = false;
function ensureHooks() {
  if (registered) return;
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  registered = true;
}

const SETTLE_ROUNDS = 20; // 目安（根拠なし）。偽の client の Promise は1回の macrotask の前に流れ切る。多めに空ける
const settle = async () => {
  for (let i = 0; i < SETTLE_ROUNDS; i++)
    await new Promise((r) => setImmediate(r));
};

/**
 * CLI（DAILY の値）を入口の形 entry（"export" は run 関数の名前 run も）で1回回し、終了の値を返す（0 = 正常、他 = 失敗）。
 * 問い合わせは先に置いた fakeDb の記録に残る
 */
export async function runDaily(url, { entry, run } = {}) {
  ensureHooks();
  const savedExit = process.exit;
  const savedArgv1 = process.argv[1];
  let status = 0;
  process.exit = (code = 0) => {
    status = code;
  };
  try {
    await quietly(async () => {
      if (entry === "argv") process.argv[1] = fileURLToPath(url);
      const mod = await import(url);
      process.argv[1] = savedArgv1;
      if (entry === "export") await mod[run]();
      else await settle();
    });
  } catch {
    status = 1;
  } finally {
    process.exit = savedExit;
    process.argv[1] = savedArgv1;
  }
  return status;
}
