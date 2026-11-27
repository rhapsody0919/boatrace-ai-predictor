#!/usr/bin/env node
/**
 * 枠別情報の6艇のコース別成績の注記が、棒と行の色の意味を実装どおりに書き分けていることの検査（灰色の棒＝差がはっきりしない、点線の枠＝走数が少ない、走数が少ない行は数字が灰色）。DB 接続は不要。
 *
 * 2026-11-27 の記事の審査で、注記の「走数が少ない艇は灰色」を読んだ人が、灰色の棒（偶然のぶれと区別できない差）と
 * 取り違えた。実装は CompareBar.css（--unclear が灰の棒、--few が点線の枠）と SixBoatCourseTable.css（is-muted の行の数字が灰）。
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const ja = JSON.parse(read("src/locales/ja/common.json"));

const findKey = (obj, key) => {
  if (obj && typeof obj === "object") {
    if (typeof obj[key] === "string") return obj[key];
    for (const v of Object.values(obj)) {
      const hit = findKey(v, key);
      if (hit) return hit;
    }
  }
  return null;
};

const errors = [];
const expectIn = (label, text, needle) => {
  if (!text?.includes(needle)) errors.push(`${label} に「${needle}」が無い`);
};

const css = read("src/components/dataDisplay/CompareBar.css");
const tableCss = read("src/components/race/SixBoatCourseTable.css");
if (!/\.compare-bar--unclear \.compare-bar__bar \{[^}]*--text-secondary/.test(css))
  errors.push("CompareBar.css の --unclear の棒が灰（--text-secondary）でない。注記と実装を合わせ直す");
if (!/\.compare-bar--few \.compare-bar__bar \{[^}]*dashed/.test(css))
  errors.push("CompareBar.css の --few の棒が点線の枠でない。注記と実装を合わせ直す");
if (!/\.is-muted[^{]*\{[^}]*--text-secondary/.test(tableCss))
  errors.push("SixBoatCourseTable.css の is-muted の行の数字が灰でない。注記と実装を合わせ直す");

const diffBar = findKey(ja, "noteDiffBar");
const sample = findKey(ja, "noteSample");
expectIn("noteDiffBar", diffBar, "灰色の棒は、偶然のぶれと区別できない差");
expectIn("noteDiffBar", diffBar, "点線の枠は、進入数が少なく差を出さない艇");
expectIn("noteSample", sample, "行の数字を灰色にして差を出しません");

if (errors.length) {
  for (const e of errors) console.error(`NG: ${e}`);
  process.exit(1);
}
console.log("OK: 枠別の注記は、灰色の棒・点線の枠・灰色の行の数字を書き分けている");
