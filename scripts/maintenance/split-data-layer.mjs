#!/usr/bin/env node
/**
 * split-data-layer.mjs - src/services/supabaseDataService.js を領域ごとのファイルへ字のまま移す（BOA-1432、RA02a）。
 * 設計: hq の drafts/ryujin-target-architecture-20261110.md §3・§5.3（RA02・RA10〜13）。中身は scripts/maintenance/splitDataLayer/
 *
 *   node scripts/maintenance/split-data-layer.mjs <領域…>   指定の領域を移して書く（例: core schedule）
 *   node scripts/maintenance/split-data-layer.mjs --report  書かずに、殻に残る物を領域ごとに数える
 *
 * 決まった出力（判断を入れない）:
 * - メソッド `async getX(a) { … }` → `export async function getX(a) { … }`。本体の字・字下げはそのまま、
 *   本体の `this.getY` は `getY`（別のファイルの物は名前付き import）。前の注釈はメソッドの字下げだけ外す
 * - 上の単位（関数・定数）は字のまま。領域は使うメソッドから導く（1つの領域だけが使えばその領域、2つ以上・0 は core）。
 *   別のファイルから使う物にだけ `export ` を足す。メソッドが同じ名前の上の関数を呼ぶだけなら、メソッドは消して上の関数を使う
 * - ファイル: core は core.js・core2.js…、ほかは <領域>Queries.js・<領域>Queries2.js…。並びは同じ領域で使う先を先に、
 *   ほかは元の順（上の単位→メソッド）。2つ以上の単位を持つファイルが 400 行を越える手前で次のファイルへ（1単位で越える物は1ファイル）
 * - 殻（supabaseDataService.js）: 移したメソッドは `getX,` と import、移した名前付き export は再 export、残りは字のまま、
 *   使わなくなった import は外す。何回かに分けて回してよい（core は最初の回に入れる）
 * - 止める（何も書かない）: 表に無い・表にあって元に無いメソッド、既に移した領域、同じ名前のファイルが既にある、
 *   this のほかの使い方、まだ移していない領域を使う、別の領域の Queries を読む（prediction・meet は許す、
 *   dependency-rules.cjs の domain-direct）、ファイルの間の循環、書いた後の AST hash が元と合わない
 * - 移した単位の対応表（単位名・先のファイル・AST hash）を標準出力へ（PR の本文に貼る）
 *
 * import しても CLI は走らない（直に起動したときだけ main）。
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { planSplit, reportSplit } from "./splitDataLayer/plan.js";
import { AREAS, SERVICE_FILE } from "./splitDataLayer/table.js";

export { planSplit, reportSplit };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const table = (head, rows) => [head, head.replace(/[^|]+/g, "---"), ...rows].join("\n");

export function main(argv, root = ROOT) {
  const dir = path.join(root, "src/services");
  const file = path.join(dir, SERVICE_FILE);
  const source = readFileSync(file, "utf8");
  if (argv.includes("--report")) {
    const rows = Object.entries(reportSplit(source)).map(
      ([a, r]) => `| ${a} | ${r.methods} | ${r.units} | ${r.lines} |`,
    );
    console.log(table("| 領域 | メソッド | 上の単位 | 行 |", rows));
    return 0;
  }
  const areas = argv.filter((a) => !a.startsWith("--"));
  if (areas.length === 0) {
    console.error("使い方: node scripts/maintenance/split-data-layer.mjs <領域…> | --report");
    return 2;
  }
  // 領域の順は表の順にそろえる（渡す順で出力が変わらない）
  const order = [...AREAS.filter((a) => areas.includes(a)), ...areas.filter((a) => !AREAS.includes(a))];
  const plan = planSplit(source, order, { existingFiles: readdirSync(dir) });
  for (const [f, text] of Object.entries(plan.files)) writeFileSync(path.join(dir, f), text);
  writeFileSync(file, plan.facade);
  const rows = plan.mapping.map((r) => `| ${r.name} | ${r.file} | ${r.hash} |`);
  console.log(table("| 単位 | 先のファイル | AST hash |", rows));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`split-data-layer: ${e.message}`);
    process.exitCode = 1;
  }
}
