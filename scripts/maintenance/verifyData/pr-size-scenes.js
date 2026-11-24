/**
 * verify-pr-size.js の場面（純関数の数え方と、試験のファイルに本体を置いた変異）。verify ではない。
 * check は verify 側の物を受け取る（失敗の数は verify が数える）。
 */
import { SIZE_LIMIT, measurePrSize } from "../prSize.js";

let check;

const n = (k, f = (i) => `const v${i} = ${i};`) =>
  Array.from({ length: k }, (_, i) => f(i));
/** 純関数の入力: files は [status, path, added, removed?] */
const input = (files, texts = {}) => ({
  changes: files.map(([status, p]) => ({ status, path: p })),
  patches: new Map(
    files
      .filter(([, , added]) => added !== null)
      .map(([, p, added, removed = []]) => [p, { added, removed }]),
  ),
  readText: (side, p) => texts[`${side}:${p}`] ?? null,
});
const size = (files, texts, extra = {}) =>
  measurePrSize({ ...input(files, texts), ...extra });
const skippedPaths = (r) => r.skipped.map((s) => s.path).sort();

function scenePureTests() {
  const r = size([
    ["A", "e2e/venue-x.spec.js", n(200)],
    ["A", "scripts/maintenance/verify-x.js", n(150)],
    ["A", "src/components/venue/X.jsx", n(100)],
  ]);
  check(
    "新しい e2e の spec と verify は数えない",
    r.lines === 100 && r.files === 1,
    JSON.stringify(r),
  );

  const helper = size([
    ["A", "e2e/helpers/venue.js", n(10)],
    ["A", "scripts/maintenance/verifyData/x-scenes.js", n(10)],
    ["M", "e2e/venue.spec.js", n(10)],
    ["M", "scripts/maintenance/verify-y.js", n(10)],
  ]);
  check(
    "e2e の helper・verifyData・既存の試験の変更は数える",
    helper.lines === 40 && helper.files === 4,
    JSON.stringify(helper),
  );

  const reg = "scripts/maintenance/verify-registry.json";
  const regAdd = size([
    [
      "M",
      reg,
      ["    {", '      "script": "verify-x.js",', "    },"],
      ["    }"],
    ],
  ]);
  check(
    "台帳の行の追加だけは数えない（前の行の } が }, になるのは追加）",
    regAdd.lines === 0 && regAdd.files === 0,
    JSON.stringify(regAdd),
  );
  const regChange = size([
    ["M", reg, ['      "tier": "manual",'], ['      "tier": "ci",']],
  ]);
  check(
    "台帳の既存の行の変更は数える",
    regChange.lines === 1,
    JSON.stringify(regChange),
  );
}

function scenePureNotes() {
  const notes = size([
    [
      "M",
      "src/a.js",
      [
        "// 注釈",
        " * 注釈",
        "/* 注釈 */",
        "  {/* 注釈 */}",
        "",
        "   ",
        "const a = 1;",
      ],
    ],
    ["M", "src/a.css", ["/* 注釈 */", ".a { color: red; }"]],
    ["M", "docs/a.md", ["* 箇条書き", "// 本文", ""]],
  ]);
  check(
    "コードの注釈と空行は数えない、md の * や // で始まる行は数える",
    notes.lines === 4 &&
      notes.counted.find((c) => c.path === "docs/a.md")?.lines === 2,
    JSON.stringify(notes.counted),
  );

  const removedOnly = size([
    ["M", "src/b.js", [], n(400)],
    ["D", "src/c.js", null],
    ["M", "src/d.js", ["const d = 2;"], ["const d = 1;"]],
  ]);
  check(
    "消しただけの行・消したファイルは数えない（書き換えは足した行を数える）",
    removedOnly.lines === 1 && removedOnly.files === 1,
    JSON.stringify(removedOnly),
  );

  const noBody = size([
    ["A", "public/images/a.png", null],
    ["R", "src/moved.js", null],
  ]);
  check(
    "行の無い差分（バイナリ・改名だけ）はファイルに数える",
    noBody.files === 2 && noBody.lines === 0,
    JSON.stringify(noBody),
  );
}

