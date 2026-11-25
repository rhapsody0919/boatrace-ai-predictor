/**
 * sitemap.xml の lastmod が「生成日」に戻っていないかを検査する（BOA-599）。
 *
 * 以前は全URLの lastmod を生成日（new Date()）にしており、ブログも md の mtime
 * （CI の checkout 時刻＝毎日の生成日）を使っていた。Google は実際の更新と
 * 一致しない lastmod を無視するため、再クロールの合図として働いていなかった。
 *
 * 1. scripts/lib/sitemapLastmod.js の部品（最終コミット日・日付の比較・<url> の出力）
 * 2. generate-sitemap.js が lastmod に生成日・mtime を使っていないこと（import して今を止め、偽の DB で生成した XML を見る）
 * 3. 言語版の組（hreflang）を xhtml:link で出していること（BOA-560。画面の hreflang は
 *    JS 実行後の head にしか無く、日本語の検索に /en/・/ko/ が出ていた）
 */
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { blogPosts } from "../../src/data/blogPosts.js";
import {
  FAKE_COMMIT_DATE,
  FIXED_NOW,
  atFixedNow,
  emptyDbScene,
  loadSitemapGenerator,
  raceDetailRun,
  urlEntries,
} from "./verifyData/sitemap-generator.js";
import {
  gitLastCommitDate,
  laterDate,
  renderUrlEntry,
} from "../lib/sitemapLastmod.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const failures = [];
const check = (cond, message) => {
  if (!cond) failures.push(message);
};

// 1-a. <url> の出力: lastmod が無いときは <lastmod> を出さない
const withDate = renderUrlEntry("https://x", {
  loc: "/a",
  lastmod: "2026-09-01",
  changefreq: "daily",
  priority: "0.5",
});
const withoutDate = renderUrlEntry("https://x", {
  loc: "/b",
  lastmod: null,
  changefreq: "monthly",
  priority: "0.3",
});
check(
  withDate.includes("<lastmod>2026-09-01</lastmod>"),
  "lastmod があるのに <lastmod> が出ていない",
);
check(
  !withoutDate.includes("<lastmod>"),
  "lastmod が null なのに <lastmod> が出ている",
);

// 1-a2. 言語版の組（hreflang）を xhtml:link で出す（BOA-560）
const withAlternates = renderUrlEntry("https://x", {
  loc: "/c",
  lastmod: null,
  changefreq: "daily",
  priority: "0.5",
  alternates: [
    { hreflang: "ja", href: "https://x/c" },
    { hreflang: "en", href: "https://x/en/c" },
  ],
});
check(
  withAlternates.includes(
    '<xhtml:link rel="alternate" hreflang="en" href="https://x/en/c" />',
  ),
  "alternates があるのに xhtml:link が出ていない",
);
check(
  !withoutDate.includes("xhtml:link"),
  "alternates が無いのに xhtml:link が出ている",
);

// 1-b. 日付の比較
check(
  laterDate("2026-09-01", "2026-08-31") === "2026-09-01",
  "laterDate: 新しいほうを返さない",
);
check(
  laterDate(null, "2026-08-31") === "2026-08-31",
  "laterDate: null を無視しない",
);
check(
  laterDate(null, null) === null,
  "laterDate: 両方 null で null にならない",
);

// 1-c. 最終コミット日: git log と同じ値、追跡されていないファイルは null
const file = "scripts/generate-sitemap.js";
const expected = execFileSync(
  "git",
  ["log", "-1", "--format=%cs", "--", file],
  {
    cwd: ROOT,
    encoding: "utf-8",
  },
).trim();
check(
  gitLastCommitDate(file, { cwd: ROOT }) === expected,
  `gitLastCommitDate が git log と違う（${expected}）`,
);
check(
  gitLastCommitDate("no/such/file.md", { cwd: ROOT }) === null,
  "存在しないファイルで null にならない",
);

// 2. generate-sitemap.js が生成日・mtime を lastmod に使っていないこと。今を記事・開催のどの日とも重ならない遠い日
//    （GENERATED_AT）に止め、記事の md の最終コミット日は決まった日（FAKE_COMMIT_DATE）を返す写しで生成し、出た lastmod を見る
const GENERATED_AT = "2099-06-15T03:00:00Z";
const raceRow = {
  race_id: "2026-10-25-01-01",
  race_date: "2026-10-25",
  race_results: { rank1: 1 },
};
try {
  const gen = await loadSitemapGenerator();
  emptyDbScene([raceRow]);
  const xml = await atFixedNow(() => gen.generateSitemap(), GENERATED_AT);
  const entries = urlEntries(xml);
  const nowDates = new Set([GENERATED_AT.slice(0, 10)]);
  check(entries.length > 0, "生成した sitemap に <url> が無い");
  check(
    entries.every((e) => !nowDates.has(e.lastmod)),
    "generate-sitemap.js が lastmod に生成日（new Date()）を使っている",
  );
  const postDate = new Map(blogPosts.map((p) => [p.id, p.updated ?? p.date ?? null]));
  const jaBlog = entries.filter((e) =>
    /^https:\/\/www\.boat-ai\.jp\/blog\/[^/]+$/.test(e.loc),
  );
  check(jaBlog.length > 0, "生成した sitemap に記事（/blog/…）が無い");
  check(
    jaBlog.every((e) => {
      const id = e.loc.split("/").at(-1);
      return e.lastmod === laterDate(FAKE_COMMIT_DATE, postDate.get(id) ?? null);
    }),
    "generate-sitemap.js が記事の lastmod に md の最終コミット日と公開日の新しい方を使っていない（mtime は CI では毎日の checkout 時刻になる）",
  );
  check(
    /<urlset [^>]*xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(xml),
    "urlset に xhtml 名前空間が無い（xhtml:link を使うと XML として不正になる）",
  );
  const top = entries.find((e) => e.loc === "https://www.boat-ai.jp/");
  check(
    top?.alternates.some(
      (a) => a.hreflang === "en" && a.href === "https://www.boat-ai.jp/en/",
    ) ?? false,
    "generate-sitemap.js が各URLに言語版の組（alternatesFor）を渡していない",
  );

  // BOA-1186: 結果の日は開催日。取得日・生成日（JST 10/31）に更新しない。
  const pages = await raceDetailRun(gen, [raceRow]);
  check(pages.length === 1, "確定済み /race が無い");
  check(
    pages[0]?.lastmod === "2026-10-25",
    "/race の lastmod が結果の日ではない",
  );
  emptyDbScene([raceRow]);
  const raceXml = await atFixedNow(() => gen.generateSitemap(), FIXED_NOW);
  check(
    urlEntries(raceXml).find(
      (e) => e.loc === "https://www.boat-ai.jp/race/2026-10-25-01-01",
    )?.lastmod === "2026-10-25",
    "/race の XML に結果の日が出ていない",
  );
} catch (error) {
  check(false, error.message);
}

if (failures.length > 0) {
  console.error("❌ sitemap の lastmod の検査に失敗:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("✅ sitemap の lastmod は実際の更新日から取っている");
