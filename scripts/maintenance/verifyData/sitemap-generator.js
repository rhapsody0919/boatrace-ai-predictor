/**
 * sitemap-generator.js - scripts/generate-sitemap.js を import し、偽の DB で生成の関数を回す部品
 * （verify-sitemap-coverage.js・verify-sitemap-lastmod.js。verify ではない）。本文の字は読まない。
 *
 * generate-sitemap.js が import する scripts/lib/supabaseClient.js と scripts/lib/sitemapLastmod.js だけを、隣の写し
 * sitemap-fake-supabase.js・sitemap-fake-lastmod.js へ差し替える（module.register の resolve hook。他の import は本物のまま）。
 * import しても main は走らない（isDirectRun）。DB・鍵・public/sitemap.xml には触れない。
 *
 * 使い方:
 *   const gen = await loadSitemapGenerator();
 *   const pages = await raceDetailRun(gen, rows);           // 確定済み /race の固定データ
 *   const xml = await atFixedNow(() => gen.generateSitemap());
 */
import assert from "node:assert/strict";
import { register } from "node:module";
// 写しの静的な import。差し替えは下の HOOKS（URL）で行うが、verify→verifyData の辿りが静的な相対 import しか見ないため、ここで名指しする
import { SITEMAP_SCENE } from "./sitemap-fake-supabase.js";
import { FAKE_COMMIT_DATE } from "./sitemap-fake-lastmod.js";

export { FAKE_COMMIT_DATE };

const PRODUCT = new URL("../../generate-sitemap.js", import.meta.url).href;
const SWAPS = {
  [new URL("../../lib/supabaseClient.js", import.meta.url).href]: new URL("./sitemap-fake-supabase.js", import.meta.url).href,
  [new URL("../../lib/sitemapLastmod.js", import.meta.url).href]: new URL("./sitemap-fake-lastmod.js", import.meta.url).href,
};
const HOOKS = `
const SWAPS = ${JSON.stringify(SWAPS)};
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return context.parentURL === ${JSON.stringify(PRODUCT)} && SWAPS[resolved.url]
    ? { url: SWAPS[resolved.url], shortCircuit: true }
    : resolved;
}
`;

// JST 10/31・UTC 10/30。生成の関数が見る今（new Date()・Date.now()）をこの時刻に止める
export const FIXED_NOW = "2026-10-30T15:30:00Z";

let registered = false;

/** generate-sitemap.js を、DB と git の部品を写しに差し替えて読み込む */
export async function loadSitemapGenerator() {
  if (!registered) {
    register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
    registered = true;
  }
  return quietly(() => import(PRODUCT));
}

/** 偽の DB の場面を置く。client は from(表) を持つ物、fetchAll を渡すと本物の fetchAll の代わりに回す */
export function sitemapScene({ enabled = true, client = {}, fetchAll = null } = {}) {
  globalThis[SITEMAP_SCENE] = { enabled, client, fetchAll };
}

/** fn を、今を at（既定 FIXED_NOW）に止め、console を黙らせて回す。例外はそのまま投げる */
export async function atFixedNow(fn, at = FIXED_NOW) {
  const RealDate = globalThis.Date;
  const fixed = RealDate.parse(at);
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate;
  try {
    return await quietly(fn);
  } finally {
    globalThis.Date = RealDate;
  }
}

/** 確定済み /race（getRaceDetailPages）を固定データ rows で回す。fail なら races の読みを失敗させる */
export async function raceDetailRun(gen, rows, { fail = false } = {}) {
  sitemapScene({ fetchAll: raceDetailFetchAll(rows, fail) });
  return atFixedNow(() => gen.getRaceDetailPages());
}

/** races の問い合わせ（gte・lte・not・order）を行に当てる偽の client で、本物の fetchAll（ページング）を回す */
export function raceDetailFetchAll(rows, fail) {
  return async (table, columns, build) => {
    assert.equal(table, "races");
    assert.match(columns, /race_results!inner\(rank1\)/);
    if (fail) throw new Error("fixture read failed");
    let hit = rows;
    let range;
    const query = {
      select: () => query,
      gte(key, value) {
        hit = hit.filter((r) => r[key] >= value);
        return query;
      },
      lte(key, value) {
        hit = hit.filter((r) => r[key] <= value);
        return query;
      },
      not(key, op, value) {
        assert.equal(key, "race_results.rank1");
        assert.equal(op, "is");
        assert.equal(value, null);
        hit = hit.filter((r) => r.race_results?.rank1 != null);
        return query;
      },
      order(key) {
        assert.equal(key, "race_id");
        return query;
      },
      range(from, to) {
        range = [from, to];
        return query;
      },
      then: (resolve) => resolve({ data: hit.slice(range[0], range[1] + 1), error: null }),
    };
    // 本物の fetchAll（ページング）。読み込みで出る「鍵が無い」等の案内は黙らせる。既定の client（鍵の有る環境の DB）には向けない
    const { fetchAll } = await quietly(() => import("../../lib/supabaseClient.js"));
    return fetchAll(table, columns, build, { client: { from: () => query } });
  };
}

/** /race 以外の DB の読みを空で返す場面（generateSitemap 全体を回すとき）。raceRows は確定済み /race の行 */
export function emptyDbScene(raceRows = []) {
  const query = {
    select: () => query,
    gte: () => query,
    lte: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    then: (resolve) => resolve({ data: [], error: null }),
  };
  const detail = raceDetailFetchAll(raceRows, false);
  sitemapScene({
    client: { from: () => query },
    fetchAll: async (table, columns, build, options) =>
      table === "races" && /race_results!inner/.test(columns) ? detail(table, columns, build, options) : [],
  });
}

/** XML の <url> ごとの {loc, lastmod, alternates: [{hreflang, href}]} */
export function urlEntries(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
    loc: body.match(/<loc>([^<]*)<\/loc>/)?.[1] ?? null,
    lastmod: body.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] ?? null,
    alternates: [...body.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g)].map(([, hreflang, href]) => ({
      hreflang,
      href,
    })),
  }));
}

/** console を黙らせて fn を回す（製品の進捗の文を verify の出力に混ぜない）。例外はそのまま投げる */
export async function quietly(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
}
