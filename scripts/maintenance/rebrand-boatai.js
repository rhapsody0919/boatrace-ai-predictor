import fs from "node:fs";
import path from "node:path";

const OLD_BRAND = "BoatAI";
const BRAND_REGEX = /BoatAI/g;

// public/blog/*.md はファイル名サフィックスで言語を判定する
// (getBlogMdSuffix: en=-en, zh-TW=-zh-tw, ko=-ko, ja=サフィックス無し)
const TARGETS = [
  {
    label: "public/blog (ja)",
    dir: "public/blog",
    match: (f) => f.endsWith(".md") && !/-(en|zh-tw|ko)\.md$/.test(f),
    brand: "龍神レーダー",
  },
  {
    label: "public/blog (en)",
    dir: "public/blog",
    match: (f) => f.endsWith("-en.md"),
    brand: "Ryujin Radar",
  },
  {
    label: "public/blog (zh-TW)",
    dir: "public/blog",
    match: (f) => f.endsWith("-zh-tw.md"),
    brand: "龍神雷達",
  },
  {
    label: "public/blog (ko)",
    dir: "public/blog",
    match: (f) => f.endsWith("-ko.md"),
    brand: "용신 레이더",
  },
  {
    label: "src/data/blogPosts.js (ja)",
    dir: "src/data",
    match: (f) => f === "blogPosts.js",
    brand: "龍神レーダー",
  },
  {
    label: "src/data/blogPostsEn.js (en)",
    dir: "src/data",
    match: (f) => f === "blogPostsEn.js",
    brand: "Ryujin Radar",
  },
  {
    label: "src/data/blogPostsZhTw.js (zh-TW)",
    dir: "src/data",
    match: (f) => f === "blogPostsZhTw.js",
    brand: "龍神雷達",
  },
  {
    label: "src/data/blogPostsKo.js (ko)",
    dir: "src/data",
    match: (f) => f === "blogPostsKo.js",
    brand: "용신 레이더",
  },
];

// "BoatAI"（大文字・ハイフン無し）と"boat-ai.jp"（小文字・ハイフン有り）は
// 文字列として完全に異なるため単純な完全一致置換で安全に区別できる。
// 念のため置換前後で "boat-ai.jp" の出現数が不変であることを検証する。
function verifyDomainUntouched(before, after, file) {
  const beforeCount = (before.match(/boat-ai\.jp/g) || []).length;
  const afterCount = (after.match(/boat-ai\.jp/g) || []).length;
  if (beforeCount !== afterCount) {
    throw new Error(
      `${file}: boat-ai.jp ドメイン文字列の個数が変化した（${beforeCount} -> ${afterCount}）。置換ロジックを見直すこと`,
    );
  }
}

function run({ dryRun = true } = {}) {
  const report = [];

  for (const target of TARGETS) {
    const files = fs
      .readdirSync(target.dir)
      .filter(target.match)
      .map((f) => path.join(target.dir, f));

    for (const file of files) {
      const before = fs.readFileSync(file, "utf-8");
      if (!before.includes(OLD_BRAND)) continue;
      const after = before.replace(BRAND_REGEX, target.brand);
      verifyDomainUntouched(before, after, file);
      const occurrences = (before.match(BRAND_REGEX) || []).length;
      report.push({ label: target.label, file, occurrences });
      if (!dryRun) fs.writeFileSync(file, after, "utf-8");
    }
  }

  const totalFiles = report.length;
  const totalOccurrences = report.reduce((sum, r) => sum + r.occurrences, 0);

  console.log(
    `対象ファイル: ${totalFiles}件 / 合計置換箇所: ${totalOccurrences}件\n`,
  );
  let currentLabel = null;
  for (const r of report) {
    if (r.label !== currentLabel) {
      currentLabel = r.label;
      console.log(`--- ${currentLabel} ---`);
    }
    console.log(`  ${r.file}: ${r.occurrences}箇所`);
  }
  console.log(
    dryRun ? "\n[dry-run] --apply で実行してください" : "\n書き込み完了",
  );
  return report;
}

const dryRun = !process.argv.includes("--apply");
run({ dryRun });
