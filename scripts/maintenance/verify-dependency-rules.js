/**
 * 依存の向きの関所の部品（BOA-1428）。lintBaselines.js の純関数を固定の入力で試し、
 * dependency-rules.cjs が読めて規則の名前がそろっていることを見る。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  isDataLayer,
  compareEdgesToBaseline,
  compareBaselines,
  newUtilsFileProblems,
  facadeShouldBeError,
} from "./lintBaselines.js";
import { baselineOfEdges } from "./lintDepTree.js";

const require = createRequire(import.meta.url);

const edge = (from, to, rule = "services-no-ui") => ({ rule, from, to });
// 和は from を "<data-layer>" 1つにまとめた基準
const baseline = {
  "services-no-ui": {
    "<data-layer>": ["src/hooks/useX.js", "src/pages/P.jsx"],
    "src/services/other.js": ["src/components/A.jsx"],
  },
};

test("データ層の和に当たるファイル", () => {
  assert.ok(isDataLayer("src/services/supabaseDataService.js"));
  assert.ok(isDataLayer("src/services/coreHelpers.js"));
  assert.ok(isDataLayer("src/services/raceQueries2.js"));
  assert.ok(!isDataLayer("src/services/other.js"));
  assert.ok(!isDataLayer("src/components/raceQueries.js"));
});

test("基準の辺だけなら緑", () => {
  const r = compareEdgesToBaseline(
    [edge("src/services/other.js", "src/components/A.jsx")],
    baseline,
  );
  assert.equal(r.ok, true);
});

test("基準に無い辺は赤", () => {
  const r = compareEdgesToBaseline(
    [edge("src/services/other.js", "src/pages/Z.jsx")],
    baseline,
  );
  assert.equal(r.ok, false);
  const r2 = compareEdgesToBaseline(
    [edge("src/services/new.js", "src/pages/Z.jsx")],
    baseline,
  );
  assert.equal(r2.ok, false);
});

test("データ層の和の中で関数を別ファイルへ移した辺は緑", () => {
  const moved = [
    edge("src/services/raceQueries.js", "src/hooks/useX.js"),
    edge("src/services/coreNew.js", "src/pages/P.jsx"),
  ];
  assert.equal(compareEdgesToBaseline(moved, baseline).ok, true);
  const over = [edge("src/services/coreNew.js", "src/pages/Other.jsx")];
  assert.equal(compareEdgesToBaseline(over, baseline).ok, false);
});

test("src/utils の新しいファイルは赤", () => {
  assert.equal(newUtilsFileProblems(["src/utils/new.js"]).length, 1);
  assert.deepEqual(newUtilsFileProblems(["src/lib/new.js"]), []);
  assert.deepEqual(newUtilsFileProblems([]), []);
});

test("基準の行を足すと赤、減ると better", () => {
  const more = structuredClone(baseline);
  more["services-no-ui"]["<data-layer>"].push("src/pages/New.jsx");
  const up = compareBaselines(baseline, more);
  assert.equal(up.ok, false);
  assert.equal(up.added.length, 1);
  const less = structuredClone(baseline);
  less["services-no-ui"]["<data-layer>"].pop();
  const down = compareBaselines(baseline, less);
  assert.equal(down.ok, true);
  assert.equal(down.better.length, 1);
  assert.equal(compareBaselines(baseline, baseline).better.length, 0);
});

test("facade-frozen を error にする条件は関数の本体0", () => {
  assert.equal(facadeShouldBeError(0), true);
  assert.equal(facadeShouldBeError(3), false);
});

test("dependency-rules.cjs が読めて規則の名前が10個", () => {
  const { forbidden, DEPENDENCY_CRUISER } = require("./dependency-rules.cjs");
  assert.match(DEPENDENCY_CRUISER, /^dependency-cruiser@\d+\.\d+\.\d+$/);
  assert.deepEqual(
    forbidden.map((r) => r.name),
    [
      "services-no-ui",
      "utils-no-up",
      "hooks-no-ui",
      "components-no-pages",
      "src-no-node",
      "api-no-ui-data",
      "lib-no-entry",
      "domain-direct",
      "facade-frozen",
      "no-circular",
    ],
  );
  assert.equal(forbidden.find((r) => r.name === "facade-frozen").severity, "warn");
});

test("baselineOfEdges は和の中の from を <data-layer> にまとめ、和の外はそのまま残す", () => {
  const to = "src/components/race/basicInfoStats.js";
  const base = baselineOfEdges([
    edge("src/services/supabaseDataService.js", to),
    edge("src/services/raceService.js", to),
  ]);
  assert.deepEqual(Object.keys(base["services-no-ui"]).sort(), [
    "<data-layer>",
    "src/services/raceService.js",
  ]);
  assert.deepEqual(base["services-no-ui"]["<data-layer>"], [to]);
});

test("和の中で移しただけの辺は緑、base に無い to は赤", () => {
  const to = "src/components/race/basicInfoStats.js";
  const base = baselineOfEdges([edge("src/services/supabaseDataService.js", to)]);
  assert.equal(
    compareEdgesToBaseline([edge("src/services/raceQueries2.js", to)], base).ok,
    true,
  );
  assert.equal(
    compareEdgesToBaseline(
      [edge("src/services/raceQueries2.js", "src/components/race/Other.js")],
      base,
    ).ok,
    false,
  );
});
