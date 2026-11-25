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
  judgeAgainstExceptions,
  newServicesFileProblems,
  newUtilsFileProblems,
} from "./lintBaselines.js";
import { baselineOfEdges, judgeDepTree } from "./lintDepTree.js";

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
  assert.ok(!isDataLayer("src/services/supabaseDataService.js"), "殻は RA40 で消えた");
  assert.ok(isDataLayer("src/services/coreHelpers.js"));
  assert.ok(isDataLayer("src/services/zzaQueries2.js"));
  assert.ok(!isDataLayer("src/services/other.js"));
  assert.ok(!isDataLayer("src/components/zzaQueries.js"));
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
    edge("src/services/zzaQueries.js", "src/hooks/useX.js"),
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

test("src/services の新しいファイルは <領域>Queries*.js だけ通す", () => {
  for (const ok of [
    "src/services/zzrQueries5.js",
    "src/services/zzbQueries.js",
    "src/services/zzvQueries12.js",
    "src/services/zzvQueries10.js",
    "src/utils/x.js",
    "src/pure/racerService.js",
  ]) {
    assert.deepEqual(newServicesFileProblems([ok]), [], ok);
  }
  for (const ng of [
    "src/services/dataService.js",
    "src/services/racerService.js",
    "src/services/core2.js",
    "src/services/ZzrQueries.js",
    "src/services/zzrQueries.ts",
    "src/services/zzrQueriesX.js",
    "src/services/xzzrQueries.js.bak",
    "src/services/racer/zzrQueries.js",
    "src/services/Queries.js",
    "src/services/racer-queries.js",
    "src/services/zzrQueries5.jsx",
  ]) {
    assert.equal(newServicesFileProblems([ng]).length, 1, ng);
  }
  assert.equal(
    newServicesFileProblems(["src/services/a.js", "src/services/aQueries.js", "src/services/b.js"]).length,
    2,
  );
  assert.deepEqual(newServicesFileProblems([]), []);
  assert.deepEqual(newServicesFileProblems(undefined), []);
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

// 規則の path・pathNot を dependency-cruiser と同じ読み方（to の $1 は from の1つ目の組）で当てる。試験だけの写し
const asList = (v) => (v === undefined ? [] : [v].flat());
function violates(rule, from, to) {
  const fm = asList(rule.from.path).map((re) => from.match(new RegExp(re))).find(Boolean);
  if (rule.from.path && !fm) return false;
  if (asList(rule.from.pathNot).some((re) => new RegExp(re).test(from))) return false;
  const sub = (re) => re.replace(/\$1/g, fm?.[1] ?? "");
  if (!asList(rule.to.path).some((re) => new RegExp(sub(re)).test(to))) return false;
  return !asList(rule.to.pathNot).some((re) => new RegExp(sub(re)).test(to));
}
const ruleOf = (name) =>
  require("./dependency-rules.cjs").forbidden.find((r) => r.name === name);

test("domain-direct: 領域の間の Queries は赤（prediction・meet も）、同じ領域は緑（2026-11-25 に締めた）", () => {
  const r = ruleOf("domain-direct");
  assert.equal(violates(r, "src/services/zzaQueries2.js", "src/services/zzaQueries.js"), false);
  assert.equal(violates(r, "src/services/zzaQueries2.js", "src/services/zzbQueries.js"), true);
  assert.equal(violates(r, "src/services/zzaQueries2.js", "src/services/predictionQueries99.js"), true);
  assert.equal(violates(r, "src/services/zzrQueries5.js", "src/services/meetQueries99.js"), true);
  assert.equal(violates(r, "src/services/zzaQueries2.js", "src/services/coreZz.js"), false);
});

test("pure-no-up: src/pure は自分と定数だけ", () => {
  const r = ruleOf("pure-no-up");
  for (const ok of ["src/pure/b.js", "src/constants/c.js", "src/config/zz.js", "src/data/d.js"]) {
    assert.equal(violates(r, "src/pure/a.js", ok), false, ok);
  }
  for (const ng of ["src/utils/x.js", "src/services/zzaQueries.js", "src/components/A.jsx", "src/locales/zz/zz.json"]) {
    assert.equal(violates(r, "src/pure/a.js", ng), true, ng);
  }
});

test("constants-no-up: 定数は定数だけ", () => {
  const r = ruleOf("constants-no-up");
  assert.equal(violates(r, "src/constants/a.js", "src/config/b.js"), false);
  assert.equal(violates(r, "src/data/a.js", "src/constants/b.js"), false);
  for (const from of ["src/constants/a.js", "src/config/a.js", "src/data/a.js"]) {
    assert.equal(violates(r, from, "src/pure/x.js"), true, from);
    assert.equal(violates(r, from, "src/utils/x.js"), true, from);
  }
});

test("node-to-src: scripts・api から src は pure・定数・訳だけ、試験は除く", () => {
  const r = ruleOf("node-to-src");
  for (const from of ["scripts/lib/a.js", "scripts/daily/b.js", "api/_lib/c.js", "api/cron/d.js", "middleware.js", "scripts/maintenance/fix-x.js"]) {
    assert.equal(violates(r, from, "src/pure/x.js"), false, from);
    assert.equal(violates(r, from, "src/locales/zz/zz.json"), false, from);
    assert.equal(violates(r, from, "src/utils/x.js"), true, from);
    assert.equal(violates(r, from, "src/services/zzaQueries.js"), true, from);
  }
  assert.equal(violates(r, "scripts/maintenance/verify-x.js", "src/services/zzaQueries.js"), false);
  assert.equal(violates(r, "scripts/maintenance/verifyData/x-scenes.js", "src/utils/x.js"), false);
  assert.equal(violates(r, "src/pages/P.jsx", "src/utils/x.js"), false);
});

test("新しい規則の境目: フォルダ名の前方一致で当てない・当て漏らさない", () => {
  const dd = ruleOf("domain-direct");
  assert.equal(violates(dd, "src/services/zzaQueries2.js", "src/services/zzaQueries10.js"), false, "同じ領域の番号違い");
  assert.equal(violates(dd, "src/services/zzaHelpers.js", "src/services/zzbQueries.js"), false, "Queries でない from は見ない");
  assert.equal(violates(dd, "src/services/zzaQueries.js", "src/services/zzaaQueries.js"), true, "名の前方一致は同じ領域でない");
  const pu = ruleOf("pure-no-up");
  assert.equal(violates(pu, "src/purely/a.js", "src/utils/x.js"), false, "src/pure/ の外");
  assert.equal(violates(pu, "src/pure/a.js", "src/pure-old/x.js"), true, "src/pure/ でない兄弟");
  assert.equal(violates(pu, "src/pure/a.js", "src/constantsX/x.js"), true);
  const co = ruleOf("constants-no-up");
  assert.equal(violates(co, "src/configs/a.js", "src/utils/x.js"), false, "src/config/ の外");
  assert.equal(violates(co, "src/data/a.js", "src/database/x.js"), true, "src/data/ でない兄弟");
  const nd = ruleOf("node-to-src");
  assert.equal(violates(nd, "apix/a.js", "src/utils/x.js"), false, "api/ の外");
  assert.equal(violates(nd, "src/a.js", "src/utils/x.js"), false, "src は見ない");
  assert.equal(violates(nd, "scripts/a.js", "src/pure-old/x.js"), true, "src/pure/ でない兄弟");
  assert.equal(violates(nd, "scripts/a.js", "srcx/utils/x.js"), false, "src/ の外");
  assert.equal(violates(nd, "scripts/maintenance/fix-verify-x.js", "src/utils/x.js"), true, "verify- で始まらない maintenance の CLI");
  assert.equal(violates(nd, "scripts/maintenance/sub/verify-x.js", "src/utils/x.js"), true, "maintenance の下のフォルダの verify は除かない");
  assert.equal(violates(nd, "middleware.js", "src/services/zzaQueries.js"), true);
  assert.equal(violates(nd, "xmiddleware.js", "src/services/zzaQueries.js"), false);
});

test("dependency-rules.cjs が読めて規則の名前が14個", () => {
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
      "ui-no-supabase-client",
      "api-no-ui-data",
      "lib-no-entry",
      "domain-direct",
      "pure-no-up",
      "constants-no-up",
      "node-to-src",
      "no-circular",
    ],
  );
});

