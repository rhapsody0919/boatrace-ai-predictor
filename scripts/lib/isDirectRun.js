/**
 * そのモジュールが `node <path>` で直接実行されたかを判定する。
 *
 * `scripts/daily/*.js` を Vercel Functions（`api/cron/*.js`）からも import して使うため、
 * import されただけのときに CLI の処理（argv の解析・`process.exit`）が走らないようにする。
 * ESM には CommonJS の `require.main === module` に相当する標準がないので、
 * `import.meta.url` と `process.argv[1]` を実パスで突き合わせる。
 *
 * 使い方:
 *   if (isDirectRun(import.meta.url)) { ... }
 */
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export function isDirectRun(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      realpathSync(fileURLToPath(importMetaUrl)) ===
      realpathSync(resolve(entry))
    );
  } catch {
    // 実行ファイルが消えている・シンボリックリンクが壊れている等。
    // 判定できないときは「直接実行ではない」に倒す（import 側で副作用を出さない）
    return false;
  }
}
