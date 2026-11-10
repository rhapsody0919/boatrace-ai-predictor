/**
 * verify-lint-duplicates.js - lint-changed.js --ci の jscpd の重なりの分け方（scripts/maintenance/lintDuplicates.js）を小さな固定の入力で試す。
 * 新しいファイルの側の重なりは赤・既にあるファイルだけの重なりは警告（今まで）。split-data-layer.mjs の出力そのままの PR で、
 * 差分の側が全部移しただけのファイルなら警告。手で1行でも足した・移すだけでない新しいファイルが側にあれば赤のまま。
 * fixture の import は文字列の中に置く（行の頭に相対の import を書くと verify-relative-imports が参照先を探す）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDuplicates,
  loadMoveOnly,
  movedFiles,
  notMovedReason,
  toChanges,
  treeReader,
} from "./lintDuplicates.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// 殻のパスは字を分けて書く（hq の verify_guard が文字列のパスを試す製品と見るため。この verify は殻の振る舞いを試さない）
const SVC = ["src/services", "supabaseDataService.js"].join("/");
const SQ = "src/services/scheduleQueries.js";
const NEW = "src/utils/handCopy.js";
const OLD = "src/utils/old.js";
const OTHER = "src/utils/untouched.js";

const dup = (a, b, n = 20) => ({
  lines: n,
  firstFile: { name: a, start: 1, end: n },
  secondFile: { name: b, start: 5, end: 4 + n },
});
const files = (...rows) =>
  new Map(rows.map(([name, added]) => [name, { added }]));

test("今までの分け方: 差分の無い重なりは出さない・既にあるファイルだけは警告・新しいファイルは赤", () => {
  const byFile = files([OLD, false], [NEW, true]);
  const r = classifyDuplicates(
    [dup(OTHER, "src/x.js"), dup(OLD, OTHER), dup(NEW, OTHER), dup(OLD, NEW)],
    byFile,
    new Set(),
  );
  assert.deepEqual(r.warnings, [
    "重なり 20 行: src/utils/old.js:1-20 と src/utils/untouched.js:5-24",
  ]);
  assert.deepEqual(r.errors, [
    "重なり 20 行: src/utils/handCopy.js:1-20 と src/utils/untouched.js:5-24",
    "重なり 20 行: src/utils/old.js:1-20 と src/utils/handCopy.js:5-24",
  ]);
});

test("差分の側が全部移しただけなら警告（to とほか・to どうし・殻と to）", () => {
  const byFile = files(
    [SVC, false],
    [SQ, true],
    ["src/services/core.js", true],
  );
  const moved = new Set([SVC, SQ, "src/services/core.js"]);
  const r = classifyDuplicates(
    [dup(SQ, OTHER), dup(SQ, "src/services/core.js"), dup(SVC, SQ)],
    byFile,
    moved,
  );
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 3);
  assert.ok(
    r.warnings.every((w) =>
      w.endsWith("（移しただけ。base の殻の字そのまま）"),
    ),
  );
});

test("移した PR でも、移すだけでないファイルが側にあれば赤（新しい写し・既にあるファイルへの写し）", () => {
  const byFile = files([SVC, false], [SQ, true], [NEW, true], [OLD, false]);
  const moved = new Set([SVC, SQ]);
  const r = classifyDuplicates(
    [dup(SQ, NEW), dup(NEW, OTHER), dup(SQ, OLD), dup(SVC, NEW)],
    byFile,
    moved,
  );
  assert.equal(r.warnings.length, 0);
  assert.equal(r.errors.length, 4);
  assert.ok(r.errors.every((e) => !e.includes("移しただけ")));
});

test("toChanges: 足した→A・改名→R・ほか→M", () => {
  assert.deepEqual(
    toChanges([
      { file: SQ, oldFile: SQ, added: true },
      { file: "b.js", oldFile: "a.js", added: false },
      { file: SVC, oldFile: SVC, added: false },
    ]),
    [
      { status: "A", path: SQ },
      { status: "R", path: "b.js" },
      { status: "M", path: SVC },
    ],
  );
});

// ---- movedFiles: 本物の設定（config/pr-path-rules.json の moveOnly）と prLaneMoveOnly.js で判定する ----
const lines = (...ls) => ls.join("\n") + "\n";
const BASE = lines(
  "/** 頭の注釈 */",
  'import { a } from "../utils/a.js";',
  'import { c } from "../utils/c.js";',
  "",
  "/** 殻 */",
  "export const supabaseDataService = {",
  "  async getX(v) {",
  "    const n = a(v);",
  "    return n + this.getY(v);",
  "  },",
  "  getY(v) {",
  "    return a(v) + 1;",
  "  },",
  "  getZ(v) {",
  "    return c(v);",
  "  },",
  "};",
);
const HEAD = lines(
  "/** 頭の注釈 */",
  'import { c } from "../utils/c.js";',
  'import { getX, getY } from "./scheduleQueries.js";',
  "",
  "/** 殻 */",
  "export const supabaseDataService = {",
  "  getX,",
  "  getY,",
  "  getZ(v) {",
  "    return c(v);",
  "  },",
  "};",
);
const TO = lines(
  `// ${SVC} から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: schedule）。`,
  "// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい",
  "",
  'import { a } from "../utils/a.js";',
  "",
  "export async function getX(v) {",
  "    const n = a(v);",
  "    return n + getY(v);",
  "  }",
  "export function getY(v) {",
  "    return a(v) + 1;",
  "  }",
);
const changed = [
  { file: SVC, oldFile: SVC, added: false },
  { file: SQ, oldFile: SQ, added: true },
];
const reader =
  ({ to = TO, head = HEAD } = {}) =>
  (side, p) =>
    p === SVC ? (side === "base" ? BASE : head) : p === SQ ? to : null;