function scenePureLocale() {
  const ja = "src/locales/ja/venue.json";
  const en = "src/locales/en/venue.json";
  const ko = "src/locales/ko/venue.json";
  const zh = "src/locales/zh-TW/venue.json";
  const texts = {
    [`base:${ja}`]: '{"a":"あ"}',
    [`head:${ja}`]: '{"a":"あ","b":{"c":"レース選択へ"}}',
    [`base:${en}`]: '{"a":"A"}',
    [`head:${en}`]: '{"a":"A","b":{"c":"To races"}}',
    [`base:${ko}`]: '{"a":"A"}',
    [`head:${ko}`]: '{"a":"A","b":{"c":"x","d":"y"}}',
    [`base:${zh}`]: '{"a":"A"}',
    [`head:${zh}`]: '{"a":"B","b":{"c":"x"}}',
  };
  const loc = size(
    [
      [
        "M",
        ja,
        ['  "a": "あ",', '  "b": { "c": "レース選択へ" }'],
        ['  "a": "あ"'],
      ],
      ["M", en, ['  "a": "A",', '  "b": { "c": "To races" }'], ['  "a": "A"']],
      [
        "M",
        ko,
        ['  "a": "A",', '  "b": { "c": "x", "d": "y" }'],
        ['  "a": "A"'],
      ],
      ["M", zh, ['  "a": "B",', '  "b": { "c": "x" }'], ['  "a": "A"']],
    ],
    texts,
  );
  check(
    "ja と同じキーを足しただけの他の locale は数えない（ja・キーの違う ko・既存の値を変えた zh-TW は数える）",
    JSON.stringify(skippedPaths(loc)) === JSON.stringify([en]) &&
      loc.files === 3,
    JSON.stringify(loc.skipped),
  );
  const noJa = size(
    [["M", en, ['  "a": "A",', '  "b": { "c": "To races" }'], ['  "a": "A"']]],
    texts,
  );
  check(
    "同じ PR に ja が無い locale の追加は数える",
    noJa.lines === 2,
    JSON.stringify(noJa),
  );
}

function scenePureLimit() {
  const at = (lines, files) =>
    size(
      Array.from({ length: files }, (_, i) => [
        "A",
        `src/f${i}.js`,
        n(i === 0 ? lines - files + 1 : 1),
      ]),
    );
  check(
    "300行・5ファイルは線の中",
    !at(300, 5).over && at(300, 5).lines === 300,
  );
  check("301行は超える", at(301, 5).over);
  check("6ファイルは超える", at(10, 6).over);
  check(
    "線は 300行・5ファイル",
    SIZE_LIMIT.lines === 300 && SIZE_LIMIT.files === 5,
  );

  const big = [
    ["A", "src/big.js", n(500)],
    ["M", "src/other.js", n(10)],
  ];
  const content = size(big, {}, { contentPr: true });
  check(
    "記事の PR は線の外",
    content.exempt !== null && !content.over && content.lines === 0,
  );
  const allMoved = size(
    big,
    {},
    { moved: new Set(["src/big.js", "src/other.js"]) },
  );
  check(
    "差分の全部が移すだけなら線の外",
    allMoved.exempt !== null && !allMoved.over,
  );
  const partMoved = size(big, {}, { moved: new Set(["src/big.js"]) });
  check(
    "移すだけでないファイルが1つでもあれば全部数える",
    partMoved.exempt === null && partMoved.over && partMoved.lines === 510,
  );
}

function sceneMutation() {
  const body = n(250, (i) => `export const rule${i} = (x) => x + ${i};`);
  for (const [label, test, spec] of [
    [
      "verify に本体（src から import）",
      "scripts/maintenance/verify-rules.js",
      'import { rule1 } from "../../scripts/maintenance/verify-rules.js";',
    ],
    [
      "verify に本体（拡張子を省いた import）",
      "scripts/maintenance/verify-rules.js",
      "import { rule1 } from '../maintenance/verify-rules';",
    ],
    [
      "spec に本体（require）",
      "e2e/rules.spec.js",
      'const { rule1 } = require("../e2e/rules.spec.js");',
    ],
    [
      "verify に本体（new URL）",
      "scripts/maintenance/verify-rules.js",
      'const u = new URL("./verify-rules.js", import.meta.url);',
    ],
  ]) {
    const r = size([
      ["A", test, body],
      ["M", "src/pages/Venue.jsx", [spec, "const a = rule1(1);"]],
    ]);
    check(
      `変異は数える: ${label}`,
      r.lines === 252 && r.counted.some((c) => c.path === test),
      JSON.stringify(r.counted),
    );
  }
  const fromTest = size([
    ["A", "scripts/maintenance/verify-rules.js", body],
    [
      "A",
      "scripts/maintenance/verify-other.js",
      ['import { rule1 } from "./verify-rules.js";'],
    ],
    [
      "M",
      "scripts/maintenance/verify-registry.json",
      ['    { "script": "verify-rules.js" },'],
    ],
  ]);
  check(
    "新しい試験どうしの import・台帳の名は本体扱いしない",
    fromTest.lines === 0,
    JSON.stringify(fromTest.counted),
  );
  const nameOnly = size([
    ["A", "scripts/maintenance/verify-rules.js", body],
    ["M", "docs/a.md", ["`node scripts/maintenance/verify-rules.js` を回す"]],
  ]);
  check(
    "文書で名を挙げるだけなら本体扱いしない",
    nameOnly.lines === 1,
    JSON.stringify(nameOnly.counted),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runPrSizeScenes(env) {
  ({ check } = env);
  scenePureTests();
  scenePureNotes();
  scenePureLocale();
  scenePureLimit();
  sceneMutation();
}
