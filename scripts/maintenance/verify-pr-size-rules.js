#!/usr/bin/env node
/**
 * verify-pr-size-rules.js - PR の大きさの数え方（scripts/maintenance/prSize.js の measurePrSize、BOA-1718）の純関数の場面（1/2）。
 * 外部接続なし・git に触れない。試験のファイルに本体を置いた変異は verify-pr-size-mutation.js、実の履歴とこの PR の数は verify-pr-size.js。
 *
 * 数えない物（新しい試験・台帳の項目の追加・ja と同じキーの他の locale・注釈と空行・消した行）と数える物
 * （既存の試験の変更・helper・名だけの verify・md の行・キーの違う locale・行の無い差分・注釈の後ろのコード）、線の境（300行・5ファイル）
 */
import { SIZE_LIMIT, measurePrSize } from "./prSize.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const n = (k, f = (i) => `const v${i} = ${i};`) =>
  Array.from({ length: k }, (_, i) => f(i));
const REG = "scripts/maintenance/verify-registry.json";
const regText = (entries) => JSON.stringify({ entries });
/** 台帳の base（空）と head（files で足した verify-*.js を tier=ci で並べる）。texts に台帳があればそちらが勝つ */
const autoRegistry = (files) => ({
  [`base:${REG}`]: regText([]),
  [`head:${REG}`]: regText(
    files
      .filter(([st, p]) => st === "A" && /\/verify-[^/]+$/.test(p))
      .map(([, p]) => ({ script: p.split("/").pop(), tier: "ci" })),
  ),
});
/** 純関数の入力: files は [status, path, added, removed?, from?] */
const input = (files, texts = {}) => ({
  changes: files.map(([status, p, , , from]) => ({
    status,
    path: p,
    ...(from ? { from } : {}),
  })),
  patches: new Map(
    files
      .filter(([, , added]) => added !== null)
      .map(([, p, added, removed = []]) => [p, { added, removed }]),
  ),
  readText: (side, p) =>
    ({ ...autoRegistry(files), ...texts })[`${side}:${p}`] ?? null,
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

  const unregistered = size(
    [["A", "scripts/maintenance/verify-tool.js", n(150)]],
    { [`head:${REG}`]: regText([]) },
  );
  check(
    "台帳に tier=ci で足していない verify の名の道具は数える",
    unregistered.lines === 150,
    JSON.stringify(unregistered.counted),
  );

  const old = { script: "verify-a.js", tier: "ci", guards: "a" };
  const regRows = [
    [
      "M",
      REG,
      ["    {", '      "script": "verify-x.js",', "    },"],
      ["    }"],
    ],
  ];
  const regAdd = size(regRows, {
    [`base:${REG}`]: regText([old]),
    [`head:${REG}`]: regText([old, { script: "verify-x.js", tier: "ci" }]),
  });
  check(
    "台帳の新しい項目の追加だけは数えない",
    regAdd.lines === 0 && regAdd.files === 0,
    JSON.stringify(regAdd),
  );
  for (const [label, head] of [
    ["既存の項目に性質の行を足す", [{ ...old, args: ["--x"] }]],
    ["既存の項目の tier を変える", [{ ...old, tier: "manual" }]],
    [
      "既にある script の名で2つ目の項目を足す",
      [old, { script: "verify-a.js", tier: "manual" }],
    ],
  ]) {
    const r = size(regRows, {
      [`base:${REG}`]: regText([old]),
      [`head:${REG}`]: regText(head),
    });
    check(
      `台帳を数える: ${label}`,
      r.files === 1 && r.lines === 3,
      JSON.stringify(r.counted),
    );
  }
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

  const code = [
    "/**/ export const r = 1;",
    "{/* c */}<Row />",
    "  *entries() {",
    "/* 注釈 */ const b = 2;",
    "/**",
    " */",
    " *",
  ];
  const codeLike = size([
    ["M", "src/b.jsx", code],
    ["M", "src/b.css", ["* {", "*,", "*::before {", " * 注釈", "/* 閉じない"]],
  ]);
  check(
    "注釈の後ろにコードを置く行・ジェネレーター・CSS の * のセレクタは数える",
    codeLike.counted.find((c) => c.path === "src/b.jsx")?.lines === 4 &&
      codeLike.counted.find((c) => c.path === "src/b.css")?.lines === 4,
    JSON.stringify(codeLike.counted),
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

scenePureTests();
scenePureNotes();
scenePureLocale();
scenePureLimit();
if (failures > 0) {
  console.error(`NG: verify-pr-size-rules の試験が ${failures} 件失敗`);
  process.exit(1);
}
console.log("verify-pr-size-rules: OK");
