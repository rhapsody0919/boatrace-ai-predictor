/**
 * docs/adr/ 配下のADR番号（ファイル名先頭4桁）の重複を検知する。
 * 複数セッション並行作業により、同じ番号のADRが繰り返し発生した実績があるため
 * （2026-09-01時点で0019/0020/0021/0022/0023×3/0024/0032/0043が重複）、
 * 新規ADR作成時・実装完了後の自動レビューで機械的に確認できるようにする。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADR_DIR = path.join(__dirname, "../../docs/adr");

async function main() {
  const files = await fs.readdir(ADR_DIR);
  const adrFiles = files.filter((f) => /^\d{4}-.+\.md$/.test(f));

  const byNumber = new Map();
  for (const f of adrFiles) {
    const number = f.slice(0, 4);
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(f);
  }

  const duplicates = [...byNumber.entries()].filter(
    ([, files]) => files.length > 1,
  );

  if (duplicates.length === 0) {
    const numbers = [...byNumber.keys()].sort();
    const maxNumber = numbers[numbers.length - 1];
    console.log(
      `OK: ADR番号の重複なし（${adrFiles.length}件、最大番号 ${maxNumber}）。次の新規ADRは ${String(Number(maxNumber) + 1).padStart(4, "0")} を使う。`,
    );
    return;
  }

  console.error(`NG: ADR番号の重複が${duplicates.length}件見つかりました。\n`);
  for (const [number, files] of duplicates) {
    console.error(`  ${number}:`);
    for (const f of files) {
      console.error(`    - ${f}`);
    }
  }
  console.error(
    "\n重複を解消するには、より新しい方（git logで作成日時が新しい方）を採番済みの最大番号+1にリネームし、" +
      "そのADRを参照している docs/design/ 配下のドキュメント・コード内コメントも合わせて更新すること。",
  );
  process.exit(1);
}

main();
