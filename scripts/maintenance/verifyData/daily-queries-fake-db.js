/**
 * daily-queries-fake-db.js - 日次の集計 CLI（scripts/daily/*.js）を、本文の字でなく「偽の DB に何を問い合わせたか」で見るための部品
 * （verify-race-outcome-filters.js の (d)）。
 *
 * CLI は import の時に main を回す物・`node <path>` の時だけ回す物が混ざり、main を export しない物もあるので、
 * 子の node で `node --import daily-queries-preload.js <CLI>` と直接実行する（製品は変えない）。preload が supabaseClient.js を
 * 写し aggregate-racer-stats-fake-supabase.js へ差し替え、子の終わりに問い合わせの記録を返す。子には SUPABASE_* の環境変数を渡さない。
 *
 * 使い方:
 *   const run = runDaily(new URL("../daily/update-top-start-stats.js", import.meta.url), { race_start_timings: [...] });
 *   run.status（子の終了）・run.queries（{table, method, args} の並び。表ごとの連なりは aggregate-racer-stats-fake-db.js の chainsOf({ queries }, 表)）
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PRELOAD = new URL("./daily-queries-preload.js", import.meta.url).href;
const MARK = "@@daily-queries@@"; // daily-queries-preload.js と同じ印

/** 鍵の環境変数を落とした子の環境（偽の client に差し替えるが、本物を読んだときも繋がらないように） */
const childEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/SUPABASE/i.test(k)),
  );

/** CLI（URL）を偽の DB の場面 tables で1回直接実行し、終了と問い合わせの記録を返す */
export function runDaily(productUrl, tables = {}) {
  const r = spawnSync(
    process.execPath,
    ["--import", PRELOAD, fileURLToPath(productUrl)],
    {
      env: { ...childEnv(), DAILY_QUERIES_SCENE: JSON.stringify({ tables }) },
      encoding: "utf8",
      timeout: 30000,
    },
  );
  const line = (r.stdout ?? "").split("\n").findLast((l) => l.startsWith(MARK));
  return {
    status: r.status,
    queries: line ? JSON.parse(line.slice(MARK.length)) : null,
    stderr: (r.stderr ?? "").slice(-500),
  };
}
