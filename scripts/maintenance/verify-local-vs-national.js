#!/usr/bin/env node
/**
 * 出走表の当地勝率の下の「本人の全国勝率との差」 src/pure/localVsNational.js の回帰テスト。
 * 意味づけ（2026-11-28。勝率・2連率の「上位N割」はオーナーとファン役が表には不要とした）。DB 接続は不要。
 *
 * 守ること:
 *   - 差は 当地 − 全国 の小数2桁（丸めの向きで 0.01 ずれない）
 *   - 当地が 0.00（当地の出走なし）・値なしなら出さない（0 との差を「全国より低い」に化けさせない）
 *   - 全国が値なしでも出さない
 */
import { localVsNational } from "../../src/pure/localVsNational.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.log(`✗ ${name} ${detail}`);
  }
};

check("当地−全国は小数2桁", localVsNational("6.83", "6.31") === 0.52, String(localVsNational("6.83", "6.31")));
check("マイナスも小数2桁", localVsNational("4.93", "5.95") === -1.02, String(localVsNational("4.93", "5.95")));
check("当地 0.00 は出さない", localVsNational("0.00", "6.31") === null);
check("当地が空なら出さない", localVsNational("", "6.31") === null);
check("全国が空なら出さない", localVsNational("5.00", "") === null);

if (failed > 0) {
  console.log(`\n❌ verify-local-vs-national: ${failed}件失敗`);
  process.exit(1);
}
console.log("\n✅ verify-local-vs-national: 全件合格");
