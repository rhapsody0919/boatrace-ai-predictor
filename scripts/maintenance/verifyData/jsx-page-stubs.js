/**
 * 頁（src/pages/*.jsx など）を renderJsx で描くとき、Vite 専用の import（import.meta.glob・仮想モジュール）に届く物だけを
 * 空の写しへ差し替える道具。verify ではない。DB・公式・ネットには繋がない。
 *
 * 差し替える物（他は本物のまま）:
 *   src/data/blogPosts*.js（import.meta.glob で記事の表を読む）→ 記事の表を引数で渡した写し
 *   src/i18n.js（import.meta.glob で訳を読む）→ 何もしない（t は鍵を返す）
 *   virtual:blog-image-dimensions → 空の表
 *   stubs = { "src/ からの相対": 写しの本文 } … 呼ぶ側が足す写し（例: DB を読む services）
 */
import { register } from "node:module";

const SRC = new URL("../../../src/", import.meta.url).href;
const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const blogPostsStub = (posts) => `
const posts = ${JSON.stringify(posts)};
export const blogPosts = posts;
export const getFeaturedPosts = () => [];
export const getPostsForLang = () => posts;
export const getPostById = (id) => posts.find((p) => p.id === id);
export const getLatestPosts = () => posts;
export const getHomeBlogPosts = () => posts;
export const getRelatedPosts = () => [];
export const getRelatedPostsForLang = () => [];
export const isBlogLangAvailable = () => true;
export const getBlogOverride = () => ({});
export const getBlogMdSuffix = () => "";
`;
const emptyBlog = (names) => names.map((n) => `export const ${n} = () => ({});`).join("\n");

/** 差し替えの表（解決後の URL → 写しの URL）を作る */
function buildMap(posts, stubs) {
  const map = {
    [`${SRC}data/blogPosts.js`]: dataUrl(blogPostsStub(posts)),
    [`${SRC}data/blogPostsEn.js`]: dataUrl(`export const blogPostsEn = []; ${emptyBlog(["getEnglishOverride"])} export const isEnglishAvailable = () => false;`),
    [`${SRC}data/blogPostsZhTw.js`]: dataUrl(`export const blogPostsZhTw = []; ${emptyBlog(["getZhTwOverride"])} export const isZhTwAvailable = () => false;`),
    [`${SRC}data/blogPostsKo.js`]: dataUrl(`export const blogPostsKo = []; ${emptyBlog(["getKoreanOverride"])} export const isKoreanAvailable = () => false;`),
    [`${SRC}i18n.js`]: dataUrl("export default {};"),
  };
  for (const [rel, source] of Object.entries(stubs)) map[`${SRC}${rel}`] = dataUrl(source);
  return map;
}

const HOOKS = `
let MAP = {};
let VIRTUAL = "";
export async function initialize(data) { MAP = data.map; VIRTUAL = data.virtual; }
export async function resolve(specifier, context, next) {
  if (specifier === "virtual:blog-image-dimensions") return { url: VIRTUAL, shortCircuit: true };
  const resolved = await next(specifier, context);
  return MAP[resolved.url] ? { url: MAP[resolved.url], shortCircuit: true } : resolved;
}
`;

let registered = false;

/** 一度だけ登録する（hooks は process 全体に効く）。renderJsx より後に呼ぶ（後に登録した hook が先に呼ばれる）。 */
export function registerJsxPageStubs({ posts = [], stubs = {} } = {}) {
  if (registered) return;
  registered = true;
  register(dataUrl(HOOKS), {
    parentURL: import.meta.url,
    data: { map: buildMap(posts, stubs), virtual: dataUrl("export default {};") },
  });
}

/** fn の間だけ console を黙らせる（頁を読み込むときの「Supabase 環境変数が無い」等の案内が verify の出力に混ざらないように）。 */
export async function quietly(fn) {
  const keys = ["log", "info", "warn", "error"];
  const saved = keys.map((k) => console[k]);
  for (const k of keys) console[k] = () => {};
  try {
    return await fn();
  } finally {
    keys.forEach((k, i) => {
      console[k] = saved[i];
    });
  }
}
