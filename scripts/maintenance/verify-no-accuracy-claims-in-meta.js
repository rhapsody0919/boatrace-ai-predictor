/**
 * サイト全体の説明文（meta・OGP・JSON-LD・llms.txt の冒頭）に、的中・精度を誇る語が戻っていないことを確かめる。
 *
 * 方針: 的中率・回収率の土俵で戦わない（BOA-617）。画面の主役は過去の実際の結果を数えた値（BOA-271）。
 * 2026-10-05 にユーザーが「高精度な予想を提供」等の表現を直すと決めた（docs/proposal/ai-agent-era-strategy.md R5）。
 *
 * 対象はサイト全体の自己紹介にあたる箇所だけ。ブログ記事のタイトル・説明や、
 * AI予想の作り直しで扱うページ本文（About の本文・FAQ 等）は対象外。
 */

import { readFileSync } from "node:fs";

const read = (rel) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf-8");

const BANNED = ["高精度", "精度", "的中", "回収率", "必勝"];

const llms = read("public/llms.txt");
const llmsHeader = llms.split("## ブログ記事")[0];
const aboutDescription =
  read("src/pages/About.jsx").match(/const DESCRIPTION =\s*"([^"]*)"/)?.[1] ??
  null;

const targets = [
  ["index.html", read("index.html")],
  ["src/hooks/useSocialMeta.js", read("src/hooks/useSocialMeta.js")],
  ["src/pages/About.jsx の DESCRIPTION", aboutDescription],
  ["scripts/generate-llms-txt.js", read("scripts/generate-llms-txt.js")],
  ["public/llms.txt（ブログ記事より前）", llmsHeader],
];

const failures = [];
for (const [label, text] of targets) {
  if (text === null) {
    console.log(`  NG  ${label} が見つからない`);
    failures.push(label);
    continue;
  }
  const hits = BANNED.filter((word) => text.includes(word));
  const ok = hits.length === 0;
  console.log(
    `  ${ok ? "OK" : "NG"}  ${label}${ok ? "" : `（${hits.join("・")}）`}`,
  );
  if (!ok) failures.push(label);
}

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nOK: サイト全体の説明文に的中・精度を誇る語は無い");
