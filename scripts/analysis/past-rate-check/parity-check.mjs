/**
 * BOA-635 T0-1a: 判定式の二重実装の検査。定番／レアの線の検証（Python、label-threshold.py）と画面
 * （JS、src/utils/pastRate/count.js）が、同じ固定の行データで選択肢333通りすべて同じ件数・分母になるか。
 *
 * 固定データは、各形で差が線ちょうどの行（1段目・2段目、浮動小数で割れる組を含む）・要素の null・
 * 決まり手と払戻の欠け・前付け・配当の境界を含む。DB には接続しない。
 * 実行: PYTHON=<pandas の入った python> node scripts/analysis/past-rate-check/parity-check.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countPastRate } from "../../../src/utils/pastRate/count.js";
import { TECHNIQUE_NAMES } from "../../../src/utils/turnPrediction.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = [1, 2, 3, 4, 5, 6];
const r = (rank, tech, cb, st, pay) => ({
  race_id: "2026-09-01-01-01",
  race_date: "2026-09-01",
  rank1: rank[0],
  rank2: rank[1],
  rank3: rank[2],
  winning_technique: tech,
  course_by_boat: cb,
  st_by_course: st,
  payout_3tan: pay,
});
const ROWS = [
  r([1, 2, 3], "逃げ", W, [0.1, 0.15, 0.1, 0.12, 0.13, 0.14], 999), // 2コース凹み 0.05（0.15−0.10）
  r([1, 3, 2], "逃げ", W, [0.1, 0.18, 0.1, 0.12, 0.13, 0.14], 1000), // 2コース凹み 0.08
  r([3, 1, 4], "まくり", W, [0.21, 0.16, 0.17, 0.18, 0.19, 0.2], 9999), // イン凹み 0.05（0.21−0.16）
  r([4, 1, 2], "まくり", W, [0.13, 0.13, 0.13, 0.1, 0.14, 0.14], 10000), // カド一撃 0.03
  r([4, 2, 1], "まくり差し", W, [0.15, 0.15, 0.15, 0.1, 0.16, 0.16], 23000), // カド一撃 0.05
  r([5, 4, 1], "まくり", W, [0.23, 0.23, 0.23, 0.15, 0.15, 0.15], 88000), // ダッシュ勢先行 0.24
  r([2, 1, 3], "差し", W, [0.2, 0.2, 0.2, 0.15, 0.15, 0.15], 2500), // ダッシュ勢先行 0.15
  r([3, 4, 5], null, [1, 2, 4, 3, 5, 6], [0.1, 0.1, 0.18, 0.1, 0.12, 0.12], null), // カド受け凹み 0.08、決まり手・払戻なし、前付け
  r([1, 4, 3], "逃げ", [2, 1, 3, 4, 6, 5], [0.29, 0.23, 0.23, 0.23, 0.23, 0.23], 1900), // 自分で作る 30 ちょうど
  r([6, 1, 2], "抜き", [1, 2, 3, 4, null, 6], [0.14, 0.2, 0.2, 0.2, 0.2, 0.2], 51000), // 自分で作る 出る 30 ちょうど
  r([1, 5, 6], "逃げ", W, [0.15, 0.15, null, null, 0.15, 0.15], 3000), // 同じコースに2艇（要素の null）
  r([2, 3, 1], "差し", W, [0.1, 0.16, 0.12, 0.13, 0.14, 0.15], 4800), // 横一線 0.06 ちょうど
];

const TECH_KEY = Object.fromEntries(Object.entries(TECHNIQUE_NAMES).map(([k, v]) => [v, k]));

/** Python の選択肢 → JS の型と入力 */
function toJs(o) {
  const x = o.opt;
  switch (o.sub) {
    case "order_single":
    case "order_nagashi":
      return ["order", { first: x.a[0], second: x.b, third: x.c, nagashi: o.sub === "order_nagashi" }];
    case "boat1":
      return ["boat1", { outcome: { win: "win", stay: "top3", out: "out" }[x.v] }];
    case "tenkai":
      return ["tenkai", { boat: x.b, technique: TECH_KEY[x.t] }];
    case "slit_form":
      return ["slit", { mode: "pattern", patterns: x.forms, level: x.s }];
    case "slit_custom": {
      const courses = [0, 0, 0, 0, 0, 0];
      for (const [k, d] of x.spec) courses[k - 1] = d === "out" ? 1 : -1;
      return ["slit", { mode: "custom", courses }];
    }
    case "entry":
      return ["entry", { boat: x.b, target: { in3: "within3", in4: "within4", waku: "waku" }[x.v] }];
    default:
      return ["payout", { band: { kata: "low", chuana: "mid", manshu: "high" }[x.v] }];
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "past-rate-parity-"));
const file = path.join(tmp, "rows.json");
fs.writeFileSync(file, JSON.stringify(ROWS));
const py = JSON.parse(
  execFileSync(process.env.PYTHON ?? "python3", [path.join(HERE, "parity_py.py"), file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
fs.rmSync(tmp, { recursive: true, force: true });

let bad = 0;
for (const o of py.options) {
  const [type, input] = toJs(o);
  const js = countPastRate(ROWS, type, input);
  if (js.count !== o.count || js.n !== o.n) {
    bad++;
    console.error(`❌ ${o.sub} ${o.key}: Python ${o.count}/${o.n}、JS ${js.count}/${js.n}`);
  }
}
const hits = py.options.filter((o) => o.count > 0).length;
console.log(`選択肢 ${py.options.length} 通り（1件以上一致 ${hits}）、固定データ ${ROWS.length} 行`);
console.log(bad === 0 ? "✅ Python と JS の件数・分母がすべて一致" : `❌ ${bad} 通りで食い違い`);
process.exit(bad === 0 ? 0 : 1);
