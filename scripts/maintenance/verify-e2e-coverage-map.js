#!/usr/bin/env node
/**
 * verify-e2e-coverage-map.js - 毎晩の全件で作る「spec → 動いた src のファイル」の表（scripts/lib/e2eCoverageMap.js、
 * scripts/maintenance/e2e-coverage-map.js、docs/design/ci-minutes-reduction/design.md 12章）の検証。
 * 固定の小さな束・source map・V8 coverage の入力で確かめる。ブラウザ・ネットワーク・vite build には触らない。
 *
 * 守るもの:
 *   - 呼ばれていない関数のファイルは外れ、動いた関数のファイルは入る
 *   - 束の上の関数（モジュールの評価、範囲が束の頭から終わりまで）は数えない（数えると全モジュールが全 spec に当たる）
 *   - 数えるのは関数の最初の範囲の startOffset だけ（中の分岐の範囲は使わない）
 *   - node_modules・仮想モジュール・マップに無い位置は入らない。source はリポジトリからの相対にする
 *   - 表の組み立て: 行の和（project・再試行をまたぐ）、自分で context を作る spec・行が無い spec・ファイルが空の spec は always
 *   - 何も取れなかったときは表を作らず落とす
 */
import { TraceMap } from "@jridgewell/trace-mapping";
import {
  buildCoverageMap,
  coveredSources,
  createsOwnContext,
  normalizeSource,
  offsetToPosition,
  lineStartsOf,
  parseCoverageRows,
  specsInList,
} from "../lib/e2eCoverageMap.js";
import { viteBuildArgs } from "./e2e-build.js";

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`✅ ${label}`);
  else {
    failures += 1;
    console.error(`❌ ${label}\n   期待 ${e}\n   実際 ${a}`);
  }
}

// --- source map の組み立て（VLQ） ---
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(n) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}
/** lines: 生成した各行の [genCol, srcIdx, srcLine, srcCol][] */
function encodeMappings(lines) {
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  return lines
    .map((segs) => {
      let genCol = 0;
      return segs
        .map(([gc, si, sl, sc]) => {
          const s =
            vlq(gc - genCol) +
            vlq(si - srcIdx) +
            vlq(sl - srcLine) +
            vlq(sc - srcCol);
          genCol = gc;
          srcIdx = si;
          srcLine = sl;
          srcCol = sc;
          return s;
        })
        .join(",");
    })
    .join(";");
}

// 束（4 行）。used / unused / lib / orphan の4つの関数を、それぞれ別の src に対応させる
const bundle = [
  "var top=1;function used(){return 1}",
  "function unused(){return 2}",
  "function fromLib(){return 3}",
  "function orphan(){return 4}",
  "",
].join("\n");
const at = (needle) => bundle.indexOf(needle);
const map = new TraceMap({
  version: 3,
  sources: [
    "../../src/used.js",
    "../../src/unused.js",
    "../../node_modules/x/index.js",
    "../../src/top.js",
  ],
  names: [],
  // 1 行目: 先頭（0 列）は top.js、used の関数は 10 列目から used.js
  mappings: encodeMappings([
    [
      [0, 3, 0, 0],
      [10, 0, 0, 0],
    ],
    [[0, 1, 0, 0]],
    [[0, 2, 0, 0]],
    [], // 4 行目は対応が無い（orphan）
  ]),
});

const whole = { startOffset: 0, endOffset: bundle.length, count: 1 };
const fn = (needle, count, extra = []) => ({
  functionName: needle,
  isBlockCoverage: true,
  ranges: [
    {
      startOffset: at(`function ${needle}`),
      endOffset: at(`function ${needle}`) + 20,
      count,
    },
    ...extra,
  ],
});
const entry = {
  url: "http://localhost/assets/index-abc.js",
  functions: [
    { functionName: "", isBlockCoverage: true, ranges: [whole] },
    fn("used", 2, [
      // 関数の中の分岐の範囲。最初の範囲だけを使うので、これが別の位置でも結果は変わらない
      {
        startOffset: at("function unused"),
        endOffset: at("function unused") + 5,
        count: 1,
      },
    ]),
    fn("unused", 0),
    fn("fromLib", 1),
    fn("orphan", 1),
  ],
};

check(
  "動いた関数のファイルは入り、呼ばれていない関数・node_modules・対応の無い位置・束の上の関数（top.js）は入らない",
  [...coveredSources(entry, bundle, map)].sort(),
  ["src/used.js"],
);
check(
  "束の上の関数だけの coverage は何も返さない（モジュールの評価を数えない）",
  [
    ...coveredSources(
      { url: entry.url, functions: [entry.functions[0]] },
      bundle,
      map,
    ),
  ],
  [],
);
check(
  "関数が呼ばれていれば（数が 1 以上）、unused の位置にある分岐の範囲は数えない",
  [
    ...coveredSources(
      {
        url: entry.url,
        functions: [
          fn("used", 1, [
            {
              startOffset: at("function unused"),
              endOffset: at("function unused") + 5,
              count: 3,
            },
          ]),
        ],
      },
      bundle,
      map,
    ),
  ],
  ["src/used.js"],
);
check(
  "全部呼ばれていない coverage は空",
  [
    ...coveredSources(
      { url: entry.url, functions: [fn("used", 0), fn("unused", 0)] },
      bundle,
      map,
    ),
  ],
  [],
);

