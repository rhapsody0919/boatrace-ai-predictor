#!/usr/bin/env node
/**
 * データ健全性の日次監視のDB関数（scripts/lib/dataHealth/functions.js）のDDLを、標準出力に出す。
 * マイグレーションに貼るためのもの（関数のSQLの正本は functions.js。手で書き写さない）。
 *
 * 使い方:
 *   node scripts/maintenance/render-data-health-functions.js <関数名...>
 *   node scripts/maintenance/render-data-health-functions.js --migration 089_data_health_functions.sql
 *     （そのマイグレーションに載せる関数（functions.js の migration が一致するもの）を、すべて出す）
 */
import { pathToFileURL } from "node:url";
import {
  DATA_HEALTH_FUNCTIONS,
  functionByName,
  renderFunctionDdl,
} from "../lib/dataHealth/functions.js";

export function selectFunctions(argv) {
  if (argv[0] === "--migration") {
    const file = argv[1];
    if (!file) throw new Error("--migration にはファイル名が必要です");
    const fns = DATA_HEALTH_FUNCTIONS.filter((f) => f.migration === file);
    if (fns.length === 0)
      throw new Error(`マイグレーション ${file} に載せる関数がありません`);
    return fns;
  }
  if (argv.length === 0)
    throw new Error("関数名（または --migration）が必要です");
  return argv.map((name) => {
    const fn = functionByName(name);
    if (!fn) throw new Error(`未登録の関数です: ${name}`);
    return fn;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const fns = selectFunctions(process.argv.slice(2));
    process.stdout.write(
      fns.map((fn) => `-- ${fn.name}\n${renderFunctionDdl(fn)}`).join("\n"),
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
