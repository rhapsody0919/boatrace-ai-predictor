#!/usr/bin/env node
/**
 * zh-TW の全ての文字列の値にかなが残っていないことを検査する（BOA-1368）。
 * verify-i18n-consistency.js の検査5は en・ko だけで zh-TW を見ない。
 * 中黒・長音も含め、U+3040〜U+309F と U+30A0〜U+30FF を禁止する。
 */
import { readFileSync } from "node:fs";

const KANA = /[\u3040-\u309F\u30A0-\u30FF]/u;

function findKana(value, prefix = "", hits = []) {
  if (typeof value === "string") {
    if (KANA.test(value)) hits.push(`${prefix}: ${value}`);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      findKana(child, prefix ? `${prefix}.${key}` : key, hits);
    }
  }
  return hits;
}

const locale = JSON.parse(
  readFileSync(new URL("../../src/locales/zh-TW/common.json", import.meta.url), "utf8"),
);
const hits = findKana(locale);
if (hits.length > 0) {
  console.error(`NG: zh-TW にかなを含む値が ${hits.length} 件あります`);
  for (const hit of hits) console.error(`  - ${hit}`);
  process.exit(1);
}
console.log("OK: zh-TW の全ての文字列の値にひらがな・カタカナはありません");
