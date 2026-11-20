/**
 * live-odds-wiring.js - api/odds/live.js の配線を、本文の字でなく export と「手前の部品へ渡した引数・呼び出しの記録」で見る（verify-odds-live-api.js の部品）。
 *
 * api/odds/live.js が import する3本だけを、この隣の写しへ差し替える（下の HOOKS。他の import は本物のまま）:
 *   scripts/lib/scrapeJobs/politeFetch.js → live-odds-wiring-politeFetch.js（createPoliteFetch の引数を記録し、fetchImpl だけ偽物に差す。公式へは繋がない）
 *   scripts/lib/scrapeJobs/store.js       → live-odds-wiring-store.js（createSupabaseStore に渡した client を記録）
 *   scripts/lib/supabaseClient.js         → live-odds-wiring-supabase.js（supabase を、from(表).メソッド… と rpc を記録する偽物にする。DB には繋がない）
 *
 * 使い方:
 *   const live = await loadLiveOddsApi({ fetchImpl: async () => new Response(html) });
 *   live.config・live.handler・live.record（politeFetchOptions・stores・queries・rpcs・supabase・rows）・await live.call({ method, url, query })
 */
import { register } from "node:module";
// 写し3本の静的な import。読み込みの差し替えは下の HOOKS（URL）で行うが、verify→verifyData の辿り（変異検査の data_readers）が静的な相対 import しか見ないため、ここで名指しする
import "./live-odds-wiring-politeFetch.js";
import "./live-odds-wiring-store.js";
import "./live-odds-wiring-supabase.js";

export const WIRING_KEY = Symbol.for("verify-odds-live-api.live-odds-wiring"); // 写し3本も同じ鍵を Symbol.for で持つ

const LIVE_URL = new URL("../../../api/odds/live.js", import.meta.url).href;
const MAP = {
  [new URL("../../lib/scrapeJobs/politeFetch.js", import.meta.url).href]: new URL("./live-odds-wiring-politeFetch.js", import.meta.url).href,
  [new URL("../../lib/scrapeJobs/store.js", import.meta.url).href]: new URL("./live-odds-wiring-store.js", import.meta.url).href,
  [new URL("../../lib/supabaseClient.js", import.meta.url).href]: new URL("./live-odds-wiring-supabase.js", import.meta.url).href,
};
// 解決の hook（module.register が別の thread で動かす）。api/odds/live.js からの3本の import だけを写しへ向ける
const HOOKS = `
const MAP = ${JSON.stringify(MAP)};
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return context.parentURL === ${JSON.stringify(LIVE_URL)} && MAP[resolved.url]
    ? { url: MAP[resolved.url], shortCircuit: true }
    : resolved;
}
`;

/** from(表).メソッド(…)… の連なりを記録し、await で { data: rows[表] ?? null, error: null } を返す偽の supabase。rpc も記録する */
function fakeSupabase(record) {
  const chain = (table) =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") {
            return (ok, ng) => Promise.resolve({ data: record.rows[table] ?? null, error: null }).then(ok, ng);
          }
          if (typeof prop === "symbol" || prop === "catch" || prop === "finally") return undefined;
          return (...args) => {
            record.queries.push({ table, method: prop, args });
            return chain(table);
          };
        },
      },
    );
  return {
    from(table) {
      record.queries.push({ table, method: "from", args: [] });
      return chain(table);
    },
    async rpc(name, args) {
      record.rpcs.push({ name, args });
      return { data: null, error: null };
    },
  };
}

/** 偽の res（status・json・setHeader を記録） */
function fakeRes() {
  const out = { status: null, headers: {}, body: undefined };
  const res = {
    setHeader(k, v) {
      out.headers[k] = v;
      return res;
    },
    status(code) {
      out.status = code;
      return res;
    },
    json(body) {
      out.body = body;
      return out;
    },
  };
  return { res, out };
}

/** 差し替えのもとで api/odds/live.js を読み込み、config・default と記録を返す。1つのプロセスで1回だけ（module は1度しか評価されない） */
export async function loadLiveOddsApi({ fetchImpl }) {
  if (globalThis[WIRING_KEY]) throw new Error("loadLiveOddsApi は1つのプロセスで1回だけ");
  const record = { politeFetchOptions: [], stores: [], queries: [], rpcs: [], rows: {}, fetchImpl, supabase: null };
  record.supabase = fakeSupabase(record);
  globalThis[WIRING_KEY] = record;
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  const mod = await import(LIVE_URL);
  return {
    config: mod.config,
    handler: mod.default,
    record,
    async call(req) {
      const { res, out } = fakeRes();
      await mod.default(req, res);
      return out;
    },
  };
}