// --- offset → 位置 ---
{
  const starts = lineStartsOf("ab\ncd\n\nef");
  check(
    "offset → 位置",
    [0, 2, 3, 6, 7, 8].map((o) => offsetToPosition(starts, o)),
    [
      { line: 1, column: 0 },
      { line: 1, column: 2 },
      { line: 2, column: 0 },
      { line: 3, column: 0 },
      { line: 4, column: 0 },
      { line: 4, column: 1 },
    ],
  );
}

// --- source の正規化 ---
check(
  "相対の source は dist/assets からの位置でリポジトリの相対にする",
  normalizeSource("../../src/a/B.jsx"),
  "src/a/B.jsx",
);
check(
  "リポジトリの src 以外でも中なら残す",
  normalizeSource("../../data/x.json"),
  "data/x.json",
);
check("クエリは落とす", normalizeSource("../../src/a.js?raw"), "src/a.js");
check(
  "node_modules は外す",
  normalizeSource("../../node_modules/react/index.js"),
  null,
);
check(
  "仮想モジュール（\\0）は外す",
  normalizeSource("\0vite/preload-helper.js"),
  null,
);
check("リポジトリの外は外す", normalizeSource("../../../elsewhere/a.js"), null);
check("source が無い位置は外す", normalizeSource(null), null);

// --- 表の組み立て ---
check(
  "自分で context を作る spec の検出",
  [
    "const c = await browser.newContext({});",
    "const p = await browser.newPage()",
    "async ({ page, browser }) => { await page.goto('/') }",
    "// newContext はコメントだけ",
  ].map(createsOwnContext),
  [true, true, false, false],
);
{
  const rows = parseCoverageRows([
    '{"spec":"a.spec.js","project":"smoke","title":"t1","files":["src/x.js","src/y.js"]}\n{"spec":"a.spec.js","project":"layout-mobile","title":"t2","files":["src/z.js","src/x.js"]}\n',
    '\n{"spec":"c.spec.js","project":"smoke","title":"t","files":[]}\n',
  ]);
  const built = buildCoverageMap({
    rows,
    specs: ["a.spec.js", "b.spec.js", "c.spec.js", "d.spec.js"],
    specTexts: {
      "a.spec.js": "await page.goto('/')",
      "b.spec.js": "await page.goto('/')",
      "c.spec.js": "await page.goto('/')",
      "d.spec.js": "const c = await browser.newContext()",
    },
    generatedAt: "2026-11-09T00:00:00.000Z",
    sha: "abc",
  });
  check("行の和を spec ごとに並べる（project・test をまたぐ）", built.specs, {
    "a.spec.js": ["src/x.js", "src/y.js", "src/z.js"],
  });
  check(
    "always: 行が無い spec・ファイルが空の spec・自分で context を作る spec",
    built.always,
    ["b.spec.js", "c.spec.js", "d.spec.js"],
  );
  check(
    "generatedAt と sha を持つ",
    [built.generatedAt, built.sha],
    ["2026-11-09T00:00:00.000Z", "abc"],
  );
  const withOwn = buildCoverageMap({
    rows: parseCoverageRows(['{"spec":"d.spec.js","files":["src/q.js"]}']),
    specs: ["d.spec.js"],
    specTexts: { "d.spec.js": "browser.newContext()" },
    generatedAt: "t",
    sha: "s",
  });
  check(
    "自分で context を作る spec は、行があっても always（取れた分は specs にも残す）",
    [withOwn.specs, withOwn.always],
    [{ "d.spec.js": ["src/q.js"] }, ["d.spec.js"]],
  );
}
{
  let message = "";
  try {
    buildCoverageMap({
      rows: [],
      specs: ["a.spec.js"],
      specTexts: { "a.spec.js": "" },
      generatedAt: "t",
      sha: "s",
    });
  } catch (error) {
    message = error.message;
  }
  check(
    "何も取れていなければ表を作らず落とす",
    /E2E_SOURCEMAP=1/.test(message),
    true,
  );
  let bad = "";
  try {
    parseCoverageRows(["{broken"]);
  } catch (error) {
    bad = error.message;
  }
  check(
    "壊れた jsonl は、何個目のファイルの何行目かを書いて落とす",
    /1 個目のファイルの 1 行目/.test(bad),
    true,
  );
}
check(
  "playwright --list の結果から spec のファイルを集める（入れ子・重複を畳む）",
  specsInList({
    suites: [
      {
        file: "b.spec.js",
        suites: [{ file: "b.spec.js", specs: [{ file: "b.spec.js" }] }],
      },
      { file: "a.spec.js", specs: [{ file: "a.spec.js" }] },
      { file: "dir/c.spec.js" },
    ],
  }),
  ["a.spec.js", "b.spec.js", "dir/c.spec.js"],
);

// --- build の引数（E2E_SOURCEMAP） ---
check(
  "E2E_SOURCEMAP=1 のときだけ hidden の source map を出す",
  [
    viteBuildArgs({ E2E_SOURCEMAP: "1" }),
    viteBuildArgs({}),
    viteBuildArgs({ E2E_SOURCEMAP: "0" }),
  ],
  [["--sourcemap", "hidden"], [], []],
);

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
