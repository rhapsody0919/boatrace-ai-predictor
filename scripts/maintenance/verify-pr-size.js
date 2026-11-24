#!/usr/bin/env node
/**
 * verify-pr-size.js - PR の大きさ（300行・5ファイル）の数え方（scripts/maintenance/prSize.js、BOA-1718）の試験と、この PR の数。
 *
 * 作り手が自分で数えて置き場の決まりを曲げた（#3304 とその前の #3303 で、src/pure に置かない・訳のキーを流用・注釈を削る）ので、
 * 数え方を機械に移した。数えない物は prSize.js の頭の注釈。超えたときは落とさず pr-lane で重い道（人が見る）に回す
 * （オーナー 2026-11-24 の (ii)）。この verify は数え方の試験が落ちたときだけ落ち、この PR の数は表示するだけ。
 *
 * 確かめること:
 *   1. 純関数: 数えない物（新しい試験・台帳の行の追加・ja と同じキーの他の locale・注釈と空行・消した行）と、数える物
 *      （既存の試験の変更・md の * の行・キーが合わない locale・行の無い差分）、線の境（300行・5ファイル）
 *   2. 試験のファイルに本体を置いた変異（ほかの変更が新しい verify・spec を import する）は数える
 *   3. 一時の git の木: 移すだけ（moveOnly）の大きい PR と記事の PR（check-content-pr.js が通す形）は線の外、
 *      どちらも1ファイルを足すと数える
 *   4. 実の差分: #3304（3fa222c70）と #3303（1069770b5）が線の中
 *   5. この PR（merge-base から HEAD）の数を出す
 *
 * 使い方: node scripts/maintenance/verify-pr-size.js --base=origin/master
 *   base や 4 のコミットを解決できない場合、CI（環境変数 CI）では失敗、手元ではスキップする。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIZE_LIMIT, measurePrSize, measureCommits } from "./prSize.js";
import { makePr } from "./verifyData/content-pr-gate-make-pr.js";
import { baseMd } from "./verifyData/content-pr-gate-fixtures.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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

// ---- 1. 純関数 ----
{
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

// ---- 2. 試験のファイルに本体を置いた変異 ----
{
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

// ---- 3. 一時の git の木 ----
const tmpGit = (fn) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "verify-pr-size-"));
  const g = (...args) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
  const write = (p, body) => {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), body);
  };
  const commit = (m) => {
    g("add", "-A");
    g("commit", "-q", "-m", m);
    return g("rev-parse", "HEAD").trim();
  };
  try {
    g("init", "-q", "-b", "main");
    g("config", "user.name", "verify");
    g("config", "user.email", "verify@example.invalid");
    fn({ dir, write, commit, g });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// 移すだけ: supabaseDataService.js の 120 個のメソッドを scheduleQueries.js へ字のまま移す（pr-lane の試験の場面と同じ形）
tmpGit(({ dir, write, commit }) => {
  const SVC = "src/services/supabaseDataService.js";
  const SQ = "src/services/scheduleQueries.js";
  const names = Array.from({ length: 120 }, (_, i) => `getM${i}`);
  const method = (m) => [`  ${m}(v) {`, `    return b(v) + "${m}";`, "  },"];
  write(
    "src/utils/a.js",
    "export const b = (v) => v;\nexport const c = (v) => v;\n",
  );
  write(
    SVC,
    [
      'import { b } from "../utils/a.js";',
      'import { c } from "../utils/a.js";',
      "",
      "export const supabaseDataService = {",
      ...names.flatMap(method),
      "  getZ(v) {",
      "    return c(v);",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  const base = commit("base");
  write(
    SVC,
    [
      'import { c } from "../utils/a.js";',
      `import { ${names.join(", ")} } from "./scheduleQueries.js";`,
      "",
      "export const supabaseDataService = {",
      ...names.map((m) => `  ${m},`),
      "  getZ(v) {",
      "    return c(v);",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  write(
    SQ,
    [
      "// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: schedule）。",
      "// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい",
      "",
      'import { b } from "../utils/a.js";',
      "",
      ...names.flatMap((m) => [
        `export function ${m}(v) {`,
        `    return b(v) + "${m}";`,
        "  }",
      ]),
      "",
    ].join("\n"),
  );
  const head = commit("move");
  const r = measureCommits(dir, base, head);
  check(
    "一時の木: 移すだけの PR（360行を超える移し）は線の外",
    r.exempt !== null && !r.over,
    JSON.stringify({ ...r, skipped: r.skipped.length }),
  );
  write("src/pages/Extra.jsx", "export const x = 1;\n");
  const head2 = commit("extra");
  const r2 = measureCommits(dir, base, head2);
  check(
    "一時の木: 移すだけに1ファイルを足すと全部数えて超える",
    r2.exempt === null && r2.over,
    JSON.stringify({ lines: r2.lines, files: r2.files }),
  );
});

// 記事の PR: verify-content-pr-gate.js の正しい新規記事（makePr）を木に置き、check-content-pr.js に判定させる
tmpGit(({ dir, write, commit, g }) => {
  const pr = makePr({
    md: `${baseMd}\n${n(400, (i) => `段落 ${i}。`).join("\n\n")}\n`,
  });
  for (const p of pr.basePaths)
    write(p, p.endsWith(".json") ? "{}\n" : "# 既存\n");
  const base = commit("base");
  for (const [p, bytes] of Object.entries(pr.head)) write(p, bytes);
  const head = commit("article");
  const r = measureCommits(dir, base, head);
  check(
    "一時の木: 記事の PR（400行を超える本文）は線の外",
    r.exempt !== null && !r.over,
    JSON.stringify({ exempt: r.exempt, lines: r.lines }),
  );
  write("src/pages/Extra.jsx", "export const x = 1;\n");
  const head2 = commit("extra");
  const r2 = measureCommits(dir, base, head2);
  check(
    "一時の木: 記事の PR に src を足すと記事の PR でなくなり数える",
    r2.exempt === null && r2.lines > SIZE_LIMIT.lines,
    JSON.stringify({ exempt: r2.exempt, lines: r2.lines }),
  );
  g("checkout", "-q", head);
  const r3 = measureCommits(dir, base, head2);
  check(
    "一時の木: head が HEAD でなければ記事の PR と判定しない（数える側）",
    r3.exempt === null,
    JSON.stringify({ exempt: r3.exempt }),
  );
});

// ---- 4. 実の差分（#3304 と #3303。作り手が線に合わせて置き場を曲げた PR） ----
const resolvable = (ref) => {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { cwd: ROOT, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
};
const skipOrFail = (message) => {
  if (process.env.CI) {
    failures += 1;
    console.error(`❌ ${message}`);
  } else console.log(`スキップ: ${message}（手元のため。CIでは失敗扱い）`);
};
for (const [pr, sha, spec] of [
  ["#3304", "3fa222c70", "e2e/venue-race-block.spec.js"],
  ["#3303", "1069770b5", "e2e/venue-meet-heading.spec.js"],
]) {
  if (!resolvable(sha)) {
    skipOrFail(`${pr}（${sha}）を解決できない`);
    continue;
  }
  const r = measureCommits(ROOT, `${sha}^`, sha);
  check(
    `実の差分: ${pr} は線の中で、新しい spec を数えない`,
    !r.over &&
      r.exempt === null &&
      r.skipped.some((s) => s.path === spec) &&
      r.lines < SIZE_LIMIT.lines,
    JSON.stringify({ lines: r.lines, files: r.files, counted: r.counted }),
  );
}

if (failures > 0) {
  console.error(`NG: PR の大きさの数え方の試験が ${failures} 件失敗`);
  process.exit(1);
}

// ---- 5. この PR ----
const base =
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--base="))
    .map((a) => a.slice("--base=".length))
    .pop() || "origin/master";
if (!resolvable(base)) {
  skipOrFail(`base（${base}）を解決できない`);
  process.exit(failures > 0 ? 1 : 0);
}
const mine = measureCommits(ROOT, base, "HEAD");
if (mine.exempt) console.log(`OK: この PR は線の外（${mine.exempt}）`);
else {
  console.log(
    `${mine.over ? "超える" : "OK"}: この PR は ${mine.lines}行・${mine.files}ファイル（線は ${SIZE_LIMIT.lines}行・${SIZE_LIMIT.files}ファイル、数え方は scripts/maintenance/prSize.js）`,
  );
  for (const c of mine.counted) console.log(`  数える ${c.lines}行 ${c.path}`);
  for (const s of mine.skipped) console.log(`  数えない ${s.path}（${s.why}）`);
  if (mine.over)
    console.log(
      "  超えた PR は pr-lane で重い道（人が見る）に回る。落とさない",
    );
}
