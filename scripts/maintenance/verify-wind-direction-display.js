/**
 * verify-wind-direction-display.js - 画面の風向を本当の方位に直す表（BOA-819、src/utils/windDirection.js）
 *
 * 守るもの:
 *   - 画面の表（VENUE_WIND_OFFSET_DEG）が、龍神ソナーのモデルが使う表（scripts/ml/analogy/wind_basis.json の
 *     offsets_deg）と24場すべてで同じ。片方だけ直すと、画面とモデルで同じレースの風向が別になる
 *   - 直し方の向き（DB の角度から引く）。徳山 2026-10-06 10R は DB「北西」、公式の直前情報の図（方位マーク
 *     is-direction7・風 is-wind15）では北から吹く風 → 「北」
 *   - 16方位でない値（無風）はそのまま、会場が分からなければ null（ずれた方位を出さない）
 *
 * 実行: node scripts/maintenance/verify-wind-direction-display.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VENUE_WIND_OFFSET_DEG,
  WIND_DIRECTIONS,
  trueWindDirection,
} from "../../src/utils/windDirection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const basis = JSON.parse(
  fs.readFileSync(path.join(here, "../ml/analogy/wind_basis.json"), "utf8"),
).offsets_deg;

let failures = 0;
const check = (label, pass, detail = "") => {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};

const diffs = [];
for (let v = 1; v <= 24; v++)
  if (VENUE_WIND_OFFSET_DEG[v] !== basis[String(v)])
    diffs.push(
      `${v}: 画面 ${VENUE_WIND_OFFSET_DEG[v]} / モデル ${basis[String(v)]}`,
    );
check(
  "24場の角度が wind_basis.json の offsets_deg と同じ",
  diffs.length === 0 && Object.keys(basis).length === 24,
  diffs.join(", "),
);
check(
  "徳山（18）の DB「北西」は北（公式の直前情報 2026-10-06 10R の図と同じ）",
  trueWindDirection("北西", 18) === "北",
);
check(
  "回転0の会場（多摩川 5・常滑 8）は DB の値のまま",
  WIND_DIRECTIONS.every(
    (d) => trueWindDirection(d, 5) === d && trueWindDirection(d, "08") === d,
  ),
);
check(
  "桐生（1、112.5°）: DB「東南東」（112.5°）は北",
  trueWindDirection("東南東", 1) === "北",
);
check(
  "無風はそのまま、会場が分からない・空は null",
  trueWindDirection("無風", 18) === "無風" &&
    trueWindDirection("北西", 99) === null &&
    trueWindDirection("北西", null) === null &&
    trueWindDirection("", 18) === null,
);

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
