#!/usr/bin/env node
/**
 * まわり足が会場独自の計測で、他場と値の水準が違う会場の判定（src/utils/turnTimeVenues.js）の
 * 回帰テスト。DB 接続は不要。
 *
 * 守ること:
 *   - 住之江（12）・尼崎（13）・徳山（18）だけを対象にする（data-catalog E12）
 *   - 会場コードは "12" でも 12 でもよい
 *   - scripts/lib/boatcast/publicMap.js の ORITEN_PUBLIC_MAP で直線の項目が無い公開の会場（TWO）と一致する
 *     （src から scripts は読まないので定数を別に持つ。片方だけ変えると食い違う）。
 *     表は export を import して値で比べる（本文の字を正規表現で読まない）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISTINCT_TURN_TIME_VENUE_CODES,
  hasDistinctTurnTime,
} from "../../src/utils/turnTimeVenues.js";
import {
  ORITEN_LABELS,
  ORITEN_PUBLIC_MAP,
} from "../lib/boatcast/publicMap.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

check(
  "住之江・尼崎・徳山は対象（数値でも文字列でも）",
  [12, 13, 18, "12", "13", "18"].every((c) => hasDistinctTurnTime(c)),
);
check(
  "ほかの会場・空の値は対象外",
  [1, 3, 16, 21, 24, "02", null, undefined, ""].every(
    (c) => !hasDistinctTurnTime(c),
  ),
);

const twoVenues = Object.entries(ORITEN_PUBLIC_MAP)
  .filter(
    ([, v]) =>
      v.status === "public" && !v.items.includes(ORITEN_LABELS.straight),
  )
  .map(([code]) => Number(code))
  .sort((a, b) => a - b);
check(
  `publicMap.js の公開の会場で直線の項目が無い（TWO）会場と一致する（TWO: ${JSON.stringify(twoVenues)}）`,
  JSON.stringify(twoVenues) ===
    JSON.stringify([...DISTINCT_TURN_TIME_VENUE_CODES].sort((a, b) => a - b)),
);

// 注記の値の水準は「11〜12秒台」。「11秒台」と言い切ると、毎節出る12秒台の値（徳山は約9%）と
// 食い違った（#1222 ファン評価1周目）
const note = JSON.parse(
  readFileSync(path.join(root, "src/locales/ja/common.json"), "utf8"),
).beforeInfo.turnTimeVenueNote;
check(
  "注記の値の水準は「11〜12秒台」（「11秒台」と言い切らない）",
  note.includes("11〜12秒台") && !note.includes("（11秒台）"),
);

if (failures.length > 0) {
  console.error(`\nverify-turn-time-venues: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nverify-turn-time-venues: すべて成功");
