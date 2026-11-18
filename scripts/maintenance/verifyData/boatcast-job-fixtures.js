/**
 * verify-boatcast-job.js の入力（公式の写し・偽の取得・偽のクライアント）。大きさの関所のため、本文を字のまま移した（ROOT と動的 import の相対パスだけこの場所から数え直した）。verify ではない。
 */
import { CANARY_URL } from "../../lib/boatcast/boatcastClient.js";
import { clearBoatcastSchemaCache } from "../../lib/boatcast/oritenSchema.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const show = (v) => JSON.stringify(v);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/boatcast");
export const readFixture = (name) =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8");

export const THREE = readFixture("oriten-3items-tamagawa-r01.txt"); // 05 多摩川（一周・まわり足・直線）
export const TWO = readFixture("oriten-2items-suminoe-r01.txt"); // 12 住之江（一周・まわり足）
export const HALF = readFixture("oriten-halflap-kiryu-r01.txt"); // 01 桐生（半周ラップ・まわり足・直線）
export const MISSING = readFixture("oriten-lap-missing-mikuni-r01.txt"); // 10 三国（一周が --.--）
export const UNMEASURABLE = readFixture("oriten-unmeasurable-shimonoseki-r06.txt"); // 19 下関（計測不可）
export const MST = readFixture("mst-suminoe-12.txt");
export const HTML_ERROR = `<!doctype html>\n<html lang="ja">\n<head><title>エラーが発生しました | BOATCAST</title></head></html>\n`;

// ---------------------------------------------------------------------------
// 共通の部品: 偽の取得・偽のクライアント
// ---------------------------------------------------------------------------
export const RACE_ID = "2026-09-21-05-01";
export const RACE = {
  race_id: RACE_ID,
  race_date: "2026-09-21",
  start_time: "10:30:00",
};

/** URL → 応答 の偽の fetch（ctx.politeFetch の代わり）。呼び出しのURLを記録する */
export function createFakeFetch(router) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const r = await router(url);
    return new Response(r.body ?? null, {
      status: r.status,
      headers: r.lastModified ? { "last-modified": r.lastModified } : {},
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
export const OK_MST = { status: 200, body: "20260323\n" };
export const FORBIDDEN = { status: 403, body: HTML_ERROR };
/** カナリアは正常、オリジナル展示は body を返す */
export const routeOriten = (oritenResponse) => (url) =>
  url === CANARY_URL ? OK_MST : oritenResponse(url);

export const fetchTextOf = (fetchImpl) => async (url) => {
  const { fetchBoatcast } = await import("../../lib/boatcast/boatcastClient.js");
  return fetchBoatcast(url, { fetchImpl, pacer: { wait: async () => {} } });
};

export function freshClient(extra = {}) {
  const c = createFakeSupabaseClient({
    tables: {
      races: [RACE],
      race_original_exhibition: [],
      race_original_exhibition_values: [],
      scrape_slots: [],
      ...extra,
    },
  });
  clearBoatcastSchemaCache(c);
  return c;
}
/** 指定したテーブルが無い（PGRST205）DBのふりをする */
export function withMissingTables(client, tables) {
  return {
    ...client,
    from(table) {
      if (!tables.includes(table)) return client.from(table);
      const err = {
        data: null,
        error: {
          code: "PGRST205",
          message: `Could not find the table 'public.${table}' in the schema cache`,
        },
      };
      const b = {
        select: () => b,
        limit: () => b,
        eq: () => b,
        maybeSingle: () => b,
        upsert: () => b,
        delete: () => b,
        then: (resolve, reject) => Promise.resolve(err).then(resolve, reject),
      };
      return b;
    },
  };
}
export const orderOf = (client) =>
  client.writes.filter((w) => w.op === "upsert").map((w) => w.table);
