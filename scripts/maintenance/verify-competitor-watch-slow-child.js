/**
 * 競合の見張りで、子の sitemap が1本読めなくても前の回の値で埋めてサイトの回を捨てず、前の値が無い子は黙って空にせず投げることを守る。網には出ない（取得は差し替え）。
 */
import { snapshotSite } from "./competitor-watch.js";

const failures = [];
let checked = 0;
const check = (name, ok, detail = "") => {
  checked += 1;
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

const index = (locs) => `<sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;
const urlset = (locs) => `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const ROOT = "https://x.test/sitemap.xml";
const A = "https://x.test/a.xml";
const B = "https://x.test/b.xml";
const pages = { [ROOT]: index([A, B]), [A]: urlset(["https://x.test/a/1", "https://x.test/a/2"]) };
// B は時間切れで読めない
const get = async (u) => {
  if (u === B) throw new Error("The operation was aborted due to timeout");
  return pages[u];
};
const site = { name: "x", sitemap: ROOT };
const prev = { snap: { [A]: ["https://x.test/a/1"], [B]: ["https://x.test/b/1"] }, meta: { [A]: {}, [B]: {} } };

const cur = await snapshotSite(site, prev, get);
check("読めた子は今の値", JSON.stringify(cur.snap[A]) === JSON.stringify(["https://x.test/a/1", "https://x.test/a/2"]), JSON.stringify(cur.snap));
check("読めない子は前の回の値", JSON.stringify(cur.snap[B]) === JSON.stringify(["https://x.test/b/1"]), JSON.stringify(cur.snap));
check("読めない子を stale に数える", cur.stale.length === 1 && cur.stale[0].startsWith(B), JSON.stringify(cur.stale));
check("listed は2本とも", cur.listed.length === 2);

let thrown = "";
try {
  await snapshotSite(site, { snap: { [A]: [] }, meta: {} }, get);
} catch (e) {
  thrown = e.message;
}
check("前の値が無い子は投げる", /timeout/.test(thrown), thrown);

const ok = await snapshotSite(site, prev, async (u) => (u === B ? urlset(["https://x.test/b/1"]) : pages[u]));
check("全部読めたら stale は空", ok.stale.length === 0);

if (failures.length) {
  console.error(`verify-competitor-watch-slow-child: ${failures.length}/${checked} 件が失敗\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`verify-competitor-watch-slow-child: ${checked} 件 OK`);
