/**
 * 競合の sitemap の差分（competitor-watch.js）が、増えたページ・新しい区画を正しく数え、読まなかった子で「消えた」と数えないことを守る。
 * ネットには繋がない（純関数だけ）。
 */
import {
  alertLine,
  childrenToFetch,
  diffSnapshots,
  parseSitemap,
  sectionOf,
} from "./competitor-watch.js";

const failures = [];
let checked = 0;
const check = (name, actual, expected) => {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${name}: 期待 ${JSON.stringify(expected)} 実際 ${JSON.stringify(actual)}`,
    );
  }
};

const urlset = `<?xml version="1.0"?><urlset xmlns="x"><url><loc>https://a.jp/</loc><lastmod>2026-11-26</lastmod></url>
<url> <loc>https://a.jp/racer/1?x=1&amp;y=2</loc> </url></urlset>`;
check("urlset のページを取る（&amp; を戻す）", parseSitemap(urlset), {
  isIndex: false,
  entries: [
    { loc: "https://a.jp/", lastmod: "2026-11-26" },
    { loc: "https://a.jp/racer/1?x=1&y=2", lastmod: null },
  ],
});
const index = `<sitemapindex><sitemap><loc>https://a.jp/s/1.xml</loc><lastmod>2026-11-25</lastmod></sitemap><sitemap><loc>https://a.jp/s/2.xml</loc></sitemap></sitemapindex>`;
check("sitemapindex の子を取る", parseSitemap(index).isIndex, true);
check(
  "子の lastmod",
  parseSitemap(index).entries.map((e) => e.lastmod),
  ["2026-11-25", null],
);

check(
  "区画は URL の1段目",
  [sectionOf("https://a.jp/racer/1"), sectionOf("https://a.jp/")],
  ["/racer", "/"],
);

const prev = {
  s1: ["https://a.jp/racer/1", "https://a.jp/racer/2"],
  s2: ["https://a.jp/blog/x"],
};
const cur = {
  s1: ["https://a.jp/racer/1", "https://a.jp/racer/3", "https://a.jp/tool/new"],
};
const d = diffSnapshots(prev, cur);
check("増えたページ", d.added, [
  "https://a.jp/racer/3",
  "https://a.jp/tool/new",
]);
check(
  "消えたページ（両方にある子だけで数える。今日読まなかった s2 は数えない）",
  d.removed,
  ["https://a.jp/racer/2"],
);
check("新しい区画", d.newSections, ["/tool"]);
check(
  "新しい子の sitemap のページは全部増えた側",
  diffSnapshots({}, { s9: ["https://a.jp/x/1"] }).added,
  ["https://a.jp/x/1"],
);

check(
  "前の回の一覧にあって読まなかった子は、初めて読んだ日に増えた側に数えない",
  diffSnapshots({}, { s9: ["https://a.jp/x/1"] }, ["s9"]).added,
  [],
);

check(
  "新しいページが無ければ知らせない",
  alertLine("A", { added: [], removed: ["u"], newSections: [] }),
  null,
);
check(
  "知らせの1行",
  alertLine("A", d),
  "A: 新しいページ 2（消えた 1）。新しい区画: /tool。例: /racer/3 /tool/new",
);

const entries = [
  { loc: "o", lastmod: "2026-01-01" },
  { loc: "n", lastmod: "2026-11-25" },
  { loc: "x", lastmod: null },
  { loc: "same", lastmod: "2026-11-20" },
];
check(
  "lastmod が変わった子と lastmod の無い子だけを新しい順に読む",
  childrenToFetch(entries, { same: { lastmod: "2026-11-20" } }).map(
    (e) => e.loc,
  ),
  ["x", "n", "o"],
);
check("読む数の上限", childrenToFetch(entries, {}, 2).length, 2);

if (failures.length > 0) {
  console.error("NG: 競合の sitemap の差分");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: 競合の sitemap の差分 ${checked}件`);