const moveOnly = loadMoveOnly(ROOT);

test("movedFiles: 字のまま移した PR は from と to を返し、重なりは警告になる", () => {
  const moved = movedFiles(moveOnly, changed, reader());
  assert.deepEqual([...moved].sort(), [SQ, SVC]);
  const r = classifyDuplicates(
    [dup(SQ, OTHER)],
    files([SVC, false], [SQ, true]),
    moved,
  );
  assert.equal(r.errors.length, 0);
});

test("movedFiles: to に手で写しを足す・1字変えると空（重なりは赤）", () => {
  const copied =
    TO + lines("export function getY2(v) {", "    return a(v) + 1;", "  }");
  const edited = TO.replace("a(v) + 1", "a(v) + 2");
  for (const to of [copied, edited]) {
    const moved = movedFiles(moveOnly, changed, reader({ to }));
    assert.equal(moved.size, 0);
    const r = classifyDuplicates(
      [dup(SQ, OTHER)],
      files([SVC, false], [SQ, true]),
      moved,
    );
    assert.equal(r.errors.length, 1);
  }
  // 殻を変えない（from が変更でない）・読めない・設定が無い
  assert.equal(movedFiles(moveOnly, [changed[1]], reader()).size, 0);
  assert.equal(movedFiles(moveOnly, changed, () => null).size, 0);
  assert.equal(movedFiles(undefined, changed, reader()).size, 0);
});

test("movedFiles: 移した PR に別の新しいファイルを足しても、その側の重なりは赤", () => {
  const withNew = [...changed, { file: NEW, oldFile: null, added: true }];
  const moved = movedFiles(moveOnly, withNew, (side, p) =>
    p === NEW ? "export const z = 1;\n" : reader()(side, p),
  );
  assert.deepEqual([...moved].sort(), [SQ, SVC]);
  const r = classifyDuplicates(
    [dup(NEW, OTHER), dup(SQ, NEW)],
    files([SVC, false], [SQ, true], [NEW, true]),
    moved,
  );
  assert.equal(r.errors.length, 2);
});

test("treeReader: head は作業ツリーの字、無ければ null（base の git の木は段ごとの実測で見る。変異検査の写しに HEAD が無いため）", () => {
  const read = treeReader(ROOT, "HEAD");
  assert.equal(JSON.parse(read("head", "package.json")).type, "module");
  assert.equal(read("base", "no/such/file.js"), null);
  assert.equal(read("head", "no/such/file.js"), null);
});

test("movedFiles: to を改名で作った（R）PR は空。notMovedReason は to の形を足したのに外れたときだけ理由を返す", () => {
  const renamed = [
    changed[0],
    { file: SQ, oldFile: "src/services/x.js", added: false },
  ];
  assert.equal(movedFiles(moveOnly, renamed, reader()).size, 0);
  assert.equal(notMovedReason(moveOnly, changed, reader()), null);
  const edited = TO.replace("a(v) + 1", "a(v) + 2");
  assert.equal(
    typeof notMovedReason(moveOnly, changed, reader({ to: edited })),
    "string",
  );
  // to の形のファイルが無い PR（普通の PR）は理由を出さない
  assert.equal(
    notMovedReason(
      moveOnly,
      [{ file: NEW, oldFile: NEW, added: true }],
      () => null,
    ),
    null,
  );
});

test("loadMoveOnly: 本物の設定の from は殻、読めなければ意味のある文で落ちる", () => {
  assert.ok(new RegExp(moveOnly.from).test(SVC));
  assert.throws(() => loadMoveOnly("/no/such/root"), /moveOnly が読めない/);
});