test("baselineOfEdges は和の中の from を <data-layer> にまとめ、和の外はそのまま残す", () => {
  const to = "src/components/zz/zzStats.js";
  const base = baselineOfEdges([
    edge("src/services/zzaQueries.js", to),
    edge("src/services/zzaService.js", to),
  ]);
  assert.deepEqual(Object.keys(base["services-no-ui"]).sort(), [
    "<data-layer>",
    "src/services/zzaService.js",
  ]);
  assert.deepEqual(base["services-no-ui"]["<data-layer>"], [to]);
});

test("和の中で移しただけの辺は緑、base に無い to は赤", () => {
  const to = "src/components/zz/zzStats.js";
  const base = baselineOfEdges([edge("src/services/zzaQueries.js", to)]);
  assert.equal(
    compareEdgesToBaseline([edge("src/services/zzaQueries2.js", to)], base).ok,
    true,
  );
  assert.equal(
    compareEdgesToBaseline(
      [edge("src/services/zzaQueries2.js", "src/components/zz/Other.js")],
      base,
    ).ok,
    false,
  );
});

test("全体で0の関所: 例外の表に無い辺は赤、和の中でもまとめない、表の余りは stale（2026-11-25）", () => {
  const exc = { "node-to-src": { "api/_lib/a.js": ["src/utils/x.js"] } };
  const inTable = edge("api/_lib/a.js", "src/utils/x.js", "node-to-src");
  assert.deepEqual(judgeAgainstExceptions([inTable], exc), { ok: true, problems: [], stale: [] });
  // base との差の関所なら、master に一度入った辺は通った。全体で0では表に無ければ赤
  const r = judgeAgainstExceptions([inTable, edge("api/_lib/a.js", "src/utils/y.js", "node-to-src")], exc);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  const dl = { "services-no-ui": { "src/services/zzaQueries.js": ["src/pages/P.jsx"] } };
  assert.equal(
    judgeAgainstExceptions([edge("src/services/zzaQueries2.js", "src/pages/P.jsx")], dl).ok,
    false,
    "和の中で別のファイルから同じ先を読むのも表に要る",
  );
  assert.deepEqual(judgeAgainstExceptions([], exc).stale, ["node-to-src api/_lib/a.js src/utils/x.js"]);
  const twice = judgeAgainstExceptions([edge("api/_lib/b.js", "src/utils/x.js", "node-to-src"), edge("api/_lib/b.js", "src/utils/x.js", "node-to-src")], exc);
  assert.equal(twice.problems.length, 1, "同じ辺が2度出ても1件");
});

