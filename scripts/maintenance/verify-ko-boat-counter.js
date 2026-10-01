#!/usr/bin/env node
/**
 * verify-ko-boat-counter.js — ko の「N号艇」が「N번 보트」にそろっているかを検査する（BOA-615）。
 *
 * ## なぜ機械検査にするか
 *
 * ko の「N号艇」は「N호정」「N번 정」「N번 보트」の3通りが混在していた。
 * 文言を足すたびに近くのキーの訳をまねるため、1つ残っていると再び増える。
 * glossary（docs/reference/i18n-glossary.md「韓国語（ko）の方針」）は「N번 보트」に決めている。
 *
 * ## 何を検査するか
 *
 * 次のファイルに、数字か `{{...}}` の直後の「호정」「번 정」「번정」が無いこと。
 * - src/locales/ko/ 配下の .json
 * - ko 専用ページ（src/pages/Ko*.jsx）
 * - ko ブログのメタデータ（src/data/blogPostsKo.js）
 *
 * ## 検査しないこと（意図的）
 *
 * - ko ブログの本文（public/blog/*-ko.md）。記事の改稿は content-qa の対象で別作業にする
 * - 艇の数の「{{count}}정」、競技名「경정」。数字＋번 の直後ではないので当たらない
 * - 「1번」だけで「보트」が無い表記。「1번」は「1回」等の意味もあり機械では判定できない
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * 数字か `}}` の直後の「호정」、または「번 정」「번정」。
 * 「번 정」の後ろがハングルなら別の語（「번 정리」「번 정도」）なので除き、
 * 助詞（이・은・의・을・과・으로・에・이나）だけは号艇の意味として当てる。
 */
const OLD_COUNTER =
  /(?:\d|\}\})\s*(?:호정|번\s?정(?=$|[^가-힣]|이|은|의|을|과|으로|에))/gu;

// パターン自体の歯の確認。ここが崩れると検査が黙って素通りになる。
const SHOULD_MATCH = [
  "1호정",
  "{{n}}호정",
  "{{boat}}번 정이",
  "1번정 승률",
  "{{number}}번 정",
];
const SHOULD_NOT_MATCH = [
  "1번 보트",
  "경정",
  "{{count}}정",
  "3번 정리",
  "1번 정도",
];
const selfTestFailures = [
  ...SHOULD_MATCH.filter((s) => !s.match(OLD_COUNTER)).map(
    (s) => `当たるべき「${s}」に当たらない`,
  ),
  ...SHOULD_NOT_MATCH.filter((s) => s.match(OLD_COUNTER)).map(
    (s) => `当たってはいけない「${s}」に当たる`,
  ),
];
if (selfTestFailures.length > 0) {
  console.error("NG: 検査パターンの自己テストに失敗");
  for (const f of selfTestFailures) console.error(`  - ${f}`);
  process.exit(1);
}

const localeDir = path.join(repoRoot, "src/locales/ko");
const pagesDir = path.join(repoRoot, "src/pages");
const targets = [
  ...readdirSync(localeDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(localeDir, f)),
  ...readdirSync(pagesDir)
    .filter((f) => /^Ko.*\.jsx$/.test(f))
    .map((f) => path.join(pagesDir, f)),
  path.join(repoRoot, "src/data/blogPostsKo.js"),
];

const hits = targets.flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(OLD_COUNTER)].map(
        (m) =>
          `${path.relative(repoRoot, file)}:${i + 1}: 「${m[0]}」 … ${line
            .slice(Math.max(0, m.index - 20), m.index + m[0].length + 10)
            .trim()}`,
      ),
    ),
);

if (hits.length > 0) {
  console.error(
    `NG: ko の「N号艇」に旧表記（호정・번 정・번정）が ${hits.length} 件残っています`,
  );
  for (const h of hits) console.error(`  - ${h}`);
  console.error("");
  console.error(
    "  「N번 보트」にそろえてください。助詞は 보트가・보트는・보트를・보트와・보트로（docs/reference/i18n-glossary.md）。",
  );
  process.exit(1);
}

console.log(
  `OK: ko の「N号艇」は「N번 보트」にそろっている（${targets.length}ファイル）`,
);
