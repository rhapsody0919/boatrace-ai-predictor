// 書き込みを構造的に止める: GET/HEAD と Storage の一覧（POST object/list）以外の通信は例外にする
const orig = globalThis.fetch;
globalThis.__netlog = [];
globalThis.fetch = (url, opts = {}) => {
  const m = (opts.method || (url && url.method) || "GET").toUpperCase();
  const u = String(url && url.url ? url.url : url);
  const ok = m === "GET" || m === "HEAD" || (m === "POST" && /\/storage\/v1\/object\/list\//.test(u));
  globalThis.__netlog.push(m);
  if (!ok) throw new Error(`guard: blocked ${m} ${u.replace(/\?.*/, "")}`);
  return orig(url, opts);
};
