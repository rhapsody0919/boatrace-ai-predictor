/**
 * sitemap.xml の lastmod が「生成日」に戻っていないかを検査する（BOA-599）。
 *
 * 以前は全URLの lastmod を生成日（new Date()）にしており、ブログも md の mtime
 * （CI の checkout 時刻＝毎日の生成日）を使っていた。Google は実際の更新と
 * 一致しない lastmod を無視するため、再クロールの合図として働いていなかった。
 *
 * 1. scripts/lib/sitemapLastmod.js の部品（最終コミット日・日付の比較・<url> の出力）
 * 2. generate-sitemap.js が lastmod に生成日・mtime を使っていないこと（ソースの検査）
 */
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
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

// 2. generate-sitemap.js が生成日・mtime を lastmod に使っていないこと
const source = readFileSync(path.join(ROOT, file), "utf-8");
check(
  !/lastmod:\s*new Date\(\)/.test(source),
  "generate-sitemap.js が lastmod に生成日（new Date()）を使っている",
);
check(
  !/mtime/.test(source.replace(/\/\/.*$/gm, "")),
  "generate-sitemap.js が lastmod にファイルの mtime を使っている（CI では毎日の checkout 時刻になる）",
);

if (failures.length > 0) {
  console.error("❌ sitemap の lastmod の検査に失敗:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("✅ sitemap の lastmod は実際の更新日から取っている");
