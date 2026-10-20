/**
 * verify-relative-imports.js - scripts/・api/ の相対 import（`from "./..."`・`from "../..."`）の参照先が実在するかの検査（BOA-536）。
 *
 * scripts/ 直下から scripts/maintenance/・scripts/analysis/ へ移したスクリプトのうち、
 * `./lib/...` の import を直さないまま残っていたものが9本あり、実行すると import で落ちる状態だった
 * （backfill-trifecta-trio.js 等）。手動実行のスクリプトは CI で走らないため、壊れていても気づけない。
 * ファイルを読むだけで、スクリプト本体は実行しない（DBにも接続しない）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const TARGET_DIRS = ["scripts", "api"];
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g;

// 変異テスト（verify-race-result-parser.js 等）が実行中に scripts/lib に置いて消す一時ファイル。
// verify:ci は並列に走るので、一覧に入っても読む前に消えている（2026-10-20、BOA-938 の並べ替えで隣に並んで落ちた）
const isTransient = (name) => /\.tmp\.m?js$/.test(name);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : walk(full);
    }
    return /\.m?js$/.test(entry.name) && !isTransient(entry.name) ? [full] : [];
  });
}

// 一時ファイルの判定の自己検査（外すと並列の CI で読む前に消えて落ちる）
for (const [name, want] of [
  ["raceResultParser.mutant-7316-11.tmp.mjs", true],
  ["x.tmp.js", true],
  ["raceResultParser.js", false],
  ["tmp.mjs", false],
]) {
  if (isTransient(name) !== want) {
    console.error(`❌ 一時ファイルの判定が違う: ${name} → ${!want}`);
    process.exit(1);
  }
}

const broken = [];
for (const dir of TARGET_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch (err) {
      // 一覧の後に消えたファイル（ほかの検査の一時ファイル）は検査の対象でない
      if (err.code === "ENOENT") continue;
      throw err;
    }
    for (const match of source.matchAll(IMPORT_RE)) {
      const target = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(target)) {
        broken.push(`${path.relative(ROOT, file)} -> ${match[1]}`);
      }
    }
  }
}

if (broken.length > 0) {
  console.error(`❌ 参照先が存在しない相対 import: ${broken.length}件`);
  for (const line of broken) console.error(`  ${line}`);
  process.exit(1);
}
console.log("✅ scripts/・api/ の相対 import は、すべて参照先が存在する");
