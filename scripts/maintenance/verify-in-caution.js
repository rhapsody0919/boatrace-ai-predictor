/**
 * BOA-822 イン崩れ注意度の検証（DB には繋がない）。
 *
 *   (a) 定義の1か所: JS の正（src/constants/inCautionConfig.js）と Python が読む src/data/inCautionConfig.json が同じ値。
 *       値の組と def を固定する（閾値・帯・期間を変えたら def を上げる。/accuracy の公開後の実績は同じ def の行だけを数える）
 *
 * 使い方: node scripts/maintenance/verify-in-caution.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IN_CAUTION_CONFIG } from "../../src/constants/inCautionConfig.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
// キーの順に依らない比較
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// ---------------------------------------------------------------- (a)
{
  const json = JSON.parse(
    fs.readFileSync(path.join(ROOT, "src/data/inCautionConfig.json"), "utf8"),
  );
  check(
    same(IN_CAUTION_CONFIG, json),
    "(a) src/constants/inCautionConfig.js と src/data/inCautionConfig.json が同じ値",
    `JS: ${JSON.stringify(canonical(IN_CAUTION_CONFIG))}\n   JSON: ${JSON.stringify(canonical(json))}`,
  );
  // 値の組を変えたのに def を上げ忘れると、/accuracy の公開後の実績に違う定義の行が混ざる
  const DEF_V1 = {
    def: "gapband-r-v1",
    thresholds: [35, 55],
    bandWidthCents: 50,
    bandMin: -8,
    bandMax: 6,
    from: "2019-04-01",
    minCellN: 100,
    lowSampleN: 300,
  };
  const pick = Object.fromEntries(
    Object.keys(DEF_V1).map((k) => [k, IN_CAUTION_CONFIG[k]]),
  );
  check(
    IN_CAUTION_CONFIG.def !== DEF_V1.def || same(pick, DEF_V1),
    "(a) def が gapband-r-v1 の間は、閾値・帯・期間・件数の下限が v1 の値のまま",
    JSON.stringify(pick),
  );
  check(
    Object.isFrozen(IN_CAUTION_CONFIG) &&
      Object.isFrozen(IN_CAUTION_CONFIG.thresholds) &&
      Object.isFrozen(IN_CAUTION_CONFIG.prelaunch),
    "(a) JS の定数は書き換えられない（freeze）",
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\n✅ すべての検査が通過");
