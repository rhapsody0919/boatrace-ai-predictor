/**
 * dailySupabase.js - scripts/daily/ の本が import する scripts/lib/supabaseClient.js を、行を返して呼びを記録する偽へ差し替える（verify の部品。verify ではない）。
 * DB・ネットに繋がない。偽が返す行は、eq の絞り（行に在る列だけ）を当て、select した列だけに削る（読まない列は本に見えない）。
 *
 * 使い方:
 *   const db = dailySupabase(rows);                       // daily の本を import する前に
 *   const { runX } = await import("../daily/x.js");
 *   await runX();  db.calls → [{ table, ops: [[名, ...引数]] }]
 *   または runDaily(rows, async () => (await import("../daily/x.js")).runX(), "書く表") → { cols, written, report }
 */
import { register } from "node:module";

const HOLDER = "__dailySupabase";
const DAILY = new URL("../../daily/", import.meta.url).href;
const HOOKS = `
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  const fromDaily = context.parentURL?.startsWith(${JSON.stringify(DAILY)}) ?? false;
  return fromDaily && resolved.url.endsWith("/scripts/lib/supabaseClient.js")
    ? { url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${HOLDER}; export const isSupabaseEnabled = () => true;"), shortCircuit: true }
    : resolved;
}
`;
let registered = false;

function answer(rows, ops) {
  if (!ops.some(([n]) => n === "select")) return { data: null, error: null };
  const cols = ops
    .find(([n]) => n === "select")[1]
    .split(",")
    .map((c) => c.trim());
  const [, from, to] = ops.find(([n]) => n === "range") ?? [
    null,
    0,
    rows.length,
  ];
  const hit = rows.filter((r) =>
    ops.every(([n, c, v]) => n !== "eq" || !(c in r) || r[c] === v),
  );
  const data = hit
    .slice(from, to + 1)
    .map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  return { data, error: null };
}

/** 偽を差し替える（何度呼んでもよい。本が掴む偽は1つで、行と記録だけを入れ替える）。戻りの calls に from(table) ごとの呼びの並びが残る */
export function dailySupabase(rows) {
  if (!registered) {
    register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
    registered = true;
  }
  const calls = [];
  globalThis[HOLDER] = Object.assign(globalThis[HOLDER] ?? {}, {
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const chain = new Proxy(
        {},
        {
          get: (_, name) =>
            name === "then"
              ? (ok, ng) => Promise.resolve(answer(rows, call.ops)).then(ok, ng)
              : (...args) => (call.ops.push([name, ...args]), chain),
        },
      );
      return chain;
    },
  });
  return { calls };
}

/** 偽の上で run を呼び、race_results へ select した列・table へ insert した行・run の戻りを返す */
export async function runDaily(rows, run, table) {
  const { calls } = dailySupabase(rows);
  const report = await run();
  const select =
    calls
      .find((c) => c.table === "race_results")
      ?.ops.find(([n]) => n === "select")?.[1] ?? "";
  const written = calls
    .filter((c) => c.table === table && c.ops[0]?.[0] === "insert")
    .flatMap((c) => c.ops[0][1]);
  return { cols: select.split(",").map((c) => c.trim()), written, report };
}