test("judgeDepTree: 表の余り・表の増え・循環は赤、base の表が無いときだけ増えを見ない", () => {
  const e1 = edge("api/_lib/a.js", "src/utils/x.js", "node-to-src");
  const exc = { "node-to-src": { "api/_lib/a.js": ["src/utils/x.js"] } };
  const ok = judgeDepTree({ headEdges: [e1], exceptions: exc, baseExceptions: exc });
  assert.deepEqual(ok, { errors: [], log: [] });
  const stale = judgeDepTree({ headEdges: [], exceptions: exc, baseExceptions: exc });
  assert.equal(stale.errors.length, 1, "直したのに表に行が残ると赤");
  const grown = judgeDepTree({ headEdges: [e1], exceptions: exc, baseExceptions: {} });
  assert.equal(grown.errors.length, 1, "base より表が増えたら赤");
  const first = judgeDepTree({ headEdges: [e1], exceptions: exc, baseExceptions: null });
  assert.equal(first.errors.length, 0);
  assert.equal(first.log.length, 1, "表を足す PR は増えを見ないと記録する");
  const cyc = judgeDepTree({
    headEdges: [e1, edge("src/a.js", "src/b.js", "no-circular")],
    exceptions: { ...exc, "no-circular": { "src/a.js": ["src/b.js"] } },
    baseExceptions: null,
  });
  assert.ok(cyc.errors.some((x) => x.startsWith("循環")), "循環は表に書いても赤");
});

test("例外の表 dependency-exceptions.json は形が正しく、行を足すと compareBaselines が赤", () => {
  const { edges } = require("./dependency-exceptions.json");
  const rules = require("./dependency-rules.cjs").forbidden.map((r) => r.name);
  for (const [rule, froms] of Object.entries(edges)) {
    assert.ok(rules.includes(rule) && rule !== "no-circular", rule);
    for (const tos of Object.values(froms)) assert.ok(Array.isArray(tos) && tos.length > 0);
  }
  const more = structuredClone(edges);
  more["node-to-src"]["api/_lib/new.js"] = ["src/utils/x.js"];
  assert.equal(compareBaselines(edges, more).ok, false);
});
