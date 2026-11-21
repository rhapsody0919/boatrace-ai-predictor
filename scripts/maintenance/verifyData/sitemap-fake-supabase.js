/**
 * sitemap-fake-supabase.js - scripts/lib/supabaseClient.js の偽（sitemap-generator.js が scripts/generate-sitemap.js からの
 * import だけをここへ向ける。verify ではない）。DB・鍵には繋がない。
 *
 * 場面（globalThis[SITEMAP_SCENE]）の client に問い合わせる。fetchAll は場面が持つ物があればそれを、無ければ本物の fetchAll
 * （ページング・並び順の確かめ）を場面の client で回す（本物の既定の client＝鍵の有る環境の DB には決して向けない）。
 */
export const SITEMAP_SCENE = Symbol.for("verify-sitemap.fake-db-scene");

const scene = () => {
  const s = globalThis[SITEMAP_SCENE];
  if (!s) throw new Error("sitemap の偽の DB: 場面が置かれていない（sitemapScene を先に呼ぶ）");
  return s;
};

export const supabase = new Proxy(
  {},
  {
    get: (_, key) => scene().client?.[key],
  },
);

export const isSupabaseEnabled = () => scene().enabled;

export async function fetchAll(table, select, buildQuery, options = {}) {
  const s = scene();
  if (s.fetchAll) return s.fetchAll(table, select, buildQuery, options);
  const real = await import("../../lib/supabaseClient.js");
  return real.fetchAll(table, select, buildQuery, { ...options, client: s.client });
}
